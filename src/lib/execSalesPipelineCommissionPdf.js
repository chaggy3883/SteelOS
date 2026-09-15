import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;

// Executive Analytics → Sales Pipeline & Commission card — open pipeline
// value (bucketPipeline) plus aggregate company-wide commission totals
// (getSalesmanCommissionSummary, summed). Commission figures are omitted
// entirely when canViewCommission is false, matching the same privacy gate
// the on-screen card enforces (no individual salesman detail either way).
export async function generateExecSalesPipelineCommissionPdf({ company, pipelineValue, pipelineCount, commissionTotals, canViewCommission }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  const letterheadY = await drawLetterheadIfActive(doc, 'exec_sales_pipeline_commission', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('SALES PIPELINE & COMMISSION', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  doc.text(`Open Pipeline Value: ${money(pipelineValue)}`, marginX, y); y += 6;
  doc.text(`  ${pipelineCount ?? 0} prospects + quotes`, marginX, y); y += 6;

  if (canViewCommission) {
    doc.text(`Pending Commission: ${money(commissionTotals?.thisMonthPending)}`, marginX, y); y += 6;
    doc.text(`YTD Commission Paid: ${money(commissionTotals?.ytdPaid)}`, marginX, y); y += 6;
  } else {
    doc.text('Commission totals restricted to Admin / Payroll Admin / HR Admin roles.', marginX, y); y += 6;
  }

  const blob = doc.output('blob');
  const filename = `Sales-Pipeline-Commission-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
