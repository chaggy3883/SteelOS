// Builds the Full Breakdown (Internal) export's content — every item the
// Bid Worksheet (TakeoffEngine.jsx) shows, grouped by the worksheet's own
// sections in the worksheet's order and with its labels, zero-value items
// included. bidInternalBreakdownPdfLayout.js draws these sections and
// buildBidInternalBreakdownAoa below turns the same sections into the Excel
// sheet, so the PDF and the Excel can't disagree with each other.
//
// Pure: no db/api/React imports (relative imports only), so it's
// Node-checkable. The data fetch lives in bidInternalBreakdownPdf.js's
// loadBidInternalBreakdownInputs. Every number comes from the same helpers
// the worksheet itself uses (bidWorksheetCalc.js's buildWorksheetLineMap /
// computeWorksheetTotals / matchDeliveryTier) — nothing is re-derived here.
import {
  FAB_HOURS_CATEGORY_KEY,
  roundTakeoffHours,
  lineMarkupMultiplier,
  buildWorksheetLineMap,
  computeWorksheetTotals,
  matchDeliveryTier,
  resolveLeedHourlyRate,
  LEED_SURCHARGE_LEVELS,
  PAYMENT_PLATFORM_FEE_RATE,
} from './bidWorksheetCalc.js';

// Same option text as the worksheet's Pricing Basis dropdown.
export const PRICING_BASIS_LABELS = {
  fob: 'F.O.B. Jobsite (Supply Only - Not Erected)',
  erected: 'Fabricated, Delivered, and Installed',
};

const yesNo = (v) => (v ? 'Yes' : 'No');
const OFF_SUFFIX = ' (off — not included)';

// Row kinds: money / pct / number / text / yesno. `field` names the Bid
// field (or computed value) a row comes from — scripts/parity checks read it.
const money = (label, value, field, extra = {}) => ({ label, kind: 'money', value: Number(value) || 0, field, ...extra });
const pct = (label, value, field, extra = {}) => ({ label, kind: 'pct', value: Number(value) || 0, field, ...extra });
const num = (label, value, field, extra = {}) => ({ label, kind: 'number', value: value == null || value === '' ? null : Number(value), field, ...extra });
const text = (label, value, field, extra = {}) => ({ label, kind: 'text', value: value == null ? '' : String(value), field, ...extra });

// Describes how a line's quantity/rate is entered on the worksheet (the
// small labels next to its inputs), e.g. "Hours × Shop Rate/Hr".
function lineBasis(cat, line) {
  if (cat.inputMode === 'flat') return cat.priceLabel || 'Flat Price';
  if (cat.inputMode === 'coverage') return `${cat.qtyLabel} ÷ ${line.coverage_rate ?? 300} sqft/gal × ${cat.rateLabel}`;
  return `${cat.qtyLabel || cat.unit}${cat.rateLabel ? ` × ${cat.rateLabel}` : ' × Unit Cost'}`;
}

function lineSource(line) {
  if (line.is_overridden) return 'Override';
  if (line.is_auto_filled) return 'Auto (from Full Takeoff)';
  return '';
}

/**
 * @param {object} input
 * @param {object} input.bid                     the Bid record
 * @param {Array}  input.categories              COST_CATEGORIES (TakeoffEngine.jsx)
 * @param {Array}  [input.visibleCategoryKeys]   categories the worksheet renders for this company (defaults to all)
 * @param {Array}  input.existingLines           TakeoffLine rows for the bid, newest first
 * @param {Map}    [input.defaultRateByCategory] buildCostCategoryRateMap result
 * @param {Array}  [input.rateDefaultKeys]       RATE_DEFAULT_CATEGORY_KEYS
 * @param {number|null} [input.configuredLeedRate] company's configured LEED $/hr (null when none)
 * @param {number} input.taxRate                 computeEffectiveTaxRate(...).rate
 * @param {string} [input.taxLabel]              getTaxDisplayLabel(...)
 * @param {number} input.joistDeckTaxRate        getJoistDeckTaxRate(bid, taxRate)
 * @param {Array}  [input.freightTiers]          DeliveryPricingTier rows
 */
