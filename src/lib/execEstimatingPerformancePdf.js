import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;

// Executive Analytics → Estimating Performance card — win rate
// (computeWinLossStats) plus bid volume / average bid size
// (estimatingAnalytics.js's computeBidVolumeStats), same three figures shown
// on screen.
export async function generateExecEstimatingPerformancePdf({ company, winLoss, bidVolumeStats }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  const letterheadY = await drawLetterheadIfActive(doc, 'exec_estimating_performance', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('ESTIMATING PERFORMANCE', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  doc.text(`Win Rate: ${winLoss?.winRatePct === null || winLoss?.winRatePct === undefined ? '—' : `${winLoss.winRatePct}%`}`, marginX, y); y += 6;
  doc.text(`Bid Volume: ${bidVolumeStats?.totalBids ?? 0}`, marginX, y); y += 6;
  doc.text(`Average Bid Size: ${money(bidVolumeStats?.avgBidSize)}`, marginX, y); y += 6;

  const blob = doc.output('blob');
  const filename = `Estimating-Performance-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
