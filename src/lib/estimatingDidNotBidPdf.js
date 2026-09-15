import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

const COLS = [
  { key: 'bid_number', label: 'Bid #', w: 22 },
  { key: 'job_name', label: 'Job', w: 42 },
  { key: 'customer_name', label: 'Customer', w: 36 },
  { key: 'estimator', label: 'Assigned To', w: 30 },
  { key: 'dnb_reason', label: 'Reason', w: 32 },
  { key: 'dnb_reason_notes', label: 'Notes', w: 60 },
];

function drawTableHeader(doc, x0, y) {
  doc.setFont(undefined, 'bold');
  doc.setFontSize(7.5);
  let x = x0;
  COLS.forEach((c) => {
    doc.text(c.label, x, y);
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
    dnb_reason: row.dnb_reason ? row.dnb_reason.replace(/_/g, ' ') : '—',
    dnb_reason_notes: String(row.dnb_reason_notes || '—').slice(0, 40),
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], x, y);
    x += c.w;
  });
}

// Estimating page → Did Not Bid card — same DNB-status bid rows the
// on-screen table shows.
export async function generateEstimatingDidNotBidPdf({ company, bids, employees }) {
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

  const letterheadY = await drawLetterheadIfActive(doc, 'estimating_did_not_bid', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('DID NOT BID', marginX, letterheadY != null ? letterheadY + 6 : 18);
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
    doc.text('No bids marked Did Not Bid yet.', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `Did-Not-Bid-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
