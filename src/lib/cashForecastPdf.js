import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';

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

// Bank & Cash → 90-Day Forecast sub-tab (CashForecastPanel) — same weekly
// buckets the on-screen table renders.
export function generateCashForecastPdf({ company, startingBalance, buckets }) {
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
  doc.text('90-DAY CASH FORECAST', marginX, 18);
  doc.setFontSize(9);
  let y = 26;
  doc.text(company?.name || '—', marginX, y); y += 5;
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
  const filename = `Cash-Forecast-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
