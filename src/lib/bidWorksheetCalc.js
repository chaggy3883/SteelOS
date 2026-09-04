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
export const LEED_SURCHARGE_RATE_PER_HOUR = 50;
export const LEED_SURCHARGE_LEVELS = [
  { value: 'Certified', label: 'Certified', hours: 30 },
  { value: 'Silver', label: 'Silver', hours: 50 },
  { value: 'Gold', label: 'Gold', hours: 80 },
  { value: 'Platinum', label: 'Platinum', hours: 120 },
  { value: 'Government', label: 'Government Job', hours: 140 },
];

export function calculateLeedSurcharge(level) {
  const match = LEED_SURCHARGE_LEVELS.find((l) => l.value === level);
  return match ? match.hours * LEED_SURCHARGE_RATE_PER_HOUR : 0;
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
