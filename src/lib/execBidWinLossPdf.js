import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

function drawReasonTable(doc, x0, y, title, rows) {
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text(title, x0, y);
  doc.setFont(undefined, 'normal');
  y += 5;
  if (!rows || rows.length === 0) {
    doc.setFontSize(8);
    doc.text('None logged.', x0, y);
    return y + 5;
  }
  doc.setFontSize(8);
  rows.forEach((r) => {
    doc.text(r.label, x0, y);
    doc.text(String(r.count), x0 + 90, y, { align: 'right' });
    y += 5;
  });
  return y;
}

// Executive Analytics → Commercial Bid Win/Loss card — won/lost/did-not-bid/
// active pipeline counts (computeWinLossStats), win rate, and the top loss /
// did-not-bid reason breakdowns shown on screen. Reason rows are passed in
// already label-mapped ({ label, count }) — REASON_LABELS lives with the
// page's own display logic, not duplicated here.
export async function generateExecBidWinLossPdf({ company, winLoss, topLossReasons, topDnbReasons }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  const letterheadY = await drawLetterheadIfActive(doc, 'exec_bid_win_loss', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('COMMERCIAL BID WIN/LOSS', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  doc.setFont(undefined, 'bold');
  doc.text('Category', marginX, y);
  doc.text('Count', marginX + 90, y, { align: 'right' });
  doc.setFont(undefined, 'normal');
  doc.setLineWidth(0.1);
  doc.line(marginX, y + 1.5, marginX + 90, y + 1.5);
  y += 5;
  [
    ['Won', winLoss?.won], ['Lost', winLoss?.lost], ['Did Not Bid', winLoss?.dnb], ['Active Pipeline', winLoss?.active],
  ].forEach(([label, count]) => {
    doc.text(label, marginX, y);
    doc.text(String(count ?? 0), marginX + 90, y, { align: 'right' });
    y += 5;
  });
  doc.text(`Win Rate: ${winLoss?.winRatePct === null || winLoss?.winRatePct === undefined ? '—' : `${winLoss.winRatePct}%`}`, marginX, y);
  y += 9;

  y = drawReasonTable(doc, marginX, y, 'Top Loss Reasons', topLossReasons);
  y += 4;
  drawReasonTable(doc, marginX, y, 'Top Did-Not-Bid Reasons', topDnbReasons);

  const blob = doc.output('blob');
  const filename = `Bid-Win-Loss-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
