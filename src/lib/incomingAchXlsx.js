// Excel sibling of incomingAchPdf.js — same rows IncomingAchPanel already
// computed for generateIncomingAchPdf, written to a workbook instead of a
// PDF (aoa_to_sheet -> book_new -> book_append_sheet -> XLSX.write,
// downloaded via downloadWorkbook).
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateIncomingAchXlsx({ company, rows }) {
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['Incoming ACH Deposits']);
  aoa.push([`Generated: ${new Date().toLocaleDateString()}`]);
  aoa.push([]);

  aoa.push(['Date', 'Sender', 'Amount', 'Bank Account', 'Status', 'Applied To']);
  (rows || []).forEach((row) => aoa.push([
    row.received_date || '—',
    row.sender_name || '—',
    Number(row.amount) || 0,
    row.bank_account || '—',
    row.status || '—',
    row.applied_to || '—',
  ]));

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Incoming ACH');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `Incoming-ACH-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
