import { jsPDF } from 'jspdf';
import { PDF_MARGIN_IN } from './pdfLayout.js';

// Pure PDF layout for the Scope Review document — see bidProposalPdfLayout.js
// for why this is a separate, app-import-free module (Node-testable from
// verify-pdfs.mjs) from scopeReviewPdf.js's data-fetching wrapper.
const MARGIN = PDF_MARGIN_IN;
const PAGE_W = 8.5;
const PAGE_H = 11;
// See bidProposalPdfLayout.js for why these two exist — both were found by
// actually re-measuring a generated PDF with pdfjs-dist in verify-pdfs.mjs,
// not by inspection.
const TEXT_SAFETY = 0.03;
const TOP_SAFETY = 0.18;
const CONTENT_RIGHT = PAGE_W - MARGIN - TEXT_SAFETY;
const CONTENT_BOTTOM = PAGE_H - MARGIN;

function ensureSpace(doc, y, needed) {
  if (y + needed > CONTENT_BOTTOM) {
    doc.addPage();
    return MARGIN + TOP_SAFETY;
  }
  return y;
}

function drawHeader(doc) {
  const y = MARGIN + 0.18;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(15);
  doc.text('SteelOS', MARGIN, y);
  const steelOsWidth = doc.getTextWidth('SteelOS');
  doc.setFont(undefined, 'normal');
  doc.setTextColor(150);
  doc.text('|', MARGIN + steelOsWidth + 0.1, y);
  doc.setTextColor(100);
  doc.setFontSize(9);
  doc.text('Scope Review', MARGIN + steelOsWidth + 0.25, y);
  doc.setTextColor(0);

  const ruleY = MARGIN + 0.5;
  doc.setDrawColor(220, 38, 38);
  doc.setLineWidth(0.025);
  doc.line(MARGIN, ruleY, CONTENT_RIGHT, ruleY);
  return ruleY + 0.25;
}

function drawProjectLine(doc, startY, project) {
  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text(project.name || '—', MARGIN, startY);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(project.project_number || '', MARGIN, startY + 0.18);
  doc.text(`Printed ${new Date().toLocaleDateString()}`, CONTENT_RIGHT, startY, { align: 'right' });
  doc.setTextColor(0);
  return startY + 0.4;
}

function drawSectionTitle(doc, y, title) {
  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.text(title, MARGIN, y);
  doc.setDrawColor(200);
  doc.setLineWidth(0.008);
  doc.line(MARGIN, y + 0.05, CONTENT_RIGHT, y + 0.05);
  doc.setFont(undefined, 'normal');
  return y + 0.25;
}

function drawQuestions(doc, startY, questions) {
  let y = startY;
  if (!questions.length) {
    doc.setFontSize(9);
    doc.setTextColor(130);
    doc.text('No questions recorded.', MARGIN, y);
    doc.setTextColor(0);
    return y + 0.3;
  }

  const contentW = CONTENT_RIGHT - MARGIN;
  questions.forEach((q, i) => {
    // Measure qLines in the SAME font/weight it's actually drawn in (bold) —
    // splitTextToSize's wrap width is only valid for the font active when it
    // runs. Measuring in the (narrower) normal weight then drawing bold, as
    // this used to do, let wrapped lines render wider than the column and
    // spill past the right margin — caught by verify-pdfs.mjs re-measuring
    // the actual generated PDF, not visible from the code alone.
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    const qLines = doc.splitTextToSize(`${i + 1}. ${q.question_text || '(no question text)'}`, contentW);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8);
    const metaLine = `Raised by ${q.raised_by || 'Unknown'} on ${q.raised_date || '—'}`;
    const answerLines = doc.splitTextToSize(`Answer: ${q.answer_text || 'Pending customer response.'}`, contentW);
    const answeredLine = q.answered_date ? `Answered ${q.answered_date}` : null;

    const blockHeight = qLines.length * 0.16 + 0.16 + answerLines.length * 0.14 + (answeredLine ? 0.14 : 0) + 0.18;
    y = ensureSpace(doc, y, blockHeight);

    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    doc.text(qLines, MARGIN, y);
    y += qLines.length * 0.16;

    doc.setFont(undefined, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(130);
    doc.text(metaLine, MARGIN, y);
    y += 0.14;

    doc.setFontSize(8);
    doc.setTextColor(0);
    doc.text(answerLines, MARGIN, y);
    y += answerLines.length * 0.14;

    if (answeredLine) {
      doc.setFontSize(7.5);
      doc.setTextColor(130);
      doc.text(answeredLine, MARGIN, y);
      doc.setTextColor(0);
      y += 0.14;
    }

    doc.setDrawColor(225);
    doc.setLineWidth(0.006);
    doc.line(MARGIN, y + 0.04, CONTENT_RIGHT, y + 0.04);
    y += 0.2;
  });
  return y + 0.1;
}

// Same explicit "reserve the whole block or push it to a fresh page" rule as
// bidProposalPdfLayout.js's signature block, applied to this document's own
// Prepared By / Date block.
const PREPARED_BY_BLOCK_HEIGHT = 1.15;

function drawPreparedByBlock(doc, startY, preparedBy, printedDate) {
  const y0 = ensureSpace(doc, startY, PREPARED_BY_BLOCK_HEIGHT);
  doc.setDrawColor(180);
  doc.setLineWidth(0.01);
  doc.line(MARGIN, y0, CONTENT_RIGHT, y0);

  const colGap = 0.3;
  const colW = (CONTENT_RIGHT - MARGIN - colGap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + colGap;
  let y = y0 + 0.3;

  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.text('Prepared By', leftX, y);
  doc.text('Date', rightX, y);
  y += 0.35;
  doc.setDrawColor(0);
  doc.line(leftX, y, leftX + colW, y);
  doc.line(rightX, y, rightX + colW, y);
  y += 0.15;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8);
  doc.text(preparedBy || '—', leftX, y);
  doc.text(printedDate, rightX, y);
  return y0 + PREPARED_BY_BLOCK_HEIGHT;
}

export function drawScopeReviewPdf(data) {
  const doc = new jsPDF({ unit: 'in', format: 'letter' });
  let y = drawHeader(doc);
  y = drawProjectLine(doc, y, data.project);

  y = drawSectionTitle(doc, y, 'Questions');
  y = drawQuestions(doc, y, data.questions);

  y = ensureSpace(doc, y, 0.6);
  y = drawSectionTitle(doc, y, 'General Notes');
  doc.setFontSize(8);
  const notesLines = doc.splitTextToSize(data.generalNotes || 'None.', CONTENT_RIGHT - MARGIN);
  y = ensureSpace(doc, y, notesLines.length * 0.14 + 0.2);
  doc.text(notesLines, MARGIN, y);
  y += notesLines.length * 0.14 + 0.25;

  drawPreparedByBlock(doc, y, data.preparedBy, data.printedDate);
  return doc;
}
