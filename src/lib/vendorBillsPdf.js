import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLS = [
  { key: 'invoice_number', label: 'Invoice #', w: 22 },
  { key: 'vendor', label: 'Vendor', w: 38 },
  { key: 'po', label: 'PO', w: 24 },
  { key: 'gross_amount', label: 'Gross Amount', w: 26, align: 'right' },
  { key: 'variance_pct', label: 'Variance %', w: 20, align: 'right' },
  { key: 'status', label: 'Status', w: 22 },
  { key: 'waivers', label: 'Waivers', w: 30 },
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
    invoice_number: row.invoice_number || '—',
    vendor: String(row.vendor_name || '—').slice(0, 30),
    po: row.po_number || '—',
    gross_amount: money(row.gross_amount),
    variance_pct: row.variance_pct != null ? `${row.variance_pct}%` : '—',
    status: row.status || '—',
    waivers: `${row.conditional_waiver_signed ? 'Cond ✓' : 'Cond —'} / ${row.unconditional_waiver_received ? 'Uncond ✓' : 'Uncond —'}`,
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

// Vendor Bills (AP) — 3-Way Match Queue, same rows Accounting.jsx's
// "vendorbills" tab renders (vendor/PO already resolved to display names).
export function generateVendorBillsPdf({ company, rows }) {
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
  doc.text('VENDOR BILLS — 3-WAY MATCH QUEUE', marginX, 18);
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
    doc.text('No vendor bills yet.', marginX, y);
    y += 6;
  }

  const totalGross = (rows || []).reduce((sum, r) => sum + (Number(r.gross_amount) || 0), 0);
  y = ensureRoom(y, 10);
  y += 2;
  doc.setLineWidth(0.1);
  doc.line(marginX, y - 3, pageWidth - marginX, y - 3);
  doc.setFont(undefined, 'bold');
  doc.text('TOTAL', marginX, y);
  doc.text(money(totalGross), marginX + COLS[0].w + COLS[1].w + COLS[2].w + COLS[3].w, y, { align: 'right' });
  doc.setFont(undefined, 'normal');

  const blob = doc.output('blob');
  const filename = `Vendor-Bills-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
