// app.js — PDF Text Extractor (ES module). Everything runs on this device: the PDF is read with the
// vendored pdf.js, whose own Web Worker parses the file; lines are rebuilt by ./extract.js.
import { toast, downloadBlob, formatBytes, wireDropzone } from './site.js';
import { buildLines, renderDocument, parseRange, describePages, txtName } from './extract.js';

const $ = (id) => document.getElementById(id);
const zone = $('dropzone');
const input = $('file-input');
const results = $('results');
const messages = $('messages');
const progressBox = $('progress-box');
const progressBar = $('progress-bar');
const progressText = $('progress-text');
const card = $('result-card');
const output = $('output');
const backdrop = $('output-backdrop');
const stats = $('stats');
const fileLabel = $('file-label');
const scanNote = $('scan-note');
const copyBtn = $('copy');
const downloadBtn = $('download');
const downloadLabel = $('download-label');
const search = $('search');
const searchCount = $('search-count');
const opt = {
  markers: $('opt-markers'),
  lines: $('opt-lines'),
  dehyphen: $('opt-dehyphen'),
  range: $('opt-range'),
  bom: $('opt-bom'),
};

const YIELD_EVERY = 5; // pages between breaks to the event loop
const PREVIEW_EVERY = 25; // pages between partial renders on long documents

let pdfjsPromise = null;
let doc = null; // the open PDFDocumentProxy
let file = null; // the File it came from
const cache = new Map(); // page number → lines
let job = 0; // bumps on every new extraction; stale loops stop themselves
let current = { text: '', name: 'document.txt' };
let matches = [];
let matchIndex = -1;

function loadPdfjs() {
  pdfjsPromise ||= import('./vendor/pdfjs-dist/pdf.min.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs-dist/pdf.worker.min.mjs', import.meta.url).href;
    return lib;
  });
  return pdfjsPromise;
}

// ---------- messages ----------
function clearMessages() { messages.replaceChildren(); }