export function buildBidInternalBreakdown(input) {
  const {
    bid, categories, visibleCategoryKeys, existingLines, defaultRateByCategory, rateDefaultKeys,
    configuredLeedRate = null, taxRate = 0, taxLabel = 'Sales Tax', joistDeckTaxRate = 0, freightTiers = [],
  } = input;

  const lines = buildWorksheetLineMap({ categories, existing: existingLines, bid, defaultRateByCategory, rateDefaultKeys });
  const leedHourlyRate = resolveLeedHourlyRate(bid, configuredLeedRate);
  // The worksheet's own initial toggle/override state for a loaded bid.
  const insuranceEnabled = bid?.insurance_enabled ?? false;
  const bondEnabled = bid?.bond_enabled ?? true;
  const procorePayEnabled = bid?.procore_pay_enabled ?? false;
  const texturaEnabled = bid?.textura_enabled ?? false;
  const insuranceInputs = {
    general_liability: bid?.insurance_general_liability ?? '',
    umbrella: bid?.insurance_umbrella ?? '',
    professional_liability: bid?.insurance_professional_liability ?? '',
  };
  const leedLevel = bid?.leed_level_override ?? '';
  const totals = computeWorksheetTotals({
    categories, lines, bid, taxRate, joistDeckTaxRate,
    insuranceOverride: bid?.insurance_override ?? '',
    bondOverride: bid?.bond_override ?? '',
    leedLevel, leedHourlyRate, insuranceInputs,
    insuranceEnabled, bondEnabled, procorePayEnabled, texturaEnabled,
  });

  // --- Cost Breakdown — Line Items -----------------------------------------
  // Every category the worksheet renders, zero lines included. A category
  // hidden for this company (no Fabrication module) still counts in the
  // worksheet's subtotal, so it's listed too — but only when it carries a
  // cost, flagged, so the subtotal here always reconciles to its lines.
  const visible = new Set(visibleCategoryKeys || (categories || []).map((c) => c.key));
  const takeoffFabHours = roundTakeoffHours(bid?.estimated_man_hours);
  const lineRows = (categories || [])
    .filter((cat) => visible.has(cat.key) || (lines[cat.key]?.total_cost || 0) !== 0)
    .map((cat) => {
      const line = lines[cat.key] || { quantity: 0, unit_cost: 0, total_cost: 0, markup_percentage: 0 };
      const notes = [];
      if (!visible.has(cat.key)) notes.push('not shown on this company\'s worksheet (no Fabrication module)');
      if (cat.key === FAB_HOURS_CATEGORY_KEY) notes.push(`Full Takeoff shop hours: ${takeoffFabHours.toFixed(1)} hrs`);
      return {
        key: cat.key,
        label: cat.label,
        basis: lineBasis(cat, line),
        quantity: Number(line.quantity) || 0,
        quantityUnit: cat.inputMode === 'flat' ? '' : (cat.qtyLabel || cat.unit),
        unitCost: Number(line.unit_cost) || 0,
        coverageRate: cat.inputMode === 'coverage' ? (line.coverage_rate ?? 300) : null,
        lineTotal: Number(line.total_cost) || 0,
        markupPct: parseFloat(line.markup_percentage) || 0,
        quotedPrice: (line.total_cost || 0) * lineMarkupMultiplier(line),
        source: lineSource(line),
        note: notes.join('; '),
      };
    });

  // --- Freight Mileage Calculator -------------------------------------------
  // Distance is the one the worksheet saved (Bid.delivery_distance_miles);
  // the worksheet looks it up live, then saves it on Save Takeoff.
  const distance = bid?.delivery_distance_miles ?? null;
  const tier = matchDeliveryTier(freightTiers, distance);

  // --- Administrative Overrides ----------------------------------------------
  const leedMatch = LEED_SURCHARGE_LEVELS.find((l) => l.value === leedLevel);
  const feeRatePct = PAYMENT_PLATFORM_FEE_RATE * 100;

  const taxRatePct = totals.calculatedTaxRate * 100;
  const joistDeckRatePct = (Number(joistDeckTaxRate) || 0) * 100;
  const savedTotal = bid?.bid_total_cost;
  const savedTotalDiffers = savedTotal != null && Math.abs(Number(savedTotal) - totals.totalWithTax) >= 0.005;

  const sections = [
    {
      key: 'line_items',
      title: 'Cost Breakdown — Line Items',
      type: 'lines',
      preRows: [pct('Default Markup % (pre-fills new lines only)', bid?.markup_percentage, 'markup_percentage')],
      rows: lineRows,
      subtotal: {
        label: 'Subtotal',
        lineTotal: totals.subtotal,
        markupPct: totals.averageMarkupPct,
        quotedPrice: totals.subtotalWithMarkup,
      },
    },
    {
      key: 'freight',
      title: 'Freight Mileage Calculator',
      type: 'values',
      rows: [
        num('Driving Distance (miles)', distance, 'delivery_distance_miles'),
        text('Matched Tier', tier ? `${tier.min_miles}–${tier.max_miles} mi` : '—', 'matched_freight_tier'),
        money('Tier Rate / Load', tier ? tier.cost_per_trip : 0, 'freight_tier_rate'),
      ],
    },
    {
      key: 'admin_overrides',
      title: 'Administrative Overrides',
      type: 'values',
      rows: [
        text('Insurance Allocation — included in Total Cost', yesNo(insuranceEnabled), 'insurance_enabled'),
        text('Performance/Payment Bond — included in Total Cost', yesNo(bondEnabled), 'bond_enabled'),
        pct('Bond tiered rate', totals.bondRate * 100, 'bond_rate', { decimals: 3 }),
        money('Bond calculated', totals.computedBondAmount, 'computed_bond_amount'),
        text('Bond Manual Override ($)', totals.bondOverrideApplied ? totals.bondOverrideValue : '— (uses calculated)', 'bond_override', totals.bondOverrideApplied ? { kind: 'money', value: totals.bondOverrideValue } : {}),
        money('Bond used', totals.effectiveBondAmount, 'effective_bond_amount'),
        text('Procore Pay Fee — included in Total Cost', yesNo(procorePayEnabled), 'procore_pay_enabled'),
        pct('Procore Pay Fee rate (of proposal total, plus tax)', feeRatePct, 'payment_platform_fee_rate', { decimals: 1 }),
        money('Procore Pay Fee', totals.procorePlatformFee.fee, 'procore_fee'),
        money('Procore Pay Fee tax', totals.procorePlatformFee.tax, 'procore_fee_tax'),
        money('Procore Pay Fee total', totals.procorePlatformFee.total, 'procore_fee_total'),
        text('Textura Fee — included in Total Cost', yesNo(texturaEnabled), 'textura_enabled'),
        pct('Textura Fee rate (of proposal total, plus tax)', feeRatePct, 'payment_platform_fee_rate', { decimals: 1 }),
        money('Textura Fee', totals.texturaPlatformFee.fee, 'textura_fee'),
        money('Textura Fee tax', totals.texturaPlatformFee.tax, 'textura_fee_tax'),
        money('Textura Fee total', totals.texturaPlatformFee.total, 'textura_fee_total'),
        money('Insurance ($)', totals.overrideTotal, 'insurance_override'),
        text('LEED / Government Job Level', leedMatch ? `${leedMatch.label} (${leedMatch.hours} hrs)` : 'Not a LEED / Gov\'t job', 'leed_level_override'),
        num('LEED hours', leedMatch ? leedMatch.hours : 0, 'leed_hours'),
        money('LEED rate ($/hr)', leedHourlyRate, 'leed_hourly_rate'),
        money('LEED surcharge', totals.leedSurchargeAmount, 'leed_surcharge'),
        money('General Liability ($)', parseFloat(insuranceInputs.general_liability) || 0, 'insurance_general_liability'),
        money('Umbrella ($)', parseFloat(insuranceInputs.umbrella) || 0, 'insurance_umbrella'),
        money('Professional Liability ($)', parseFloat(insuranceInputs.professional_liability) || 0, 'insurance_professional_liability'),
        money('Insurance Allocation (GL + Umbrella + Professional)', totals.insuranceAllocation, 'insurance_allocation'),
        money('Manual Override Total', totals.overrideTotal, 'override_total', { bold: true }),
      ],
    },
    {
      key: 'totals',
      title: 'Total Cost',
      type: 'values',
      rows: [
        money('Line Item Subtotal', totals.subtotal, 'subtotal'),
        money(`Profit Markup (avg ${totals.averageMarkupPct.toLocaleString(undefined, { maximumFractionDigits: 2 })}%)`, totals.markupAmount, 'markup_amount'),
        money('Subtotal With Markup', totals.subtotalWithMarkup, 'subtotal_with_markup'),
        money('Manual Override Total', totals.overrideTotal, 'override_total'),
        money(`Bond Estimate${bondEnabled ? '' : OFF_SUFFIX}`, totals.includedBondAmount, 'included_bond_amount'),
        money(`Insurance Allocation${insuranceEnabled ? '' : OFF_SUFFIX}`, totals.includedInsuranceAllocation, 'included_insurance_allocation'),
        money(`LEED / Gov't Job Surcharge${leedMatch ? ` (${leedMatch.label})` : ''}`, totals.leedSurchargeAmount, 'leed_surcharge'),
        money(`Procore Pay Fee${procorePayEnabled ? '' : OFF_SUFFIX}`, totals.includedProcoreFee, 'included_procore_fee'),
        money(`Textura Fee${texturaEnabled ? '' : OFF_SUFFIX}`, totals.includedTexturaFee, 'included_textura_fee'),
        money(`${taxLabel} (${taxRatePct.toFixed(2)}%)${bid?.tax_exempt ? ' — exempt' : ''}`, totals.structuralTaxAmount, 'structural_tax_amount'),
        money(`Joist & Deck Tax (${joistDeckRatePct.toFixed(2)}%)${bid?.tax_exempt ? ' — exempt' : ''}`, totals.joistDeckTaxAmount, 'joist_deck_tax_amount'),
        money('Total Cost', totals.totalWithTax, 'bid_total_cost', { bold: true, big: true, topRule: true }),
        ...(savedTotalDiffers ? [money('Saved bid total (last Save Takeoff — differs; re-save the worksheet)', savedTotal, 'saved_bid_total_cost')] : []),
      ],
    },
    {
      key: 'scope_text',
      title: 'Inclusions / Exclusions / Drawings Used / Addendums',
      type: 'values',
      rows: [
        text('Inclusions', bid?.inclusions, 'inclusions', { block: true }),
        text('Exclusions', bid?.exclusions, 'exclusions', { block: true }),
        text('Drawings Used', bid?.drawings_used, 'drawings_used', { block: true }),
        text('Addendums', bid?.addendums, 'addendums', { block: true }),
      ],
    },
    {
      key: 'proposal_header',
      title: 'Proposal Header Fields',
      type: 'values',
      rows: [
        text('Attention (Contact Name)', bid?.attention_name, 'attention_name'),
        text('Specification Sections', bid?.specification_sections, 'specification_sections'),
        text('Supplied Cut Sheet', bid?.supplied_cut_sheet, 'supplied_cut_sheet'),
        text('Pricing Basis', PRICING_BASIS_LABELS[bid?.pricing_basis || 'fob'] || bid?.pricing_basis, 'pricing_basis'),
      ],
    },
    {
      key: 'alternates_allowances',
      title: 'Alternates / Allowances',
      type: 'values',
      rows: [
        text('Alternates', bid?.alternates_text, 'alternates_text', { block: true }),
        text('Allowances', bid?.allowances_text, 'allowances_text', { block: true }),
      ],
    },
    {
      key: 'material_quantity',
      title: 'Material Quantity Summary',
      type: 'values',
      rows: [
        num('Structural Steel (tons, from the linked takeoff)', bid?.total_weight_tons ?? bid?.estimated_tons ?? 0, 'estimated_tons'),
        num('Metal Deck (Squares)', bid?.metal_deck_squares, 'metal_deck_squares'),
        num('Steel Joist (Pieces)', bid?.steel_joist_pieces, 'steel_joist_pieces'),
        num('Steel Joist (Tons)', bid?.steel_joist_tons, 'steel_joist_tons'),
      ],
    },
  ];

  return { lines, totals, sections, leedHourlyRate };
}

