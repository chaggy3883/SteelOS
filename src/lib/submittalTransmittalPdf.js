import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

const REVIEW_STAMPS = [
  { outcome: 'reviewed', label: 'REVIEWED' },
  { outcome: 'reviewed_as_noted', label: 'REVIEWED AS NOTED' },
  { outcome: 'revise_and_resubmit', label: 'REVISE & RESUBMIT' },
];

const DISCLAIMER = 'This review is only for general conformance with the design concept of the project and general compliance with the information given in the Contract Documents. The Contractor remains responsible for confirming and correlating all quantities and dimensions, selecting fabrication processes and techniques of construction, coordinating this work with that of all other trades, and performing all work in a safe and satisfactory manner. This review does not relieve the Contractor of responsibility for deviations from the Contract Documents or for errors and omissions in this submittal.';

// Generates the submittal transmittal cover sheet, matching a real GC/CM
// transmittal's layout: Job/Project info, Submittal #/Revision #/Spec
// Section, submitter/reviewer contact blocks, a Reviewed/Reviewed as
// Noted/Revise & Resubmit stamp block (with the actual outcome marked when
// one has been recorded), the standard review-disclaimer paragraph, and
// signature lines. Mirrors delayNoticePdf.js/bolPdf.js's plain jsPDF
// drawing pattern (no autotable dependency) and triggers a browser download,
// returning { blob, filename } so the caller can also attach it as a
// Document (see RFIs.jsx's handleGenerateDelayNotice for the same pattern).
export async function generateSubmittalTransmittalPdf({ company, project, submittal, shopDrawings = [], documents = [] }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = PDF_MARGIN_MM;
  const contentRight = pageWidth - marginX;
  const today = new Date().toISOString().slice(0, 10);

  const letterheadY = await drawLetterheadIfActive(doc, 'submittal_transmittal', { x: marginX, y: 10, maxWidth: contentRight - marginX, maxHeight: 22 });

  if (letterheadY == null) {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(13);
    doc.text(company?.name || 'Company', marginX, 15);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8.5);
    const addrLines = [company?.address, [company?.city, company?.state, company?.zip].filter(Boolean).join(', ')].filter(Boolean);
    addrLines.forEach((l, i) => doc.text(l, marginX, 20 + i * 4.5));
    if (company?.phone) doc.text(`Phone: ${company.phone}`, marginX, 20 + addrLines.length * 4.5);
  }

  const titleY = letterheadY != null ? letterheadY + 6 : 15;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(16);
  doc.text('SUBMITTAL TRANSMITTAL', contentRight, titleY, { align: 'right' });
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.text(`Date: ${today}`, contentRight, titleY + 6, { align: 'right' });

  let y = (letterheadY != null ? titleY + 14 : 29);
  doc.setDrawColor(40);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, contentRight, y);
  y += 7;

  // Job/Project info
  doc.setFontSize(7.5);
  doc.setTextColor(110);
  doc.text('PROJECT', marginX, y);
  doc.setTextColor(20);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(10.5);
  doc.text(`${project?.project_number ? project.project_number + ' — ' : ''}${project?.name || '—'}`, marginX, y + 5);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  const projAddrLines = [project?.address, [project?.city, project?.state].filter(Boolean).join(', ')].filter(Boolean);
  projAddrLines.forEach((l, i) => doc.text(l, marginX, y + 9.5 + i * 4));

  y += 9.5 + Math.max(projAddrLines.length, 1) * 4 + 4;
  doc.setDrawColor(190);
  doc.setLineWidth(0.2);
  doc.line(marginX, y, contentRight, y);
  y += 7;

  // Submittal #/Revision #/Spec Section metadata row
  const metaColWidth = (contentRight - marginX) / 3;
  const metaX = [marginX, marginX + metaColWidth, marginX + metaColWidth * 2];
  const metaLabels = ['SUBMITTAL #', 'REVISION #', 'SPEC SECTION'];
  const metaValues = [submittal?.submittal_number || '—', submittal?.revision_number != null ? String(submittal.revision_number) : '0 (Original)', submittal?.spec_section || '—'];
  doc.setFontSize(7.5);
  doc.setTextColor(110);
  metaLabels.forEach((l, i) => doc.text(l, metaX[i], y));
  doc.setTextColor(20);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  metaValues.forEach((v, i) => doc.text(v, metaX[i], y + 5));
  doc.setFont(undefined, 'normal');

  y += 11;
  doc.setFontSize(7.5);
  doc.setTextColor(110);
  doc.text('DESCRIPTION', marginX, y);
  doc.setTextColor(20);
  doc.setFontSize(9);
  const descLines = doc.splitTextToSize(submittal?.submittal_description || '—', contentRight - marginX);
  doc.text(descLines, marginX, y + 4.5);
  y += 4.5 + descLines.length * 4.2 + 4;

  doc.setDrawColor(190);
  doc.setLineWidth(0.2);
  doc.line(marginX, y, contentRight, y);
  y += 7;

  // Submitted By / Reviewer contact blocks
  const colGap = 10;
  const colWidth = (contentRight - marginX - colGap) / 2;
  const submitterX = marginX;
  const reviewerX = marginX + colWidth + colGap;
  doc.setFontSize(7.5);
  doc.setTextColor(110);
  doc.text('SUBMITTED BY', submitterX, y);
  doc.text('SENT TO / REVIEWER', reviewerX, y);
  doc.setTextColor(20);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(9.5);
  doc.text(submittal?.submitted_by_company || company?.name || '—', submitterX, y + 5);
  doc.text(submittal?.reviewer_company || '—', reviewerX, y + 5);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  const submitterLines = [submittal?.submitted_by_contact_name, submittal?.submitted_by_contact_title].filter(Boolean);
  const reviewerLines = [submittal?.reviewer_contact_name].filter(Boolean);
  submitterLines.forEach((l, i) => doc.text(l, submitterX, y + 9.5 + i * 4));
  reviewerLines.forEach((l, i) => doc.text(l, reviewerX, y + 9.5 + i * 4));
  doc.text(`Date Submitted: ${submittal?.date_submitted || '—'}`, submitterX, y + 9.5 + Math.max(submitterLines.length, 1) * 4);
  if (submittal?.date_reviewed) doc.text(`Date Reviewed: ${submittal.date_reviewed}`, reviewerX, y + 9.5 + Math.max(reviewerLines.length, 1) * 4);

  y += 9.5 + Math.max(submitterLines.length, reviewerLines.length, 1) * 4 + 6;
  doc.setDrawColor(40);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, contentRight, y);
  y += 7;

  // Attachments list
  const attachmentLines = [
    ...shopDrawings.map((d) => `Shop Drawing: ${d.drawing_number || ''}${d.description ? ` — ${d.description}` : ''}`),
    ...documents.map((d) => `Attachment: ${d.name || d.file_name || 'Untitled'}`),
  ];
  if (attachmentLines.length > 0) {
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.text('ATTACHMENTS', marginX, y);
    doc.setTextColor(20);
    doc.setFontSize(8.5);
    y += 4.5;
    attachmentLines.forEach((line) => {
      doc.text(`• ${line}`, marginX, y);
      y += 4.2;
    });
    y += 3;
  }

  // Review stamp block
  doc.setDrawColor(40);
  doc.setLineWidth(0.4);
  const stampBoxHeight = 22;
  doc.rect(marginX, y, contentRight - marginX, stampBoxHeight);
  const stampColWidth = (contentRight - marginX) / 3;
  doc.setFontSize(9);
  REVIEW_STAMPS.forEach((stamp, i) => {
    const boxX = marginX + stampColWidth * i;
    const isActive = submittal?.review_outcome === stamp.outcome;
    const checkX = boxX + 5;
    const checkY = y + 8;
    doc.setDrawColor(20);
    doc.rect(checkX, checkY - 3.5, 4, 4);
    if (isActive) {
      doc.setFont(undefined, 'bold');
      doc.text('X', checkX + 0.6, checkY - 0.4);
      doc.setFont(undefined, 'normal');
    }
    doc.setFont(isActive ? undefined : undefined, isActive ? 'bold' : 'normal');
    doc.text(stamp.label, checkX + 6, checkY, { maxWidth: stampColWidth - 12 });
    doc.setFont(undefined, 'normal');
  });
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(`Reviewer Initials: ${submittal?.reviewer_initials || '_______'}`, marginX + 4, y + stampBoxHeight - 4);
  doc.text(`Date: ${submittal?.date_reviewed || '_______'}`, marginX + stampColWidth * 2 + 4, y + stampBoxHeight - 4);
  doc.setTextColor(20);
  y += stampBoxHeight + 8;

  // Standard disclaimer
  doc.setFontSize(7.5);
  doc.setTextColor(90);
  const disclaimerLines = doc.splitTextToSize(DISCLAIMER, contentRight - marginX);
  doc.text(disclaimerLines, marginX, y);
  doc.setTextColor(20);
  y += disclaimerLines.length * 3.6 + 10;

  // Signature lines
  doc.setFontSize(9);
  doc.setDrawColor(20);
  doc.setLineWidth(0.3);
  doc.line(submitterX, y, submitterX + colWidth, y);
  doc.line(reviewerX, y, reviewerX + colWidth, y);
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text('Submitted By / Date', submitterX, y + 4.5);
  doc.text('Reviewed By / Date', reviewerX, y + 4.5);

  const blob = doc.output('blob');
  const filename = `Submittal-Transmittal-${submittal?.submittal_number || submittal?.id || 'submittal'}${submittal?.revision_number ? `-R${submittal.revision_number}` : ''}.pdf`;

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
