// Excel counterpart to jobCostingSummaryPdf.js — same project list
// Accounting.jsx's "jobs" tab renders, as real numeric cells instead of
// PDF text.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateJobCostingSummaryXlsx({ company, projects, riskFilterActive }) {
  const today = new Date().toISOString().slice(0, 10);
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['JOB COSTING SUMMARY']);
  if (riskFilterActive) aoa.push(['Showing only projects with financial risk flagged.']);
  aoa.push([`Generated ${today}`]);
  aoa.push([]);

  aoa.push(['Project', 'Project #', 'Status', 'Contract Value', 'Est. Tons', '$/Ton', 'Risk Level']);
  (projects || []).forEach((row) => aoa.push([
    row.name || 'Unknown Project',
    row.project_number || '',
    row.status || '—',
    Number(row.contract_value) || 0,
    Number(row.estimated_tons) || 0,
    row.contract_value && row.estimated_tons ? Math.round(row.contract_value / row.estimated_tons) : 0,
    row.risk_level || '—',
  ]));
  if (!projects || projects.length === 0) aoa.push(['No projects found']);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Job Costing Summary');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `Job-Costing-Summary-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
