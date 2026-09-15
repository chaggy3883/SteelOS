// Excel counterpart to jobCostDetailPdf.js — same project cost-code rows
// (buildProjectJobCostRows) and company-wide rollup rows
// (buildCompanyWideJobCostRollup) Accounting.jsx already computed, as real
// numeric cells instead of PDF text.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';
import { sumProjectJobCostTotals } from '@/lib/jobCostEngine';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateProjectJobCostXlsx({ project, company, rows }) {
  const today = new Date().toISOString().slice(0, 10);
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['JOB COST DETAIL']);
  aoa.push([`Project: ${project?.name || 'Unknown Project'}${project?.project_number ? ` (#${project.project_number})` : ''}`]);
  aoa.push([`Generated ${today}`]);
  aoa.push([]);

  aoa.push(['Cost Code', 'Description', 'Orig. Estimate', 'Approved C.O.', 'Revised Est.', 'JTD Hours', 'JTD Costs', 'Profit/Loss']);
  (rows || []).forEach((row) => aoa.push([
    row.cost_code || '—',
    row.description || '',
    Number(row.original_estimate) || 0,
    Number(row.approved_co) || 0,
    Number(row.revised_estimated_cost) || 0,
    Number(row.jtd_hours) || 0,
    Number(row.jtd_costs) || 0,
    Number(row.profit_loss) || 0,
  ]));
  if (!rows || rows.length === 0) aoa.push(['No job cost activity recorded for this project yet.']);

  const totals = sumProjectJobCostTotals(rows);
  aoa.push(['PROJECT TOTAL', '', totals.original_estimate, totals.approved_co, totals.revised_estimated_cost, totals.jtd_hours, totals.jtd_costs, totals.profit_loss]);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Job Cost Detail');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `Job-Cost-Detail-${(project?.name || 'project').replace(/[^a-z0-9]+/gi, '-')}-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}

export function generateCompanyWideJobCostXlsx({ company, rows, dateFrom, dateTo }) {
  const today = new Date().toISOString().slice(0, 10);
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['COMPANY-WIDE JOB COST ROLLUP']);
  aoa.push([`Period: ${dateFrom || 'All'} — ${dateTo || 'Present'}`]);
  aoa.push([`Generated ${today}`]);
  aoa.push([]);

  aoa.push(['Cost Code', 'Description', 'Projects', 'Total Cost', '% of Total']);
  const grandTotal = (rows || []).reduce((sum, r) => sum + (Number(r.jtd_costs) || 0), 0);
  (rows || []).forEach((row) => aoa.push([
    row.cost_code || '—',
    row.description || '',
    Number(row.project_count) || 0,
    Number(row.jtd_costs) || 0,
    Number(row.pct_of_total) || 0,
  ]));
  if (!rows || rows.length === 0) aoa.push(['No job cost activity recorded across any project yet.']);
  aoa.push(['COMPANY TOTAL', '', '', grandTotal, '']);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Company-Wide Rollup');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `Job-Cost-Rollup-Company-Wide-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
