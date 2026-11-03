// Shared between TakeoffEngine.jsx (the live Bid Worksheet) and
// bidInternalBreakdownPdf.js (the internal export) so the bond/LEED/payment-
// platform-fee math can't drift between the two — see the double-count bug
// this replaced, where the worksheet's bond formula and its "override" input
// were both being added instead of the override replacing the formula.

export const BOND_RATE_TIERS = [
  { max: 500000, rate: 0.00810 },
  { max: 2500000, rate: 0.00567 },
  { max: 5000000, rate: 0.00486 },
  { max: Infinity, rate: 0.00432 },
];

export function bondRateForContractValue(contractValue) {
  const value = Math.max(0, contractValue || 0);
  return BOND_RATE_TIERS.find((t) => value <= t.max).rate;
}

export function calculateBondAmount(contractValue) {
  const value = Math.max(0, contractValue || 0);
  return value * bondRateForContractValue(value);
}

// Stored value must stay 'Government' (not 'Government Job') — bidRecapMapping.js's
// LEED_TIERS list expects that exact word (case-insensitive) for the Excel
// recap export's Addtn'l (AKP)!B24 cell; the friendlier label is display-only.
// The hour tiers below are fixed; only the $/hr is company-configurable — a
// CostCategoryDefaultRate row with category_key LEED_RATE_CATEGORY_KEY,
// admin-managed at /admin/bid-worksheet-rates. LEED_SURCHARGE_RATE_PER_HOUR
// is only the fallback for a company that hasn't configured one, and the
// rate a bid saved before the rate became configurable was priced at.
export const LEED_RATE_CATEGORY_KEY = 'leed_hourly_rate';
export const LEED_SURCHARGE_RATE_PER_HOUR = 50;
export const LEED_SURCHARGE_LEVELS = [
  { value: 'Certified', label: 'Certified', hours: 30 },
  { value: 'Silver', label: 'Silver', hours: 50 },
  { value: 'Gold', label: 'Gold', hours: 80 },
  { value: 'Platinum', label: 'Platinum', hours: 120 },
  { value: 'Government', label: 'Government Job', hours: 140 },
];

export function calculateLeedSurcharge(level, ratePerHour = LEED_SURCHARGE_RATE_PER_HOUR) {
  const match = LEED_SURCHARGE_LEVELS.find((l) => l.value === level);
  return match ? match.hours * (Number(ratePerHour) || 0) : 0;
}

// The $/hr a given bid's LEED surcharge is priced at. Bid.leed_hourly_rate is
// the rate snapshotted when the worksheet was last saved with a LEED level,
// so a later admin rate change never silently reprices a saved bid (same
// pre-fill-only philosophy as the other Bid Worksheet default rates) and the
// PDF/XLSX exports, which only see the Bid, price it exactly as the
// worksheet did. A bid that already has a LEED level but no snapshot was
// saved before the rate was configurable, so it stays at the old flat $50.
// Everything else gets the company's current configured rate.
export function resolveLeedHourlyRate(bid, configuredRate) {
  if (bid?.leed_hourly_rate != null) return Number(bid.leed_hourly_rate) || 0;
  if (bid?.leed_level_override) return LEED_SURCHARGE_RATE_PER_HOUR;
  return configuredRate != null ? Number(configuredRate) || 0 : LEED_SURCHARGE_RATE_PER_HOUR;
}

// Procore Pay / Textura both charge the same 0.2% payment-processing fee on
// the proposal total, then that fee is itself taxed at the bid's effective
// tax rate — matching how every other taxable line on this worksheet is
// taxed on its marked-up (sell) price, not raw cost.
export const PAYMENT_PLATFORM_FEE_RATE = 0.002;

export function calculatePaymentPlatformFee(proposalTotal, taxRate) {
  const fee = Math.max(0, proposalTotal || 0) * PAYMENT_PLATFORM_FEE_RATE;
  const tax = fee * (taxRate || 0);
  return { fee, tax, total: fee + tax };
}

// ---------------------------------------------------------------------------
// Worksheet line map + totals, shared by TakeoffEngine.jsx (the live Bid
// Worksheet) and bidInternalBreakdownData.js (the Full Breakdown PDF/Excel)
// so the export can never show a number the worksheet doesn't. These used
// to live inline in TakeoffEngine.jsx's loadLines and render body; moved
// here unchanged. COST_CATEGORIES is passed in (it lives in
// TakeoffEngine.jsx) so this file stays import-free and Node-checkable.
// ---------------------------------------------------------------------------

// The Structural Fabrication line's Hours auto-fill from the Full Takeoff's
// shop man-hours (Bid.estimated_man_hours), rounded to one decimal the same
// way the Full Takeoff's "Total Estimated Man-Hours" card shows it.
export const FAB_HOURS_CATEGORY_KEY = 'structural_fabrication';
export const roundTakeoffHours = (hours) => Math.round((Number(hours) || 0) * 10) / 10;

