import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

const centsToDollars = (cents) => (
  cents != null ? `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
);

// Front-End Spec Review's Exception Matrix — one stacked block per exception
// line (same card layout as aiFinancialFlagsPdf.js, since every line carries
// several variable-length free-text fields a cramped table row can't hold),
// including the source document + page number a reviewer can use to jump
// straight back to it instead of re-searching the whole spec.
export async function generateFrontEndReviewPdf({ company, bid, lines }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = PDF_MARGIN_MM;
  const maxWidth = pageWidth - marginX * 2;
  const today = new Date().toISOString().slice(0, 10);

  const ensureRoom = (y, needed = 8) => (y + needed > pageHeight - marginX ? (doc.addPage(), 20) : y);

  const writeWrapped = (y, label, value) => {
    if (value == null || value === '') return y;
    y = ensureRoom(y);
    doc.setFont(undefined, 'bold');
    doc.text(label, marginX, y);
    y += 4.5;
    doc.setFont(undefined, 'normal');
    doc.splitTextToSize(String(value), maxWidth).forEach((line) => {
      y = ensureRoom(y);
      doc.text(line, marginX, y);
      y += 4.5;
    });
    return y + 1.5;
  };

  const letterheadY = await drawLetterheadIfActive(doc, 'front_end_review', { x: marginX, y: 10, maxWidth, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('FRONT-END SPEC REVIEW — EXCEPTION MATRIX', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  if (bid) { doc.text(`Bid: ${bid.bid_number ? `${bid.bid_number} — ` : ''}${bid.job_name || 'Untitled Bid'}`, marginX, y); y += 5; }
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  if (!lines || lines.length === 0) {
    doc.text('No exception lines yet — upload a spec document to seed the matrix.', marginX, y);
    y += 6;
  } else {
    lines.forEach((line, idx) => {
      y = ensureRoom(y, 20);
      doc.setFont(undefined, 'bold');
      doc.setFontSize(10);
      doc.text(`${idx + 1}. ${line.provision_number_tag || 'Untitled Provision'}`, marginX, y);
      y += 5;
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
      const sourceBits = [line.document_source_key, line.page_number ? `Page ${line.page_number}` : null].filter(Boolean).join('  —  ');
      if (sourceBits) { y = ensureRoom(y); doc.text(sourceBits, marginX, y); y += 5; }
      y = ensureRoom(y);
      doc.text(
        `Prior Bid Ask: ${line.prior_bid_ask ? 'Yes' : 'No'}    Post Bid Ask: ${line.post_bid_ask ? 'Yes' : 'No'}    Est. Additional Cost: ${centsToDollars(line.estimated_additional_cost_cents)}`,
        marginX,
        y,
      );
      y += 6;
      y = writeWrapped(y, 'Location / Page Ref', line.location_page_reference);
      y = writeWrapped(y, 'Owner/GC/CM Comment', line.owner_gc_cm_comment);
      y = writeWrapped(y, 'Owner/GC/CM Question', line.owner_gc_cm_question);
      y = writeWrapped(y, 'Comment to Estimator', line.comment_to_estimator);
      y = writeWrapped(y, 'Sub/Supplier/Detailer Comment', line.sub_supplier_detailer_comment);
      y = writeWrapped(y, 'Answer', line.answer_text);
      y = writeWrapped(y, 'If Awarded — Project Team Review', line.if_awarded_project_team_review);
      y = ensureRoom(y);
      doc.setLineWidth(0.1);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 5;
    });
  }

  const blob = doc.output('blob');
  const filename = `Front-End-Review-${bid?.bid_number || 'bid'}-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