// Display text for one values-row (PDF and anything else that needs text).
export function formatBreakdownValue(row) {
  if (row.kind === 'money') return `$${(row.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (row.kind === 'pct') {
    const d = row.decimals ?? 2;
    return `${(row.value || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
  }
  if (row.kind === 'number') return row.value == null || Number.isNaN(row.value) ? '—' : row.value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return row.value ? String(row.value) : '—';
}

export const LINE_ITEM_HEADERS = ['Category', 'Quantity / Rate (entered as)', 'Qty', 'Qty Unit', 'Unit Cost / Price', 'Coverage (sqft/gal)', 'Line Total', 'Markup %', 'Quoted Price', 'Source', 'Note'];

// Excel rows (array-of-arrays) for the same sections — real numbers, not
// formatted strings. Pure, so it's Node-checkable; bidInternalBreakdownXlsx.js
// only wraps it in a workbook.
export function buildBidInternalBreakdownAoa({ bid, company, sections, generatedOn = new Date() }) {
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = [company?.address, [company?.city, company?.state, company?.zip].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['Internal Breakdown (Internal Only)']);
  aoa.push([`Bid: ${bid?.bid_number || '—'} — ${bid?.job_name || '—'}`]);
  aoa.push(['Bid Due Date', bid?.bid_due_date || '—']);
  aoa.push(['Customer', bid?.customer_name || '—']);
  aoa.push([`Generated ${generatedOn.toLocaleDateString()}`]);

  sections.forEach((section) => {
    aoa.push([]);
    aoa.push([section.title]);
    if (section.type === 'lines') {
      (section.preRows || []).forEach((r) => aoa.push(valueRowCells(r)));
      aoa.push(LINE_ITEM_HEADERS);
      section.rows.forEach((r) => aoa.push([
        r.label, r.basis, r.quantity, r.quantityUnit, r.unitCost, r.coverageRate ?? '', r.lineTotal, r.markupPct, r.quotedPrice, r.source, r.note,
      ]));
      const s = section.subtotal;
      aoa.push([s.label, '', '', '', '', '', s.lineTotal, s.markupPct, s.quotedPrice, '', 'Markup % = dollar-weighted average']);
      return;
    }
    section.rows.forEach((r) => aoa.push(valueRowCells(r)));
  });
  return aoa;
}

function valueRowCells(r) {
  if (r.kind === 'text') return [r.label, r.value || '—'];
  if (r.kind === 'number') return [r.label, r.value == null || Number.isNaN(r.value) ? '' : r.value];
  return [r.label, r.value];
}
