// Generates a landscape PDF of selected DetailerImportedPiece rows from
// BatchReviewModal.jsx's Review & Commit table — same hand-drawn jsPDF
// table idiom as certifiedPayrollReportPdf.js (no autotable dependency is
// installed in this project), landscape for the same reason: a
// piece-mark/shape/material/weight row carries a lot of columns.
//
// Generic on purpose: `columns` ({key, label, width?}) and `rows` (plain
// objects keyed by each column's `key`) are supplied by the caller — this
// file has no idea what a DetailerImportedPiece is, matching
// requisitionPdfExport.js's {columns, rows} precedent. `width` is a relative
// weight (default 1), not millimeters; actual column x/width is computed
// here from the page's available content width.
import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';
import { downloadPdfBlob } from '@/lib/pdfDownload';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export async function generateDetailerImportBatchReviewPdf({ company, batch, uploaderEmail, generatedBy, columns, rows }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = PDF_MARGIN_MM;
  const contentRight = pageWidth - marginX;

  // An active 'detailer_import_batch_review' letterhead replaces the plain
  // company name/address/phone block entirely (that image already carries
  // the company's own branding) — see letterheadPdf.js. Everything else
  // (report title, uploader, generated-by line) always renders either way,
  // just shifted down when a letterhead is drawn.
  const letterheadY = await drawLetterheadIfActive(doc, 'detailer_import_batch_review', {
    x: marginX, y: 10, maxWidth: contentRight - marginX, maxHeight: 22,
  });

  let y;
  if (letterheadY == null) {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(13);
    doc.text(company?.name || 'Company', marginX, 15);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8.5);
    const address = addressLine(company);
    if (address) doc.text(address, marginX, 20);
    if (company?.phone) doc.text(`Phone: ${company.phone}`, marginX, 24.5);
    y = 30;
  } else {
    y = letterheadY + 4;
  }

  doc.setFont(undefined, 'bold');
  doc.setFontSize(14);
  doc.text('Detailer Import — Batch Review', marginX, y);
  y += 6;

  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.text(`Detailer / Batch: ${batch?.detailer_name || '—'}`, marginX, y);
  doc.text(`Uploaded by: ${uploaderEmail || '—'}`, pageWidth / 2, y);
  y += 5;
  doc.text(`Report generated: ${new Date().toLocaleDateString()} by ${generatedBy || '—'}`, marginX, y);
  y += 8;

  // Column x/width from each column's relative `width` weight.
  const totalWeight = columns.reduce((sum, c) => sum + (c.width || 1), 0);
  const availableWidth = contentRight - marginX;
  let cursorX = marginX;
  const cols = columns.map((c) => {
    const w = (availableWidth * (c.width || 1)) / totalWeight;
    const col = { ...c, x: cursorX, w };
    cursorX += w;
    return col;
  });

  const drawTableHeader = () => {
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'bold');
    cols.forEach((c) => doc.text(c.label, c.x, y));
    doc.setFont(undefined, 'normal');
    y += 2;
    doc.setDrawColor(150);
    doc.setLineWidth(0.2);
    doc.line(marginX, y, contentRight, y);
    y += 4;
  };
  drawTableHeader();

  const bottomLimit = pageHeight - 16;
  doc.setFontSize(7.5);
  (rows || []).forEach((row) => {
    if (y > bottomLimit) {
      doc.addPage();
      y = 16;
      drawTableHeader();
      doc.setFontSize(7.5);
    }
    cols.forEach((c) => {
      // Single-line truncation, not wrapping — same convention as
      // bolPdf.js's item description column, so every row stays a fixed
      // height and the page-break math above stays simple.
      const text = doc.splitTextToSize(String(row[c.key] ?? '') || '—', c.w - 2)[0] || '—';
      doc.text(text, c.x, y);
    });
    y += 4.6;
  });

  y += 2;
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  doc.text(`${(rows || []).length} row${(rows || []).length === 1 ? '' : 's'} exported`, marginX, y);
  doc.setTextColor(0);

  const blob = doc.output('blob');
  const safeName = String(batch?.detailer_name || batch?.id || 'batch').replace(/[^a-z0-9-]+/gi, '_');
  const filename = `Detailer-Import-Batch-Review-${safeName}.pdf`;
  downloadPdfBlob(blob, filename);

  return { blob, filename };
}
