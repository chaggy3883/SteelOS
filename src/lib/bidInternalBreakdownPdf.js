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
  const lines = await db.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 200).catch(() => []);
  const companies = await db.entities.Company.list('-created_date', 1).catch(() => []);
  const logo = await loadImageAsDataUrl(companies[0]?.logo_url);

  const lineMarkupMultiplier = (line) => 1 + ((parseFloat(line?.markup_percentage) || 0) / 100);
  const rows = COST_CATEGORIES
    .map((cat) => ({ cat, line: lines.find((l) => l.cost_category === cat.key) }))
    .filter(({ line }) => line && (line.total_cost || 0) !== 0)
    .map(({ cat, line }) => ({
      label: cat.label,
      qty: line.quantity ? line.quantity.toLocaleString() : '—',
      unitCost: fmt(line.unit_cost),
      lineTotal: fmt(line.total_cost),
      markupPct: fmtPct(line.markup_percentage),
      quotedPrice: fmt((line.total_cost || 0) * lineMarkupMultiplier(line)),
    }));

  const subtotal = lines.reduce((s, l) => s + (l.total_cost || 0), 0);
  const subtotalWithMarkup = lines.reduce((s, l) => s + (l.total_cost || 0) * lineMarkupMultiplier(l), 0);
  const markupAmount = subtotalWithMarkup - subtotal;
  const averageMarkupPct = subtotal > 0 ? (markupAmount / subtotal) * 100 : 0;

  const taxRate = Number(bid?.tax_rate || 0);
  const joistDeckTaxRate = getJoistDeckTaxRate(bid);
  const structuralTaxAmount = bid?.tax_exempt ? 0 : lines.reduce((sum, line) => {
    const cat = COST_CATEGORIES.find((c) => c.key === line.cost_category);
    if (cat?.is_taxable === false) return sum;
    return sum + (line.total_cost || 0) * lineMarkupMultiplier(line) * taxRate;
  }, 0);
  const joistDeckLine = lines.find((l) => l.cost_category === 'joist_deck');
  // Gated purely on tax_exempt, same as structuralTaxAmount above — there is
  // no separate Joist & Deck taxability toggle anymore (removed in favor of
  // a single tax_enabled/tax_exempt source of truth; see TakeoffEngine.jsx).
  const joistDeckTaxAmount = bid?.tax_exempt ? 0 : (joistDeckLine?.total_cost || 0) * lineMarkupMultiplier(joistDeckLine) * joistDeckTaxRate;

  const insuranceAllocation = bid?.insurance_enabled
    ? (parseFloat(bid?.insurance_general_liability) || 0) + (parseFloat(bid?.insurance_umbrella) || 0) + (parseFloat(bid?.insurance_professional_liability) || 0)
    : 0;
  const overrideTotal = parseFloat(bid?.insurance_override) || 0;
  const includedInsuranceAllocation = bid?.insurance_enabled ? insuranceAllocation : 0;
  const leedSurchargeAmount = calculateLeedSurcharge(bid?.leed_level_override);
  // Same ordering as TakeoffEngine.jsx: bond and the Procore/Textura fees are
  // each layered on top of the total that precedes them (see
  // src/lib/bidWorksheetCalc.js), so neither can be part of its own base.
  const preBondTotal = subtotalWithMarkup + overrideTotal + structuralTaxAmount + joistDeckTaxAmount + includedInsuranceAllocation + leedSurchargeAmount + (Number(bid?.delivery_total_cost) || 0);
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
      deliveryTotalCost: bid.delivery_total_cost,
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
