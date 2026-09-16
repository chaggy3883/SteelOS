import * as pdfjsLib from 'pdfjs-dist';

// Real PDF text extraction via pdfjs-dist (Mozilla's PDF.js), not a hand-
// rolled byte scan. PDF text is stored inside compressed content streams
// with font-encoding tables and drawing operators — the overwhelming
// majority of real-world PDFs are not readable by scanning raw bytes for
// printable characters, that only ever works on toy/uncompressed test
// files. pdfjs-dist decompresses/decodes each page's content stream
// properly and gives back the actual text runs.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

const PAGE_SEPARATOR = '\n\n';

// Returns { text, pageOffsets } — `text` is the extracted text (possibly
// empty if the PDF is scanned images with no text layer — callers should
// tell the user to OCR/export to .txt in that case rather than silently
// treating it as "no risk found"). `pageOffsets[i]` is the character index
// within `text` where page `i + 1` begins, so a later string-index match
// (regex .index / String.indexOf against `text`) can be resolved back to
// the PDF page it came from — see pageNumberForOffset below. Offsets are
// computed against the untrimmed join and only the trailing end is trimmed
// (trimEnd, not trim) so trimming can never shift an earlier page's offset.
export async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    pageTexts.push(pageText);
  }
  const pageOffsets = [];
  let offset = 0;
  pageTexts.forEach((pageText) => {
    pageOffsets.push(offset);
    offset += pageText.length + PAGE_SEPARATOR.length;
  });
  return { text: pageTexts.join(PAGE_SEPARATOR).trimEnd(), pageOffsets };
}

// Resolves a character index into the `text` extractTextFromPdf returned
// back to its 1-based PDF page number, via the running per-page offsets.
// Returns null when there's nothing to resolve against (a .txt upload has
// no pageOffsets at all) or the index itself is missing/invalid.
export function pageNumberForOffset(pageOffsets, index) {
  if (!pageOffsets || pageOffsets.length === 0 || index == null || index < 0) return null;
  let page = 1;
  for (let i = 0; i < pageOffsets.length; i++) {
    if (pageOffsets[i] <= index) page = i + 1;
    else break;
  }
  return page;
}
