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
//
// Rebuilt to match Hancock's actual real proposal template field-for-field
// (header/address/AISC badge, three-column top info block, includes/
// excludes, Clarifications + Additional Notes as two distinct sections,
// pricing box, Material Quantity Summary, Alternates/Allowances, closing
// lines, a 2-line-per-party signature block, the 12-article Standard Terms
// & Conditions body, and a per-page footer) — see hancockProposalTermsContent.js
// for the seeded terms text this renders.
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
const joinParts = (parts) => parts.filter(Boolean).join(', ');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// M/D/YYYY, no leading zeros — matches the reference template's "9/2/2026".
function formatShortDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

// "March 12, 2025" — matches the reference template's page-footer date.
// Parses the YYYY-MM-DD parts directly rather than `new Date(isoString)` to
// avoid that constructor's UTC-midnight interpretation shifting the date by
// a day in negative-UTC-offset timezones.
function formatLongDate(isoDateStr) {
  if (!isoDateStr) return '';
  const [y, m, d] = String(isoDateStr).split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

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

function drawHeader(doc, { logo, aiscBadge, aiscCertified, company }) {
  const topY = MARGIN;
  let logoRight = MARGIN;

  if (logo?.dataUrl && logo.width && logo.height) {
    const h = 0.55;
    const w = h * (logo.width / logo.height);
    doc.addImage(logo.dataUrl, 'PNG', MARGIN, topY, w, h);
    logoRight = MARGIN + w;
  } else if (company?.name) {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text(company.name, MARGIN, topY + 0.3);
    logoRight = MARGIN + doc.getTextWidth(company.name);
  }

  // AISC Certified Fabricator badge — admin-configurable per company (not
  // every company using this software holds this certification), so it
  // only renders when both the flag and the badge image are set.
  if (aiscCertified && aiscBadge?.dataUrl && aiscBadge.width && aiscBadge.height) {
    const h = 0.55;
    const w = h * (aiscBadge.width / aiscBadge.height);
    doc.addImage(aiscBadge.dataUrl, 'PNG', logoRight + 0.2, topY, w, h);
  }

  // Company address block, top-right.
  const addressLines = [
    company?.address || '',
    joinParts([company?.city, joinParts([company?.state, company?.zip])]),
    company?.phone ? `Phone: ${company.phone}` : '',
  ].filter(Boolean);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0);
  let addrY = topY + 0.14;
  addressLines.forEach((line) => {
    doc.text(line, CONTENT_RIGHT, addrY, { align: 'right' });
    addrY += 0.16;
  });

  const ruleY = topY + 0.72;
  doc.setDrawColor(0);
  doc.setLineWidth(0.02);
  doc.line(MARGIN, ruleY, CONTENT_RIGHT, ruleY);
  return ruleY + 0.24;
}

