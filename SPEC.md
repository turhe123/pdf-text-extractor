# PDF Text Extractor — specification

**Tagline:** Copy or save all the text from a PDF as a TXT file in your browser, with nothing uploaded.

**Category:** PDF

**Free alternative to:** Adobe Acrobat online and Smallpdf PDF to Text (uploads files, sign-in after a free try, scanned pages need paid OCR)

**Search phrases:** extract text from pdf, pdf to text, pdf to txt converter, copy text from pdf, pdf text extractor online, convert pdf to plain text

**Allowed libraries:** pdfjs-dist

**Published at:** https://turhe123.github.io/pdf-text-extractor/

## Acceptance checks (each must have a test)

- loading the bundled sample shows extracted text containing the word Invoice
- the page markers option inserts a page separator between pages
- Copy puts the text on the clipboard and the button confirms
- Download produces a .txt file larger than 100 bytes
- layout works at 390px wide

## Spec

Extract text from pdf and pdf to text are common searches from students, researchers and office workers. Adobe's online tool requires an account after a trial, others upload the document, cap the file size and push paid OCR for scans. Local extraction of selectable text is simple and private.

Our version does one job: pull the text layer out of a PDF and present it as plain text. It does not do OCR, so scanned pages are reported as having no text layer.

UI: a drop zone for one PDF. After loading, a large read only text area shows the result, with a stats line showing pages, words and characters. Options: include page markers like a line reading Page 3 (default on), keep line breaks as laid out or join lines into paragraphs (default join), remove hyphenation at line ends (default on), and a page range field (default all). Buttons: Copy, Download TXT named name.txt, and a search box that highlights matches count. Pages with no text are listed in a note such as pages 4 and 5 look like scans. Empty and error states are inline, and password protected files show a clear message. Keyboard: Ctrl or Cmd plus A inside the area selects the result, Enter in the search box jumps to the next match.

Technical approach: pdfjs-dist getDocument from an ArrayBuffer with the worker from the vendor folder, then for each page getTextContent. Rebuild lines by grouping items by their vertical transform position with a tolerance, sorting by horizontal position, inserting a space when the gap is greater than a fraction of font size, and inserting a blank line when the vertical gap is large, which gives paragraphs. The join option merges lines whose previous line does not end with sentence punctuation. De-hyphenation joins a trailing hyphen with the next word. Build the string incrementally with progress updates and yield to the event loop every few pages. Copy uses the clipboard API with a textarea fallback. Download uses a Blob with UTF-8 and a byte order mark option for Windows, default off.

Edge cases: right to left scripts keep the logical order pdfjs returns, ligatures and private use characters are normalized, very large documents of 1000 pages are processed with a cancel button, multi column layouts may interleave and a note says so, mobile Safari clipboard needs a tap, and Unicode file names are preserved in the output name.

Demo data: a bundled fictional PDF of two pages called Invoice 2041 for Birch and Pine Studio with a header, a table of items and a note paragraph, plus a third page that is just an image to show the no text note.
