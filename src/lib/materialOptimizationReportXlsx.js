// Generates an .xlsx mirror of materialOptimizationReportPdf.js's Material
// Optimization Report — same `report` shape (totals, stockLengthSummary,
// groups) from buildMaterialOptimizationReport, via the same aoa_to_sheet
// approach as detailerImportBatchReviewXlsx.js, downloaded with the shared
// downloadWorkbook helper (bidRecapXlsxExport.js). No letterhead image (see
// that file's header comment) — company identity is plain text rows instead.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export async function generateMaterialOptimizationReportXlsx({ company, projectName, report }) {
  const today = new Date().toISOString().slice(0, 10);
  const { totals, stockLengthSummary, groups } = report;

  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['MATERIAL OPTIMIZATION REPORT']);
  aoa.push([`Project: ${projectName || 'Unknown Project'}`]);
  aoa.push([`Generated ${today}`]);
  aoa.push([]);
  aoa.push(['Material Required', totals.required_display || '0\'']);
  aoa.push(['In Inventory (Remnants)', totals.in_inventory_display || '0\'']);
  aoa.push(['Purchased New Stock', totals.purchased_display || '0\'']);
  aoa.push(['Utilization %', totals.utilization_pct ?? '']);
  aoa.push(['Waste (in)', totals.waste_in]);
  aoa.push(['Remnant (in)', totals.remnant_in]);
  aoa.push(['Estimated Cost', totals.estimated_cost ?? totals.estimated_cost_partial ?? '']);
  aoa.push(['Actual Cost', totals.actual_cost ?? '']);
  aoa.push([]);

  aoa.push(['Stock Lengths Required']);
  aoa.push(['Stock Length (in)', 'Quantity Required']);
  if (!stockLengthSummary || stockLengthSummary.length === 0) {
    aoa.push(['No new stock purchased — every piece was covered by on-hand remnants.']);
  } else {
    stockLengthSummary.forEach((row) => aoa.push([row.length_in, row.quantity]));
  }
  aoa.push([]);

  aoa.push(['By Material (Shape + Grade)']);
  aoa.push(['Material', 'Required', 'In Inventory', 'To Purchase', 'Waste (in)', 'Remnant (in)', 'Utilization %', 'Est. Cost', 'Actual Cost']);
  (groups || []).forEach((g) => {
    aoa.push([
      `${g.material_profile || '(no profile)'} — ${g.material_grade || '(no grade)'}`,
      g.required_display,
      g.in_inventory_display,
      g.purchased_display,
      g.waste_in,
      g.remnant_in,
      g.utilization_pct ?? '',
      g.estimated_cost ?? '',
      g.actual_cost ?? '',
    ]);
  });
  if (!groups || groups.length === 0) aoa.push(['No material groups.']);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Material Optimization');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `material-optimization-report-${(projectName || 'project').replace(/[^a-z0-9]+/gi, '-')}-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
