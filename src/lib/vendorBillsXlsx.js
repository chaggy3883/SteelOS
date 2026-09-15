// Excel counterpart to vendorBillsPdf.js — same 3-Way Match Queue rows
// Accounting.jsx's "vendorbills" tab renders (vendor/PO already resolved
// to display names), as real numeric cells instead of PDF text.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateVendorBillsXlsx({ company, rows }) {
  const today = new Date().toISOString().slice(0, 10);
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['VENDOR BILLS — 3-WAY MATCH QUEUE']);
  aoa.push([`Generated ${today}`]);
  aoa.push([]);

  aoa.push(['Invoice #', 'Vendor', 'PO', 'Gross Amount', 'Variance %', 'Status', 'Conditional Waiver Signed', 'Unconditional Waiver Received']);
  (rows || []).forEach((row) => aoa.push([
    row.invoice_number || '—',
    row.vendor_name || '—',
    row.po_number || '—',
    Number(row.gross_amount) || 0,
    row.variance_pct != null ? Number(row.variance_pct) : '',
    row.status || '—',
    row.conditional_waiver_signed ? 'Yes' : 'No',
    row.unconditional_waiver_received ? 'Yes' : 'No',
  ]));
  if (!rows || rows.length === 0) aoa.push(['No vendor bills yet.']);

  const totalGross = (rows || []).reduce((sum, r) => sum + (Number(r.gross_amount) || 0), 0);
  aoa.push(['TOTAL', '', '', totalGross, '', '', '', '']);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Vendor Bills');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `Vendor-Bills-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
