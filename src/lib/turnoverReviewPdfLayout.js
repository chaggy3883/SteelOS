import { jsPDF } from 'jspdf';
import { PDF_MARGIN_IN } from './pdfLayout.js';

// Pure PDF layout for the Turnover / Contract Review handoff document — see
// bidProposalPdfLayout.js for why this is a separate, app-import-free module
// (Node-testable from verify-pdfs.mjs) from turnoverReviewPdf.js's
// data-fetching wrapper.
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

function drawHeader(doc, logo) {
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
  doc.text('Turnover / Contract Review', MARGIN + steelOsWidth + 0.25, y);
  doc.setTextColor(0);

  if (logo?.dataUrl && logo.width && logo.height) {
    const h = 0.45;
    const w = h * (logo.width / logo.height);
    doc.addImage(logo.dataUrl, 'PNG', CONTENT_RIGHT - w, MARGIN, w, h);
  }

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
  return y + 0.22;
}

function drawChecklist(doc, startY, checklistRows) {
  let y = startY;
  checklistRows.forEach(({ label, value }) => {
    y = ensureSpace(doc, y, 0.22);
    doc.setFontSize(8.5);
    const wrapped = doc.splitTextToSize(label, CONTENT_RIGHT - MARGIN - 0.6);
    doc.text(wrapped, MARGIN, y);
    doc.setFont(undefined, 'normal');
    doc.text(value ? 'Yes' : 'No', CONTENT_RIGHT, y, { align: 'right' });
    doc.setDrawColor(225);
    doc.setLineWidth(0.006);
    const rowH = wrapped.length * 0.13 + 0.05;
    doc.line(MARGIN, y + rowH - 0.02, CONTENT_RIGHT, y + rowH - 0.02);
    y += rowH + 0.04;
  });
  return y + 0.15;
}

function drawSubQuotes(doc, startY, subQuotes) {
  let y = startY;
  if (!subQuotes.length) {
    doc.setFontSize(9);
    doc.setTextColor(130);
    doc.text('None listed.', MARGIN, y);
    doc.setTextColor(0);
    return y + 0.3;
  }
  doc.setFont(undefined, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(130);
  doc.text('COMPANY', MARGIN, y);
  doc.text('TYPE', MARGIN + 3.5, y);
  doc.setDrawColor(200);
  doc.line(MARGIN, y + 0.04, CONTENT_RIGHT, y + 0.04);
  doc.setTextColor(0);
  y += 0.2;
  subQuotes.forEach((row) => {
    y = ensureSpace(doc, y, 0.2);
    doc.setFontSize(8.5);
    doc.text(row.company || '—', MARGIN, y);
    doc.text(row.type || '—', MARGIN + 3.5, y);
    doc.setDrawColor(225);
    doc.line(MARGIN, y + 0.05, CONTENT_RIGHT, y + 0.05);
    y += 0.2;
  });
  return y + 0.15;
}

function drawTwoColumnList(doc, startY, columns) {
  const colGap = 0.25;
  const colW = (CONTENT_RIGHT - MARGIN - colGap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + colGap;

  const renderColumn = (x, title, lines) => {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    doc.text(title, x, startY);
    doc.setDrawColor(200);
    doc.line(x, startY + 0.04, x + colW, startY + 0.04);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8);
    let ly = startY + 0.18;
    if (!lines.length) {
      doc.setTextColor(130);
      doc.text('None listed.', x, ly);
      doc.setTextColor(0);
      ly += 0.14;
    } else {
      lines.forEach((l) => {
        const wrapped = doc.splitTextToSize(`• ${l}`, colW);
        doc.text(wrapped, x, ly);
        ly += wrapped.length * 0.13;
      });
    }
    return ly;
  };

  const leftBottom = renderColumn(leftX, columns[0].title, columns[0].lines);
  const rightBottom = renderColumn(rightX, columns[1].title, columns[1].lines);
  return Math.max(leftBottom, rightBottom) + 0.2;
}

// Same explicit "reserve the whole block or push it to a fresh page" rule as
// bidProposalPdfLayout.js's signature block, applied to this document's own
// completion block (Completed By + Date).
const COMPLETION_BLOCK_HEIGHT = 1.15;

function drawCompletionBlock(doc, startY, completedBy, completedDate) {
  const y0 = ensureSpace(doc, startY, COMPLETION_BLOCK_HEIGHT);
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
  doc.text('Completed By', leftX, y);
  doc.text('Date', rightX, y);
  y += 0.35;
  doc.setDrawColor(0);
  doc.line(leftX, y, leftX + colW, y);
  doc.line(rightX, y, rightX + colW, y);
  y += 0.15;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8);
  doc.text(completedBy || 'Not yet marked completed', leftX, y);
  doc.text(completedDate || '—', rightX, y);
  return y0 + COMPLETION_BLOCK_HEIGHT;
}

function drawTwoColumnFreeText(doc, startY, fields) {
  const colGap = 0.25;
  const colW = (CONTENT_RIGHT - MARGIN - colGap) / 2;
  let leftBottom = startY;
  let rightBottom = startY;
  fields.forEach((field, i) => {
    const x = i % 2 === 0 ? MARGIN : MARGIN + colW + colGap;
    const y = i % 2 === 0 ? leftBottom : rightBottom;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    doc.text(field.label, x, y);
    doc.setDrawColor(200);
    doc.line(x, y + 0.04, x + colW, y + 0.04);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8);
    const wrapped = doc.splitTextToSize(field.value || 'None specified.', colW);
    doc.text(wrapped, x, y + 0.18);
    const bottom = y + 0.18 + wrapped.length * 0.13 + 0.15;
    if (i % 2 === 0) leftBottom = bottom; else rightBottom = bottom;
  });
  return Math.max(leftBottom, rightBottom, startY);
}

export function drawTurnoverReviewPdf(data) {
  const doc = new jsPDF({ unit: 'in', format: 'letter' });
  let y = drawHeader(doc, data.logo);
  y = drawProjectLine(doc, y, data.project);

  y = drawSectionTitle(doc, y, 'Checklist');
  y = drawChecklist(doc, y, data.checklistRows);

  y = ensureSpace(doc, y, 0.6);
  y = drawSectionTitle(doc, y, 'Pricing');
  doc.setFontSize(9);
  doc.text(`Pricing Basis: ${data.pricingBasisLabel}`, MARGIN, y);
  y += 0.18;
  if (data.pricingBasis === 'erected') {
    doc.text(`Erector: ${data.erectorName || '—'}`, MARGIN, y);
    y += 0.18;
  }
  y += 0.15;

  y = ensureSpace(doc, y, 0.6);
  y = drawSectionTitle(doc, y, 'Sub Quotes');
  y = drawSubQuotes(doc, y, data.subQuotes);

  const freeTextNeeded = data.freeTextFields.reduce((max, f) => Math.max(max, doc.splitTextToSize(f.value, (CONTENT_RIGHT - MARGIN - 0.25) / 2).length), 0) * 0.14 + 0.4;
  y = ensureSpace(doc, y, freeTextNeeded);
  y = drawTwoColumnFreeText(doc, y, data.freeTextFields);

  y = ensureSpace(doc, y, 0.8);
  y = drawTwoColumnList(doc, y, [
    { title: 'Required Attendees', lines: data.requiredAttendees },
    { title: 'Actual Attendees', lines: data.actualAttendees },
  ]);

  drawCompletionBlock(doc, y, data.completedBy, data.completedDate);
  return doc;
}
