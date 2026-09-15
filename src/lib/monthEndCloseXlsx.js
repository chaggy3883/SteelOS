// Excel sibling of monthEndClosePdf.js — same readiness stats and checklist
// items MonthEndClosePanel already computed for generateMonthEndClosePdf,
// written to a workbook instead of a PDF (aoa_to_sheet -> book_new ->
// book_append_sheet -> XLSX.write, downloaded via downloadWorkbook). Each
// checklist row is exported as-is so completion can be tracked across close
// cycles.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateMonthEndCloseXlsx({ company, periodLabel, close, readinessStats, checklistItems }) {
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push([`Month-End Close — ${periodLabel}`]);
  aoa.push([`Status: ${close?.status === 'Closed' ? `Closed${close?.closed_date ? ` on ${close.closed_date}` : ''}${close?.closed_by ? ` by ${close.closed_by}` : ''}` : 'In Progress'}`]);
  aoa.push([`Generated: ${new Date().toLocaleDateString()}`]);
  aoa.push([]);

  (readinessStats || []).forEach((stat) => aoa.push([stat.label, stat.count]));
  aoa.push([]);

  aoa.push(['Category', 'Task', 'Status', 'Assigned To', 'Completed Date', 'Notes']);
  (checklistItems || []).forEach((row) => aoa.push([
    row.category || '—',
    row.task_name || '—',
    row.status || 'Not Started',
    row.assigned_to || '—',
    row.completed_date || '—',
    row.notes || '—',
  ]));

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Month-End Close');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `Month-End-Close-${periodLabel.replace(/[^a-z0-9]+/gi, '-')}-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
