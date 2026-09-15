// Excel counterpart to wipRadarPdf.js — total contract value vs. actual
// job-to-date cost recognized (computeProjectWipRadar), per active project,
// as passed from ExecutiveAnalytics.jsx's Financial WIP Radar card.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateWipRadarXlsx({ company, wipRadar }) {
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['Financial WIP Radar']);
  aoa.push([`Report generated: ${new Date().toLocaleDateString()}`]);
  aoa.push([]);
  aoa.push(['Project', 'Contract Value', 'JTD Cost Recognized']);
  if (!wipRadar || wipRadar.length === 0) {
    aoa.push(['No active projects to report.']);
  } else {
    wipRadar.forEach((row) => aoa.push([row.projectName || '—', Number(row.contractValue) || 0, Number(row.jtdCost) || 0]));
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'WIP Radar');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `WIP-Radar-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
