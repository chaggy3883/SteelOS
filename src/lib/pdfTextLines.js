// Reads a text-based PDF (a detailer's BOM report, not a scan) back into
// plain text lines in reading order: every text run on a page is grouped by
// its baseline (within ~2pt), sorted left to right, and joined with spaces.
// Report-style PDFs come out exactly as their printed rows.
import * as pdfjsLib from 'pdfjs-dist';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
}

const Y_TOLERANCE = 2;

export function itemsToLines(items) {
  const rows = [];
  items.forEach((it) => {
    const str = it.str ?? '';
    if (!str.trim()) return;
    const x = it.transform[4];
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) <= Y_TOLERANCE);
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, str });
  });
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// ArrayBuffer | Uint8Array -> { lines, pageCount }
export async function extractPdfTextLines(data) {
  const doc = await pdfjsLib.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data) }).promise;
  const lines = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    lines.push(...itemsToLines(tc.items));
  }
  const pageCount = doc.numPages;
  await doc.destroy?.();
  return { lines, pageCount };
}
