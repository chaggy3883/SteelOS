import { jsPDF } from 'jspdf';
import { PDF_MARGIN_IN } from './pdfLayout.js';

// Pure PDF layout for the customer-facing proposal — takes fully-resolved
// data (no db/network/browser-image calls) and returns a jsPDF document.
// Kept in its own module, with no app-specific ('@/...') imports, so this
// drawing logic can be exercised directly from a plain Node script (see
// verify-pdfs.mjs) without needing the app's data layer or a browser DOM —
// the actual mechanism used to measure this file's margins/pagination
// against real generated PDF bytes rather than eyeballing the code. See
// bidProposalPdf.js for the data-fetching wrapper that calls this.
const MARGIN = PDF_MARGIN_IN;
const PAGE_W = 8.5;
const PAGE_H = 11;
// TEXT_SAFETY absorbs the sub-point font-metric rounding difference between
// jsPDF's own text-width tables (used to place right-aligned text) and how a
// PDF reader/renderer actually measures those same glyphs — confirmed via
// verify-pdfs.mjs, which re-opens the generated PDF with pdfjs-dist and
// found right-aligned dollar amounts landing up to ~1.2pt past the strict
// margin line without this buffer. TOP_SAFETY gives a fresh page's first
// line of text the same headroom drawHeader() already gives page 1's own
// first line, so its ascent doesn't poke back up into the margin band —
// without it, content resuming right at addPage()'s reset position measured
// as a real top-margin violation.
const TEXT_SAFETY = 0.03;
const TOP_SAFETY = 0.18;
const CONTENT_RIGHT = PAGE_W - MARGIN - TEXT_SAFETY;
const CONTENT_BOTTOM = PAGE_H - MARGIN;

const fmt = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Explicit, code-level "does this fit?" check — the page-break decision this
// whole rebuild exists to make reliable, in contrast to the CSS
// break-inside/break-before hints a print engine was previously free to
// ignore (which it did, repeatedly, for the signature block).
function ensureSpace(doc, y, needed) {
  if (y + needed > CONTENT_BOTTOM) {
    doc.addPage();
    return MARGIN + TOP_SAFETY;
  }
  return y;
}

function drawHeader(doc, { logo, companyName }) {
  const y = MARGIN + 0.18;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('Structural Steel Proposal', MARGIN, y);
  doc.setTextColor(0);

  if (logo?.dataUrl && logo.width && logo.height) {
    const h = 0.45;
    const w = h * (logo.width / logo.height);
    doc.addImage(logo.dataUrl, 'PNG', CONTENT_RIGHT - w, MARGIN, w, h);
  } else if (companyName) {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(13);
    doc.text(companyName, CONTENT_RIGHT, y + 0.05, { align: 'right' });
    doc.setFont(undefined, 'normal');
  }

  const ruleY = MARGIN + 0.55;
  doc.setDrawColor(0);
  doc.setLineWidth(0.02);
  doc.line(MARGIN, ruleY, CONTENT_RIGHT, ruleY);
  return ruleY + 0.3;
}

