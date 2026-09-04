import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLS = [
  { key: 'source', label: 'Source', w: 70 },
  { key: 'date', label: 'Date', w: 20 },
  { key: 'amount', label: 'Unapplied Amount', w: 32, align: 'right' },
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
    source: String(row.source || '—').slice(0, 46),
    date: row.date || '—',
    amount: money(row.amount),
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

// Bank & Cash → Unapplied Cash sub-tab (UnappliedCashPanel) — same
// overpayment rows the on-screen table renders.
export function generateUnappliedCashPdf({ company, rows }) {
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

  doc.setFontSize(16);
  doc.text('UNAPPLIED CASH', marginX, 18);
  doc.setFontSize(9);
  let y = 26;
  doc.text(company?.name || '—', marginX, y); y += 5;
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  y = drawTableHeader(doc, marginX, y);
  doc.setFontSize(8);
  (rows || []).forEach((row) => {
    y = ensureRoom(y);
    drawRow(doc, marginX, y, row);
    y += 5;
  });

  if (!rows || rows.length === 0) {
    doc.text('No unapplied cash right now.', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `Unapplied-Cash-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
