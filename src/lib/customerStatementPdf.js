import { jsPDF } from 'jspdf';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Minimum-viable customer statement — Stage 9 of the payment-layer build.
// Same manual jsPDF + Blob-anchor download idiom as certifiedPayrollReportPdf.js
// (no autotable dependency installed in this project). Lists every open
// invoice making up the customer's balance (from computeCustomerBalances'
// per-customer entry), every payment applied against those invoices, and
// every credit memo — write-offs show inline in the payment list, labeled
// distinctly, exactly as they appear in the app's own payment history.
export function generateCustomerStatementPdf({ customer, company, invoiceRows, payments, memos }) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  const today = new Date().toISOString().slice(0, 10);
  const rightColX = pageWidth - marginX - 22;

  const ensureRoom = (y, needed = 8) => {
    if (y + needed > 280) { doc.addPage(); return 20; }
    return y;
  };

  doc.setFontSize(16);
  doc.text('CUSTOMER STATEMENT', marginX, 18);

  doc.setFontSize(9);
  let y = 26;
  const companyLine = [company?.name, company?.address, company?.city, company?.state].filter(Boolean).join(', ');
  doc.text(companyLine || '—', marginX, y); y += 5;
  doc.text(`Statement Date: ${today}`, marginX, y); y += 9;

  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text(customer?.name || 'Unknown Customer', marginX, y);
  doc.setFont(undefined, 'normal');
  y += 6;
  const custAddress = [customer?.billing_address || customer?.address, [customer?.billing_city || customer?.city, customer?.billing_state || customer?.state].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  if (custAddress) { doc.setFontSize(9); doc.text(custAddress, marginX, y); y += 8; } else { y += 4; }

  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('Open Invoices', marginX, y);
  doc.setFont(undefined, 'normal');
  y += 6;

  const cols = [
    { key: 'period', label: 'Billing Period', x: marginX, w: 45 },
    { key: 'project', label: 'Project', x: marginX + 42, w: 58 },
    { key: 'net', label: 'Net Billing', x: marginX + 102, w: 28 },
    { key: 'applied', label: 'Applied/Credited', x: marginX + 132, w: 32 },
    { key: 'balance', label: 'Balance', x: marginX + 168, w: 24 },
  ];
  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  cols.forEach((c) => doc.text(c.label, c.x, y));
  doc.setFont(undefined, 'normal');
  y += 2;
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 5;

  let totalBalance = 0;
  (invoiceRows || []).forEach(({ invoice, project, outstanding }) => {
    y = ensureRoom(y);
    const net = Number(invoice.net_billing) || 0;
    const appliedOrCredited = net - outstanding;
    totalBalance += outstanding;
    doc.text(invoice.billing_period || '—', cols[0].x, y);
    doc.text(String(project?.name || '—').slice(0, 34), cols[1].x, y);
    doc.text(money(net), cols[2].x, y);
    doc.text(money(appliedOrCredited), cols[3].x, y);
    doc.text(money(outstanding), cols[4].x, y);
    y += 6;
  });
  if (!invoiceRows || invoiceRows.length === 0) { doc.text('No open invoices.', marginX, y); y += 6; }

  y += 3;
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 6;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text(`Total Balance Due: ${money(totalBalance)}`, marginX, y);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  y += 10;

  if (payments?.length) {
    y = ensureRoom(y, 14);
    doc.setFont(undefined, 'bold'); doc.text('Payments Applied', marginX, y); doc.setFont(undefined, 'normal'); y += 6;
    doc.setFontSize(8);
    payments.forEach((p) => {
      y = ensureRoom(y);
      const label = p.is_write_off ? 'Write-Off' : (p.payment_method || '').replace(/_/g, ' ');
      doc.text(`${p.payment_date || '—'}   ${label}${p.reference_number ? `   Ref: ${p.reference_number}` : ''}`, marginX, y);
      doc.text(money(p.amount), rightColX, y);
      y += 5;
    });
    y += 5;
  }

  if (memos?.length) {
    y = ensureRoom(y, 14);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold'); doc.text('Credit Memos', marginX, y); doc.setFont(undefined, 'normal'); y += 6;
    doc.setFontSize(8);
    memos.forEach((m) => {
      y = ensureRoom(y);
      doc.text(`${m.issued_date || '—'}   ${(m.reason || '').slice(0, 70)}`, marginX, y);
      doc.text(money(m.amount), rightColX, y);
      y += 5;
    });
  }

  const blob = doc.output('blob');
  const filename = `Statement-${(customer?.name || 'customer').replace(/[^a-z0-9]+/gi, '-')}-${today}.pdf`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { blob, filename };
}
