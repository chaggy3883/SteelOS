import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLS = [
  { key: 'transaction_date', label: 'Date', w: 18 },
  { key: 'description', label: 'Description', w: 55 },
  { key: 'transaction_type', label: 'Type', w: 20 },
  { key: 'amount', label: 'Amount', w: 24, align: 'right' },
  { key: 'balance', label: 'Balance', w: 24, align: 'right' },
  { key: 'reconciled', label: 'Reconciled', w: 18 },
];

function drawTableHeader(doc, x0, y) {
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  let x = x0;
  COLS.forEach((c) => {
    doc.text(c.label, c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
  doc.setFont(undefined, 'normal');
  doc.setLineWidth(0.1);
  doc.line(x0, y + 1.5, x, y + 1.5);
  return y + 5;
}

function drawRow(doc, x0, y, row) {
  let x = x0;
  const values = {
    transaction_date: row.transaction_date || '—',
    description: String(row.description || '—').slice(0, 40),
    transaction_type: row.transaction_type || '—',
    amount: money(row.amount),
    balance: money(row.balance),
    reconciled: row.reconciled ? 'Yes' : 'No',
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

// Bank & Cash → Accounts & Reconciliation sub-tab (CashManagementPanel) for
// one bank account — same running-balance transactions the on-screen table
// renders, plus the reconciliation summary figures shown above it.
export function generateCashReconciliationPdf({ company, account, transactions, currentBalance, reconciledBalance, statementBalance, reconciliationDifference }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  const ensureRoom = (y, needed = 8) => {
    if (y + needed > pageHeight - marginX) {
      doc.addPage();
      return drawTableHeader(doc, marginX, 18);
    }
    return y;
  };

  doc.setFontSize(16);
  doc.text('CASH RECONCILIATION', marginX, 18);
  doc.setFontSize(9);
  let y = 26;
  doc.text(company?.name || '—', marginX, y); y += 5;
  doc.text(`Account: ${account?.account_name || '—'} (${account?.bank_name || '—'} · ****${account?.account_number_last4 || '----'})`, marginX, y); y += 5;
  doc.text(`Generated ${today}`, marginX, y); y += 7;

  doc.text(`Current Balance: ${money(currentBalance)}`, marginX, y); y += 5;
  doc.text(`Reconciled Balance: ${money(reconciledBalance)}`, marginX, y); y += 5;
  if (statementBalance != null) {
    doc.text(`Statement Balance: ${money(statementBalance)}`, marginX, y); y += 5;
    doc.text(`Difference: ${money(reconciliationDifference)}`, marginX, y); y += 5;
  }
  y += 4;

  y = drawTableHeader(doc, marginX, y);
  doc.setFontSize(8);
  (transactions || []).forEach((row) => {
    y = ensureRoom(y);
    drawRow(doc, marginX, y, row);
    y += 5;
  });

  if (!transactions || transactions.length === 0) {
    doc.text('No transactions for this account yet.', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `Cash-Reconciliation-${(account?.account_name || 'account').replace(/[^a-z0-9]+/gi, '-')}-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
