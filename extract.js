// extract.js — turns pdf.js text items into lines and paragraphs, and lines into plain text.
// Pure functions with no DOM access, so app.js can re-render instantly when an option changes.

// Ligatures (U+FB00–FB06) and Arabic/Hebrew presentation forms are folded with NFKC; private-use
// glyphs (icon fonts, unmapped symbols) and control characters are dropped.
const cp = (n) => '\\u{' + n.toString(16) + '}';
const cls = (...ranges) => new RegExp(`[${ranges.map(([a, b]) => (b ? `${cp(a)}-${cp(b)}` : cp(a))).join('')}]`, 'gu');
const PRESENTATION = cls([0xFB00, 0xFDFF], [0xFE70, 0xFEFF]);
const JUNK = cls([0xE000, 0xF8FF], [0x0, 0x8], [0xB, 0x1F], [0x7F], [0xFFFD]);
const ODD_SPACE = cls([0xA0], [0x2000, 0x200A], [0x202F], [0x3000]);
const SOFT_HYPHEN = String.fromCharCode(0xAD);

export function cleanText(s) {
  return s
    .replace(PRESENTATION, (c) => c.normalize('NFKC'))
    .replace(JUNK, '')
    .replace(ODD_SPACE, ' ')
    .normalize('NFC');
}

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// items: textContent.items from pdf.js. Returns [{ text, y, size, left, right, tabular, gapBefore }].
export function buildLines(items) {
  const runs = [];
  for (const it of items) {
    if (typeof it.str !== 'string') continue; // marked-content markers
    const str = cleanText(it.str);
    if (!str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 10;
    runs.push({ str, x: e, y: f, w: Math.max(0, it.width || 0), size, rtl: it.dir === 'rtl' });
  }
  if (!runs.length) return [];

  // Group runs into lines by baseline, with a tolerance relative to the font size.
  runs.sort((p, q) => q.y - p.y || p.x - q.x);
  const groups = [];
  for (const r of runs) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.y - r.y) <= 0.45 * Math.min(g.size, r.size)) {
      g.runs.push(r);
      g.size = Math.max(g.size, r.size);
    } else {
      groups.push({ y: r.y, size: r.size, runs: [r] });
    }
  }

  const lines = groups.map((g) => {
    // Right-to-left lines keep pdf.js's logical order by reading runs from right to left.
    const rtl = g.runs.filter((r) => r.rtl).length > g.runs.length / 2;
    const rs = g.runs.sort((p, q) => (rtl ? q.x + q.w - (p.x + p.w) : p.x - q.x));
    let text = '';
    let prev = null;
    for (const r of rs) {
      if (prev) {
        const gap = rtl ? prev.x - (r.x + r.w) : r.x - (prev.x + prev.w);
        const size = Math.min(prev.size, r.size);
        if (gap > 2.5 * size) text = text.replace(/ +$/, '') + '\t';
        else if (gap > 0.2 * size && !/\s$/.test(text) && !/^\s/.test(r.str)) text += ' ';
      }
      text += r.str;
      prev = r;
    }
    text = text.replace(/ {2,}/g, ' ').trim();
    const left = Math.min(...rs.map((r) => r.x));
    const right = Math.max(...rs.map((r) => r.x + r.w));
    return { text, y: g.y, size: g.size, left, right, tabular: text.includes('\t'), gapBefore: false };
  }).filter((l) => l.text);

  // A vertical gap clearly bigger than normal line spacing starts a new paragraph.
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    lines[i].gapBefore = gap > 1.9 * Math.min(lines[i - 1].size, lines[i].size);
  }
  return lines;
}

