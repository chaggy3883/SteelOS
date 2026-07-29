export const HANCOCK_COUNTY_TAX_RATE = 0.0675;

const OHIO_NAMES = ['ohio', 'oh'];

export function computeEffectiveTaxRate({ state, job_state, tax_enabled, tax_rate } = {}) {
  const stateName = String(state || job_state || '').trim().toLowerCase();
  const isOhioOverride = !!tax_enabled && OHIO_NAMES.includes(stateName);
  return isOhioOverride ? HANCOCK_COUNTY_TAX_RATE : Number(tax_rate || 0);
}

export function getJoistDeckTaxRate(bid) {
  return Number(bid?.joist_deck_tax_rate ?? HANCOCK_COUNTY_TAX_RATE);
}

// Matches a 2-digit whole number + 2-digit decimal percentage, e.g. "7.25".
// Blocks trailing-float artifacts like "7.249999" from ever being committed.
export const TAX_RATE_PATTERN = /^\d{1,2}\.\d{2}$/;

export function formatTaxRatePercent(fraction) {
  return fraction ? (Number(fraction) * 100).toFixed(2) : '';
}

// Sanitizes free-typed text toward the TAX_RATE_PATTERN shape: digits and a
// single dot, at most 2 integer digits and 2 decimal digits.
export function sanitizeTaxRateInput(raw) {
  let value = String(raw || '').replace(/[^\d.]/g, '');
  const firstDot = value.indexOf('.');
  if (firstDot !== -1) {
    value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, '');
  }
  const [intPart, decPart] = value.split('.');
  const cappedInt = (intPart || '').slice(0, 2);
  if (decPart === undefined) return cappedInt;
  return `${cappedInt}.${decPart.slice(0, 2)}`;
}
