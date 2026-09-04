import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';

const COLS = [
  { key: 'category', label: 'Category', w: 22 },
  { key: 'task_name', label: 'Task', w: 68 },
  { key: 'status', label: 'Status', w: 22 },
  { key: 'assigned_to', label: 'Assigned To', w: 28 },
  { key: 'notes', label: 'Notes', w: 40 },
];

function drawTableHeader(doc, x0, y) {
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  let x = x0;
  COLS.forEach((c) => {
    doc.text(c.label, x, y);
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
    category: row.category || '—',
    task_name: String(row.task_name || '—').slice(0, 44),
    status: row.status || 'Not Started',
    assigned_to: String(row.assigned_to || '—').slice(0, 18),
    notes: String(row.notes || '—').slice(0, 28),
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], x, y);
    x += c.w;
  });
}

// Month-End Close panel (MonthEndClosePanel) — the checklist for the
// selected period, plus the same readiness stat counts shown above it.
export function generateMonthEndClosePdf({ company, periodLabel, close, readinessStats, checklistItems }) {
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
  doc.text(`MONTH-END CLOSE — ${periodLabel}`, marginX, 18);
  doc.setFontSize(9);
  let y = 26;
  doc.text(company?.name || '—', marginX, y); y += 5;
  doc.text(`Status: ${close?.status === 'Closed' ? `Closed${close?.closed_date ? ` on ${close.closed_date}` : ''}${close?.closed_by ? ` by ${close.closed_by}` : ''}` : 'In Progress'}`, marginX, y); y += 5;
  doc.text(`Generated ${today}`, marginX, y); y += 7;

  (readinessStats || []).forEach((stat) => {
    doc.text(`${stat.label}: ${stat.count}`, marginX, y);
    y += 5;
  });
  y += 4;

  y = drawTableHeader(doc, marginX, y);
  doc.setFontSize(8);
  (checklistItems || []).forEach((row) => {
    y = ensureRoom(y);
    drawRow(doc, marginX, y, row);
    y += 5;
  });

  if (!checklistItems || checklistItems.length === 0) {
    doc.text('No checklist items yet.', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `Month-End-Close-${periodLabel.replace(/[^a-z0-9]+/gi, '-')}-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