// Quoted Price = Line Total x this. A blank markup counts as 0%.
export const lineMarkupMultiplier = (line) => 1 + ((parseFloat(line?.markup_percentage) || 0) / 100);

// Strips float noise from a converted number (0.175 x 2000 =
// 350.00000000000006 -> 350) without rounding a real value.
const cleanFloat = (n) => Number((Number(n) || 0).toPrecision(12));

// ---------------------------------------------------------------------------
// Per-line quantity units. A category with `unitOptions` (Galvanizing: tons
// or lbs) lets the estimator pick the unit; the pick is saved on the line as
// TakeoffLine.unit_of_measure. Each option's `perBase` is how many of that
// unit make one of the first (base) unit — tons 1, lbs 2000 — so switching
// converts the quantity one way and the rate the other and the line total
// never moves (12.5 tons x $350 = $4,375 = 25,000 lb x $0.175).
// ---------------------------------------------------------------------------
export const LBS_PER_TON = 2000;

export function lineUnitOption(cat, line) {
  const options = cat?.unitOptions;
  if (!options?.length) return null;
  return options.find((o) => o.value === line?.unit_of_measure) || options[0];
}

// The unit a line is saved with: the picked option, else the category's unit.
export const lineUnit = (cat, line) => lineUnitOption(cat, line)?.value || cat?.unit || null;

// Quantity/rate labels for a line as the worksheet shows them.
export function lineLabels(cat, line) {
  const option = lineUnitOption(cat, line);
  return {
    qtyLabel: option?.qtyLabel || cat?.qtyLabel || cat?.unit || '',
    rateLabel: option?.rateLabel || cat?.rateLabel || '',
  };
}

// Switches a line to another unit option: quantity x (to/from), rate x
// (from/to). total_cost is kept exactly as it was (the product of the
// converted numbers can differ from it in the last float digit).
export function convertLineUnit(cat, line, toValue) {
  const from = lineUnitOption(cat, line);
  const to = (cat?.unitOptions || []).find((o) => o.value === toValue);
  if (!from || !to || from.value === to.value) return line;
  const factor = to.perBase / from.perBase;
  return {
    ...line,
    unit_of_measure: to.value,
    quantity: cleanFloat((Number(line.quantity) || 0) * factor),
    unit_cost: cleanFloat((Number(line.unit_cost) || 0) / factor),
    total_cost: Number(line.total_cost) || 0,
  };
}

// ---------------------------------------------------------------------------
// Saved lines from before a category changed how it is entered.
//  - qty x rate (or lot x price) -> quote only: a saved line with a
//    quantity other than 1 is carried into the quote amount as quantity x
//    unit_cost (quote lines are stored as 1 x amount), so the line total
//    and every bid total stay exactly the same. carried_from keeps what it
//    was, for the line's note.
//  - quote -> qty x price each (cat.fromQuote, Bolts / Fasteners): an old
//    quote is stored as 1 x $X, which already reads "1 x $X" and keeps its
//    total. legacy_quote_amount flags it as "was a quote" until the count
//    or price is re-entered. A line saved after this change carries
//    unit_of_measure, so it is never re-flagged.
// ---------------------------------------------------------------------------
export function migrateSavedLine(cat, found) {
  if (!found || !cat) return found;
  const qty = Number(found.quantity) || 0;
  const rate = Number(found.unit_cost) || 0;
  if (cat.inputMode === 'flat') {
    if (qty === 1 || (qty === 0 && rate === 0)) return found;
    const amount = qty * rate;
    return {
      ...found,
      quantity: 1,
      unit_cost: amount,
      total_cost: amount,
      carried_from: { quantity: qty, unit_cost: rate, unit: found.unit_of_measure || cat.wasUnit || '' },
    };
  }
  if (cat.fromQuote && found.legacy_quote_amount === undefined && found.unit_of_measure == null && qty === 1 && rate > 0) {
    return { ...found, legacy_quote_amount: rate };
  }
  return found;
}

// ---------------------------------------------------------------------------
// Shop Priming hours from painted area: sq ft / the company's "Shop priming
// sq ft per hour" production rate (CostCategoryDefaultRate row with
// category_key SHOP_PRIMING_RATE_KEY, the number kept in hourly_rate, set at
// /admin/bid-worksheet-rates). Until an admin sets one, the default below is
// used and the worksheet says so.
// ---------------------------------------------------------------------------
export const SHOP_PRIMING_RATE_KEY = 'shop_priming_sqft_per_hour';
export const SHOP_PRIMING_SQFT_PER_HOUR_DEFAULT = 250;

