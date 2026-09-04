import { jsPDF } from 'jspdf';
import { PDF_MARGIN_IN } from './pdfLayout.js';

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

function drawHeader(doc, logo, companyName) {
  const y = MARGIN + 0.18;
  let titleX = MARGIN;
  // Internal, not customer-facing — but still no SteelOS name/logo here,
  // same as bidProposalPdfLayout.js's drawHeader: the real company's own
  // name (or nothing, if it isn't loaded) stands in for app branding.
  if (companyName) {
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

  if (logo?.dataUrl && logo.width && logo.height) {
    const h = 0.45;
    const w = h * (logo.width / logo.height);
    doc.addImage(logo.dataUrl, 'PNG', CONTENT_RIGHT - w, MARGIN, w, h);
  }

  const ruleY = MARGIN + 0.5;
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

const LINE_ITEM_COLUMNS = [
  { key: 'label', label: 'Cost Category', x: MARGIN, align: 'left' },
  { key: 'qty', label: 'Qty', x: MARGIN + 3.4, align: 'right' },
  { key: 'unitCost', label: 'Unit Cost', x: MARGIN + 4.3, align: 'right' },
  { key: 'lineTotal', label: 'Line Total', x: MARGIN + 5.3, align: 'right' },
  { key: 'markupPct', label: 'Markup %', x: MARGIN + 6.2, align: 'right' },
  { key: 'quotedPrice', label: 'Quoted Price', x: CONTENT_RIGHT, align: 'right' },
];

function drawLineItemsTable(doc, startY, rows, totals) {
  let y = startY;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  LINE_ITEM_COLUMNS.forEach((c) => doc.text(c.label, c.x, y, { align: c.align }));
  doc.setDrawColor(0);
  doc.setLineWidth(0.02);
  doc.line(MARGIN, y + 0.06, CONTENT_RIGHT, y + 0.06);
  y += 0.24;

  const drawDataRow = (row, opts = {}) => {
    doc.setFont(undefined, opts.bold ? 'bold' : 'normal');
    doc.setFontSize(8.5);
    LINE_ITEM_COLUMNS.forEach((c) => doc.text(String(row[c.key] ?? '—'), c.x, y, { align: c.align }));
    doc.setDrawColor(225);
    doc.setLineWidth(0.006);
    if (!opts.noRule) doc.line(MARGIN, y + 0.06, CONTENT_RIGHT, y + 0.06);
    y += 0.2;
  };

  rows.forEach((row) => {
    const preBreakY = y;
    y = ensureSpace(doc, y, 0.24);
    if (y < preBreakY) {
      // Fresh page — repeat the column header before resuming the table.
      doc.setFont(undefined, 'bold');
      doc.setFontSize(8);
      LINE_ITEM_COLUMNS.forEach((c) => doc.text(c.label, c.x, y, { align: c.align }));
      doc.setDrawColor(0);
      doc.setLineWidth(0.02);
      doc.line(MARGIN, y + 0.06, CONTENT_RIGHT, y + 0.06);
      y += 0.24;
    }
    drawDataRow(row);
  });

  y = ensureSpace(doc, y, 0.3);
  doc.setDrawColor(0);
  doc.setLineWidth(0.02);
  doc.line(MARGIN, y - 0.1, CONTENT_RIGHT, y - 0.1);
  drawDataRow({ label: 'Subtotal', qty: '', unitCost: '', lineTotal: fmt(totals.subtotal), markupPct: fmtPct(totals.averageMarkupPct), quotedPrice: fmt(totals.subtotalWithMarkup) }, { bold: true, noRule: true });
  doc.setFont(undefined, 'normal');
  return y + 0.3;
}

function drawSummaryTable(doc, startY, summary) {
  let y = startY;
  const rows = [
    ['Line Item Subtotal', fmt(summary.subtotal)],
    [`Profit Markup (avg ${fmtPct(summary.averageMarkupPct)})`, fmt(summary.markupAmount)],
    ['Administrative Overrides', fmt(summary.overrideTotal)],
    [`Bond Estimate${!summary.bondEnabled ? ' (off)' : ''}`, fmt(summary.bondEnabled ? summary.bondAmount : 0)],
    [`Insurance Allocation${!summary.insuranceEnabled ? ' (off)' : ''}`, fmt(summary.insuranceAllocation)],
    ...(summary.leedSurchargeAmount > 0 ? [[`LEED / Gov't Job Surcharge (${summary.leedLevel})`, fmt(summary.leedSurchargeAmount)]] : []),
    ...(summary.procorePlatformFee ? [[`Procore Pay Fee (fee ${fmt(summary.procorePlatformFee.fee)} + tax ${fmt(summary.procorePlatformFee.tax)})`, fmt(summary.procorePlatformFee.total)]] : []),
    ...(summary.texturaPlatformFee ? [[`Textura Fee (fee ${fmt(summary.texturaPlatformFee.fee)} + tax ${fmt(summary.texturaPlatformFee.tax)})`, fmt(summary.texturaPlatformFee.total)]] : []),
    [`Sales Tax ${summary.taxExempt ? '(exempt)' : `(${(summary.taxRate * 100).toFixed(2)}%)`}`, fmt(summary.structuralTaxAmount)],
    [`Joist & Deck Tax ${summary.taxExempt ? '(exempt)' : `(${(summary.joistDeckTaxRate * 100).toFixed(2)}%)`}`, fmt(summary.joistDeckTaxAmount)],
    ['Total Cost', fmt(summary.grandTotal), { bold: true, big: true, topRule: true }],
  ];

  rows.forEach(([label, value, opts = {}]) => {
    y = ensureSpace(doc, y, 0.32);
    if (opts.topRule) {
      doc.setDrawColor(0);
      doc.setLineWidth(0.02);
      doc.line(MARGIN, y - 0.14, CONTENT_RIGHT, y - 0.14);
    }
    doc.setFont(undefined, opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.big ? 11.5 : 10);
    doc.text(label, MARGIN, y);
    doc.text(value, CONTENT_RIGHT, y, { align: 'right' });
    if (!opts.topRule) {
      doc.setDrawColor(225);
      doc.setLineWidth(0.008);
      doc.line(MARGIN, y + 0.09, CONTENT_RIGHT, y + 0.09);
    }
    y += 0.28;
  });
  doc.setFont(undefined, 'normal');
  return y;
}

export function drawBidInternalBreakdownPdf(data) {
  const doc = new jsPDF({ unit: 'in', format: 'letter' });
  let y = drawHeader(doc, data.logo, data.companyName);
  y = drawJobInfoBox(doc, y, data.bid);
  y = drawLineItemsTable(doc, y, data.rows, { subtotal: data.subtotal, averageMarkupPct: data.averageMarkupPct, subtotalWithMarkup: data.subtotalWithMarkup });
  drawSummaryTable(doc, y, data.summary);
  return doc;
}
