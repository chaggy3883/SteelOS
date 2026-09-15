import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLS = [
  { key: 'bucketEndDate', label: 'Week Ending', w: 30 },
  { key: 'netChange', label: 'Net Change', w: 30, align: 'right' },
  { key: 'runningBalance', label: 'Projected Balance', w: 34, align: 'right' },
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
    bucketEndDate: row.bucketEndDate,
    netChange: money(row.netChange),
    runningBalance: money(row.runningBalance),
  };
  COLS.forEach((c) => {
    doc.text(values[c.key], c.align === 'right' ? x + c.w : x, y, c.align === 'right' ? { align: 'right' } : undefined);
    x += c.w;
  });
}

// Executive Analytics → Cash Position card. Same starting balance + weekly
// buckets as the embedded CashForecastPanel (both derive from
// cashForecastEngine.js), drawn under its own 'exec_cash_position' letterhead
// key rather than reusing cashForecastPdf.js's 'cash_forecast' key — Admin
// may want a different letterhead assigned to the executive rollup than to
// the Accounting → Bank & Cash tab's own forecast export.
export async function generateExecCashPositionPdf({ company, startingBalance, buckets }) {
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

  const letterheadY = await drawLetterheadIfActive(doc, 'exec_cash_position', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('EXECUTIVE — CASH POSITION', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`Starting Balance (all active accounts): ${money(startingBalance)}`, marginX, y); y += 5;
  doc.text(`Projected Balance in 90 Days: ${money(buckets?.[buckets.length - 1]?.runningBalance)}`, marginX, y); y += 5;
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  y = drawTableHeader(doc, marginX, y);
  doc.setFontSize(8);
  (buckets || []).forEach((row) => {
    y = ensureRoom(y);
    drawRow(doc, marginX, y, row);
    y += 5;
  });

  if (!buckets || buckets.length === 0) {
    doc.text('No forecast data available.', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `Executive-Cash-Position-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
