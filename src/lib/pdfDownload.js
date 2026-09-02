// Same Blob-anchor download idiom as certifiedPayrollReportPdf.js/delayNoticePdf.js
// — shared here since bidProposalPdf.js, bidInternalBreakdownPdf.js,
// turnoverReviewPdf.js, and scopeReviewPdf.js all trigger an immediate
// download rather than returning a data URI for later use (contrast
// bolPdf.js, which returns a data URI to store on the load record).
export function downloadPdfBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