function drawJobInfoBox(doc, startY, bid) {
  const rows = [
    ['Job Name', bid.job_name || '—'],
    ['Bid Number', bid.bid_number || '—'],
    ['Bid Due Date', bid.bid_due_date || '—'],
    ['Customer', bid.customer_name || '—'],
    ['General Contractor', bid.general_contractor_name || '—'],
  ];
  const colW = (CONTENT_RIGHT - MARGIN) / 2;
  const rowH = 0.4;
  const nRows = Math.ceil(rows.length / 2);
  const boxH = nRows * rowH + 0.18;

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

const TAX_DISCLAIMER = 'Unless a sales tax exemption certificate is received, the current sales tax rate on the date of the invoice will be added.';

// Customer-facing proposal shows the bottom-line price only — FOB, one
// combined tax line (structural + joist & deck folded together, since the
// customer never sees the internal category split those two rates are each
// applied to), and the final total. It deliberately does NOT itemize
// fabrication/detailing/engineering/erection/admin-allocation the way the
// internal-only Full Breakdown export does (see bidInternalBreakdownPdf.js,
// which is untouched by this) — matching the company's actual historical
// proposal format.
function drawCostTable(doc, startY, data) {
  const { amounts, taxLabel } = data;
  let y = startY;

  const drawRow = (label, value, opts = {}) => {
    y = ensureSpace(doc, y, 0.32);
    if (opts.topRule) {
      doc.setDrawColor(0);
      doc.setLineWidth(0.02);
      doc.line(MARGIN, y - 0.14, CONTENT_RIGHT, y - 0.14);
    }
    doc.setFont(undefined, opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.big ? 11.5 : 10);
    doc.text(label, MARGIN, y);
    doc.text(fmt(value), CONTENT_RIGHT, y, { align: 'right' });
    if (!opts.topRule) {
      doc.setDrawColor(225);
      doc.setLineWidth(0.008);
      doc.line(MARGIN, y + 0.09, CONTENT_RIGHT, y + 0.09);
    }
    y += 0.28;
  };

  drawRow('FOB Price (Excl. Tax)', amounts.fobPrice, { bold: true });

  if (!amounts.taxExempt) {
    const combinedTax = amounts.structuralTaxAmount + amounts.joistDeckTaxAmount;
    drawRow(taxLabel, combinedTax, {});

    doc.setFont(undefined, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    const disclaimerLines = doc.splitTextToSize(TAX_DISCLAIMER, CONTENT_RIGHT - MARGIN);
    y = ensureSpace(doc, y, disclaimerLines.length * 0.12 + 0.12);
    doc.text(disclaimerLines, MARGIN, y);
    y += disclaimerLines.length * 0.12 + 0.15;
    doc.setTextColor(0);

    drawRow('Total Price (Incl. Tax)', amounts.grandTotal, { bold: true, big: true, topRule: true });
  }

  doc.setFont(undefined, 'normal');
  return y + 0.15;
}

// Company-configurable, short plain-text blurb — distinct from
// CompanyProposalTerms (the large, multi-page uploaded legal document
// appended after the signature block). Omitted entirely, not shown as an
// empty header, when the company hasn't entered any text.
function drawClarifications(doc, startY, company) {
  const text = (company?.clarifications_text || '').trim();
  if (!text) return startY;

  let y = startY;
  doc.setFontSize(8.5);
  const lines = doc.splitTextToSize(text, CONTENT_RIGHT - MARGIN);
  const neededHeight = 0.25 + lines.length * 0.14;
  y = ensureSpace(doc, y, neededHeight);

  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text('Clarifications', MARGIN, y);
  doc.setDrawColor(200);
  doc.setLineWidth(0.008);
  doc.line(MARGIN, y + 0.05, CONTENT_RIGHT, y + 0.05);

  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  let ly = y + 0.22;
  lines.forEach((l) => { doc.text(l, MARGIN, ly); ly += 0.14; });

  return ly + 0.2;
}

function drawInclusionsExclusions(doc, startY, bid) {
  const colGap = 0.25;
  const colW = (CONTENT_RIGHT - MARGIN - colGap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + colGap;

  doc.setFontSize(8.5);
  const leftLines = doc.splitTextToSize(bid.inclusions || 'None specified.', colW);
  const rightLines = doc.splitTextToSize(bid.exclusions || 'None specified.', colW);
  const lineH = 0.14;
  const neededHeight = 0.35 + Math.max(leftLines.length, rightLines.length) * lineH;
  const y = ensureSpace(doc, startY, neededHeight);

  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text('Inclusions', leftX, y);
  doc.text('Exclusions', rightX, y);
  doc.setDrawColor(200);
  doc.setLineWidth(0.008);
  doc.line(leftX, y + 0.05, leftX + colW, y + 0.05);
  doc.line(rightX, y + 0.05, rightX + colW, y + 0.05);

  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  let ly = y + 0.22;
  leftLines.forEach((l) => { doc.text(l, leftX, ly); ly += lineH; });
  let ry = y + 0.22;
  rightLines.forEach((l) => { doc.text(l, rightX, ry); ry += lineH; });

  return Math.max(ly, ry) + 0.2;
}

// The signature block's own height is fixed and known up front, so — per
// this fix's whole premise — the page-break decision is made explicitly in
// code (addPage() before drawing a single element of it) rather than left to
// a print engine's break-inside heuristic. Either the entire block fits
// starting at `startY`, or it starts at the top of a fresh page; it is never
// drawn split across the boundary.
const SIGNATURE_BLOCK_HEIGHT = 2.25;

function drawSignatureBlock(doc, startY, sellerLabel, buyerLabel) {
  const y0 = ensureSpace(doc, startY, SIGNATURE_BLOCK_HEIGHT);
  doc.setDrawColor(180);
  doc.setLineWidth(0.01);
  doc.line(MARGIN, y0, CONTENT_RIGHT, y0);

  const colGap = 0.3;
  const colW = (CONTENT_RIGHT - MARGIN - colGap) / 2;
  const columns = [[MARGIN, sellerLabel], [MARGIN + colW + colGap, buyerLabel]];

  columns.forEach(([x, label]) => {
    let ly = y0 + 0.3;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(label, x, ly);
    ly += 0.35;
    ['Signature', 'Print Name', 'Title', 'Date'].forEach((fieldLabel) => {
      doc.setDrawColor(0);
      doc.setLineWidth(0.01);
      doc.line(x, ly, x + colW, ly);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(130);
      doc.text(fieldLabel, x, ly + 0.15);
      doc.setTextColor(0);
      ly += 0.4;
    });
  });

  return y0 + SIGNATURE_BLOCK_HEIGHT;
}

function drawFullPageImage(doc, image, fallbackNote) {
  doc.addPage();
  if (!image?.dataUrl || !image.width || !image.height) {
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    doc.text(fallbackNote || 'Unable to render this page.', MARGIN, MARGIN + 0.3);
    return;
  }
  const availW = CONTENT_RIGHT - MARGIN;
  const availH = CONTENT_BOTTOM - MARGIN;
  const scale = Math.min(availW / image.width, availH / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const x = MARGIN + (availW - w) / 2;
  doc.addImage(image.dataUrl, 'PNG', x, MARGIN, w, h);
}

function drawAppendedTermsPages(doc, termsPages) {
  (termsPages || []).forEach((entry) => {
    if (entry.kind === 'pdf') {
      (entry.images || []).forEach((img) => drawFullPageImage(doc, img));
    } else if (entry.kind === 'image') {
      drawFullPageImage(doc, entry.image);
    } else {
      // No generic renderer exists for an arbitrary non-PDF, non-image
      // document inside a programmatically-built PDF (the old print view
      // dropped these into an <iframe>, which has no PDF equivalent) — flag
      // it plainly on its own page rather than silently dropping it.
      doc.addPage();
      doc.setFont(undefined, 'bold');
      doc.setFontSize(11);
      doc.text(entry.name || 'Appended Document', MARGIN, MARGIN + 0.3);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(9);
      doc.text('This document type could not be embedded automatically — view it separately in the Document Viewer.', MARGIN, MARGIN + 0.55, { maxWidth: CONTENT_RIGHT - MARGIN });
    }
  });
}

export function drawBidProposalPdf(data) {
  const doc = new jsPDF({ unit: 'in', format: 'letter' });
  let y = drawHeader(doc, { logo: data.logo, companyName: data.companyName });
  y = drawJobInfoBox(doc, y, data.bid);
  y = drawCostTable(doc, y, data);
  y = drawInclusionsExclusions(doc, y, data.bid);
  y = drawClarifications(doc, y, data.company);
  y = drawSignatureBlock(doc, y, `${data.companyName || 'Company'} (Seller)`, `${data.bid.customer_name || 'Customer'} (Buyer)`);
  drawAppendedTermsPages(doc, data.termsPages);
  return doc;
}
