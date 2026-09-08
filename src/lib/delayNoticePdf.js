import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

// Generates a formal Delay Impact Notice PDF for an RFI that went unanswered
// past the contractually mandated response window, and triggers a browser
// download (mirrors the Blob-download pattern used by glExport.js).
export async function generateDelayImpactNoticePDF({ rfi, contract, daysDelayed, project }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  // This notice has no company logo/name block of its own to replace — an
  // active letterhead is simply prepended as a full-width banner, and the
  // title/metadata below shift down to start after it. See letterheadPdf.js.
  const letterheadY = await drawLetterheadIfActive(doc, 'delay_impact_notice', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });

  doc.setFontSize(16);
  doc.text('NOTICE OF SCHEDULE IMPACT — ENGINEERING RESPONSE DELAY', marginX, letterheadY != null ? letterheadY + 6 : 20);

  doc.setFontSize(11);
  let y = letterheadY != null ? letterheadY + 16 : 35;
  const line = (label, value) => {
    doc.text(`${label}: ${value ?? '—'}`, marginX, y);
    y += 8;
  };

  line('Date of Notice', today);
  line('Project', project?.name || rfi.project_id);
  line('RFI Number', rfi.rfi_number);
  line('RFI Subject', rfi.subject);
  line('Date Submitted', rfi.date_submitted);
  line('Response Required By', rfi.date_required);
  line('Days Delayed', daysDelayed);
  line('Contractual RFI Response Window (days)', contract?.rfi_response_window_days);
  line('Governing Notice/Cure Clause (days)', contract?.notice_cure_days);

  y += 4;
  doc.setFontSize(10);
  const body = `Per the terms of the executed contract with ${contract?.gc_name || 'the General Contractor'}, a response to the above-referenced RFI was contractually due within ${contract?.rfi_response_window_days || 'the agreed'} day(s) of submission. As of the date of this notice, ${daysDelayed} day(s) have elapsed without a response, constituting an excusable delay under the schedule-extension provisions of the governing contract. This notice is issued to preserve the Contractor's rights to a corresponding time extension and associated impact costs, and is logged as supporting documentation for the related Change Order.`;
  const wrapped = doc.splitTextToSize(body, pageWidth - marginX * 2);
  doc.text(wrapped, marginX, y);

  const blob = doc.output('blob');
  const filename = `Delay-Impact-Notice-${rfi.rfi_number || rfi.id}.pdf`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { blob, filename };
}
