// Local, dependency-free "export to PDF": writes a clean unpriced HTML sheet
// into a new browser tab and calls print() on it, so the browser's own
// print dialog (Save as PDF) produces the file — a plain browser-print
// export, unlike bidProposalPdf.js's direct jsPDF generation, since this
// grid isn't a top-level print target on its own page tree.
import { loadLetterheadImage } from '@/lib/letterheadPdf';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export async function exportRequisitionToPdf({ title, subtitle, columns, rows }) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const headerHtml = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const rowsHtml = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');

  // This export has no company name/logo of its own today — an active
  // 'material_requisition' letterhead is simply injected as a full-width
  // image ahead of the title; no image means no visual change at all. See
  // letterheadPdf.js.
  const image = await loadLetterheadImage('material_requisition');
  const letterheadHtml = image?.dataUrl
    ? `<img src="${image.dataUrl}" style="max-width:100%;height:auto;max-height:140px;display:block;margin-bottom:16px;" />`
    : '';

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
  ${letterheadHtml}
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

// Combined order list (takeoff "Combine for ordering" step) in the same
// print-to-PDF sheet style as exportRequisitionToPdf above: an order list,
// then every bar's/sheet's cut list, the drop/scrap summary and anything
// flagged for splice / special order. `tables` comes from stockCombiner.js
// buildOrderExportTables so the Excel version prints the same rows.
export async function exportCombinedOrderToPdf({ title, subtitle, tables, settingsText, includeCost = false }) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const fmtCell = (cell) => (typeof cell === 'number' ? cell.toLocaleString(undefined, { maximumFractionDigits: 4 }) : cell);
  const tableHtml = ({ columns, rows, totalRow }) => `<table>
    <thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(fmtCell(cell))}</td>`).join('')}</tr>`).join('')}
    ${totalRow ? `<tr class="total">${totalRow.map((cell) => `<td>${escapeHtml(fmtCell(cell))}</td>`).join('')}</tr>` : ''}</tbody>
  </table>`;

  const image = await loadLetterheadImage('material_requisition');
  const letterheadHtml = image?.dataUrl
    ? `<img src="${image.dataUrl}" style="max-width:100%;height:auto;max-height:140px;display:block;margin-bottom:16px;" />`
    : '';

  printWindow.document.write(`<!doctype html>
<html>
<head>
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #111; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 22px 0 6px; }
  p.subtitle { font-size: 12px; color: #555; margin: 0 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
  th { background: #eee; }
  tr.total td { font-weight: bold; background: #f6f6f6; }
  p.footer-note { margin-top: 16px; font-size: 11px; color: #777; }
</style>
</head>
<body>
  ${letterheadHtml}
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">${escapeHtml(subtitle)}</p>
  ${settingsText ? `<p class="subtitle">${escapeHtml(settingsText)}</p>` : ''}
  <h2>Order list</h2>
  ${tableHtml(tables.order)}
  <h2>Cut lists</h2>
  ${tableHtml(tables.cuts)}
  <h2>Drop / scrap summary</h2>
  ${tableHtml(tables.drops)}
  ${tables.flagged.rows.length ? `<h2>Needs splice / special order</h2>${tableHtml(tables.flagged)}` : ''}
  <p class="footer-note">${includeCost ? 'Includes estimated material cost — internal use.' : 'Unpriced order list — for supplier quoting.'} Combined from the takeoff for review; takeoff lines themselves are unchanged.</p>
</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
