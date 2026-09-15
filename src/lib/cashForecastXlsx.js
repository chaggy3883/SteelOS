// Excel sibling of cashForecastPdf.js — same weekly forecast buckets
// CashForecastPanel already computed for generateCashForecastPdf, written to
// a workbook instead of a PDF (aoa_to_sheet -> book_new ->
// book_append_sheet -> XLSX.write, downloaded via downloadWorkbook).
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateCashForecastXlsx({ company, startingBalance, buckets }) {
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['90-Day Cash Forecast']);
  aoa.push(['Starting Balance (all active accounts)', Number(startingBalance) || 0]);
  aoa.push(['Projected Balance in 90 Days', Number(buckets?.[buckets.length - 1]?.runningBalance) || 0]);
  aoa.push([`Generated: ${new Date().toLocaleDateString()}`]);
  aoa.push([]);

  aoa.push(['Week Ending', 'Net Change', 'Projected Balance']);
  (buckets || []).forEach((row) => aoa.push([row.bucketEndDate, Number(row.netChange) || 0, Number(row.runningBalance) || 0]));

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Cash Forecast');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `Cash-Forecast-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