const SENTENCE_END = /[.!?:;]["'”’)\]]*$/;
const HYPHEN_END = new RegExp(`\\p{L}[-${SOFT_HYPHEN}]$`, 'u');
const LOWER_START = /^\p{Ll}/u;

// Renders one page's lines. opts: { join: boolean, dehyphen: boolean }.
export function renderLines(lines, opts) {
  if (!lines.length) return '';
  const textLines = lines.filter((l) => !l.tabular);
  const pageLeft = median(lines.map((l) => l.left));
  const pageRight = Math.max(...(textLines.length ? textLines : lines).map((l) => l.right));
  const width = Math.max(1, pageRight - pageLeft);

  const out = []; // paragraphs: arrays of output lines
  let para = null;
  let prev = null;
  for (const line of lines) {
    let text = line.text;
    if (!para || line.gapBefore) {
      para = [];
      out.push(para);
      para.push(text);
      prev = line;
      continue;
    }
    const last = para[para.length - 1];
    const hyphenated = HYPHEN_END.test(last) && LOWER_START.test(text);
    if (hyphenated && opts.dehyphen) {
      if (opts.join) {
        para[para.length - 1] = last.slice(0, -1) + text;
      } else {
        // Keep the layout, but pull the rest of the split word up to the line it started on.
        const m = text.match(/^(\S+)\s*(.*)$/);
        para[para.length - 1] = last.slice(0, -1) + m[1];
        if (m[2]) para.push(m[2]);
      }
    } else if (opts.join && (hyphenated || joinable(prev, line, last, pageLeft, width))) {
      para[para.length - 1] = hyphenated ? last + text : `${last} ${text}`;
    } else {
      para.push(text);
    }
    prev = line;
  }
  return out.map((p) => p.join('\n')).join('\n\n');
}

// Join a line onto the previous one only when it reads like wrapped prose: the previous line has no
// sentence punctuation at its end, runs most of the text width, and neither line is a table row or
// a heading in a different font size.
function joinable(prev, line, lastText, pageLeft, width) {
  if (SENTENCE_END.test(lastText)) return false;
  if (prev.tabular || line.tabular) return false;
  if (Math.abs(prev.size - line.size) > 0.15 * Math.max(prev.size, line.size)) return false;
  return (prev.right - pageLeft) / width >= 0.75;
}

export const pageMarker = (n) => `--- Page ${n} ---`;

// pages: [{ num, lines }]. Returns { text, words, chars, emptyPages }.
export function renderDocument(pages, opts) {
  const parts = [];
  const bodies = [];
  const emptyPages = [];
  for (const { num, lines } of pages) {
    const body = renderLines(lines, opts);
    if (!body) emptyPages.push(num);
    else bodies.push(body);
    if (opts.markers) parts.push(`${pageMarker(num)}\n\n${body || '[No text layer on this page]'}`);
    else if (body) parts.push(body);
  }
  const all = bodies.join('\n\n');
  return {
    text: parts.join('\n\n') + (parts.length ? '\n' : ''),
    words: (all.match(/\S+/g) || []).length,
    chars: all.length,
    emptyPages,
  };
}

// "all", "", "1-3, 5", "7-" → sorted unique page numbers within 1..max. Throws a readable Error.
export function parseRange(input, max) {
  const s = String(input || '').trim().toLowerCase().replace(/\s*[-–—]\s*/g, '-');
  if (!s || s === 'all') return Array.from({ length: max }, (_, i) => i + 1);
  const set = new Set();
  for (const part of s.split(/[\s,;]+/).filter(Boolean)) {
    const m = part.match(/^(\d*)-(\d*)$/) || part.match(/^(\d+)$/);
    if (!m) throw new Error(`“${part}” is not a page or range. Use something like 1-3, 5.`);
    let a; let b;
    if (m.length === 2) { a = b = Number(m[1]); } else { a = m[1] ? Number(m[1]) : 1; b = m[2] ? Number(m[2]) : max; }
    if (!a || !b) throw new Error('Page numbers start at 1.');
    if (a > b) [a, b] = [b, a];
    if (a > max) throw new Error(`Page ${a} does not exist: this PDF has ${max} page${max === 1 ? '' : 's'}.`);
    for (let n = a; n <= Math.min(b, max); n++) set.add(n);
  }
  return [...set].sort((x, y) => x - y);
}

// [1,2,3,5,9] → "1–3, 5 and 9"
export function describePages(nums) {
  const ranges = [];
  for (const n of nums) {
    const r = ranges[ranges.length - 1];
    if (r && n === r[1] + 1) r[1] = n;
    else ranges.push([n, n]);
  }
  const parts = ranges.map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a}, ${b}` : `${a}–${b}`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || '';
}

export function txtName(pdfName) {
  const base = String(pdfName || '').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').trim();
  return `${base || 'document'}.txt`;
}
