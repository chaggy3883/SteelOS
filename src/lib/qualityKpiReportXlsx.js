// KPI Builder's built chart, as an .xlsx data table — same chartModel
// columns/sortedRows already computed for generateQualityKpiReportPdf,
// plus the legend & metric definitions block. Numeric cells are written as
// real numbers (not unit-suffixed strings) so Excel can sum/sort them.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export async function generateQualityKpiReportXlsx({ company, currentUser, title, dateRangeLabel, chartModel, sortedRows }) {
  const today = new Date().toISOString().slice(0, 10);
  const columns = chartModel?.columns || [];
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push([(title || 'KPI Report')]);
  aoa.push([`${dateRangeLabel || ''} · Generated ${today} by ${currentUser?.full_name || currentUser?.email || 'Unknown'}`]);
  aoa.push([]);
  aoa.push(columns.map((c) => c.label));
  (sortedRows || []).forEach((row) => aoa.push(columns.map((c) => (c.key === 'xLabel' ? row.xLabel : (Number(row[c.key]) || 0)))));

  aoa.push([]);
  aoa.push(['Legend & Metric Definitions']);
  (chartModel?.metrics || []).forEach((m) => {
    aoa.push([m.label, m.definition || '']);
  });

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'KPI Report');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const name = (title || 'kpi_report').replace(/[^a-z0-9_-]+/gi, '_');
  const filename = `${name}_${today}.xlsx`;
  downloadWorkbook(bytes, filename);
  return { filename };
}