function showMessage(text, kind = 'error') {
  const el = document.createElement('div');
  el.className = `alert alert--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = text;
  messages.appendChild(el);
  return el;
}

function showPasswordForm(f, wrong) {
  const box = showMessage(wrong
    ? 'That password is not right. Check it and try again.'
    : `“${f.name}” is password protected. Enter its password to read the text. The password stays on this device.`, 'error');
  box.classList.add('unlock');
  const form = document.createElement('form');
  form.className = 'unlock__form';
  form.innerHTML = `
    <div class="field">
      <label for="pdf-password">PDF password</label>
      <input type="password" id="pdf-password" autocomplete="off" required>
    </div>
    <button class="btn btn--primary" type="submit">Unlock</button>`;
  box.appendChild(form);
  const pw = form.querySelector('input');
  form.addEventListener('submit', (e) => { e.preventDefault(); openPdf(f, pw.value); });
  pw.focus();
}

// ---------- loading ----------
const isPdfName = (f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';

async function looksLikePdf(f) {
  const head = new Uint8Array(await f.slice(0, 1024).arrayBuffer());
  const s = String.fromCharCode(...head);
  return s.includes('%PDF-');
}

async function handleFiles(files) {
  clearMessages();
  const list = [...files];
  const pdfs = list.filter(isPdfName);
  const rejected = list.filter((f) => !isPdfName(f));
  if (rejected.length) {
    const names = rejected.map((f) => `“${f.name}”`).join(', ');
    showMessage(`${names} ${rejected.length === 1 ? 'is not a PDF' : 'are not PDFs'}. This tool reads .pdf files only.`);
  }
  if (!pdfs.length) return;
  if (pdfs.length > 1) showMessage(`One PDF at a time: showing “${pdfs[0].name}”. Drop the others one by one.`, 'info');
  await openPdf(pdfs[0]);
}

async function openPdf(f, password) {
  const myJob = ++job;
  if (!(await looksLikePdf(f))) {
    clearMessages();
    showMessage(`“${f.name}” does not look like a PDF. It may be damaged or another kind of file renamed to .pdf.`);
    return;
  }
  setBusy(true, `Opening ${f.name}…`, 0);
  let lib;
  let next;
  try {
    lib = await loadPdfjs();
    const data = new Uint8Array(await f.arrayBuffer());
    next = await lib.getDocument({ data, password, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  } catch (err) {
    if (myJob !== job) return;
    setBusy(false);
    messages.querySelectorAll('.unlock').forEach((el) => el.remove());
    if (err?.name === 'PasswordException') {
      showPasswordForm(f, err.code === lib?.PasswordResponses?.INCORRECT_PASSWORD);
    } else if (err?.name === 'InvalidPDFException') {
      showMessage(`“${f.name}” could not be read as a PDF. The file may be damaged or incomplete.`);
    } else {
      showMessage(`Could not open “${f.name}”: ${err?.message || err}`);
    }
    return;
  }
  if (myJob !== job) { next.destroy(); return; }
  messages.querySelectorAll('.unlock').forEach((el) => el.remove());
  if (doc) doc.destroy();
  doc = next;
  file = f;
  cache.clear();
  opt.range.setAttribute('placeholder', `all (1-${doc.numPages})`);
  await run(true);
}

// Extracts every page in the chosen range that is not cached yet, then renders.
async function run(scroll = false) {
  if (!doc) return;
  messages.querySelectorAll('.range-error').forEach((el) => el.remove());
  opt.range.removeAttribute('aria-invalid');
  let pages;
  try {
    pages = parseRange(opt.range.value, doc.numPages);
  } catch (err) {
    opt.range.setAttribute('aria-invalid', 'true');
    showMessage(err.message).classList.add('range-error');
    return;
  }
  const myJob = ++job;
  const todo = pages.filter((n) => !cache.has(n));
  if (todo.length) {
    card.hidden = !cache.size;
    for (let i = 0; i < todo.length; i++) {
      if (myJob !== job) return;
      setBusy(true, `Reading page ${todo[i]} (${i + 1} of ${todo.length})`, i / todo.length, todo.length > 1);
      try {
        const page = await doc.getPage(todo[i]);
        const content = await page.getTextContent();
        cache.set(todo[i], buildLines(content.items));
        page.cleanup();
      } catch (err) {
        if (myJob !== job) return;
        cache.set(todo[i], []);
        showMessage(`Page ${todo[i]} could not be read: ${err?.message || err}`);
      }
      if ((i + 1) % YIELD_EVERY === 0) await new Promise((r) => setTimeout(r));
      if ((i + 1) % PREVIEW_EVERY === 0 && myJob === job) { render(pages, true); card.hidden = false; }
    }
    if (myJob !== job) return;
    setBusy(false);
  }
  render(pages);
  card.hidden = false;
  if (scroll) card.scrollIntoView({ block: 'nearest' });
}

function cancel() {
  job++;
  setBusy(false);
  if (!doc) return;
  const pages = (() => { try { return parseRange(opt.range.value, doc.numPages); } catch { return []; } })();
  const done = pages.filter((n) => cache.has(n));
  showMessage(done.length
    ? `Stopped. The text below covers ${done.length} of ${pages.length} pages; change an option or the page range to continue.`
    : 'Stopped before any page was read.', 'info');
  if (done.length) { render(pages, true); card.hidden = false; }
}

function setBusy(on, label = '', fraction = 0, showPct = true) {
  progressBox.hidden = !on;
  if (!on) return;
  // Floor to one decimal so 99.95% never reads as 100%.
  const pct = Math.floor(fraction * 1000) / 10;
  progressBar.style.width = `${pct}%`;
  progressBox.querySelector('.progress').setAttribute('aria-valuenow', String(pct));
  progressText.textContent = showPct ? `${label} · ${pct}%` : label;
}

// ---------- rendering ----------
function options() {
  return { markers: opt.markers.checked, join: opt.lines.value === 'join', dehyphen: opt.dehyphen.checked };
}

function render(pages, partial = false) {
  const ready = pages.filter((n) => cache.has(n)).map((num) => ({ num, lines: cache.get(num) }));
  const r = renderDocument(ready, options());
  current = { text: r.text, name: txtName(file?.name) };
  const scroll = output.scrollTop;
  output.value = r.text;
  output.scrollTop = scroll;

  const count = ready.length;
  const ofTotal = count === doc.numPages ? '' : ` of ${doc.numPages}`;
  stats.textContent = `${count.toLocaleString()}${ofTotal} page${count === 1 && !ofTotal ? '' : 's'} · ${r.words.toLocaleString()} words · ${r.chars.toLocaleString()} characters${partial ? ' so far' : ''}`;
  fileLabel.textContent = `${file.name} · ${formatBytes(file.size)}`;

  if (r.emptyPages.length && r.emptyPages.length === count) {
    scanNote.textContent = count === 1
      ? 'This page has no text layer, so it looks like a scan or a picture. This tool does not do OCR, so there is no text to extract.'
      : 'None of these pages has a text layer, so the PDF looks scanned. This tool does not do OCR, so there is no text to extract.';
    scanNote.hidden = false;
  } else if (r.emptyPages.length) {
    const many = r.emptyPages.length > 1;
    scanNote.textContent = `${many ? 'Pages' : 'Page'} ${describePages(r.emptyPages)} ${many ? 'look like scans' : 'looks like a scan'}: no text layer was found, so ${many ? 'they are' : 'it is'} empty here. This tool does not do OCR.`;
    scanNote.hidden = false;
  } else {
    scanNote.hidden = true;
  }

  const hasText = r.chars > 0;
  copyBtn.disabled = !hasText;
  downloadBtn.disabled = !hasText;
  downloadLabel.textContent = `Download ${current.name}`;
  downloadBtn.title = `Download ${current.name}`;
  updateSearch(false);
}

// ---------- search with highlights ----------
const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function updateSearch(resetIndex = true) {
  const q = search.value;
  const text = output.value;
  matches = [];
  if (q) {
    const re = new RegExp(escapeRe(q), 'giu');
    for (let m; (m = re.exec(text)) && matches.length < 10000;) matches.push([m.index, m.index + m[0].length]);
  }
  if (resetIndex || matchIndex >= matches.length) matchIndex = matches.length ? 0 : -1;
  if (!q) {
    backdrop.replaceChildren();
    searchCount.textContent = '';
    return;
  }
  let html = '';
  let at = 0;
  matches.forEach(([a, b], i) => {
    html += `${escapeHtml(text.slice(at, a))}<mark${i === matchIndex ? ' class="is-current"' : ''}>${escapeHtml(text.slice(a, b))}</mark>`;
    at = b;
  });
  // A trailing newline needs a character after it to take up space, as it does in the textarea.
  backdrop.innerHTML = `${html}${escapeHtml(text.slice(at))} `;
  backdrop.scrollTop = output.scrollTop;
  searchCount.textContent = matches.length
    ? `${matchIndex + 1} of ${matches.length.toLocaleString()}${matches.length >= 10000 ? '+' : ''} matches`
    : 'No matches';
}

function jumpToMatch(step) {
  if (!matches.length) return;
  matchIndex = (matchIndex + step + matches.length) % matches.length;
  const marks = backdrop.querySelectorAll('mark');
  marks.forEach((m, i) => m.classList.toggle('is-current', i === matchIndex));
  const mark = marks[matchIndex];
  if (mark) {
    output.scrollTop = Math.max(0, mark.offsetTop - output.clientHeight / 3);
    backdrop.scrollTop = output.scrollTop;
  }
  output.setSelectionRange(matches[matchIndex][0], matches[matchIndex][1]);
  searchCount.textContent = `${matchIndex + 1} of ${matches.length.toLocaleString()} matches`;
}

// ---------- copy and download ----------
async function copyText() {
  const text = current.text;
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    // Fallback for browsers without the async clipboard (or without permission): select and copy.
    output.focus();
    output.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
  }
  if (ok) {
    copyBtn.querySelector('span').textContent = 'Copied';
    copyBtn.classList.add('is-done');
    toast('Text copied to the clipboard');
    clearTimeout(copyText.timer);
    copyText.timer = setTimeout(() => { copyBtn.querySelector('span').textContent = 'Copy text'; copyBtn.classList.remove('is-done'); }, 2000);
  } else {
    output.focus();
    output.select();
    showMessage('This browser blocked the clipboard. The text is selected: press Ctrl+C (or ⌘C), or tap and hold to copy.', 'info');
  }
}

function download() {
  const parts = opt.bom.checked ? [String.fromCharCode(0xFEFF), current.text] : [current.text];
  downloadBlob(new Blob(parts, { type: 'text/plain;charset=utf-8' }), current.name);
}

// ---------- wiring ----------
wireDropzone(zone, input, handleFiles);
$('cancel').addEventListener('click', cancel);
copyBtn.addEventListener('click', copyText);
downloadBtn.addEventListener('click', download);
[opt.markers, opt.lines, opt.dehyphen].forEach((el) => el.addEventListener('change', () => run()));
opt.range.addEventListener('change', () => run());
opt.range.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
search.addEventListener('input', () => updateSearch(true));
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); jumpToMatch(e.shiftKey ? -1 : 1); }
});
$('search-next').addEventListener('click', () => jumpToMatch(1));
output.addEventListener('scroll', () => { backdrop.scrollTop = output.scrollTop; });
output.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); output.select(); }
});

// Called by the factory's screenshot script: a finished extraction of the bundled fictional invoice.
window.__demo = async () => {
  const res = await fetch('./tests/fixtures/invoice-2041.pdf');
  const blob = await res.blob();
  await handleFiles([new File([blob], 'Invoice 2041.pdf', { type: 'application/pdf' })]);
  search.value = 'Birch';
  updateSearch(true);
};

export { handleFiles };
