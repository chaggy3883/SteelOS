import * as pdfjsLib from 'pdfjs-dist';

// Real PDF text extraction via pdfjs-dist (Mozilla's PDF.js), not a hand-
// rolled byte scan. PDF text is stored inside compressed content streams
// with font-encoding tables and drawing operators — the overwhelming
// majority of real-world PDFs are not readable by scanning raw bytes for
// printable characters, that only ever works on toy/uncompressed test
// files. pdfjs-dist decompresses/decodes each page's content stream
// properly and gives back the actual text runs.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

// Returns the extracted text (possibly empty if the PDF is scanned
// images with no text layer — callers should tell the user to OCR/export
// to .txt in that case rather than silently treating it as "no risk found").
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
  return pageTexts.join('\n\n').trim();
}
