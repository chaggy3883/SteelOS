import { db } from '@/api/apiClient';
import { getJoistDeckTaxRate } from '@/lib/taxRate';
import { COST_CATEGORIES } from '@/components/estimating/TakeoffEngine';
import { loadImageAsDataUrl } from '@/lib/pdfImage';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawBidInternalBreakdownPdf } from '@/lib/bidInternalBreakdownPdfLayout';

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
  const joistDeckTaxAmount = bid?.joist_deck_taxable && !bid?.tax_exempt
    ? (joistDeckLine?.total_cost || 0) * lineMarkupMultiplier(joistDeckLine) * joistDeckTaxRate
    : 0;

  const insuranceAllocation = bid?.insurance_enabled
    ? (parseFloat(bid?.insurance_general_liability) || 0) + (parseFloat(bid?.insurance_umbrella) || 0) + (parseFloat(bid?.insurance_professional_liability) || 0)
    : 0;
  const overrideTotal = ['insurance_override', 'bond_override', 'procore_pay_override', 'textura_override']
    .reduce((s, k) => s + (parseFloat(bid?.[k]) || 0), 0);
  const bondAmount = (() => {
    const contractValue = Math.max(0, subtotalWithMarkup + overrideTotal);
    if (contractValue <= 500000) return contractValue * 0.00810;
    if (contractValue <= 2500000) return contractValue * 0.00567;
    if (contractValue <= 5000000) return contractValue * 0.00486;
    return contractValue * 0.00432;
  })();
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
      deliveryTotalCost: bid.delivery_total_cost,
      taxExempt: !!bid.tax_exempt, taxRate, structuralTaxAmount,
      joistDeckTaxable: !!bid.joist_deck_taxable, joistDeckTaxRate, joistDeckTaxAmount,
      grandTotal,
    },
  };

  const doc = drawBidInternalBreakdownPdf(data);
  const blob = doc.output('blob');
  const filename = `Internal-Breakdown-${bid.bid_number || bid.id}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
