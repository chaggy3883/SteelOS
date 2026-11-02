import { db } from '@/api/apiClient';
import { computeEffectiveTaxRate, buildTaxRateInput, getTaxDisplayLabel, getJoistDeckTaxRate } from '@/lib/taxRate';
import { COST_CATEGORIES, RATE_DEFAULT_CATEGORY_KEYS } from '@/components/estimating/TakeoffEngine';
import { loadImageAsDataUrl } from '@/lib/pdfImage';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawBidInternalBreakdownPdf } from '@/lib/bidInternalBreakdownPdfLayout';
import { LEED_RATE_CATEGORY_KEY } from '@/lib/bidWorksheetCalc';
import { buildCostCategoryRateMap, currentCostCategoryRate } from '@/lib/bidWorksheetRateEngine';
import { buildBidInternalBreakdown } from '@/lib/bidInternalBreakdownData';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import { loadLetterheadImage } from '@/lib/letterheadPdf';

export { drawBidInternalBreakdownPdf };

// Same rule as TakeoffEngine.jsx's visibleCategories: a company without the
// Fabrication module doesn't see these lines on its worksheet.
const FABRICATION_ONLY_CATEGORIES = ['structural_material', 'structural_fabrication', 'shop_priming'];

// Fetches exactly what the Bid Worksheet fetches on load (TakeoffLine rows,
// CostCategoryDefaultRate defaults, DeliveryPricingTier rows, the effective
// tax rate + label) and builds the breakdown with the worksheet's own math
// (see bidInternalBreakdownData.js). Shared by the PDF and the Excel export.
//
// Earlier versions of this export summed every fetched TakeoffLine (so a
// duplicate row for one category counted twice), used Bid.tax_rate instead
// of the worksheet's resolved jurisdiction rate, treated a never-set
// bond_enabled as off (the worksheet defaults it on), and printed the saved
// Bid.bid_total_cost as Total Cost. All four now follow the worksheet.
export async function loadBidInternalBreakdownInputs(bid) {
  const [existingLines, categoryRateDefaults, freightTiers, companies, effectiveCompany] = await Promise.all([
    db.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 100).catch(() => []),
    db.entities.CostCategoryDefaultRate.list('-effective_date', 500).catch(() => []),
    db.entities.DeliveryPricingTier.list('min_miles', 200).catch(() => []),
    db.entities.Company.list('-created_date', 1).catch(() => []),
    getEffectiveCompany().catch(() => null),
  ]);
  const taxInfo = await computeEffectiveTaxRate(buildTaxRateInput(bid));
  const taxLabel = await getTaxDisplayLabel({
    tax_exempt: bid?.tax_exempt,
    tax_exempt_reason: bid?.tax_exempt_reason,
    tax_rate_source: taxInfo.source,
    tax_zone_id: taxInfo.tax_zone_id,
    state: bid?.state,
    job_state: bid?.job_state,
    tax_enabled: bid?.tax_enabled,
  }).catch(() => 'Sales Tax');
  const configuredLeedRate = currentCostCategoryRate(categoryRateDefaults, LEED_RATE_CATEGORY_KEY);
  const visibleCategoryKeys = (hasModule(effectiveCompany, '/shop-fabrication')
    ? COST_CATEGORIES
    : COST_CATEGORIES.filter((cat) => !FABRICATION_ONLY_CATEGORIES.includes(cat.key))).map((c) => c.key);

  const breakdown = buildBidInternalBreakdown({
    bid,
    categories: COST_CATEGORIES,
    visibleCategoryKeys,
    existingLines,
    defaultRateByCategory: buildCostCategoryRateMap(categoryRateDefaults, RATE_DEFAULT_CATEGORY_KEYS),
    rateDefaultKeys: RATE_DEFAULT_CATEGORY_KEYS,
    configuredLeedRate: configuredLeedRate ? configuredLeedRate.hourly_rate : null,
    taxRate: taxInfo.rate,
    taxLabel,
    joistDeckTaxRate: getJoistDeckTaxRate(bid, taxInfo.rate),
    freightTiers,
  });
  return { ...breakdown, company: companies[0] || null };
}

// Internal-only: every Bid Worksheet item — each line's quantity, rate,
// Line Total, Markup % and Quoted Price, the freight lookup, every
// administrative override, the full financial rollup and the worksheet's
// text/quantity fields. This must never be wired into the customer-facing
// proposal export — see bidProposalPdf.js, which deliberately shows none of
// this. Replaces the earlier window.print()-of-a-hidden-React-view approach
// (see git history for BidInternalBreakdownPrintView.jsx) for the same
// reason as bidProposalPdf.js — a real PDF file has no browser print-dialog
// margin override to worry about. See bidInternalBreakdownPdfLayout.js for
// the actual page-drawing logic.
export async function generateBidInternalBreakdownPdf(bid) {
  const { sections, company } = await loadBidInternalBreakdownInputs(bid);
  const logo = await loadImageAsDataUrl(company?.logo_url);
  const letterheadImage = await loadLetterheadImage('bid_internal_breakdown');

  const doc = drawBidInternalBreakdownPdf({
    bid,
    logo,
    letterheadImage,
    companyName: company?.name || '',
    sections,
  });
  const blob = doc.output('blob');
  const filename = `Internal-Breakdown-${bid.bid_number || bid.id}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
