import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

const pct = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `${Math.round(n)}%`);

// Executive Analytics → Shop Production card — current-week capacity
// utilization (buildCapacityMatrix) and dwell-time variance
// (getStationDwellVariance), the same figures the on-screen stat tiles show.
export async function generateExecShopProductionPdf({ company, currentWeekTons, maxShopCapacity, currentWeekUtilizationPct, avgDwellVariancePct }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  const letterheadY = await drawLetterheadIfActive(doc, 'exec_shop_production', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('SHOP PRODUCTION', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  doc.text(`This Week's Capacity Utilization: ${pct(currentWeekUtilizationPct)}`, marginX, y); y += 6;
  doc.text(`  ${Math.round(currentWeekTons || 0).toLocaleString()} of ${Math.round(maxShopCapacity || 0).toLocaleString()} tons`, marginX, y); y += 6;
  doc.text(`Avg Dwell Time Variance: ${pct(avgDwellVariancePct)}`, marginX, y); y += 6;
  doc.text('On-Time Completion Rate: — (not yet tracked)', marginX, y); y += 6;

  const blob = doc.output('blob');
  const filename = `Shop-Production-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
