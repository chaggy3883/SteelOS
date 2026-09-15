// Historical Analytics → Estimated vs. Actual Hours by Shop Station card, as
// an .xlsx — same per-station average variance % already computed for
// generateEstimatingShopHoursVariancePdf.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export async function generateEstimatingShopHoursVarianceXlsx({ company, projectLabel, stationVariances }) {
  const today = new Date().toISOString().slice(0, 10);
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['Estimated vs. Actual Hours by Shop Station']);
  aoa.push([`Scope: ${projectLabel || 'All Projects'}`]);
  aoa.push([`Generated ${today}`]);
  aoa.push([]);
  aoa.push(['Station', 'Avg Variance %']);
  (stationVariances || []).forEach((row) => aoa.push([row.station, Number(row.avgVariance) || 0]));

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Shop Hours Variance');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `Estimated-vs-Shop-Hours-${(projectLabel || 'all-projects').replace(/[^a-z0-9_-]+/gi, '_')}-${today}.xlsx`;
  downloadWorkbook(bytes, filename);
  return { filename };
}
