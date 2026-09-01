import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { PDF_MARGIN_PT, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';

// Rasterizes a DOM node and paginates it into a letter-size PDF — used by
// read-only record dialogs (e.g. CandidateApplicationDialog) and report
// panels (KPI Builder, Executive/Estimating Analytics, Material Optimization
// Report) that need an "Export to PDF" action but have no server-rendered
// document to hand back.
//
// Each page's slice of the source canvas is cropped into its own image
// (rather than re-drawing the whole tall image on every page and letting
// the page edge cut it off, which is the more common version of this
// technique) — that's what lets PDF_MARGIN_PT apply on every edge of every
// page. The simpler re-draw approach can only ever get the top margin right
// on page 1; the bottom margin (and every subsequent page's top margin)
// would depend on the page break landing exactly on a full pageHeight
// multiple, which it never does for arbitrary content height. Cropping the
// source pixels per page sidesteps that entirely.
export async function exportNodeToPdf(node, filename = 'document.pdf') {
  if (!node) return;

  const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff' });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: PDF_PAGE_FORMAT });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PDF_MARGIN_PT * 2;
  const contentHeight = pageHeight - PDF_MARGIN_PT * 2;

  // Source-canvas pixels per PDF point, so each page's contentHeight (in PDF
  // points) maps back to the matching slice of the (2x-scaled) source canvas.
  const pxPerPoint = canvas.width / contentWidth;
  const sliceHeightPx = Math.max(1, Math.floor(contentHeight * pxPerPoint));

  let sourceY = 0;
  let first = true;
  while (sourceY < canvas.height) {
    const thisSliceHeightPx = Math.min(sliceHeightPx, canvas.height - sourceY);
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = thisSliceHeightPx;
    const ctx = sliceCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(canvas, 0, sourceY, canvas.width, thisSliceHeightPx, 0, 0, canvas.width, thisSliceHeightPx);
    const sliceData = sliceCanvas.toDataURL('image/png');
    const sliceHeightPt = thisSliceHeightPx / pxPerPoint;

    if (!first) pdf.addPage();
    pdf.addImage(sliceData, 'PNG', PDF_MARGIN_PT, PDF_MARGIN_PT, contentWidth, sliceHeightPt);

    sourceY += thisSliceHeightPx;
    first = false;
  }

  pdf.save(filename);
}
