// Estimating page → Bid History (Won & Lost) card, as an .xlsx — same
// won+lost bids/employees data already fetched for generateEstimatingBidHistoryPdf.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

function estimatorName(employees, id) {
  return employees.find((e) => e.id === id)?.full_name || 'Unassigned';
}

export async function generateEstimatingBidHistoryXlsx({ company, bids, employees }) {
  const today = new Date().toISOString().slice(0, 10);
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['Bid History — Won & Lost']);
  aoa.push([`Generated ${today}`]);
  aoa.push([]);
  aoa.push(['Bid #', 'Job', 'GC', 'Assigned To', 'Quoted Price', 'Margin %', 'Result', 'Loss Reason']);
  (bids || []).forEach((row) => aoa.push([
    row.bid_number || '—',
    row.job_name || '—',
    row.general_contractor_name || '—',
    estimatorName(employees || [], row.estimator_id),
    Number(row.bid_quoted_price) || 0,
    Number(row.margin_percentage) || 0,
    row.status === 'won' ? 'Won' : 'Lost',
    row.loss_reason ? row.loss_reason.replace(/_/g, ' ') : '—',
  ]));

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Bid History');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `Bid-History-${today}.xlsx`;
  downloadWorkbook(bytes, filename);
  return { filename };
}
