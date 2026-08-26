import { db } from '@/api/apiClient';

export const HANCOCK_COUNTY_TAX_RATE = 0.0675;

const OHIO_NAMES = ['ohio', 'oh'];

const todayIso = () => new Date().toISOString().slice(0, 10);

// Matches a 2-digit whole number + 2-digit decimal percentage, e.g. "7.25".
// Blocks trailing-float artifacts like "7.249999" from ever being committed.
export const TAX_RATE_PATTERN = /^\d{1,2}\.\d{2}$/;

export function formatTaxRatePercent(fraction) {
  return fraction ? (Number(fraction) * 100).toFixed(2) : '';
}

// Looks up the TaxRate row for a job address: an exact street_address match
// within the ZIP wins (special taxing district / annexed area / TIF
// override), otherwise falls back to the ZIP-wide row (street_address
// blank). Only rows currently in effect (effective_date <= today and
// end_date null/in the future) are considered, so a superseded rate never
// wins even though its is_active flag hasn't been flipped yet at the exact
// moment a new one is added. Returns null if the ZIP has no active,
// currently-effective tax rate on file.
export async function findTaxRateForAddress({ street_address, zip_code } = {}) {
  const zip = String(zip_code || '').trim();
  if (!zip) return null;
  const candidates = await db.entities.TaxRate.filter({ zip_code: zip, is_active: true }, '-created_date', 50);
  const today = todayIso();
  const currentlyEffective = candidates.filter((r) => {
    const startsOk = !r.effective_date || r.effective_date <= today;
    const endsOk = !r.end_date || r.end_date >= today;
    return startsOk && endsOk;
  });
  const normalizedAddress = String(street_address || '').trim().toLowerCase();
  if (normalizedAddress) {
    const exactMatch = currentlyEffective.find((r) => String(r.street_address || '').trim().toLowerCase() === normalizedAddress);
    if (exactMatch) return exactMatch;
  }
  return currentlyEffective.find((r) => !String(r.street_address || '').trim()) || null;
}

// Builds the one consistent argument shape computeEffectiveTaxRate expects,
// from anything bid-shaped (a real Bid record, a freshly-fetched copy, or
// BidDetail's in-progress baseInfo form state) — so every call site resolves
// the same fields the same way instead of drifting (see the "inconsistent
// argument shapes" gap this replaces).
export function buildTaxRateInput(source) {
  return {
    zip_code: source?.zip,
    street_address: source?.street,
    state: source?.state,
    job_state: source?.job_state,
    tax_enabled: source?.tax_enabled,
    tax_rate: source?.tax_rate,
    tax_exempt: source?.tax_exempt,
  };
}

// The single authoritative tax-rate calculation. Priority order:
// 1. Explicit tax_exempt flag — always 0%, regardless of jurisdiction data.
// 2. A currently-effective TaxRate row for the job's ZIP/address (the real
//    jurisdiction table, built via Admin > Tax Zone Lookup).
// 3. The legacy Ohio hardcoded fallback — only when no jurisdiction row
//    exists yet for that ZIP, so bids in already-populated ZIPs aren't
//    silently pulled back onto the flat Hancock County rate.
// 4. Whatever was manually typed into tax_rate (every other state, or Ohio
//    with tax disabled).
// Async because step 2 needs to query the TaxRate entity — every call site
// must await this now.
export async function computeEffectiveTaxRate({ zip_code, street_address, state, job_state, tax_enabled, tax_rate, tax_exempt } = {}) {
  if (tax_exempt) {
    return { rate: 0, source: 'tax_exempt', effective_date: null, tax_zone_id: null };
  }

  const zoneMatch = await findTaxRateForAddress({ street_address, zip_code });
  if (zoneMatch) {
    return {
      rate: Number(zoneMatch.tax_percentage || 0) / 100,
      source: 'jurisdiction_table',
      effective_date: zoneMatch.effective_date || null,
      tax_zone_id: zoneMatch.id,
    };
  }

  const stateName = String(state || job_state || '').trim().toLowerCase();
  const isOhioOverride = !!tax_enabled && OHIO_NAMES.includes(stateName);
  if (isOhioOverride) {
    return { rate: HANCOCK_COUNTY_TAX_RATE, source: 'ohio_hardcoded_fallback', effective_date: null, tax_zone_id: null };
  }

  return { rate: Number(tax_rate || 0), source: 'manual_entry', effective_date: null, tax_zone_id: null };
}

// Resolves which path produced a bid's tax rate: the explicit
// tax_rate_source snapshot when present, otherwise infers it from
// pre-snapshot legacy bids using the same rule computeEffectiveTaxRate uses
// (so old bids saved before this field existed still label correctly).
export function inferTaxRateSource(input) {
  if (input?.tax_exempt) return 'tax_exempt';
  if (input?.tax_rate_source) return input.tax_rate_source;
  const stateName = String(input?.state || input?.job_state || '').trim().toLowerCase();
  if (input?.tax_enabled && OHIO_NAMES.includes(stateName)) return 'ohio_hardcoded_fallback';
  return 'manual_entry';
}

// Customer-facing (and worksheet) label for the tax line — never shows a
// specific Ohio county's name for a job that isn't actually in that
// jurisdiction. Fetches the snapshotted TaxRate row by id for the
// jurisdiction_table case so the label matches the row that was actually
// used at calculation time, even if that ZIP's current rate has since
// changed (the row itself isn't mutated by a supersede, only
// is_active/end_date are).
export async function getTaxDisplayLabel(input) {
  const source = inferTaxRateSource(input);
  if (source === 'tax_exempt') {
    return `Tax Exempt — ${input?.tax_exempt_reason || 'reason not specified'}`;
  }
  if (source === 'jurisdiction_table' && input?.tax_zone_id) {
    try {
      const zone = await db.entities.TaxRate.get(input.tax_zone_id);
      if (zone) {
        const place = zone.county
          ? `${zone.county} County, ${zone.state || ''}`.trim().replace(/,\s*$/, '')
          : [zone.city, zone.state].filter(Boolean).join(', ');
        if (place) return `${place} Tax`;
      }
    } catch (e) {}
    return 'Jurisdiction Tax';
  }
  if (source === 'ohio_hardcoded_fallback') return 'Hancock County Tax';
  return 'Sales Tax';
}

export function getJoistDeckTaxRate(bid) {
  return Number(bid?.joist_deck_tax_rate ?? HANCOCK_COUNTY_TAX_RATE);
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
