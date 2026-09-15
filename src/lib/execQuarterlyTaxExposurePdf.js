import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;

const COLS = [
  { key: 'quarter', label: 'Quarter', w: 40 },
  { key: 'hancockCountyTax', label: 'Hancock County Tax', w: 40, align: 'right' },
  { key: 'joistDeckTax', label: 'Joist & Deck Tax', w: 40, align: 'right' },
  { key: 'total', label: 'Total', w: 36, align: 'right' },
];

function drawTableHeader(doc, x0, y) {
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  let x = x0;
  COLS.forEach((c) => {
    doc.text(c.label, c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
  doc.setFont(undefined, 'normal');
  doc.setLineWidth(0.1);
  doc.line(x0, y + 1.5, x, y + 1.5);
  return y + 5;
}

function drawRow(doc, x0, y, row) {
  let x = x0;
  const values = {
    quarter: row.quarter,
    hancockCountyTax: money(row.hancockCountyTax),
    joistDeckTax: money(row.joistDeckTax),
    total: money(row.hancockCountyTax + row.joistDeckTax),
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

// Executive Analytics → Quarterly Tax Exposure Grid — Hancock County
// structural tax vs. Joist & Deck jobsite tax overrides, by billing quarter,
// across all bids (computeQuarterlyTaxExposure), same rows as the on-screen
// table.
export async function generateExecQuarterlyTaxExposurePdf({ company, taxRows }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  const ensureRoom = (y, needed = 8) => {
    if (y + needed > pageHeight - marginX) {
      doc.addPage();
      return drawTableHeader(doc, marginX, 18);
    }
    return y;
  };

  const letterheadY = await drawLetterheadIfActive(doc, 'exec_quarterly_tax_exposure', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('QUARTERLY TAX EXPOSURE GRID', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  y = drawTableHeader(doc, marginX, y);
  doc.setFontSize(8);
  (taxRows || []).forEach((row) => {
    y = ensureRoom(y);
    drawRow(doc, marginX, y, row);
    y += 5;
  });

  if (!taxRows || taxRows.length === 0) {
    doc.text('No bid tax data available yet.', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `Quarterly-Tax-Exposure-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
