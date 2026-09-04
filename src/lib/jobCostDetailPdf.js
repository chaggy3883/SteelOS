import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { sumProjectJobCostTotals } from '@/lib/jobCostEngine';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLS = [
  { key: 'cost_code', label: 'Cost Code', w: 26 },
  { key: 'description', label: 'Description', w: 42 },
  { key: 'original_estimate', label: 'Orig. Estimate', w: 24, align: 'right' },
  { key: 'approved_co', label: 'Approved C.O.', w: 24, align: 'right' },
  { key: 'revised_estimated_cost', label: 'Revised Est.', w: 24, align: 'right' },
  { key: 'jtd_hours', label: 'JTD Hours', w: 20, align: 'right' },
  { key: 'jtd_costs', label: 'JTD Costs', w: 24, align: 'right' },
  { key: 'profit_loss', label: 'Profit/Loss', w: 24, align: 'right' },
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
    cost_code: row.cost_code || '—',
    description: String(row.description || '—').slice(0, 32),
    original_estimate: money(row.original_estimate),
    approved_co: money(row.approved_co),
    revised_estimated_cost: money(row.revised_estimated_cost),
    jtd_hours: (Number(row.jtd_hours) || 0).toLocaleString(),
    jtd_costs: money(row.jtd_costs),
    profit_loss: money(row.profit_loss),
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

function drawTotalsRow(doc, x0, y, totals, label = 'PROJECT TOTAL') {
  doc.setFont(undefined, 'bold');
  let x = x0;
  const values = {
    cost_code: label,
    description: '',
    original_estimate: money(totals.original_estimate),
    approved_co: money(totals.approved_co),
    revised_estimated_cost: money(totals.revised_estimated_cost),
    jtd_hours: (Number(totals.jtd_hours) || 0).toLocaleString(),
    jtd_costs: money(totals.jtd_costs),
    profit_loss: money(totals.profit_loss),
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
  doc.setFont(undefined, 'normal');
}

// One project's cost-code-by-cost-code breakdown — same rows Accounting.jsx's
// Job Cost Detail tab renders (buildProjectJobCostRows), laid out as a table
// with a project-total footer row.
export function generateProjectJobCostPdf({ project, company, rows }) {
  // Landscape — 8 columns of financial detail don't fit portrait's ~192mm
  // usable width (same reasoning as the WH-347 certified payroll table, see
  // pdfLayout.js's comment on PDF_MARGIN_MM).
  const doc = new jsPDF({ orientation: 'landscape', format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  const ensureRoom = (y, needed = 8) => {
    if (y + needed > pageHeight - marginX) {
      doc.addPage();
      const header = drawTableHeader(doc, marginX, 18);
      return header;
    }
    return y;
  };

  doc.setFontSize(16);
  doc.text('JOB COST DETAIL', marginX, 18);
  doc.setFontSize(9);
  let y = 26;
  doc.text(company?.name || '—', marginX, y); y += 5;
  doc.text(`Project: ${project?.name || 'Unknown Project'}${project?.project_number ? ` (#${project.project_number})` : ''}`, marginX, y); y += 5;
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  y = drawTableHeader(doc, marginX, y);
  doc.setFontSize(8);
  (rows || []).forEach((row) => {
    y = ensureRoom(y);
    drawRow(doc, marginX, y, row);
    y += 5;
  });

  if (!rows || rows.length === 0) {
    doc.text('No job cost activity recorded for this project yet.', marginX, y);
    y += 6;
  }

  y = ensureRoom(y, 10);
  y += 2;
  doc.setLineWidth(0.1);
  doc.line(marginX, y - 3, pageWidth - marginX, y - 3);
  drawTotalsRow(doc, marginX, y, sumProjectJobCostTotals(rows));

  const blob = doc.output('blob');
  const filename = `Job-Cost-Detail-${(project?.name || 'project').replace(/[^a-z0-9]+/gi, '-')}-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}

const ROLLUP_COLS = [
  { key: 'cost_code', label: 'Cost Code', w: 32 },
  { key: 'description', label: 'Description', w: 60 },
  { key: 'project_count', label: 'Projects', w: 22, align: 'right' },
  { key: 'jtd_costs', label: 'Total Cost', w: 30, align: 'right' },
  { key: 'pct_of_total', label: '% of Total', w: 26, align: 'right' },
];

function drawRollupHeader(doc, x0, y) {
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  let x = x0;
  ROLLUP_COLS.forEach((c) => {
    doc.text(c.label, c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
  doc.setFont(undefined, 'normal');
  doc.setLineWidth(0.1);
  doc.line(x0, y + 1.5, x, y + 1.5);
  return y + 5;
}

function drawRollupRow(doc, x0, y, row) {
  let x = x0;
  const values = {
    cost_code: row.cost_code || '—',
    description: String(row.description || '—').slice(0, 46),
    project_count: String(row.project_count ?? 0),
    jtd_costs: money(row.jtd_costs),
    pct_of_total: `${(Number(row.pct_of_total) || 0).toFixed(1)}%`,
  };
  ROLLUP_COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

// Combined "all projects" export — company-wide cost distribution per cost
// code (buildCompanyWideJobCostRollup's output), the leadership-facing view
// asked for alongside the per-project breakdown above.
export function generateCompanyWideJobCostPdf({ company, rows, dateFrom, dateTo }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  const ensureRoom = (y, needed = 8) => {
    if (y + needed > pageHeight - marginX) {
      doc.addPage();
      const header = drawRollupHeader(doc, marginX, 18);
      return header;
    }
    return y;
  };

  doc.setFontSize(16);
  doc.text('COMPANY-WIDE JOB COST ROLLUP', marginX, 18);
  doc.setFontSize(9);
  let y = 26;
  doc.text(company?.name || '—', marginX, y); y += 5;
  doc.text(`Period: ${dateFrom || 'All'} — ${dateTo || 'Present'}`, marginX, y); y += 5;
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  y = drawRollupHeader(doc, marginX, y);
  doc.setFontSize(8);
  const grandTotal = (rows || []).reduce((sum, r) => sum + (Number(r.jtd_costs) || 0), 0);
  (rows || []).forEach((row) => {
    y = ensureRoom(y);
    drawRollupRow(doc, marginX, y, row);
    y += 5;
  });

  if (!rows || rows.length === 0) {
    doc.text('No job cost activity recorded across any project yet.', marginX, y);
    y += 6;
  }

  y = ensureRoom(y, 10);
  y += 2;
  doc.setLineWidth(0.1);
  doc.line(marginX, y - 3, pageWidth - marginX, y - 3);
  doc.setFont(undefined, 'bold');
  doc.text('COMPANY TOTAL', marginX, y);
  doc.text(money(grandTotal), marginX + ROLLUP_COLS[0].w + ROLLUP_COLS[1].w + ROLLUP_COLS[2].w + ROLLUP_COLS[3].w, y, { align: 'right' });
  doc.setFont(undefined, 'normal');

  const blob = doc.output('blob');
  const filename = `Job-Cost-Rollup-Company-Wide-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
