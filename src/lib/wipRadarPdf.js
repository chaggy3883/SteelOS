import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;

const COLS = [
  { key: 'projectName', label: 'Project', w: 80 },
  { key: 'contractValue', label: 'Contract Value', w: 32, align: 'right' },
  { key: 'jtdCost', label: 'JTD Cost Recognized', w: 34, align: 'right' },
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
    projectName: String(row.projectName || '—').slice(0, 48),
    contractValue: money(row.contractValue),
    jtdCost: money(row.jtdCost),
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

// Executive Analytics → Financial WIP Radar card — total contract value vs.
// actual job-to-date cost recognized (computeProjectWipRadar), per active
// project, same rows the on-screen bar chart plots.
export async function generateWipRadarPdf({ company, wipRadar }) {
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

  const letterheadY = await drawLetterheadIfActive(doc, 'exec_wip_radar', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('FINANCIAL WIP RADAR', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  y = drawTableHeader(doc, marginX, y);
  doc.setFontSize(8);
  (wipRadar || []).forEach((row) => {
    y = ensureRoom(y);
    drawRow(doc, marginX, y, row);
    y += 5;
  });

  if (!wipRadar || wipRadar.length === 0) {
    doc.text('No active projects to report.', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `WIP-Radar-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
