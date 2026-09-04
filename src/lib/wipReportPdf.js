import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLS = [
  { key: 'transaction_date', label: 'Date', w: 18 },
  { key: 'cost_code', label: 'Cost Code', w: 26 },
  { key: 'cost_class', label: 'Class', w: 16 },
  { key: 'source_type', label: 'Source', w: 30 },
  { key: 'amount', label: 'Amount', w: 24, align: 'right' },
  { key: 'description', label: 'Description', w: 60 },
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
    transaction_date: row.transaction_date || '—',
    cost_code: row.cost_code || '—',
    cost_class: row.cost_class || '—',
    source_type: String(row.source_type || '—').replace(/_/g, ' '),
    amount: money(row.amount),
    description: String(row.description || '—').slice(0, 40),
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

// WIP Report tab for one project — the WIP schedule stat figures plus the
// Job Cost Ledger transaction detail table Accounting.jsx renders for
// selectedProjectId.
export function generateWipReportPdf({ project, company, wip, ledgerEntries, changeOrderMargin }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
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
  doc.text('WIP REPORT', marginX, 18);
  doc.setFontSize(9);
  let y = 26;
  doc.text(company?.name || '—', marginX, y); y += 5;
  doc.text(`Project: ${project?.name || 'Unknown Project'}${project?.project_number ? ` (#${project.project_number})` : ''}`, marginX, y); y += 5;
  doc.text(`Generated ${today}`, marginX, y); y += 7;

  if (wip) {
    doc.text(`Total Contract Value: ${money(wip.totalContractValue)}`, marginX, y); y += 5;
    doc.text(`Actual JTD Costs: ${money(wip.actualJTDCosts)}`, marginX, y); y += 5;
    doc.text(`Earned Revenue: ${money(wip.earnedRevenue)}`, marginX, y); y += 5;
    doc.text(`Margin Variance: ${wip.marginVariancePct > 0 ? '+' : ''}${wip.marginVariancePct.toFixed(1)}%${wip.isOverBudget ? ' (over 3% threshold)' : ''}`, marginX, y); y += 5;
    doc.text(`Billings to Date: ${money(wip.billingsToDate)}`, marginX, y); y += 5;
    doc.text(`Over/Under Billing: ${money(Math.abs(wip.overUnderBilling))}${wip.billingStatus !== 'even' ? ` (${wip.billingStatus === 'overbilled' ? 'Overbilled' : 'Underbilled'})` : ''}`, marginX, y); y += 5;
    doc.text(`Change Order Margin: ${changeOrderMargin >= 0 ? '+' : '-'}${money(Math.abs(changeOrderMargin))}`, marginX, y); y += 5;
  } else {
    doc.text('Select a project to view its WIP schedule.', marginX, y); y += 5;
  }
  y += 4;

  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('Job Cost Ledger — Transaction Detail', marginX, y);
  doc.setFont(undefined, 'normal');
  y += 6;

  y = drawTableHeader(doc, marginX, y);
  doc.setFontSize(8);
  (ledgerEntries || []).forEach((row) => {
    y = ensureRoom(y);
    drawRow(doc, marginX, y, row);
    y += 5;
  });

  if (!ledgerEntries || ledgerEntries.length === 0) {
    doc.text('No ledger transactions for this project yet.', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `WIP-Report-${(project?.name || 'project').replace(/[^a-z0-9]+/gi, '-')}-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
