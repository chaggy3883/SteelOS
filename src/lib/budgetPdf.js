import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';

const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
const fmtPct = (n) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`);

const CATEGORY_W = 22;
const MONTH_W = 15;
const TOTAL_W = 24;
const YTD_W = 24;
const VARIANCE_MONTH_W = 10;

function drawBudgetGridHeader(doc, x0, y, monthLabels) {
  doc.setFont(undefined, 'bold');
  doc.setFontSize(7);
  let x = x0 + CATEGORY_W;
  doc.text('Category', x0, y);
  monthLabels.forEach((label) => { doc.text(label, x + MONTH_W, y, { align: 'right' }); x += MONTH_W; });
  doc.text('Total', x + TOTAL_W, y, { align: 'right' });
  doc.setFont(undefined, 'normal');
  doc.setLineWidth(0.1);
  doc.line(x0, y + 1.5, x + TOTAL_W, y + 1.5);
  return y + 5;
}

function drawBudgetGridRow(doc, x0, y, row, monthLabels) {
  doc.text(row.category, x0, y);
  let x = x0 + CATEGORY_W;
  monthLabels.forEach((_, i) => { doc.text(fmtMoney(row.months[i]), x + MONTH_W, y, { align: 'right' }); x += MONTH_W; });
  doc.text(fmtMoney(row.total), x + TOTAL_W, y, { align: 'right' });
}

function drawVarianceHeader(doc, x0, y, monthLabels) {
  doc.setFont(undefined, 'bold');
  doc.setFontSize(7);
  let x = x0 + CATEGORY_W;
  doc.text('Category', x0, y);
  monthLabels.forEach((label) => { doc.text(label, x + VARIANCE_MONTH_W, y, { align: 'right' }); x += VARIANCE_MONTH_W; });
  ['YTD Actual', 'YTD Budget', 'YTD Var', 'YTD Var %'].forEach((label) => { doc.text(label, x + YTD_W, y, { align: 'right' }); x += YTD_W; });
  doc.setFont(undefined, 'normal');
  doc.setLineWidth(0.1);
  doc.line(x0, y + 1.5, x, y + 1.5);
  return y + 5;
}

function drawVarianceRow(doc, x0, y, row, monthLabels) {
  doc.text(row.category, x0, y);
  let x = x0 + CATEGORY_W;
  monthLabels.forEach((_, i) => { doc.text(fmtPct(row.monthVariancePct[i]), x + VARIANCE_MONTH_W, y, { align: 'right' }); x += VARIANCE_MONTH_W; });
  doc.text(fmtMoney(row.ytdActual), x + YTD_W, y, { align: 'right' }); x += YTD_W;
  doc.text(fmtMoney(row.ytdBudgeted), x + YTD_W, y, { align: 'right' }); x += YTD_W;
  doc.text(fmtMoney(row.ytdVariance), x + YTD_W, y, { align: 'right' }); x += YTD_W;
  doc.text(fmtPct(row.ytdVariancePct), x + YTD_W, y, { align: 'right' });
}

// Budget panel (BudgetPanel) — the monthly budget grid and the budget-vs-
// actual variance table it renders, for the selected fiscal year.
export function generateBudgetPdf({ company, fiscalYear, monthLabels, budgetRows, columnTotals, grandTotal, varianceRows, ytdThroughLabel }) {
  const doc = new jsPDF({ orientation: 'landscape', format: PDF_PAGE_FORMAT });
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  doc.setFontSize(16);
  doc.text(`BUDGET — ${fiscalYear}`, marginX, 18);
  doc.setFontSize(9);
  let y = 26;
  doc.text(company?.name || '—', marginX, y); y += 5;
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text('Monthly Budget', marginX, y);
  doc.setFont(undefined, 'normal');
  y += 6;

  y = drawBudgetGridHeader(doc, marginX, y, monthLabels);
  doc.setFontSize(7);
  (budgetRows || []).forEach((row) => {
    drawBudgetGridRow(doc, marginX, y, row, monthLabels);
    y += 5;
  });
  doc.setLineWidth(0.1);
  doc.line(marginX, y - 3, marginX + CATEGORY_W + monthLabels.length * MONTH_W + TOTAL_W, y - 3);
  doc.setFont(undefined, 'bold');
  doc.text('Total', marginX, y);
  let totalsX = marginX + CATEGORY_W;
  (columnTotals || []).forEach((t) => { doc.text(fmtMoney(t), totalsX + MONTH_W, y, { align: 'right' }); totalsX += MONTH_W; });
  doc.text(fmtMoney(grandTotal), totalsX + TOTAL_W, y, { align: 'right' });
  doc.setFont(undefined, 'normal');
  y += 10;

  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text(`Budget vs Actual — YTD through ${ytdThroughLabel}`, marginX, y);
  doc.setFont(undefined, 'normal');
  y += 6;

  const ensureRoom = (yy, needed = 8) => {
    if (yy + needed > pageHeight - marginX) {
      doc.addPage();
      return drawVarianceHeader(doc, marginX, 18, monthLabels);
    }
    return yy;
  };

  y = drawVarianceHeader(doc, marginX, y, monthLabels);
  doc.setFontSize(7);
  (varianceRows || []).forEach((row) => {
    y = ensureRoom(y);
    drawVarianceRow(doc, marginX, y, row, monthLabels);
    y += 5;
  });

  if (!varianceRows || varianceRows.length === 0) {
    doc.text('No budget lines set up for this fiscal year yet.', marginX, y);
  }

  const blob = doc.output('blob');
  const filename = `Budget-${fiscalYear}-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
