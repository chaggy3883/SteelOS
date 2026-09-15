import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';
import { AGING_BUCKETS, AGING_BUCKET_LABELS } from '@/lib/agingReport';

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
const pct = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `${Math.round(n)}%`);

function drawBucketTable(doc, x0, y, title, totalLine, bucketTotals) {
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text(title, x0, y);
  doc.setFont(undefined, 'normal');
  y += 6;
  doc.setFontSize(9);
  doc.text(totalLine, x0, y);
  y += 6;

  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.text('Aging Bucket', x0, y);
  doc.text('Amount', x0 + 60, y, { align: 'right' });
  doc.setFont(undefined, 'normal');
  doc.setLineWidth(0.1);
  doc.line(x0, y + 1.5, x0 + 60, y + 1.5);
  y += 5;

  AGING_BUCKETS.forEach((b) => {
    doc.text(AGING_BUCKET_LABELS[b], x0, y);
    doc.text(money(bucketTotals[b]), x0 + 60, y, { align: 'right' });
    y += 5;
  });
  return y;
}

// Executive Analytics → AR/AP Aging Summary card — same bucket totals
// (computeArAging/computeApAging, agingReport.js) as the two on-screen aging
// tables, side by side.
export async function generateExecArApAgingPdf({ company, arAgingTotals, apAgingTotals, arTotalOutstanding, apTotalOutstanding, arPastDuePct }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  const letterheadY = await drawLetterheadIfActive(doc, 'exec_ar_ap_aging_summary', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('AR / AP AGING SUMMARY', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  const leftX = marginX;
  const rightX = marginX + 100;
  drawBucketTable(doc, leftX, y, 'AR Outstanding', `${money(arTotalOutstanding)} total (${pct(arPastDuePct)} past due)`, arAgingTotals);
  drawBucketTable(doc, rightX, y, 'AP Outstanding', `${money(apTotalOutstanding)} total`, apAgingTotals);

  const blob = doc.output('blob');
  const filename = `AR-AP-Aging-Summary-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
