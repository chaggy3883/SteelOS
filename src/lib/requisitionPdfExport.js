// Local, dependency-free "export to PDF": writes a clean unpriced HTML sheet
// into a new browser tab and calls print() on it, so the browser's own
// print dialog (Save as PDF) produces the file — a plain browser-print
// export, unlike bidProposalPdf.js's direct jsPDF generation, since this
// grid isn't a top-level print target on its own page tree.
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export function exportRequisitionToPdf({ title, subtitle, columns, rows }) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const headerHtml = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const rowsHtml = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');

  printWindow.document.write(`<!doctype html>
<html>
<head>
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #111; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.subtitle { font-size: 12px; color: #555; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
  th { background: #eee; }
  p.footer-note { margin-top: 16px; font-size: 11px; color: #777; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">${escapeHtml(subtitle)}</p>
  <table>
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <p class="footer-note">Unpriced requisition — for supplier quoting only. No cost data included.</p>
</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
