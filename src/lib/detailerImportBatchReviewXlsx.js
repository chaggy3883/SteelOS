// Generates an .xlsx of selected DetailerImportedPiece rows from
// BatchReviewModal.jsx's Review & Commit table — same generic array-of-arrays
// -> real workbook approach as SteelCatalogEditor.jsx's buildCatalogWorkbook
// (XLSX.utils.aoa_to_sheet + book_new + book_append_sheet + XLSX.write),
// downloaded via the shared downloadWorkbook Blob-anchor helper
// (bidRecapXlsxExport.js). Generic on `columns`/`rows` for the same reason
// detailerImportBatchReviewPdf.js is — this file doesn't know what a
// DetailerImportedPiece is.
//
// No letterhead IMAGE here: the 'xlsx' package this app has installed
// (SheetJS community build) can't embed images into a worksheet — that's
// the same reason CompanyLetterhead's own docs describe it as a PDF-only
// feature (letterheadDocumentTypes.js's header comment: "every PDF export
// type a CompanyLetterhead can be assigned to"). Company identification is
// still included as a plain text header block instead, so the export is
// never anonymous just because the graphic can't render here.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateDetailerImportBatchReviewXlsx({ company, batch, uploaderEmail, generatedBy, columns, rows }) {
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['Detailer Import — Batch Review']);
  aoa.push([`Detailer / Batch: ${batch?.detailer_name || '—'}`]);
  aoa.push([`Uploaded by: ${uploaderEmail || '—'}`]);
  aoa.push([`Report generated: ${new Date().toLocaleDateString()} by ${generatedBy || '—'}`]);
  aoa.push([]);
  aoa.push(columns.map((c) => c.label));
  (rows || []).forEach((row) => aoa.push(columns.map((c) => row[c.key] ?? '')));

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Batch Review');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const safeName = String(batch?.detailer_name || batch?.id || 'batch').replace(/[^a-z0-9-]+/gi, '_');
  const filename = `Detailer-Import-Batch-Review-${safeName}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
