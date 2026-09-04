import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLS = [
  { key: 'received_date', label: 'Date', w: 18 },
  { key: 'sender_name', label: 'Sender', w: 40 },
  { key: 'amount', label: 'Amount', w: 24, align: 'right' },
  { key: 'bank_account', label: 'Bank Account', w: 35 },
  { key: 'status', label: 'Status', w: 22 },
  { key: 'applied_to', label: 'Applied To', w: 40 },
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
    received_date: row.received_date || '—',
    sender_name: String(row.sender_name || '—').slice(0, 30),
    amount: money(row.amount),
    bank_account: String(row.bank_account || '—').slice(0, 26),
    status: row.status || '—',
    applied_to: String(row.applied_to || '—').slice(0, 30),
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

// Bank & Cash → Incoming ACH sub-tab (IncomingAchPanel) — same rows the
// on-screen "All Incoming ACH" table renders.
export function generateIncomingAchPdf({ company, rows }) {
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
  doc.text('INCOMING ACH DEPOSITS', marginX, 18);
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
    doc.text('No incoming ACH deposits logged yet.', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `Incoming-ACH-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