// Three-column top info block matching the reference template exactly:
// Date / Proposal Expires / Quote # on one line; Project / Customer and
// (City, State) / Attention as a two-column pair beneath it; then
// full-width Specification Sections / Drawings Used / Supplied Cut Sheet
// lines; then Addendums after a gap.
function drawTopInfoBlock(doc, startY, bid, company) {
  let y = startY;
  const rightColX = MARGIN + (CONTENT_RIGHT - MARGIN) * 0.62;
  const midColX = MARGIN + (CONTENT_RIGHT - MARGIN) * 0.32;

  const now = new Date();
  const validityDays = Number(company?.proposal_validity_days) > 0 ? Number(company.proposal_validity_days) : 7;
  const expires = new Date(now.getTime() + validityDays * 86400000);

  const labelValue = (label, value, x, yy) => {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    const labelW = doc.getTextWidth(`${label} `);
    doc.text(label, x, yy);
    doc.setFont(undefined, 'normal');
    doc.text(String(value ?? ''), x + labelW, yy);
  };

  labelValue('Date:', formatShortDate(now), MARGIN, y);
  labelValue('Proposal Expires:', formatShortDate(expires), midColX, y);
  labelValue('Quote #:', bid.bid_number || '—', rightColX, y);
  y += 0.22;

  doc.setFont(undefined, 'bold');
  doc.setFontSize(9);
  let labelW = doc.getTextWidth('Project: ');
  doc.text('Project:', MARGIN, y);
  doc.setFont(undefined, 'normal');
  doc.text(bid.job_name || '—', MARGIN + labelW, y);

  doc.setFont(undefined, 'bold');
  labelW = doc.getTextWidth('Customer: ');
  doc.text('Customer:', rightColX, y);
  doc.setFont(undefined, 'normal');
  doc.text(bid.customer_name || '—', rightColX + labelW, y);
  y += 0.18;

  const cityState = joinParts([bid.job_city || bid.city, bid.job_state || bid.state]);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  doc.text(cityState ? `(${cityState})` : '', MARGIN, y);

  doc.setFont(undefined, 'bold');
  doc.setFontSize(9);
  labelW = doc.getTextWidth('Attention: ');
  doc.text('Attention:', rightColX, y);
  doc.setFont(undefined, 'normal');
  doc.text(bid.attention_name || '', rightColX + labelW, y);
  y += 0.3;

  const fullWidthField = (label, value) => {
    y = ensureSpace(doc, y, 0.2);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    const labelW = doc.getTextWidth(`${label} `);
    doc.text(label, MARGIN, y);
    doc.setFont(undefined, 'normal');
    const lines = doc.splitTextToSize(String(value || ''), CONTENT_RIGHT - MARGIN - labelW);
    doc.text(lines, MARGIN + labelW, y);
    y += Math.max(1, lines.length) * 0.16;
  };

  fullWidthField('Specification Sections:', bid.specification_sections);
  fullWidthField('Drawings Used:', bid.drawings_used);
  fullWidthField('Supplied Cut Sheet:', bid.supplied_cut_sheet);
  y += 0.14;
  fullWidthField('Addendums:', bid.addendums);

  return y + 0.2;
}

// Splits free text into dash-bulleted lines matching the reference
// template's list style. A line already starting with '-' keeps its own
// dash; a line starting with '+' renders as an indented sub-bullet (the
// template's own convention for nested items, e.g. under Additional
// Notes); everything else gets a '- ' prefix.
function bulletLines(doc, text, maxWidth) {
  const raw = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  raw.forEach((line) => {
    if (line.startsWith('+')) {
      const content = line.replace(/^\+\s*/, '');
      doc.splitTextToSize(`+ ${content}`, maxWidth - 0.15).forEach((w) => out.push({ text: w, indent: 0.15 }));
    } else {
      const content = line.replace(/^-\s*/, '');
      doc.splitTextToSize(`- ${content}`, maxWidth).forEach((w) => out.push({ text: w, indent: 0 }));
    }
  });
  return out;
}

