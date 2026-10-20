// smoke.spec.js — PDF Text Extractor: the core action on bundled fictional fixtures.
// Fixtures come from tests/make-fixtures.js: invoice-2041.pdf (2 text pages + 1 image-only page)
// and locked.pdf (user password "birch").
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const fixture = (name) => path.join(__dirname, 'fixtures', name);
const INVOICE = fixture('invoice-2041.pdf');

async function load(page, files = INVOICE) {
  await page.goto('./');
  await page.setInputFiles('#file-input', files);
}

async function loaded(page) {
  await expect(page.locator('#result-card')).toBeVisible();
  await expect(page.locator('#stats')).toContainText('3 pages');
  await expect(page.locator('#progress-box')).toBeHidden();
}

const text = (page) => page.locator('#output').inputValue();

test.describe('PDF Text Extractor', () => {
  test('loading the bundled sample shows extracted text containing Invoice', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await load(page);
    await loaded(page);
    const out = await text(page);
    expect(out).toContain('Invoice 2041');
    expect(out).toContain('Birch and Pine Studio');
    expect(out).toMatch(/Logo design and brand sheet\t1\t900\.00\t900\.00/);
    await expect(page.locator('#stats')).toContainText(/\d+ words · \d[\d,]* characters/);
    // The image-only third page is reported, not silently dropped.
    await expect(page.locator('#scan-note')).toBeVisible();
    await expect(page.locator('#scan-note')).toContainText('Page 3 looks like a scan');
    expect(errors).toEqual([]);
  });

  test('__demo shows a finished result from the bundled fixture', async ({ page }) => {
    await page.goto('./');
    await page.evaluate(() => window.__demo());
    await loaded(page);
    expect(await text(page)).toContain('Invoice');
    await expect(page.locator('#search-count')).toContainText(/of \d+ matches/);
    await expect(page.locator('#download-label')).toHaveText('Download Invoice 2041.txt');
  });

  test('the page markers option inserts a page separator between pages', async ({ page }) => {
    await load(page);
    await loaded(page);
    let out = await text(page);
    const p1 = out.indexOf('--- Page 1 ---');
    const sep = out.indexOf('--- Page 2 ---');
    expect(p1).toBe(0);
    expect(sep).toBeGreaterThan(out.indexOf('Total due'));
    expect(sep).toBeLessThan(out.indexOf('payment details'));
    expect(out).toContain('--- Page 3 ---');

    await page.uncheck('#opt-markers');
    await expect.poll(() => text(page)).not.toContain('--- Page');
    out = await text(page);
    expect(out).toContain('Invoice 2041');
    await page.check('#opt-markers');
    await expect.poll(() => text(page)).toContain('--- Page 2 ---');
  });

  test('join, keep-layout and de-hyphenation options reshape the text', async ({ page }) => {
    await load(page);
    await loaded(page);
    // Default: wrapped lines joined into one paragraph, "trans-/fer" rejoined.
    let out = await text(page);
    expect(out).toContain('due within thirty days of the issue date. Please include the invoice number with your bank transfer so we can match it quickly.');
    // Table rows and short lines stay separate.
    expect(out).toContain('Issued 3 March 2026\nDue 2 April 2026');

    await page.selectOption('#opt-lines', 'layout');
    await expect.poll(() => text(page)).toContain('Payment is due within thirty\ndays of the issue date.');
    out = await text(page);
    expect(out).toContain('with your bank transfer\nso we can match');

    await page.uncheck('#opt-dehyphen');
    await expect.poll(() => text(page)).toContain('your bank trans-\nfer so');
  });

  test('page range limits the output to the chosen pages', async ({ page }) => {
    await load(page);
    await loaded(page);
    await page.fill('#opt-range', '2');
    await page.press('#opt-range', 'Enter');
    await expect(page.locator('#stats')).toContainText('1 of 3 pages');
    const out = await text(page);
    expect(out).toContain('payment details');
    expect(out).not.toContain('Logo design');
    await expect(page.locator('#scan-note')).toBeHidden();

    await page.fill('#opt-range', '9');
    await page.press('#opt-range', 'Enter');
    await expect(page.locator('#results .alert--error')).toContainText('Page 9 does not exist');
  });

  test('Copy puts the text on the clipboard and the button confirms', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await load(page);
    await loaded(page);
    await page.click('#copy');
    await expect(page.locator('#copy')).toContainText('Copied');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('Invoice 2041');
    expect(clip).toBe(await text(page));
    await expect(page.locator('#copy')).toContainText('Copy text', { timeout: 5000 });
  });

  test('Download produces a .txt file larger than 100 bytes', async ({ page }) => {
    await load(page);
    await loaded(page);
    await expect(page.locator('#download')).toContainText('invoice-2041.txt');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
    expect(download.suggestedFilename()).toBe('invoice-2041.txt');
    const bytes = fs.readFileSync(await download.path());
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes[0]).not.toBe(0xef); // no BOM by default
    const body = bytes.toString('utf8');
    expect(body).toContain('Invoice 2041');
    expect(body).toBe(await text(page));

    await page.check('#opt-bom');
    const [withBom] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
    const b2 = fs.readFileSync(await withBom.path());
    expect([...b2.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  test('Unicode file names are preserved in the output name', async ({ page }) => {
    await page.goto('./');
    await page.setInputFiles('#file-input', { name: 'Résumé 計画 2041.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(INVOICE) });
    await loaded(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
    expect(download.suggestedFilename()).toBe('Résumé 計画 2041.txt');
  });

  test('search counts matches and Enter jumps to the next one', async ({ page }) => {
    await load(page);
    await loaded(page);
    await page.fill('#search', 'birch');
    await expect(page.locator('#search-count')).toHaveText('1 of 3 matches');
    await expect(page.locator('#output-backdrop mark')).toHaveCount(3);
    await page.press('#search', 'Enter');
    await expect(page.locator('#search-count')).toHaveText('2 of 3 matches');
    await expect(page.locator('#output-backdrop mark.is-current')).toHaveCount(1);
    await expect(page.locator('#search')).toBeFocused();
    await page.fill('#search', 'zebra');
    await expect(page.locator('#search-count')).toHaveText('No matches');
  });

  test('Ctrl/Cmd+A inside the text area selects only the result', async ({ page }) => {
    await load(page);
    await loaded(page);
    await page.focus('#output');
    await page.keyboard.press('ControlOrMeta+A');
    const sel = await page.evaluate(() => { const t = document.getElementById('output'); return [t.selectionStart, t.selectionEnd, t.value.length]; });
    expect(sel[0]).toBe(0);
    expect(sel[1]).toBe(sel[2]);
  });

  test('wrong file types are rejected, also when mixed with a PDF', async ({ page }) => {
    await page.goto('./');
    await page.setInputFiles('#file-input', fixture('sample.png'));
    await expect(page.locator('#results .alert--error')).toContainText('“sample.png” is not a PDF');
    await expect(page.locator('#result-card')).toBeHidden();

    // A drop with a PNG and a PDF: the PNG is rejected and the PDF is still read.
    await page.evaluate(async () => {
      const [png, pdf] = await Promise.all(['sample.png', 'invoice-2041.pdf'].map((n) => fetch(`./tests/fixtures/${n}`).then((r) => r.blob())));
      const dt = new DataTransfer();
      dt.items.add(new File([png], 'photo.png', { type: 'image/png' }));
      dt.items.add(new File([pdf], 'invoice-2041.pdf', { type: 'application/pdf' }));
      document.getElementById('dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.locator('#results .alert--error')).toContainText('“photo.png” is not a PDF');
    await loaded(page);
    expect(await text(page)).toContain('Invoice 2041');

    // A renamed non-PDF is caught by its content.
    await page.setInputFiles('#file-input', { name: 'notes.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(fixture('sample.txt')) });
    await expect(page.locator('#results .alert--error')).toContainText('does not look like a PDF');
  });

  test('password protected files show a clear message and can be unlocked', async ({ page }) => {
    await load(page, fixture('locked.pdf'));
    const alert = page.locator('#results .alert--error');
    await expect(alert).toContainText('password protected');
    await page.fill('#pdf-password', 'wrong');
    await page.click('.unlock__form button');
    await expect(alert).toContainText('password is not right');
    await page.fill('#pdf-password', 'birch');
    await page.press('#pdf-password', 'Enter');
    await expect(page.locator('#result-card')).toBeVisible();
    expect(await text(page)).toContain('Locked sample invoice');
    await expect(page.locator('#results .unlock')).toHaveCount(0);
  });

  test('layout works at 390px wide', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page);
    await loaded(page);
    await page.fill('#search', 'invoice');
    const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    expect(widths.doc).toBeLessThanOrEqual(widths.win + 1);
    for (const sel of ['#dropzone', '#opt-range', '#copy', '#download', '#search', '#output']) {
      const box = await page.locator(sel).boundingBox();
      expect(box, sel).not.toBeNull();
      expect(box.x, sel).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, sel).toBeLessThanOrEqual(391);
    }
    await expect(page.locator('#output')).toBeVisible();
    const h = await page.locator('#output').evaluate((el) => el.clientHeight);
    expect(h).toBeGreaterThan(200);
  });
});
