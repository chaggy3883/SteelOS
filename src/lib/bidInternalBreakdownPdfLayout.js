import { jsPDF } from 'jspdf';
import { PDF_MARGIN_IN } from './pdfLayout.js';
import { drawLetterheadImage } from '@/lib/letterheadDraw';
import { formatBreakdownValue } from './bidInternalBreakdownData.js';

// Pure PDF layout for the internal financial breakdown — see
// bidProposalPdfLayout.js for why this is a separate, app-import-free module
// (Node-testable from verify-pdfs.mjs) from bidInternalBreakdownPdf.js's
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

const fmt = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n) => `${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

function ensureSpace(doc, y, needed) {
  if (y + needed > CONTENT_BOTTOM) {
    doc.addPage();
    return MARGIN + TOP_SAFETY;
  }
  return y;
}

function drawHeader(doc, logo, companyName, letterheadImage) {
  // An active letterhead replaces the company name/"|" separator + logo
  // portion of this header (that image already carries the company's own
  // branding) — see letterheadPdf.js. The "Internal Financial Breakdown"
  // document subtitle is not branding and always renders either way.
  const letterheadY = drawLetterheadImage(doc, letterheadImage, {
    x: MARGIN, y: MARGIN, maxWidth: CONTENT_RIGHT - MARGIN, maxHeight: 0.75,
  });

  const y = letterheadY != null ? letterheadY + 0.05 : MARGIN + 0.18;
  let titleX = MARGIN;
  if (letterheadY == null && companyName) {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(15);
    doc.setTextColor(0);
    doc.text(companyName, MARGIN, y);
    const nameWidth = doc.getTextWidth(companyName);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(150);
    doc.text('|', MARGIN + nameWidth + 0.1, y);
    titleX = MARGIN + nameWidth + 0.25;
  }
  doc.setFont(undefined, 'normal');
  doc.setTextColor(100);
  doc.setFontSize(9);
  doc.text('Internal Financial Breakdown', titleX, y);
  doc.setTextColor(0);

  if (letterheadY == null && logo?.dataUrl && logo.width && logo.height) {
    const h = 0.45;
    const w = h * (logo.width / logo.height);
    doc.addImage(logo.dataUrl, 'PNG', CONTENT_RIGHT - w, MARGIN, w, h);
  }

  const ruleY = letterheadY != null ? y + 0.14 : MARGIN + 0.5;
  doc.setDrawColor(220, 38, 38);
  doc.setLineWidth(0.025);
  doc.line(MARGIN, ruleY, CONTENT_RIGHT, ruleY);
  return ruleY + 0.3;
}

function drawJobInfoBox(doc, startY, bid) {
  const rows = [
    ['Job Name', bid.job_name || '—'],
    ['Bid Number', bid.bid_number || '—'],
    ['Bid Due Date', bid.bid_due_date || '—'],
    ['Customer', bid.customer_name || '—'],
  ];
  const colW = (CONTENT_RIGHT - MARGIN) / 2;
  const rowH = 0.4;
  const boxH = Math.ceil(rows.length / 2) * rowH + 0.18;

  doc.setDrawColor(180);
  doc.setLineWidth(0.01);
  doc.rect(MARGIN, startY, CONTENT_RIGHT - MARGIN, boxH);

  rows.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = MARGIN + 0.15 + col * colW;
    const cy = startY + 0.24 + row * rowH;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(label, cx, cy);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(String(value), cx, cy + 0.19);
  });
  doc.setFont(undefined, 'normal');
  return startY + boxH + 0.3;
}

// Line-items table: Category (with how the line is entered, its source
// flag and any note on a small second line), Qty, Unit Cost / Price, Line
// Total, Markup %, Quoted Price — the worksheet's own columns.
const LINE_ITEM_COLUMNS = [
  { key: 'label', label: 'Category (Quantity / Rate entered as)', x: MARGIN, align: 'left' },
  { key: 'qty', label: 'Qty', x: MARGIN + 3.4, align: 'right' },
  { key: 'unitCost', label: 'Unit Cost / Price', x: MARGIN + 4.35, align: 'right' },
  { key: 'lineTotal', label: 'Line Total', x: MARGIN + 5.3, align: 'right' },
  { key: 'markupPct', label: 'Markup %', x: MARGIN + 6.1, align: 'right' },
  { key: 'quotedPrice', label: 'Quoted Price', x: CONTENT_RIGHT, align: 'right' },
];

function drawSectionTitle(doc, y, title) {
  y = ensureSpace(doc, y, 0.6);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(0);
  doc.text(title, MARGIN, y);
  doc.setDrawColor(150);
  doc.setLineWidth(0.012);
  doc.line(MARGIN, y + 0.07, CONTENT_RIGHT, y + 0.07);
  doc.setFont(undefined, 'normal');
  return y + 0.3;
}

function drawLineHeader(doc, y) {
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  LINE_ITEM_COLUMNS.forEach((c) => doc.text(c.label, c.x, y, { align: c.align }));
  doc.setDrawColor(0);
  doc.setLineWidth(0.02);
  doc.line(MARGIN, y + 0.06, CONTENT_RIGHT, y + 0.06);
  return y + 0.24;
}

function drawLineItemsSection(doc, startY, section) {
  let y = startY;
  (section.preRows || []).forEach((row) => { y = drawValueRow(doc, y, row); });
  y = drawLineHeader(doc, y + 0.05);

  section.rows.forEach((row) => {
    const sub = [row.basis, row.coverageRate != null ? `${row.coverageRate} sqft/gal` : '', row.source, row.note].filter(Boolean).join(' · ');
    const subLines = sub ? doc.splitTextToSize(sub, 3.0) : [];
    const rowH = 0.2 + subLines.length * 0.13;
    const preBreakY = y;
    y = ensureSpace(doc, y, rowH + 0.04);
    if (y < preBreakY) y = drawLineHeader(doc, y);
    const cells = {
      label: row.label,
      qty: row.quantityUnit ? `${row.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${row.quantityUnit}` : row.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      unitCost: fmt(row.unitCost),
      lineTotal: fmt(row.lineTotal),
      markupPct: fmtPct(row.markupPct),
      quotedPrice: fmt(row.quotedPrice),
    };
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8.5);
    LINE_ITEM_COLUMNS.forEach((c) => doc.text(String(cells[c.key]), c.x, y, { align: c.align }));
    if (subLines.length) {
      doc.setFontSize(7);
      doc.setTextColor(110);
      doc.text(subLines, MARGIN + 0.1, y + 0.13);
      doc.setTextColor(0);
    }
    doc.setDrawColor(225);
    doc.setLineWidth(0.006);
    doc.line(MARGIN, y + rowH - 0.14, CONTENT_RIGHT, y + rowH - 0.14);
    y += rowH;
  });

  y = ensureSpace(doc, y, 0.3);
  doc.setDrawColor(0);
  doc.setLineWidth(0.02);
  doc.line(MARGIN, y - 0.1, CONTENT_RIGHT, y - 0.1);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8.5);
  const s = section.subtotal;
  doc.text(s.label, MARGIN, y);
  doc.text(fmt(s.lineTotal), LINE_ITEM_COLUMNS[3].x, y, { align: 'right' });
  doc.text(`avg ${fmtPct(s.markupPct)}`, LINE_ITEM_COLUMNS[4].x, y, { align: 'right' });
  doc.text(fmt(s.quotedPrice), CONTENT_RIGHT, y, { align: 'right' });
  doc.setFont(undefined, 'normal');
  return y + 0.35;
}

// One label/value row; `block` rows (Inclusions, Exclusions, …) print the
// label then the full wrapped text underneath instead of a right-aligned value.
function drawValueRow(doc, startY, row) {
  let y = startY;
  if (row.block) {
    const body = row.value ? doc.splitTextToSize(String(row.value), CONTENT_RIGHT - MARGIN - 0.1) : ['—'];
    y = ensureSpace(doc, y, 0.42);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    doc.text(row.label, MARGIN, y);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8.5);
    y += 0.17;
    body.forEach((line) => {
      y = ensureSpace(doc, y, 0.16);
      doc.text(line, MARGIN + 0.1, y);
      y += 0.15;
    });
    return y + 0.1;
  }
  y = ensureSpace(doc, y, 0.3);
  if (row.topRule) {
    doc.setDrawColor(0);
    doc.setLineWidth(0.02);
    doc.line(MARGIN, y - 0.14, CONTENT_RIGHT, y - 0.14);
  }
  doc.setFont(undefined, row.bold ? 'bold' : 'normal');
  doc.setFontSize(row.big ? 11.5 : 9);
  const value = formatBreakdownValue(row);
  const valueWidth = doc.getTextWidth(value);
  const labelLines = doc.splitTextToSize(row.label, Math.max(2, CONTENT_RIGHT - MARGIN - valueWidth - 0.3));
  doc.text(labelLines, MARGIN, y);
  doc.text(value, CONTENT_RIGHT, y, { align: 'right' });
  const rowH = 0.24 + (labelLines.length - 1) * 0.15;
  if (!row.topRule) {
    doc.setDrawColor(225);
    doc.setLineWidth(0.008);
    doc.line(MARGIN, y + rowH - 0.17, CONTENT_RIGHT, y + rowH - 0.17);
  }
  doc.setFont(undefined, 'normal');
  return y + rowH;
}

function drawValuesSection(doc, startY, section) {
  let y = startY;
  section.rows.forEach((row) => { y = drawValueRow(doc, y, row); });
  return y + 0.15;
}

// data.sections comes from bidInternalBreakdownData.js — the Bid Worksheet's
// sections in the worksheet's order; every section is drawn.
export function drawBidInternalBreakdownPdf(data) {
  const doc = new jsPDF({ unit: 'in', format: 'letter' });
  let y = drawHeader(doc, data.logo, data.companyName, data.letterheadImage);
  y = drawJobInfoBox(doc, y, data.bid);
  (data.sections || []).forEach((section) => {
    y = drawSectionTitle(doc, y, section.title);
    y = section.type === 'lines' ? drawLineItemsSection(doc, y, section) : drawValuesSection(doc, y, section);
  });
  return doc;
}
