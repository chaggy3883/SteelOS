import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

// Historical Analytics → Estimated vs. Actual Hours by Shop Station card —
// the per-station average variance % (from HistoricalVariance rows,
// optionally scoped to one project) plotted by the on-screen bar chart.
export async function generateEstimatingShopHoursVariancePdf({ company, projectLabel, stationVariances }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  const letterheadY = await drawLetterheadIfActive(doc, 'estimating_shop_hours_variance', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('ESTIMATED VS. ACTUAL HOURS BY SHOP STATION', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`Scope: ${projectLabel || 'All Projects'}`, marginX, y); y += 5;
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  doc.text('Station', marginX, y);
  doc.text('Avg Variance %', marginX + 60, y, { align: 'right' });
  doc.setFont(undefined, 'normal');
  doc.setLineWidth(0.1);
  doc.line(marginX, y + 1.5, marginX + 60, y + 1.5);
  y += 5;

  (stationVariances || []).forEach((row) => {
    doc.text(row.station, marginX, y);
    doc.text(`${row.avgVariance.toFixed(1)}%`, marginX + 60, y, { align: 'right' });
    y += 5;
  });

  if (!stationVariances || stationVariances.length === 0) {
    doc.text('No completed-project variance data yet.', marginX, y);
    y += 6;
  }

  const blob = doc.output('blob');
  const filename = `Estimated-vs-Shop-Hours-${(projectLabel || 'all-projects').replace(/[^a-z0-9_-]+/gi, '_')}-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
