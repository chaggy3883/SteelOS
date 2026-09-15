// Excel counterpart to customerStatementPdf.js — same open-invoices,
// payments-applied, and credit-memos data passed from Accounting.jsx's
// handleGenerateStatement, as real numeric cells instead of PDF text lines.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateCustomerStatementXlsx({ customer, company, invoiceRows, payments, memos }) {
  const today = new Date().toISOString().slice(0, 10);
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['CUSTOMER STATEMENT']);
  aoa.push([`Statement Date: ${today}`]);
  aoa.push([customer?.name || 'Unknown Customer']);
  const custAddress = [customer?.billing_address || customer?.address, [customer?.billing_city || customer?.city, customer?.billing_state || customer?.state].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  if (custAddress) aoa.push([custAddress]);
  aoa.push([]);

  aoa.push(['Open Invoices']);
  aoa.push(['Billing Period', 'Project', 'Net Billing', 'Applied/Credited', 'Balance']);
  let totalBalance = 0;
  (invoiceRows || []).forEach(({ invoice, project, outstanding }) => {
    const net = Number(invoice.net_billing) || 0;
    const appliedOrCredited = net - outstanding;
    totalBalance += outstanding;
    aoa.push([invoice.billing_period || '—', project?.name || '—', net, appliedOrCredited, outstanding]);
  });
  if (!invoiceRows || invoiceRows.length === 0) aoa.push(['No open invoices.']);
  aoa.push(['Total Balance Due', '', '', '', totalBalance]);
  aoa.push([]);

  if (payments?.length) {
    aoa.push(['Payments Applied']);
    aoa.push(['Date', 'Type', 'Reference', 'Amount']);
    payments.forEach((p) => {
      const label = p.is_write_off ? 'Write-Off' : (p.payment_method || '').replace(/_/g, ' ');
      aoa.push([p.payment_date || '—', label, p.reference_number || '', Number(p.amount) || 0]);
    });
    aoa.push([]);
  }

  if (memos?.length) {
    aoa.push(['Credit Memos']);
    aoa.push(['Date', 'Reason', 'Amount']);
    memos.forEach((m) => {
      aoa.push([m.issued_date || '—', m.reason || '', Number(m.amount) || 0]);
    });
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Statement');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `Statement-${(customer?.name || 'customer').replace(/[^a-z0-9]+/gi, '-')}-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
