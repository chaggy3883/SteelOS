// Estimating page → Bid List (Active) card, as an .xlsx — same active-status
// bids/employees data already fetched for generateEstimatingActiveBidsPdf.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

function estimatorName(employees, id) {
  return employees.find((e) => e.id === id)?.full_name || 'Unassigned';
}

export async function generateEstimatingActiveBidsXlsx({ company, bids, employees }) {
  const today = new Date().toISOString().slice(0, 10);
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['Bid List — Active']);
  aoa.push([`Generated ${today}`]);
  aoa.push([]);
  aoa.push(['Bid #', 'Job', 'Customer', 'Assigned To', 'Due Date', 'Bid Total', 'Status']);
  (bids || []).forEach((row) => aoa.push([
    row.bid_number || '—',
    row.job_name || '—',
    row.customer_name || '—',
    estimatorName(employees || [], row.estimator_id),
    row.bid_due_date || '—',
    Number(row.bid_total_cost) || 0,
    (row.status || '').replace(/_/g, ' '),
  ]));

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Active Bids');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `Active-Bids-${today}.xlsx`;
  downloadWorkbook(bytes, filename);
  return { filename };
}
