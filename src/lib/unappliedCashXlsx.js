// Excel sibling of unappliedCashPdf.js — same overpayment rows
// UnappliedCashPanel already computed for generateUnappliedCashPdf, written
// to a workbook instead of a PDF (aoa_to_sheet -> book_new ->
// book_append_sheet -> XLSX.write, downloaded via downloadWorkbook).
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateUnappliedCashXlsx({ company, rows }) {
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['Unapplied Cash']);
  aoa.push([`Generated: ${new Date().toLocaleDateString()}`]);
  aoa.push([]);

  aoa.push(['Source', 'Date', 'Unapplied Amount']);
  (rows || []).forEach((row) => aoa.push([row.source || '—', row.date || '—', Number(row.amount) || 0]));

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Unapplied Cash');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `Unapplied-Cash-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
