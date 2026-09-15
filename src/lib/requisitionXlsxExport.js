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
