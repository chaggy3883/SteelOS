// Excel counterpart to wipOverUnderBillingPdf.js — company-wide overbilled/
// underbilled totals plus the same Top 5 Overbilled/Underbilled project lists
// (calculateWIPSchedule run per active project), as passed from
// ExecutiveAnalytics.jsx's WIP Overbilling/Underbilling Summary card.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

const pushProjectRows = (aoa, title, rows) => {
  aoa.push([title]);
  aoa.push(['Project', 'Amount']);
  if (!rows || rows.length === 0) aoa.push(['None.']);
  else rows.forEach(({ project, amount }) => aoa.push([project?.name || '—', Number(amount) || 0]));
  aoa.push([]);
};

export function generateWipOverUnderBillingXlsx({ company, wipSummary }) {
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['WIP Overbilling / Underbilling Summary']);
  aoa.push([`Total Overbilled: ${Number(wipSummary?.totalOverbilled) || 0}`]);
  aoa.push([`Total Underbilled: ${Number(wipSummary?.totalUnderbilled) || 0}`]);
  aoa.push([`Report generated: ${new Date().toLocaleDateString()}`]);
  aoa.push([]);

  const overRows = (wipSummary?.topOverbilled || []).map(({ project, wip }) => ({ project, amount: wip.overUnderBilling }));
  const underRows = (wipSummary?.topUnderbilled || []).map(({ project, wip }) => ({ project, amount: -wip.overUnderBilling }));
  pushProjectRows(aoa, 'Top Overbilled Projects', overRows);
  pushProjectRows(aoa, 'Top Underbilled Projects', underRows);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'WIP Over-Under Billing');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `WIP-Overbilling-Underbilling-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
