import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

const money = (n) => (n ? `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—');

const COLS = [
  { key: 'bid_number', label: 'Bid #', w: 22 },
  { key: 'job_name', label: 'Job', w: 44 },
  { key: 'customer_name', label: 'Customer', w: 38 },
  { key: 'estimator', label: 'Assigned To', w: 32 },
  { key: 'bid_due_date', label: 'Due Date', w: 22 },
  { key: 'bid_total_cost', label: 'Bid Total', w: 26, align: 'right' },
  { key: 'status', label: 'Status', w: 22 },
];

function drawTableHeader(doc, x0, y) {
  doc.setFont(undefined, 'bold');
  doc.setFontSize(7.5);
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

function estimatorName(employees, id) {
  return employees.find((e) => e.id === id)?.full_name || 'Unassigned';
}

function drawRow(doc, x0, y, row, employees) {
  let x = x0;
  const values = {
    bid_number: row.bid_number || '—',
    job_name: String(row.job_name || '—').slice(0, 28),
    customer_name: String(row.customer_name || '—').slice(0, 24),
    estimator: estimatorName(employees, row.estimator_id),
    bid_due_date: row.bid_due_date || '—',
    bid_total_cost: money(row.bid_total_cost),
    status: (row.status || '').replace(/_/g, ' '),
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

// Estimating page → Bid List (Active) card — same active-status-filtered
// bid rows the on-screen table shows.
export async function generateEstimatingActiveBidsPdf({ company, bids, employees }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT, orientation: 'landscape' });
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

  const letterheadY = await drawLetterheadIfActive(doc, 'estimating_active_bids', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('BID LIST — ACTIVE', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  y = drawTableHeader(doc, marginX, y);
  doc.setFontSize(7.5);
  (bids || []).forEach((row) => {
    y = ensureRoom(y);
    drawRow(doc, marginX, y, row, employees || []);
    y += 5;
  });

  if (!bids || bids.length === 0) {
    doc.text('No active bids.', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `Active-Bids-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
