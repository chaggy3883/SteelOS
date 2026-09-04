import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLS = [
  { key: 'project', label: 'Project', w: 60 },
  { key: 'status', label: 'Status', w: 26 },
  { key: 'contract_value', label: 'Contract Value', w: 30, align: 'right' },
  { key: 'estimated_tons', label: 'Est. Tons', w: 24, align: 'right' },
  { key: 'per_ton', label: '$/Ton', w: 26, align: 'right' },
  { key: 'risk_level', label: 'Risk Level', w: 24 },
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
    project: `${String(row.name || 'Unknown Project').slice(0, 38)}${row.project_number ? ` (#${row.project_number})` : ''}`,
    status: row.status || '—',
    contract_value: row.contract_value ? money(row.contract_value) : '—',
    estimated_tons: row.estimated_tons ? `${Number(row.estimated_tons).toLocaleString()} T` : '—',
    per_ton: row.contract_value && row.estimated_tons ? `$${Math.round(row.contract_value / row.estimated_tons).toLocaleString()}` : '—',
    risk_level: row.risk_level || '—',
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

// The Job Costing Summary tab's project list (Accounting.jsx's "jobs" tab) —
// same rows/filter the on-screen table renders, laid out as a table.
export function generateJobCostingSummaryPdf({ company, projects, riskFilterActive }) {
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
  doc.text('JOB COSTING SUMMARY', marginX, 18);
  doc.setFontSize(9);
  let y = 26;
  doc.text(company?.name || '—', marginX, y); y += 5;
  if (riskFilterActive) { doc.text('Showing only projects with financial risk flagged.', marginX, y); y += 5; }
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  y = drawTableHeader(doc, marginX, y);
  doc.setFontSize(8);
  (projects || []).forEach((row) => {
    y = ensureRoom(y);
    drawRow(doc, marginX, y, row);
    y += 5;
  });

  if (!projects || projects.length === 0) {
    doc.text('No projects found', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `Job-Costing-Summary-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
