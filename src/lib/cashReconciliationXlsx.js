// Excel sibling of cashReconciliationPdf.js — same running-balance
// transactions and reconciliation summary CashManagementPanel already
// computed for generateCashReconciliationPdf, written to a workbook instead
// of a PDF (aoa_to_sheet -> book_new -> book_append_sheet -> XLSX.write,
// downloaded via downloadWorkbook).
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateCashReconciliationXlsx({ company, account, transactions, currentBalance, reconciledBalance, statementBalance, reconciliationDifference }) {
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['Cash Reconciliation']);
  aoa.push([`Account: ${account?.account_name || '—'} (${account?.bank_name || '—'} · ****${account?.account_number_last4 || '----'})`]);
  aoa.push([`Generated: ${new Date().toLocaleDateString()}`]);
  aoa.push([]);

  aoa.push(['Current Balance', Number(currentBalance) || 0]);
  aoa.push(['Reconciled Balance', Number(reconciledBalance) || 0]);
  if (statementBalance != null) {
    aoa.push(['Statement Balance', Number(statementBalance) || 0]);
    aoa.push(['Difference', Number(reconciliationDifference) || 0]);
  }
  aoa.push([]);

  aoa.push(['Date', 'Description', 'Type', 'Amount', 'Balance', 'Reconciled']);
  (transactions || []).forEach((row) => aoa.push([
    row.transaction_date || '—',
    row.description || '—',
    row.transaction_type || '—',
    Number(row.amount) || 0,
    Number(row.balance) || 0,
    row.reconciled ? 'Yes' : 'No',
  ]));

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Cash Reconciliation');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `Cash-Reconciliation-${(account?.account_name || 'account').replace(/[^a-z0-9]+/gi, '-')}-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