export function resolveShopPrimingRate(configuredRate) {
  const n = Number(configuredRate);
  return n > 0 ? { value: n, isDefault: false } : { value: SHOP_PRIMING_SQFT_PER_HOUR_DEFAULT, isDefault: true };
}

// Hours rounded to 0.1, the same rounding as the fab hours.
export function shopPrimingHours(sqft, sqftPerHour) {
  const rate = Number(sqftPerHour) || 0;
  return rate > 0 ? roundTakeoffHours((Number(sqft) || 0) / rate) : 0;
}

// One worksheet line per category from the saved TakeoffLine rows (newest
// first, as fetched), applying the same Full Takeoff auto-fill rules the
// worksheet applies on load. Each category's default_markup_pct pre-fills a
// new line's markup (Bid.markup_percentage only for a category missing
// one). Primer (Paint)/Galvanizing/Structural Fabrication quantities follow
// the takeoff's paint area / galvanized tons / shop hours while the line
// was never hand-edited (and a saved-but-blank fab row also picks them up).
// Galvanizing's tons are converted when the line is kept in lbs. Saved
// lines from before a category's entry changed go through migrateSavedLine.
export function buildWorksheetLineMap({ categories, existing, bid, defaultRateByCategory, rateDefaultKeys }) {
  const bidMarkupPct = parseFloat(bid?.markup_percentage) || 0;
  const takeoffFabHours = roundTakeoffHours(bid?.estimated_man_hours);
  const defaultRate = (key) => ((rateDefaultKeys || []).includes(key) ? (defaultRateByCategory?.get(key) ?? 0) : 0);
  const map = {};
  (categories || []).forEach((cat) => {
    let found = migrateSavedLine(cat, (existing || []).find((e) => e.cost_category === cat.key));
    // A company rate goes straight into a saved line's empty rate box too
    // (not only a brand-new line's), so the line calculates without the
    // estimator retyping it; a rate already on the line is never replaced.
    const companyRate = defaultRate(cat.key);
    if (found && !(Number(found.unit_cost) > 0) && companyRate > 0) {
      const qty = Number(found.quantity) || 0;
      const coverage = found.coverage_rate ?? 300;
      found = {
        ...found,
        unit_cost: companyRate,
        total_cost: cat.inputMode === 'coverage' ? (qty / (coverage || 300)) * companyRate : qty * companyRate,
      };
    }
    const categoryDefaultMarkupPct = cat.default_markup_pct ?? bidMarkupPct;
    // Galvanizing's takeoff number is tons; a line kept in lbs gets it x 2000.
    const unitPerBase = lineUnitOption(cat, found)?.perBase || 1;
    const autoQty = cat.key === 'primer_paint' ? Math.round((Number(bid?.estimated_paint_area_sqft) || 0) * 100) / 100
      : cat.key === 'galvanizing' ? cleanFloat((Number(bid?.estimated_galvanizing_tons) || 0) * unitPerBase)
      : cat.key === FAB_HOURS_CATEGORY_KEY ? takeoffFabHours
      : 0;
    const isBlankFabRow = cat.key === FAB_HOURS_CATEGORY_KEY && found && !found.is_auto_filled && !found.is_overridden && !(Number(found.quantity) > 0);
    if (autoQty > 0 && (!found || (found.is_auto_filled && !found.is_overridden) || isBlankFabRow)) {
      const base = found || {
        quantity: 0,
        unit_cost: defaultRate(cat.key),
        coverage_rate: 300,
        markup_percentage: categoryDefaultMarkupPct,
        id: null,
      };
      const unitCost = base.unit_cost || 0;
      const coverageRate = base.coverage_rate ?? 300;
      map[cat.key] = {
        ...base,
        quantity: autoQty,
        coverage_rate: coverageRate,
        markup_percentage: base.markup_percentage ?? categoryDefaultMarkupPct,
        total_cost: cat.inputMode === 'coverage' ? (autoQty / (coverageRate || 300)) * unitCost : autoQty * unitCost,
        is_auto_filled: true,
        is_overridden: false,
        source: 'calculated',
      };
      return;
    }
    map[cat.key] = found
      ? { ...found, coverage_rate: found.coverage_rate ?? 300, markup_percentage: found.markup_percentage ?? categoryDefaultMarkupPct }
      : {
          quantity: 0,
          unit_cost: defaultRate(cat.key),
          total_cost: 0,
          coverage_rate: 300,
          markup_percentage: categoryDefaultMarkupPct,
          is_auto_filled: false,
          source: 'manual',
          id: null,
        };
  });
  return map;
}

