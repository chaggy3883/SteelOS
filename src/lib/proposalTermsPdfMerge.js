import * as pdfjsLib from 'pdfjs-dist';

// Same worker wiring as pdfTextExtractor.js/BlueprintCanvas.jsx — required
// once per module that calls pdfjsLib.getDocument.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

// There is no backend in this app (see AGENTS.md) and so no server-side PDF
// merge — this is the actual mechanism behind "append these pages to the
// proposal PDF": rasterize every page of an uploaded terms document into a
// PNG, so it can be dropped into the print DOM as an ordinary full-page
// <img>, one continuous document alongside the pricing pages. scale=2 keeps
// print output reasonably sharp without producing enormous data URLs.
export async function rasterizePdfPages(url, scale = 2) {
  const pdf = await pdfjsLib.getDocument({ url }).promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    pages.push(canvas.toDataURL('image/png'));
  }
  return pages;
}

// Classifies a document's actual bytes (not its file name, which is a
// user-edited label here and not a reliable extension) so the print view
// knows whether to rasterize it as a PDF, drop it in as an image, or fall
// back to an <iframe> for anything else.
export async function detectDocumentKind(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  if (blob.type === 'application/pdf') return 'pdf';
  if (blob.type.startsWith('image/')) return 'image';
  return 'other';
}
