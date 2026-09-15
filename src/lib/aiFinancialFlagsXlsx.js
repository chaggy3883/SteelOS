// Excel counterpart to aiFinancialFlagsPdf.js — but a lightweight structured
// table only (id/project/severity/date/status): the narrative fields
// (ai_explanation, quoted_text, recommendation, review_notes) the PDF
// renders as cards don't belong in a spreadsheet and are deliberately
// excluded here. Same findings list Accounting.jsx's "ai" tab renders.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateAiFinancialFlagsXlsx({ company, findings, projectFilterLabel, projects }) {
  const today = new Date().toISOString().slice(0, 10);
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['AI FINANCIAL FLAGS']);
  if (projectFilterLabel) aoa.push([`Showing flags for ${projectFilterLabel}.`]);
  aoa.push([`Generated ${today}`]);
  aoa.push([]);

  aoa.push(['Finding ID', 'Project', 'Severity', 'Date', 'Status']);
  if (!findings || findings.length === 0) {
    aoa.push(['No AI financial findings yet. Upload project contracts to generate analysis.']);
  } else {
    findings.forEach((f) => aoa.push([
      f.id || '—',
      (projects || []).find((p) => p.id === f.project_id)?.name || '—',
      f.risk_level || '—',
      f.created_date || '—',
      f.status || '—',
    ]));
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'AI Financial Flags');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `AI-Financial-Flags-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
