// Excel counterpart to execArApAgingPdf.js — AR and AP aging bucket totals
// (computeArAging/computeApAging, agingReport.js) as passed from
// ExecutiveAnalytics.jsx's AR/AP Aging Summary card, one sheet per side.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';
import { AGING_BUCKETS, AGING_BUCKET_LABELS } from '@/lib/agingReport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

const buildAoa = (company, title, totalLine, bucketTotals) => {
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push([title]);
  aoa.push([totalLine]);
  aoa.push([`Report generated: ${new Date().toLocaleDateString()}`]);
  aoa.push([]);
  aoa.push(['Aging Bucket', 'Amount']);
  AGING_BUCKETS.forEach((b) => aoa.push([AGING_BUCKET_LABELS[b], Number(bucketTotals?.[b]) || 0]));
  return aoa;
};

export function generateExecArApAgingXlsx({ company, arAgingTotals, apAgingTotals, arTotalOutstanding, apTotalOutstanding, arPastDuePct }) {
  const workbook = XLSX.utils.book_new();

  const arAoa = buildAoa(
    company, 'AR / AP Aging Summary — AR Outstanding',
    `Total: ${Number(arTotalOutstanding) || 0} (${arPastDuePct === null || arPastDuePct === undefined || Number.isNaN(arPastDuePct) ? '—' : `${Math.round(arPastDuePct)}%`} past due)`,
    arAgingTotals
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(arAoa), 'AR Aging');

  const apAoa = buildAoa(company, 'AR / AP Aging Summary — AP Outstanding', `Total: ${Number(apTotalOutstanding) || 0}`, apAgingTotals);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(apAoa), 'AP Aging');

  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const today = new Date().toISOString().slice(0, 10);
  const filename = `AR-AP-Aging-Summary-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
