// make-fixtures.js — writes the small, fictional PDF fixtures used by __demo and tests/smoke.spec.js.
// Run with: node tests/make-fixtures.js   (Node built-ins only, no dependencies)
//   tests/fixtures/invoice-2041.pdf  two text pages (header, item table, note with hyphenated line ends)
//                                    plus a third page that is only an image, like a scan
//   tests/fixtures/locked.pdf        one text page protected with the user password "birch" (RC4 40-bit)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const OUT = path.join(__dirname, 'fixtures');

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const text = (font, size, x, y, s) => `BT /${font} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`;

// Builds a PDF from an array of object bodies (strings or Buffers); object n is objects[n - 1].
function buildPdf(objects, trailerExtra = '') {
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = parts[0].length;
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
      Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'),
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(chunk);
    offset += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

const stream = (content, dict = '') => {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'latin1');
  return Buffer.concat([Buffer.from(`<< /Length ${data.length} ${dict}>>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
};

// ---------- invoice-2041.pdf ----------
function invoice() {
  const p1 = [
    text('F2', 26, 60, 770, 'Invoice 2041'),
    text('F1', 14, 60, 742, 'Birch and Pine Studio'),
    text('F1', 10, 60, 712, 'Issued 3 March 2026'),
    text('F1', 10, 60, 698, 'Due 2 April 2026'),
    text('F1', 10, 60, 684, 'Bill to: Example Client Co., Unit 7, Sample Park'),
  ];
  const cols = [60, 330, 400, 480];
  const rows = [
    ['Item', 'Qty', 'Rate', 'Amount'],
    ['Logo design and brand sheet', '1', '900.00', '900.00'],
    ['Website layout, five pages', '1', '1,600.00', '1,600.00'],
    ['Product photo retouching', '24', '15.00', '360.00'],
    ['Business card print files', '2', '75.00', '150.00'],
  ];
  rows.forEach((r, i) => r.forEach((cell, c) => p1.push(text(i === 0 ? 'F2' : 'F1', 11, cols[c], 640 - i * 20, cell))));
  p1.push(text('F1', 11, 400, 520, 'Subtotal'), text('F1', 11, 480, 520, '3,010.00'));
  p1.push(text('F1', 11, 400, 502, 'Tax (10%)'), text('F1', 11, 480, 502, '301.00'));
  p1.push(text('F2', 11, 400, 484, 'Total due'), text('F2', 11, 480, 484, '3,311.00'));
  const note = [
    'Note: Thank you for choosing Birch and Pine Studio. Payment is due within thirty',
    'days of the issue date. Please include the invoice number with your bank trans-',
    'fer so we can match it quickly. Source files are delivered once the full bal-',
    'ance has been received.',
  ];
  note.forEach((l, i) => p1.push(text('F1', 11, 60, 430 - i * 15, l)));

  const p2 = [
    text('F2', 18, 60, 770, 'Invoice 2041 - payment details'),
    text('F1', 11, 60, 735, 'Account name: Birch and Pine Studio'),
    text('F1', 11, 60, 720, 'Reference: INV-2041'),
    text('F1', 11, 60, 705, 'Accepted: bank transfer or card'),
    text('F2', 13, 60, 665, 'Terms'),
    text('F1', 11, 60, 645, 'Late payments may incur a fee of two percent per month. Revisions beyond the'),
    text('F1', 11, 60, 630, 'two rounds included in each item are billed at the hourly rate agreed in the'),
    text('F1', 11, 60, 615, 'project brief.'),
    text('F1', 11, 60, 575, 'Thank you for your business!'),
  ];

  // Page 3: a grey "scanned" image with dark bars where lines of text would be, and no text layer.
  const W = 120, H = 160;
  const px = Buffer.alloc(W * H, 238);
  for (let y = 12; y < H - 12; y += 7) {
    const len = 70 + ((y * 37) % 30);
    for (let yy = y; yy < y + 3; yy++) for (let x = 12; x < 12 + len; x++) px[yy * W + x] = 70 + ((x * 13 + yy * 7) % 40);
  }
  const img = stream(zlib.deflateSync(px), `/Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode `);
  const p3 = 'q 450 0 0 600 72 120 cm /Im1 Do Q';

  const fonts = '/Font << /F1 3 0 R /F2 4 0 R >>';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [5 0 R 7 0 R 9 0 R] /Count 3 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << ${fonts} >> >>`,
    stream(p1.join('\n')),
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 8 0 R /Resources << ${fonts} >> >>`,
    stream(p2.join('\n')),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 10 0 R /Resources << /XObject << /Im1 11 0 R >> >> >>',
    stream(p3),
    img,
  ];
  objects.push('<< /Title (Invoice 2041 - Birch and Pine Studio) /Producer (make-fixtures.js) >>');
  return buildPdf(objects, '/Info 12 0 R ');
}

// ---------- locked.pdf (Standard security handler, revision 2, 40-bit RC4) ----------
function rc4(key, data) {
  const s = [...Array(256).keys()];
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}
const md5 = (...bufs) => crypto.createHash('md5').update(Buffer.concat(bufs)).digest();
const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const pad = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);

function locked() {
  const userPw = 'birch', ownerPw = 'pine-owner';
  const id = md5(Buffer.from('locked-fixture'));
  const O = rc4(md5(pad(ownerPw)).subarray(0, 5), pad(userPw));
  const P = Buffer.alloc(4); P.writeInt32LE(-4);
  const key = md5(pad(userPw), O, P, id).subarray(0, 5);
  const U = rc4(key, PAD);
  const objKey = (num) => md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, 10);
  const content = [text('F1', 20, 60, 760, 'Locked sample invoice'), text('F1', 12, 60, 730, 'Opened with the password birch.')].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    stream(rc4(objKey(4), Buffer.from(content, 'latin1'))),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P -4 >>`,
  ];
  return buildPdf(objects, `/Encrypt 6 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] `);
}

fs.writeFileSync(path.join(OUT, 'invoice-2041.pdf'), invoice());
fs.writeFileSync(path.join(OUT, 'locked.pdf'), locked());
console.log('wrote invoice-2041.pdf and locked.pdf');
