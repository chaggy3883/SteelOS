import { db } from '@/api/apiClient';
import { getJoistDeckTaxRate } from '@/lib/taxRate';
import { COST_CATEGORIES } from '@/components/estimating/TakeoffEngine';
import { loadImageAsDataUrl } from '@/lib/pdfImage';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawBidInternalBreakdownPdf } from '@/lib/bidInternalBreakdownPdfLayout';
import { calculateBondAmount, calculateLeedSurcharge, calculatePaymentPlatformFee } from '@/lib/bidWorksheetCalc';

export { drawBidInternalBreakdownPdf };

// Internal-only: every line item's Line Total, Markup %, and Quoted Price,
// plus the full financial rollup (bond/insurance/tax/delivery included).
// This must never be wired into the customer-facing proposal export — see
// bidProposalPdf.js, which deliberately shows none of this. Replaces the
// earlier window.print()-of-a-hidden-React-view approach (see git history
// for BidInternalBreakdownPrintView.jsx) for the same reason as
// bidProposalPdf.js — a real PDF file has no browser print-dialog margin
// override to worry about. See bidInternalBreakdownPdfLayout.js for the
// actual page-drawing logic.
const fmt = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n) => `${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export async function generateBidInternalBreakdownPdf(bid) {
  // Filtered to categories COST_CATEGORIES still recognizes — a bid can carry
  // orphaned TakeoffLine rows from a category since removed (e.g. the old
  // "Additional Cost: LEED / Gov't Job" line), and the live worksheet's own
  // subtotal/markup math already ignores those (see loadLines in
  // TakeoffEngine.jsx, which only ever populates recognized categories).
  // Summing the unfiltered fetch here previously let those orphaned rows
  // inflate this export's Profit Markup Avg beyond what the worksheet shows.
  const allLines = await db.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 200).catch(() => []);
  const lines = allLines.filter((l) => COST_CATEGORIES.some((c) => c.key === l.cost_category));
  const companies = await db.entities.Company.list('-created_date', 1).catch(() => []);
  const logo = await loadImageAsDataUrl(companies[0]?.logo_url);

  // A TakeoffLine saved before per-line markup existed has markup_percentage
  // null — the live worksheet falls back to that category's default_markup_pct
  // (or the bid's own markup_percentage) for those, never to 0% (see loadLines
  // in TakeoffEngine.jsx). This export was previously coercing that same null
  // straight to 0 via parseFloat(null) || 0, silently understating both this
  // line's Quoted Price and the overall Profit Markup Avg for any bid with
  // pre-per-line-markup data.
  const bidMarkupPct = parseFloat(bid?.markup_percentage) || 0;
  const resolveMarkupPct = (line, cat) => {
    const pct = line?.markup_percentage;
    return (pct === null || pct === undefined) ? (cat?.default_markup_pct ?? bidMarkupPct) : (parseFloat(pct) || 0);
  };
  const lineMarkupMultiplier = (line, cat) => 1 + (resolveMarkupPct(line, cat) / 100);
  const rows = COST_CATEGORIES
    .map((cat) => ({ cat, line: lines.find((l) => l.cost_category === cat.key) }))
    .filter(({ line }) => line && (line.total_cost || 0) !== 0)
    .map(({ cat, line }) => ({
      label: cat.label,
      qty: line.quantity ? line.quantity.toLocaleString() : '—',
      unitCost: fmt(line.unit_cost),
      lineTotal: fmt(line.total_cost),
      markupPct: fmtPct(resolveMarkupPct(line, cat)),
      quotedPrice: fmt((line.total_cost || 0) * lineMarkupMultiplier(line, cat)),
    }));

  const catForLine = (line) => COST_CATEGORIES.find((c) => c.key === line.cost_category);
  const subtotal = lines.reduce((s, l) => s + (l.total_cost || 0), 0);
  const subtotalWithMarkup = lines.reduce((s, l) => s + (l.total_cost || 0) * lineMarkupMultiplier(l, catForLine(l)), 0);
  const markupAmount = subtotalWithMarkup - subtotal;
  const averageMarkupPct = subtotal > 0 ? (markupAmount / subtotal) * 100 : 0;

  const taxRate = Number(bid?.tax_rate || 0);
  const joistDeckTaxRate = getJoistDeckTaxRate(bid, taxRate);
  const structuralTaxAmount = bid?.tax_exempt ? 0 : lines.reduce((sum, line) => {
    const cat = catForLine(line);
    if (cat?.is_taxable === false) return sum;
    return sum + (line.total_cost || 0) * lineMarkupMultiplier(line, cat) * taxRate;
  }, 0);
  const joistDeckLine = lines.find((l) => l.cost_category === 'joist_deck');
  const joistDeckCat = COST_CATEGORIES.find((c) => c.key === 'joist_deck');
  // Gated purely on tax_exempt, same as structuralTaxAmount above — there is
  // no separate Joist & Deck taxability toggle anymore (removed in favor of
  // a single tax_enabled/tax_exempt source of truth; see TakeoffEngine.jsx).
  const joistDeckTaxAmount = bid?.tax_exempt ? 0 : (joistDeckLine?.total_cost || 0) * lineMarkupMultiplier(joistDeckLine, joistDeckCat) * joistDeckTaxRate;

  const insuranceAllocation = bid?.insurance_enabled
    ? (parseFloat(bid?.insurance_general_liability) || 0) + (parseFloat(bid?.insurance_umbrella) || 0) + (parseFloat(bid?.insurance_professional_liability) || 0)
    : 0;
  const overrideTotal = parseFloat(bid?.insurance_override) || 0;
  const includedInsuranceAllocation = bid?.insurance_enabled ? insuranceAllocation : 0;
  const leedSurchargeAmount = calculateLeedSurcharge(bid?.leed_level_override);
  // Same ordering as TakeoffEngine.jsx: bond and the Procore/Textura fees are
  // each layered on top of the total that precedes them (see
  // src/lib/bidWorksheetCalc.js), so neither can be part of its own base.
  const preBondTotal = subtotalWithMarkup + overrideTotal + structuralTaxAmount + joistDeckTaxAmount + includedInsuranceAllocation + leedSurchargeAmount;
  const computedBondAmount = calculateBondAmount(preBondTotal);
  const bondAmount = bid?.bond_override != null ? Number(bid.bond_override) : computedBondAmount;
  const includedBondAmount = bid?.bond_enabled ? bondAmount : 0;
  const preFeeTotal = preBondTotal + includedBondAmount;
  const procorePlatformFee = bid?.procore_pay_enabled ? calculatePaymentPlatformFee(preFeeTotal, taxRate) : null;
  const texturaPlatformFee = bid?.textura_enabled ? calculatePaymentPlatformFee(preFeeTotal, taxRate) : null;
  const grandTotal = Number(bid?.bid_total_cost || 0);

  const data = {
    bid,
    logo,
    companyName: companies[0]?.name || '',
    rows,
    subtotal,
    averageMarkupPct,
    subtotalWithMarkup,
    summary: {
      subtotal, averageMarkupPct, markupAmount, overrideTotal,
      bondEnabled: !!bid.bond_enabled, bondAmount,
      insuranceEnabled: !!bid.insurance_enabled, insuranceAllocation,
      leedLevel: bid?.leed_level_override || null, leedSurchargeAmount,
      procorePlatformFee, texturaPlatformFee,
      taxExempt: !!bid.tax_exempt, taxRate, structuralTaxAmount,
      joistDeckTaxRate, joistDeckTaxAmount,
      grandTotal,
    },
  };

  const doc = drawBidInternalBreakdownPdf(data);
  const blob = doc.output('blob');
  const filename = `Internal-Breakdown-${bid.bid_number || bid.id}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
