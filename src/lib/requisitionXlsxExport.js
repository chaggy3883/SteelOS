// Generates an .xlsx mirror of requisitionPdfExport.js's unpriced material
// requisition sheet — same { title, subtitle, columns, rows } shape its
// three callers (BlueprintTakeoff.jsx, MarkupsList.jsx, FullTakeoff.jsx)
// already build for the PDF export, via the aoa_to_sheet approach shared
// with detailerImportBatchReviewXlsx.js, downloaded with the shared
// downloadWorkbook helper (bidRecapXlsxExport.js).
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

export function exportRequisitionToXlsx({ title, subtitle, columns, rows }) {
  const aoa = [];
  aoa.push([title]);
  if (subtitle) aoa.push([subtitle]);
  aoa.push([]);
  aoa.push(columns);
  (rows || []).forEach((row) => aoa.push(row));
  aoa.push([]);
  aoa.push(['Unpriced requisition — for supplier quoting only. No cost data included.']);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Requisition');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const safeName = String(title || 'requisition').replace(/[^a-z0-9-]+/gi, '_');
  downloadWorkbook(bytes, `${safeName}.xlsx`);

  return { filename: `${safeName}.xlsx` };
}

// Excel mirror of exportCombinedOrderToPdf (requisitionPdfExport.js), from
// the same stockCombiner.js buildOrderExportTables rows — on ONE sheet so the
// order, % drop, scrap and cut list sit side by side: each group's summary
// row, its bars / sheets and their cuts with each bar's drop, anything
// flagged, then the run total.
export function exportCombinedOrderToXlsx({ title, subtitle, tables, settingsText }) {
  const workbook = XLSX.utils.book_new();
  const { columns, rows, totalRow } = tables.combined;
  const aoa = [];
  aoa.push([title]);
  if (subtitle) aoa.push([subtitle]);
  if (settingsText) aoa.push([settingsText]);
  aoa.push([]);
  aoa.push(columns);
  rows.forEach((r) => aoa.push(r.cells));
  aoa.push([]);
  aoa.push(totalRow);
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  // Column widths sized to the longest value so nothing reads as "#####".
  sheet['!cols'] = columns.map((c, i) => {
    const longest = Math.max(String(c).length, ...rows.map((r) => String(r.cells[i] ?? '').length), String(totalRow[i] ?? '').length);
    return { wch: Math.min(48, Math.max(8, longest + 2)) };
  });
  XLSX.utils.book_append_sheet(workbook, sheet, 'Combined Order');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const safeName = String(title || 'combined-order').replace(/[^a-z0-9-]+/gi, '_');
  downloadWorkbook(bytes, `${safeName}.xlsx`);
  return { filename: `${safeName}.xlsx` };
}
