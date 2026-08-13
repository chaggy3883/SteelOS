// Quoted pricing on a bid is only held for a limited window — after that,
// material/labor costs may have moved and the estimator should confirm the
// numbers are still good before proceeding. There's no dedicated "quote
// issued" timestamp on Bid, so bid_due_date (the date the priced bid went
// out) is the anchor date for this math.
export const DEFAULT_BID_PRICING_HOLD_DAYS = 21;

// Only bids still awaiting a decision can "age out" — once won/lost/
// cancelled/Did_Not_Bid the pricing question is moot.
const ACTIVE_BID_STATUSES = ['draft', 'in_progress', 'submitted'];

// Company.bid_pricing_hold_days is the admin-configurable override (see
// Settings.jsx); this resolves it with the same "missing/invalid = default"
// fallback style used elsewhere in this app (e.g. moduleEntitlement.js).
export function getBidHoldDays(company) {
  const value = Number(company?.bid_pricing_hold_days);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BID_PRICING_HOLD_DAYS;
}

// Derived at render every time — never persisted, since a bid's age changes
// every day it sits undecided and a stored value would go stale immediately.
//
// Thresholds (for the default 21-day window): 0-14 days = normal, 15-20 =
// warning, 21+ = expired. Generalized for a configurable holdDays as "last 6
// days before expiration = warning", so the same shape holds at any window.
export function getBidPricingHoldState(bid, holdDays = DEFAULT_BID_PRICING_HOLD_DAYS) {
  if (!bid?.bid_due_date || !ACTIVE_BID_STATUSES.includes(bid.status)) return null;

  const quoted = new Date(bid.bid_due_date);
  const daysOld = Math.max(0, Math.floor((new Date() - quoted) / (1000 * 60 * 60 * 24)));
  const expiration = new Date(quoted);
  expiration.setDate(expiration.getDate() + holdDays);

  const warningStart = Math.max(holdDays - 6, 0);
  const level = daysOld >= holdDays ? 'expired' : daysOld >= warningStart ? 'warning' : 'normal';

  return {
    daysOld,
    level,
    holdDays,
    quoteDate: bid.bid_due_date,
    expirationDate: expiration.toISOString().slice(0, 10),
  };
}