// The Freight Mileage Calculator's DeliveryPricingTier for a driving
// distance (no distance -> no tier).
export function matchDeliveryTier(tiers, miles) {
  if (miles == null) return null;
  return (tiers || []).find((t) => miles >= (t.min_miles ?? 0) && miles <= (t.max_miles ?? Infinity)) || null;
}

// Every derived dollar figure on the worksheet, in the worksheet's own
// order: subtotal -> per-line markup -> manual override -> tax -> insurance
// -> LEED -> bond (on that running total) -> Procore/Textura fees (on the
// total including bond). taxRate is the resolved jurisdiction/manual rate
// (computeEffectiveTaxRate) and is zeroed here when the bid is tax exempt,
// exactly as the worksheet does; joistDeckTaxRate comes from
// getJoistDeckTaxRate (taxRate.js), passed in to keep this file import-free.
export function computeWorksheetTotals({
  categories, lines, bid, taxRate, joistDeckTaxRate,
  insuranceOverride, bondOverride, leedLevel, leedHourlyRate,
  insuranceInputs, insuranceEnabled, bondEnabled, procorePayEnabled, texturaEnabled,
}) {
  const lineList = Object.values(lines || {});
  const subtotal = lineList.reduce((s, l) => s + (l.total_cost || 0), 0);
  const subtotalWithMarkup = lineList.reduce((s, l) => s + (l.total_cost || 0) * lineMarkupMultiplier(l), 0);
  const markupAmount = subtotalWithMarkup - subtotal;
  // Dollar-weighted average, not a plain mean of the per-line percentages.
  const averageMarkupPct = subtotal > 0 ? (markupAmount / subtotal) * 100 : 0;
  const overrideTotal = parseFloat(insuranceOverride) || 0;
  const grandTotal = subtotalWithMarkup + overrideTotal;
  const calculatedTaxRate = bid?.tax_exempt ? 0 : (taxRate || 0);
  const structuralTaxAmount = Object.entries(lines || {}).reduce((sum, [categoryKey, line]) => {
    const cat = (categories || []).find((c) => c.key === categoryKey);
    if (cat?.is_taxable === false) return sum;
    return sum + Number(line?.total_cost || 0) * lineMarkupMultiplier(line) * calculatedTaxRate;
  }, 0);
  const joistDeckLine = (lines || {}).joist_deck;
  const joistDeckTaxAmount = bid?.tax_exempt ? 0 : Number(joistDeckLine?.total_cost || 0) * lineMarkupMultiplier(joistDeckLine) * (joistDeckTaxRate || 0);
  const taxAmount = structuralTaxAmount + joistDeckTaxAmount;
  const insuranceAllocation = (parseFloat(insuranceInputs?.general_liability) || 0) + (parseFloat(insuranceInputs?.umbrella) || 0) + (parseFloat(insuranceInputs?.professional_liability) || 0);
  const includedInsuranceAllocation = insuranceEnabled ? insuranceAllocation : 0;
  const leedSurchargeAmount = calculateLeedSurcharge(leedLevel, leedHourlyRate);
  const preBondTotal = grandTotal + taxAmount + includedInsuranceAllocation + leedSurchargeAmount;
  const bondRate = bondRateForContractValue(preBondTotal);
  const computedBondAmount = calculateBondAmount(preBondTotal);
  const bondOverrideValue = bondOverride === '' || bondOverride === null || bondOverride === undefined ? null : parseFloat(bondOverride);
  const bondOverrideApplied = bondOverrideValue != null && !Number.isNaN(bondOverrideValue);
  const effectiveBondAmount = bondOverrideApplied ? bondOverrideValue : computedBondAmount;
  const includedBondAmount = bondEnabled ? effectiveBondAmount : 0;
  const preFeeTotal = preBondTotal + includedBondAmount;
  const procorePlatformFee = calculatePaymentPlatformFee(preFeeTotal, calculatedTaxRate);
  const texturaPlatformFee = calculatePaymentPlatformFee(preFeeTotal, calculatedTaxRate);
  const includedProcoreFee = procorePayEnabled ? procorePlatformFee.total : 0;
  const includedTexturaFee = texturaEnabled ? texturaPlatformFee.total : 0;
  const totalWithTax = preFeeTotal + includedProcoreFee + includedTexturaFee;
  return {
    subtotal, subtotalWithMarkup, markupAmount, averageMarkupPct, overrideTotal, grandTotal,
    calculatedTaxRate, structuralTaxAmount, joistDeckTaxAmount, taxAmount,
    insuranceAllocation, includedInsuranceAllocation, leedSurchargeAmount,
    preBondTotal, bondRate, computedBondAmount, bondOverrideValue, bondOverrideApplied, effectiveBondAmount, includedBondAmount,
    preFeeTotal, procorePlatformFee, texturaPlatformFee, includedProcoreFee, includedTexturaFee, totalWithTax,
  };
}
