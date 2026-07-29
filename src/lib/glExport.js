// General-ledger export helpers. Column layouts are a good-faith approximation of
// each system's typical GL/journal import CSV — verify against the actual current
// QuickBooks Online / Sage 100 import template before relying on this in production.

const COST_CLASS_ACCOUNTS = {
  MAT: '5100 - Materials COGS',
  SUB: '5200 - Subcontractor COGS',
  EQP: '5300 - Equipment COGS',
  LAB: '5400 - Labor COGS',
};

function downloadCSV(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToQuickBooksCSV(ledgerEntries) {
  const header = ['Date', 'Account', 'Debit', 'Credit', 'Name', 'Memo'];
  const rows = ledgerEntries.map((e) => [
    e.transaction_date || '',
    COST_CLASS_ACCOUNTS[e.cost_class] || e.cost_class,
    Number(e.amount) || 0,
    '',
    e.project_id || '',
    e.description || '',
  ]);
  downloadCSV('gl_export_quickbooks.csv', [header, ...rows]);
}

export function exportToSage100CSV(ledgerEntries) {
  const header = ['TransactionDate', 'GLAccountNo', 'ReferenceNo', 'SourceModule', 'DebitAmt', 'CreditAmt', 'Description'];
  const rows = ledgerEntries.map((e) => [
    e.transaction_date || '',
    COST_CLASS_ACCOUNTS[e.cost_class] || e.cost_class,
    e.source_id || '',
    'JC',
    Number(e.amount) || 0,
    '',
    e.description || '',
  ]);
  downloadCSV('gl_export_sage100.csv', [header, ...rows]);
}