function drawInclusionsExclusions(doc, startY, bid) {
  const colGap = 0.25;
  const colW = (CONTENT_RIGHT - MARGIN - colGap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + colGap;
  const lineH = 0.14;

  doc.setFontSize(8.5);
  const leftLines = bid.inclusions?.trim() ? bulletLines(doc, bid.inclusions, colW) : [{ text: 'None specified.', indent: 0 }];
  const rightLines = bid.exclusions?.trim() ? bulletLines(doc, bid.exclusions, colW) : [{ text: 'None specified.', indent: 0 }];
  const neededHeight = 0.35 + Math.max(leftLines.length, rightLines.length) * lineH;
  const y = ensureSpace(doc, startY, neededHeight);

  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text('Includes:', leftX, y);
  doc.text('Excludes:', rightX, y);
  doc.setDrawColor(200);
  doc.setLineWidth(0.008);
  doc.line(leftX, y + 0.05, leftX + colW, y + 0.05);
  doc.line(rightX, y + 0.05, rightX + colW, y + 0.05);

  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  let ly = y + 0.22;
  leftLines.forEach((l) => { doc.text(l.text, leftX + l.indent, ly); ly += lineH; });
  let ry = y + 0.22;
  rightLines.forEach((l) => { doc.text(l.text, rightX + l.indent, ry); ry += lineH; });

  return Math.max(ly, ry) + 0.2;
}

// Company-configurable, short plain-text blurb — distinct from
// CompanyProposalTerms (the large, multi-page legal document rendered after
// the signature block). Omitted entirely, not shown as an empty header,
// when the company hasn't entered any text.
function drawBulletSection(doc, startY, heading, text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return startY;

  const maxWidth = CONTENT_RIGHT - MARGIN;
  doc.setFontSize(8.5);
  const lines = bulletLines(doc, trimmed, maxWidth);
  const neededHeight = 0.25 + lines.length * 0.14;
  let y = ensureSpace(doc, startY, neededHeight);

  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text(heading, MARGIN, y);
  doc.setDrawColor(200);
  doc.setLineWidth(0.008);
  doc.line(MARGIN, y + 0.05, CONTENT_RIGHT, y + 0.05);

  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  let ly = y + 0.22;
  lines.forEach((l) => { doc.text(l.text, MARGIN + l.indent, ly); ly += 0.14; });

  return ly + 0.2;
}

// Alternates / Allowances — genuinely new section, two-column layout like
// Includes/Excludes, but the whole section is omitted (not shown with empty
// headers) when the bid has neither.
function drawAlternatesAllowances(doc, startY, bid) {
  const hasAlternates = (bid.alternates_text || '').trim();
  const hasAllowances = (bid.allowances_text || '').trim();
  if (!hasAlternates && !hasAllowances) return startY;

  const colGap = 0.25;
  const colW = (CONTENT_RIGHT - MARGIN - colGap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + colGap;
  const lineH = 0.14;

  doc.setFontSize(8.5);
  const leftLines = hasAlternates ? bulletLines(doc, bid.alternates_text, colW) : [{ text: 'None specified.', indent: 0 }];
  const rightLines = hasAllowances ? bulletLines(doc, bid.allowances_text, colW) : [{ text: 'None specified.', indent: 0 }];
  const neededHeight = 0.35 + Math.max(leftLines.length, rightLines.length) * lineH;
  const y = ensureSpace(doc, startY, neededHeight);

  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text('Alternates:', leftX, y);
  doc.text('Allowances:', rightX, y);
  doc.setDrawColor(200);
  doc.setLineWidth(0.008);
  doc.line(leftX, y + 0.05, leftX + colW, y + 0.05);
  doc.line(rightX, y + 0.05, rightX + colW, y + 0.05);

  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  let ly = y + 0.22;
  leftLines.forEach((l) => { doc.text(l.text, leftX + l.indent, ly); ly += lineH; });
  let ry = y + 0.22;
  rightLines.forEach((l) => { doc.text(l.text, rightX + l.indent, ry); ry += lineH; });

  return Math.max(ly, ry) + 0.2;
}

const TAX_DISCLAIMER = 'Unless a sales tax exemption certificate is received, the current sales tax rate on the date of the invoice will be added.';
const PRICING_BASIS_LABELS = {
  fob: 'F.O.B. Jobsite (Supply Only - Not Erected)',
  erected: 'Fabricated, Delivered, and Installed',
};

// Customer-facing proposal shows the bottom-line price only — one combined
// tax line (structural + joist & deck folded together, since the customer
// never sees the internal category split those two rates are each applied
// to) — and the final total, inside a bordered pricing box matching the
// reference template. It deliberately does NOT itemize fabrication/
// detailing/engineering/erection/admin-allocation the way the internal-only
// Full Breakdown export does (see bidInternalBreakdownPdf.js, which is
// untouched by this).
function drawPricingBlock(doc, startY, data) {
  const { amounts, taxLabel, bid } = data;
  const pricingBasisLabel = PRICING_BASIS_LABELS[bid.pricing_basis] || PRICING_BASIS_LABELS.fob;
  const innerW = CONTENT_RIGHT - MARGIN - 0.24;

  const rows = [{ type: 'header', text: pricingBasisLabel }];
  rows.push({ type: 'row', label: 'Total Price (Excluding Sales Tax):', value: amounts.fobPrice, bold: true });

  let disclaimerLines = [];
  if (!amounts.taxExempt) {
    const combinedTax = amounts.structuralTaxAmount + amounts.joistDeckTaxAmount;
    rows.push({ type: 'row', label: taxLabel, value: combinedTax });
    disclaimerLines = doc.splitTextToSize(TAX_DISCLAIMER, innerW);
    rows.push({ type: 'disclaimer', lines: disclaimerLines });
    rows.push({ type: 'row', label: 'Total Price (Including Sales Tax):', value: amounts.grandTotal, bold: true, big: true, topRule: true });
  }

  const PAD = 0.16;
  let boxH = PAD;
  rows.forEach((r) => {
    if (r.type === 'header') boxH += 0.26;
    else if (r.type === 'row') boxH += r.big ? 0.32 : 0.26;
    else if (r.type === 'disclaimer') boxH += r.lines.length * 0.13 + 0.1;
  });
  boxH += PAD;

  const y0 = ensureSpace(doc, startY, boxH);
  doc.setDrawColor(0);
  doc.setLineWidth(0.015);
  doc.rect(MARGIN, y0, CONTENT_RIGHT - MARGIN, boxH);

  let y = y0 + PAD + 0.1;
  rows.forEach((r) => {
    if (r.type === 'header') {
      doc.setFont(undefined, 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(0);
      doc.text(r.text, MARGIN + 0.12, y);
      y += 0.26;
    } else if (r.type === 'row') {
      if (r.topRule) {
        doc.setDrawColor(0);
        doc.setLineWidth(0.012);
        doc.line(MARGIN + 0.12, y - 0.15, CONTENT_RIGHT - 0.12, y - 0.15);
      }
      doc.setFont(undefined, r.bold ? 'bold' : 'normal');
      doc.setFontSize(r.big ? 11.5 : 10);
      doc.setTextColor(0);
      doc.text(r.label, MARGIN + 0.12, y);
      doc.text(fmt(r.value), CONTENT_RIGHT - 0.12, y, { align: 'right' });
      y += r.big ? 0.32 : 0.26;
    } else if (r.type === 'disclaimer') {
      doc.setFont(undefined, 'bold');
      doc.setFontSize(8);
      doc.setTextColor(180, 0, 0);
      r.lines.forEach((l) => { doc.text(l, MARGIN + 0.12, y); y += 0.13; });
      doc.setTextColor(0);
      doc.setFont(undefined, 'normal');
      y += 0.1;
    }
  });

  return y0 + boxH + 0.22;
}

// Genuinely new section — pulled from whatever takeoff/material data
// already exists on the bid. Structural Steel tons map cleanly onto the
// bid's own takeoff rollup (total_weight_tons, falling back to
// estimated_tons). Metal Deck squares and Steel Joist pieces/tons have no
// clean automatic source — Joist & Deck is priced as a single flat-quote
// cost category with no quantity breakdown in TakeoffEngine.jsx — so those
// two are manually entered per bid (see the Material Quantity Summary
// fields on the BID Worksheet) rather than computed.
function drawMaterialQuantitySummary(doc, startY, bid) {
  const structuralTons = bid.total_weight_tons ?? bid.estimated_tons ?? 0;
  const deckSquares = bid.metal_deck_squares != null ? Number(bid.metal_deck_squares).toLocaleString() : '—';
  const joistPieces = bid.steel_joist_pieces != null ? Number(bid.steel_joist_pieces).toLocaleString() : '—';
  const joistTons = bid.steel_joist_tons != null ? Number(bid.steel_joist_tons).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';

  const items = [
    ['Structural Steel:', `${Number(structuralTons).toLocaleString(undefined, { maximumFractionDigits: 1 })} Tons`],
    ['Metal Deck:', `${deckSquares} Squares`],
    ['Steel Joist:', `${joistPieces} Pc's / ${joistTons} Tons`],
  ];

  const rowH = 0.2;
  const h = 0.16 + items.length * rowH;
  let y = ensureSpace(doc, startY, h);
  y += 0.16;
  items.forEach(([label, val]) => {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(0);
    doc.text(label, MARGIN, y);
    doc.setFont(undefined, 'normal');
    doc.text(val, MARGIN + 1.5, y);
    y += rowH;
  });

  return y + 0.15;
}

function drawClosingLines(doc, startY, company) {
  let y = ensureSpace(doc, startY, 0.55);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text("Escalation is Based on Today's Prices.", PAGE_W / 2, y, { align: 'center' });
  y += 0.2;

  const validityDays = Number(company?.proposal_validity_days) > 0 ? Number(company.proposal_validity_days) : 7;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  doc.text(`This Proposal is valid for ${validityDays} day${validityDays === 1 ? '' : 's'} from the date shown above.`, PAGE_W / 2, y, { align: 'center' });

  return y + 0.28;
}

// Only drawn when at least one terms document/body exists — the transition
// sentence only makes sense if terms actually follow.
function drawTermsIntro(doc, startY) {
  let y = ensureSpace(doc, startY, 0.6);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(0);
  const intro = doc.splitTextToSize(
    'SEE BELOW TERMS AND CONDITIONS WHICH ARE INCORPORATED INTO THIS PROPOSAL AND CONTRACT WITH CUSTOMER (BUYER).',
    CONTENT_RIGHT - MARGIN
  );
  intro.forEach((l) => { doc.text(l, PAGE_W / 2, y, { align: 'center' }); y += 0.14; });
  y += 0.16;

  y = ensureSpace(doc, y, 0.3);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text('STANDARD TERMS & CONDITIONS OF SALE', PAGE_W / 2, y, { align: 'center' });
  return y + 0.3;
}

// Renders a company's native structured terms text (see
// hancockProposalTermsContent.js for the exact format this reads):
//   - "ARTICLE ..." lines are top-level headings.
//   - "N.N " / "N.N.N " lines are numbered clauses — the number renders
//     bold, the rest of the paragraph normal weight; a three-part number
//     gets an extra indent (sub-clause).
//   - any other paragraph (only the closing confidentiality paragraph, in
//     practice) renders as plain wrapped text.
function drawProposalTermsBody(doc, startY, bodyText) {
  let y = startY;
  const paragraphs = String(bodyText || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  paragraphs.forEach((p) => {
    if (p.startsWith('ARTICLE ')) {
      y = ensureSpace(doc, y, 0.5);
      y += 0.08;
      doc.setFont(undefined, 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(0);
      const lines = doc.splitTextToSize(p, CONTENT_RIGHT - MARGIN);
      lines.forEach((l) => { y = ensureSpace(doc, y, 0.16); doc.text(l, MARGIN, y); y += 0.16; });
      y += 0.14;
      return;
    }

    const m = p.match(/^(\d+\.\d+(?:\.\d+)?)\s+([\s\S]*)$/);
    if (m) {
      const num = m[1];
      const rest = m[2].replace(/\s+/g, ' ').trim();
      const level = num.split('.').length === 3 ? 1 : 0;
      const x = MARGIN + (level === 1 ? 0.25 : 0);
      const maxWidth = CONTENT_RIGHT - x;

      doc.setFontSize(8.5);
      const numText = `${num} `;
      doc.setFont(undefined, 'bold');
      const numWidth = doc.getTextWidth(numText);
      doc.setFont(undefined, 'normal');

      // Custom word-wrap: the first line shares its width with the bold
      // clause number that precedes it on the same line; every later line
      // wraps to the full available width, flush with the number (no
      // hanging indent under the heading text — matches the reference
      // template's plain paragraph wrap).
      const words = rest.split(' ');
      const lines = [];
      let line = '';
      words.forEach((w) => {
        const test = line ? `${line} ${w}` : w;
        const avail = lines.length === 0 ? maxWidth - numWidth : maxWidth;
        if (line && doc.getTextWidth(test) > avail) {
          lines.push(line);
          line = w;
        } else {
          line = test;
        }
      });
      if (line) lines.push(line);

      y = ensureSpace(doc, y, 0.14);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(0);
      doc.text(numText, x, y);
      doc.setFont(undefined, 'normal');
      doc.text(lines[0] || '', x + numWidth, y);
      y += 0.14;
      for (let i = 1; i < lines.length; i += 1) {
        y = ensureSpace(doc, y, 0.14);
        doc.text(lines[i], x, y);
        y += 0.14;
      }
      y += 0.09;
      return;
    }

    doc.setFont(undefined, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(0);
    const lines = doc.splitTextToSize(p, CONTENT_RIGHT - MARGIN);
    lines.forEach((l) => { y = ensureSpace(doc, y, 0.14); doc.text(l, MARGIN, y); y += 0.14; });
    y += 0.1;
  });

  return y;
}

// The signature block's own height is fixed and known up front, so — per
// this fix's whole premise — the page-break decision is made explicitly in
// code (addPage() before drawing a single element of it) rather than left to
// a print engine's break-inside heuristic. Either the entire block fits
// starting at `startY`, or it starts at the top of a fresh page; it is never
// drawn split across the boundary.
//
// Reformatted to the reference template's actual 2-line-per-party layout:
// "Agree To:" / "By: {seller}" beside "{buyer}" / one Signature line /  one
// combined Name & Title + Date line (side by side, not stacked) — replacing
// the earlier 4-separate-field-per-party format.
const SIGNATURE_BLOCK_HEIGHT = 1.55;

function drawSignatureBlock(doc, startY, sellerName, buyerName) {
  const y0 = ensureSpace(doc, startY, SIGNATURE_BLOCK_HEIGHT);
  let y = y0;

  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text('Agree To:', MARGIN, y);
  y += 0.26;

  const colGap = 0.3;
  const colW = (CONTENT_RIGHT - MARGIN - colGap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + colGap;

  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(`By: ${sellerName || 'Company'}`, leftX, y);
  doc.text(buyerName || '', rightX, y);
  y += 0.42;

  // Signature line
  doc.setDrawColor(0);
  doc.setLineWidth(0.01);
  [leftX, rightX].forEach((x) => doc.line(x, y, x + colW, y));
  doc.setFont(undefined, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(130);
  doc.text('(Signature)', leftX, y + 0.15);
  doc.text('(Signature)', rightX, y + 0.15);
  doc.setTextColor(0);
  y += 0.45;

  // Name & Title + Date — one combined row, side by side within each party
  // column (not two stacked lines).
  const subGap = 0.15;
  const nameW = colW * 0.62 - subGap / 2;
  const dateW = colW * 0.38 - subGap / 2;
  doc.setDrawColor(0);
  doc.setLineWidth(0.01);
  [leftX, rightX].forEach((x) => {
    doc.line(x, y, x + nameW, y);
    doc.line(x + nameW + subGap, y, x + nameW + subGap + dateW, y);
  });
  doc.setFont(undefined, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(130);
  [leftX, rightX].forEach((x) => {
    doc.text('(Name & Title)', x, y + 0.15);
    doc.text('(Date)', x + nameW + subGap, y + 0.15);
  });
  doc.setTextColor(0);
  y += 0.3;

  return y;
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

// Per-page footer: a blank buyer-initials line and a "Last Updated [date]"
// label, bottom-right of every page — lives inside the page's own bottom
// margin band (below CONTENT_BOTTOM), matching the reference template,
// which repeats this on every page including the pricing page.
function drawPageFooter(doc, lastUpdatedLabel) {
  const lineW = 1.05;
  const xRight = CONTENT_RIGHT;
  const xLeft = xRight - lineW;
  const y1 = PAGE_H - 0.28;

  doc.setDrawColor(0);
  doc.setLineWidth(0.008);
  doc.line(xLeft, y1, xRight, y1);

  doc.setFont(undefined, 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(80);
  doc.text('(Buyer Initials)', xRight, y1 + 0.1, { align: 'right' });
  if (lastUpdatedLabel) doc.text(lastUpdatedLabel, xRight, y1 + 0.21, { align: 'right' });
  doc.setTextColor(0);
}

export function drawBidProposalPdf(data) {
  const doc = new jsPDF({ unit: 'in', format: 'letter' });
  const { bid, company } = data;

  let y = drawHeader(doc, { logo: data.logo, aiscBadge: data.aiscBadge, aiscCertified: !!company?.aisc_certified, company: { ...company, name: company?.name || data.companyName } });
  y = drawTopInfoBlock(doc, y, bid, company);
  y = drawInclusionsExclusions(doc, y, bid);
  y = drawBulletSection(doc, y, 'Clarifications', company?.clarifications_text);
  y = drawBulletSection(doc, y, 'Additional Notes', company?.additional_notes_text);
  y = drawAlternatesAllowances(doc, y, bid);
  y = drawPricingBlock(doc, y, data);
  y = drawMaterialQuantitySummary(doc, y, bid);
  y = drawClosingLines(doc, y, company);

  const termsEntries = data.termsPages || [];
  let endedOnFullBleedPage = false;
  if (termsEntries.length) {
    y = drawTermsIntro(doc, y);
    termsEntries.forEach((entry) => {
      if (entry.kind === 'text') {
        y = drawProposalTermsBody(doc, y, entry.bodyText);
        endedOnFullBleedPage = false;
      } else if (entry.kind === 'pdf') {
        (entry.images || []).forEach((img) => drawFullPageImage(doc, img));
        endedOnFullBleedPage = true;
      } else if (entry.kind === 'image') {
        drawFullPageImage(doc, entry.image);
        endedOnFullBleedPage = true;
      } else {
        // No generic renderer exists for an arbitrary non-PDF, non-image
        // document inside a programmatically-built PDF (the old print view
        // dropped these into an <iframe>, which has no PDF equivalent) —
        // flag it plainly on its own page rather than silently dropping it.
        doc.addPage();
        doc.setFont(undefined, 'bold');
        doc.setFontSize(11);
        doc.text(entry.name || 'Appended Document', MARGIN, MARGIN + 0.3);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(9);
        doc.text('This document type could not be embedded automatically — view it separately in the Document Viewer.', MARGIN, MARGIN + 0.55, { maxWidth: CONTENT_RIGHT - MARGIN });
        endedOnFullBleedPage = true;
      }
    });
  }

  // Matches the reference template's real page ordering: the terms content
  // comes FIRST, with the signature block as the true final page(s) of the
  // proposal — not the other way around. A full-bleed appended page (a
  // rasterized upload) leaves no meaningful trailing y-cursor to continue
  // on, so the signature starts fresh; native terms text just continues
  // in-flow, exactly like the reference template crams the signature onto
  // the tail of its last terms page.
  if (endedOnFullBleedPage) {
    doc.addPage();
    y = MARGIN + TOP_SAFETY;
  }
  drawSignatureBlock(doc, y, data.companyName, bid.customer_name);

  const lastUpdatedLabel = company?.terms_last_updated_date ? `Last Updated ${formatLongDate(company.terms_last_updated_date)}` : '';
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i += 1) {
    doc.setPage(i);
    drawPageFooter(doc, lastUpdatedLabel);
  }

  return doc;
}
