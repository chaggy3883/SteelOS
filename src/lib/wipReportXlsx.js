// Excel counterpart to wipReportPdf.js — same WIP schedule stat figures
// and Job Cost Ledger transaction rows Accounting.jsx renders for the
// selected project, as real numeric cells instead of PDF text.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateWipReportXlsx({ project, company, wip, ledgerEntries, changeOrderMargin }) {
  const today = new Date().toISOString().slice(0, 10);
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['WIP REPORT']);
  aoa.push([`Project: ${project?.name || 'Unknown Project'}${project?.project_number ? ` (#${project.project_number})` : ''}`]);
  aoa.push([`Generated ${today}`]);
  aoa.push([]);

  if (wip) {
    aoa.push(['Total Contract Value', Number(wip.totalContractValue) || 0]);
    aoa.push(['Actual JTD Costs', Number(wip.actualJTDCosts) || 0]);
    aoa.push(['Earned Revenue', Number(wip.earnedRevenue) || 0]);
    aoa.push(['Margin Variance %', Number(wip.marginVariancePct) || 0]);
    aoa.push(['Over Budget (>3% threshold)', wip.isOverBudget ? 'Yes' : 'No']);
    aoa.push(['Billings to Date', Number(wip.billingsToDate) || 0]);
    aoa.push(['Over/Under Billing', Math.abs(Number(wip.overUnderBilling) || 0)]);
    aoa.push(['Billing Status', wip.billingStatus === 'even' ? 'Even' : (wip.billingStatus === 'overbilled' ? 'Overbilled' : 'Underbilled')]);
    aoa.push(['Change Order Margin', Number(changeOrderMargin) || 0]);
  } else {
    aoa.push(['Select a project to view its WIP schedule.']);
  }
  aoa.push([]);

  aoa.push(['Job Cost Ledger — Transaction Detail']);
  aoa.push(['Date', 'Cost Code', 'Class', 'Source', 'Amount', 'Description']);
  (ledgerEntries || []).forEach((row) => aoa.push([
    row.transaction_date || '—',
    row.cost_code || '—',
    row.cost_class || '—',
    String(row.source_type || '—').replace(/_/g, ' '),
    Number(row.amount) || 0,
    row.description || '',
  ]));
  if (!ledgerEntries || ledgerEntries.length === 0) aoa.push(['No ledger transactions for this project yet.']);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'WIP Report');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `WIP-Report-${(project?.name || 'project').replace(/[^a-z0-9]+/gi, '-')}-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
