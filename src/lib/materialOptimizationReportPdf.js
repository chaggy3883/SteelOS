import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

const money = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);

const GROUP_COLS = [
  { key: 'material', label: 'Material', w: 42 },
  { key: 'required_display', label: 'Required', w: 20, align: 'right' },
  { key: 'in_inventory_display', label: 'In Inventory', w: 22, align: 'right' },
  { key: 'purchased_display', label: 'To Purchase', w: 22, align: 'right' },
  { key: 'waste_in', label: 'Waste (in)', w: 18, align: 'right' },
  { key: 'remnant_in', label: 'Remnant (in)', w: 20, align: 'right' },
  { key: 'utilization_pct', label: 'Util.', w: 14, align: 'right' },
  { key: 'estimated_cost', label: 'Est. Cost', w: 24, align: 'right' },
  { key: 'actual_cost', label: 'Actual Cost', w: 24, align: 'right' },
];

function drawGroupTableHeader(doc, x0, y) {
  doc.setFont(undefined, 'bold');
  doc.setFontSize(7);
  let x = x0;
  GROUP_COLS.forEach((c) => {
    doc.text(c.label, c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
  doc.setFont(undefined, 'normal');
  doc.setLineWidth(0.1);
  doc.line(x0, y + 1.5, x, y + 1.5);
  return y + 5;
}

function drawGroupRow(doc, x0, y, g) {
  let x = x0;
  const values = {
    material: `${g.material_profile || '(no profile)'} — ${g.material_grade || '(no grade)'}`.slice(0, 30),
    required_display: g.required_display,
    in_inventory_display: g.in_inventory_display,
    purchased_display: g.purchased_display,
    waste_in: String(g.waste_in),
    remnant_in: String(g.remnant_in),
    utilization_pct: pct(g.utilization_pct),
    estimated_cost: money(g.estimated_cost),
    actual_cost: `${money(g.actual_cost)}${g.actual_cost !== null && !g.actual_cost_complete ? ' (partial)' : ''}`,
  };
  GROUP_COLS.forEach((c) => {
    doc.text(String(values[c.key] ?? '—'), c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

// Material Optimization Report panel — the same STAGE 12 rollup
// (buildMaterialOptimizationReport) the on-screen stat tiles and tables show,
// for one project's committed cut-plan runs.
export async function generateMaterialOptimizationReportPdf({ company, projectName, report }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT, orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);
  const { totals, stockLengthSummary, groups } = report;

  const ensureRoom = (y, needed = 8, redrawHeader) => {
    if (y + needed > pageHeight - marginX) {
      doc.addPage();
      return redrawHeader ? redrawHeader(18) : 18;
    }
    return y;
  };

  const letterheadY = await drawLetterheadIfActive(doc, 'material_optimization_report', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('MATERIAL OPTIMIZATION REPORT', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`Project: ${projectName || 'Unknown Project'}`, marginX, y); y += 5;
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  doc.text(`Material Required: ${totals.required_display || '0\''}`, marginX, y); y += 5;
  doc.text(`In Inventory (Remnants): ${totals.in_inventory_display || '0\''}`, marginX, y); y += 5;
  doc.text(`Purchased New Stock: ${totals.purchased_display || '0\''}`, marginX, y); y += 5;
  doc.text(`Utilization: ${pct(totals.utilization_pct)}`, marginX, y); y += 5;
  doc.text(`Waste / Remnant on Purchased Stock: ${totals.waste_in}" waste total, ${totals.remnant_in}" left as new remnant`, marginX, y); y += 5;
  doc.text(
    `Estimated vs. Actual Material Cost: ${money(totals.estimated_cost ?? totals.estimated_cost_partial)}${totals.estimated_cost === null ? ' (partial)' : ''} est. vs. ${money(totals.actual_cost)} actual`,
    marginX, y
  ); y += 9;

  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('Stock Lengths Required', marginX, y);
  doc.setFont(undefined, 'normal');
  y += 6;
  doc.setFontSize(8);
  if (!stockLengthSummary || stockLengthSummary.length === 0) {
    doc.text('No new stock purchased — every piece was covered by on-hand remnants.', marginX, y);
    y += 6;
  } else {
    doc.setFont(undefined, 'bold');
    doc.text('Stock Length', marginX, y);
    doc.text('Quantity Required', marginX + 60, y, { align: 'right' });
    doc.setFont(undefined, 'normal');
    doc.setLineWidth(0.1);
    doc.line(marginX, y + 1.5, marginX + 60, y + 1.5);
    y += 5;
    stockLengthSummary.forEach((row) => {
      y = ensureRoom(y);
      doc.text(`${row.length_in}"`, marginX, y);
      doc.text(String(row.quantity), marginX + 60, y, { align: 'right' });
      y += 5;
    });
  }
  y += 4;

  y = ensureRoom(y, 14);
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('By Material (Shape + Grade)', marginX, y);
  doc.setFont(undefined, 'normal');
  y += 6;

  y = drawGroupTableHeader(doc, marginX, y);
  doc.setFontSize(7);
  (groups || []).forEach((g) => {
    y = ensureRoom(y, 6, (yy) => drawGroupTableHeader(doc, marginX, yy));
    drawGroupRow(doc, marginX, y, g);
    y += 5;
  });

  if (!groups || groups.length === 0) {
    doc.text('No material groups.', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `material-optimization-report-${(projectName || 'project').replace(/[^a-z0-9]+/gi, '-')}-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
