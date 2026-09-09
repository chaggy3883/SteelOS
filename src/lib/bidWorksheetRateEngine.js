// Resolves company-configurable default hourly/shop rates for the Bid
// Worksheet's rate-driven cost categories (Field Rigging, Erection Labor
// Hours, Load/Unload Material, Shop Priming, Structural Fabrication) —
// admin-managed at /admin/bid-worksheet-rates (CostCategoryDefaultRate),
// same effective-dated history convention as resolveTmLaborRate in
// tmEngine.js. Only used to PRE-FILL a brand-new TakeoffLine's unit_cost
// (see TakeoffEngine.jsx's loadLines) — never re-applied over a line that
// already exists, so an estimator's manual edit is never silently
// overwritten.

export function currentCostCategoryRate(rates, categoryKey, asOfDate = new Date().toISOString().slice(0, 10)) {
  const candidates = (rates || [])
    .filter((r) => r.category_key === categoryKey && r.effective_date <= asOfDate && (!r.end_date || r.end_date > asOfDate))
    .sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || ''));
  return candidates[0] || null;
}

// Map of category_key -> current hourly_rate (number), for only the
// category keys passed in. Categories with no configured rate yet are
// simply absent from the map, so callers fall back to their own default
// (0) rather than this module inventing one.
export function buildCostCategoryRateMap(rates, categoryKeys, asOfDate) {
  const map = new Map();
  (categoryKeys || []).forEach((key) => {
    const rate = currentCostCategoryRate(rates, key, asOfDate);
    if (rate) map.set(key, Number(rate.hourly_rate) || 0);
  });
  return map;
}
