// Excel counterpart to arBillingPdf.js — same Schedule of Values and
// Progress Billings (AIA G702/G703) rows Accounting.jsx renders for the
// selected project, as real numeric cells instead of PDF text.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateArBillingXlsx({ project, company, sovLines, invoiceReceivables }) {
  const today = new Date().toISOString().slice(0, 10);
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['AR & BILLINGS']);
  aoa.push([`Project: ${project?.name || 'Unknown Project'}${project?.project_number ? ` (#${project.project_number})` : ''}`]);
  aoa.push([`Generated ${today}`]);
  aoa.push([]);

  aoa.push(['Schedule of Values (SOV)']);
  aoa.push(['Item', 'Scheduled Value', '% Complete', 'Billed to Date', 'Retainage %']);
  (sovLines || []).forEach((row) => aoa.push([
    row.item_description || '—',
    Number(row.original_scheduled_value) || 0,
    Number(row.completion_percentage) || 0,
    Number(row.current_billed_amount) || 0,
    (Number(row.retainage_rate) || 0) * 100,
  ]));
  if (!sovLines || sovLines.length === 0) aoa.push(['No SOV lines for this project yet.']);
  aoa.push([]);

  aoa.push(['Progress Billings (AIA G702/G703)']);
  aoa.push(['Billing Period', 'Gross Amount', 'Retainage Held', 'Net Billing', 'Status']);
  (invoiceReceivables || []).forEach((row) => aoa.push([
    row.billing_period || '—',
    Number(row.gross_amount) || 0,
    Number(row.retainage_held) || 0,
    Number(row.net_billing) || 0,
    row.payment_status || '—',
  ]));
  if (!invoiceReceivables || invoiceReceivables.length === 0) aoa.push(['No progress billings for this project yet.']);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'AR & Billings');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `AR-Billing-${(project?.name || 'project').replace(/[^a-z0-9]+/gi, '-')}-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
