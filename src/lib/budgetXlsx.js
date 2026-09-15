// Excel sibling of budgetPdf.js — same monthly budget grid and budget-vs-
// actual variance rows BudgetPanel already computed for generateBudgetPdf,
// written to a workbook instead of a PDF (aoa_to_sheet -> book_new ->
// book_append_sheet -> XLSX.write, downloaded via downloadWorkbook).
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateBudgetXlsx({ company, fiscalYear, monthLabels, budgetRows, columnTotals, grandTotal, varianceRows, ytdThroughLabel }) {
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push([`Budget — ${fiscalYear}`]);
  aoa.push([`Generated: ${new Date().toLocaleDateString()}`]);
  aoa.push([]);

  aoa.push(['Monthly Budget']);
  aoa.push(['Category', ...monthLabels, 'Total']);
  (budgetRows || []).forEach((row) => {
    aoa.push([row.category, ...monthLabels.map((_, i) => row.months[i] ?? 0), row.total ?? 0]);
  });
  aoa.push(['Total', ...(columnTotals || []).map((t) => t ?? 0), grandTotal ?? 0]);
  aoa.push([]);

  aoa.push([`Budget vs Actual — YTD through ${ytdThroughLabel}`]);
  aoa.push(['Category', ...monthLabels.map((l) => `${l} Var %`), 'YTD Actual', 'YTD Budget', 'YTD Var', 'YTD Var %']);
  (varianceRows || []).forEach((row) => {
    aoa.push([
      row.category,
      ...monthLabels.map((_, i) => row.monthVariancePct[i] ?? ''),
      row.ytdActual ?? 0,
      row.ytdBudgeted ?? 0,
      row.ytdVariance ?? 0,
      row.ytdVariancePct ?? '',
    ]);
  });

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Budget');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `Budget-${fiscalYear}-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
