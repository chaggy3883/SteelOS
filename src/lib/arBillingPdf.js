import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SOV_COLS = [
  { key: 'item_description', label: 'Item', w: 60 },
  { key: 'original_scheduled_value', label: 'Scheduled Value', w: 28, align: 'right' },
  { key: 'completion_percentage', label: '% Complete', w: 20, align: 'right' },
  { key: 'current_billed_amount', label: 'Billed to Date', w: 28, align: 'right' },
  { key: 'retainage_rate', label: 'Retainage %', w: 20, align: 'right' },
];

const INVOICE_COLS = [
  { key: 'billing_period', label: 'Billing Period', w: 30 },
  { key: 'gross_amount', label: 'Gross Amount', w: 28, align: 'right' },
  { key: 'retainage_held', label: 'Retainage Held', w: 28, align: 'right' },
  { key: 'net_billing', label: 'Net Billing', w: 28, align: 'right' },
  { key: 'payment_status', label: 'Status', w: 24 },
];

function drawHeader(doc, cols, x0, y) {
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  let x = x0;
  cols.forEach((c) => {
    doc.text(c.label, c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
  doc.setFont(undefined, 'normal');
  doc.setLineWidth(0.1);
  doc.line(x0, y + 1.5, x, y + 1.5);
  return y + 5;
}

function drawSovRow(doc, x0, y, row) {
  let x = x0;
  const values = {
    item_description: String(row.item_description || '—').slice(0, 46),
    original_scheduled_value: money(row.original_scheduled_value),
    completion_percentage: `${row.completion_percentage || 0}%`,
    current_billed_amount: money(row.current_billed_amount),
    retainage_rate: `${((row.retainage_rate || 0) * 100).toFixed(1)}%`,
  };
  SOV_COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

function drawInvoiceRow(doc, x0, y, row) {
  let x = x0;
  const values = {
    billing_period: row.billing_period || '—',
    gross_amount: money(row.gross_amount),
    retainage_held: money(row.retainage_held),
    net_billing: money(row.net_billing),
    payment_status: row.payment_status || '—',
  };
  INVOICE_COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

// AR & Billings tab for one project — the Schedule of Values and Progress
// Billings (AIA G702/G703) tables Accounting.jsx renders for
// selectedProjectId.
export function generateArBillingPdf({ project, company, sovLines, invoiceReceivables }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  let ensureRoomCols = SOV_COLS;
  const ensureRoom = (y, needed = 8) => {
    if (y + needed > pageHeight - marginX) {
      doc.addPage();
      return drawHeader(doc, ensureRoomCols, marginX, 18);
    }
    return y;
  };

  doc.setFontSize(16);
  doc.text('AR & BILLINGS', marginX, 18);
  doc.setFontSize(9);
  let y = 26;
  doc.text(company?.name || '—', marginX, y); y += 5;
  doc.text(`Project: ${project?.name || 'Unknown Project'}${project?.project_number ? ` (#${project.project_number})` : ''}`, marginX, y); y += 5;
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('Schedule of Values (SOV)', marginX, y);
  doc.setFont(undefined, 'normal');
  y += 6;

  ensureRoomCols = SOV_COLS;
  y = drawHeader(doc, SOV_COLS, marginX, y);
  doc.setFontSize(8);
  (sovLines || []).forEach((row) => {
    y = ensureRoom(y);
    drawSovRow(doc, marginX, y, row);
    y += 5;
  });
  if (!sovLines || sovLines.length === 0) {
    doc.text('No SOV lines for this project yet.', marginX, y);
    y += 6;
  }
  y += 6;

  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('Progress Billings (AIA G702/G703)', marginX, y);
  doc.setFont(undefined, 'normal');
  y += 6;

  ensureRoomCols = INVOICE_COLS;
  y = drawHeader(doc, INVOICE_COLS, marginX, y);
  doc.setFontSize(8);
  (invoiceReceivables || []).forEach((row) => {
    y = ensureRoom(y);
    drawInvoiceRow(doc, marginX, y, row);
    y += 5;
  });
  if (!invoiceReceivables || invoiceReceivables.length === 0) {
    doc.text('No progress billings for this project yet.', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `AR-Billing-${(project?.name || 'project').replace(/[^a-z0-9]+/gi, '-')}-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
