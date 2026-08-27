// A submitted bid needs a decision (Won/Lost/Did Not Bid) within a limited
// follow-up window — after that, it's flagged as needing follow-up and at
// risk of going stale/being marked lost by default. This has nothing to do
// with pricing (despite the file/variable names below, kept as-is to avoid
// a much larger rename across every import site) — it's purely a "how long
// has this been sitting with no word back" tracker, anchored to
// bid_submitted_date (set by the "Bid Submitted" action on BidDetail.jsx),
// not bid_due_date or the bid's creation date.
export const DEFAULT_BID_PRICING_HOLD_DAYS = 21;

// Only bids still awaiting a decision can "age out" — once won/lost/
// cancelled/Did_Not_Bid the follow-up question is moot.
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
// Returns null until bid_submitted_date is actually set — there's no
// countdown to show before the bid has gone out.
//
// Thresholds (for the default 21-day window): 0-14 days = normal, 15-20 =
// warning, 21+ = expired ("needs follow-up"). Generalized for a configurable
// holdDays as "last 6 days before expiration = warning", so the same shape
// holds at any window.
export function getBidPricingHoldState(bid, holdDays = DEFAULT_BID_PRICING_HOLD_DAYS) {
  if (!bid?.bid_submitted_date || !ACTIVE_BID_STATUSES.includes(bid.status)) return null;

  const submitted = new Date(bid.bid_submitted_date);
  const daysOld = Math.max(0, Math.floor((new Date() - submitted) / (1000 * 60 * 60 * 24)));
  const expiration = new Date(submitted);
  expiration.setDate(expiration.getDate() + holdDays);

  const warningStart = Math.max(holdDays - 6, 0);
  const level = daysOld >= holdDays ? 'expired' : daysOld >= warningStart ? 'warning' : 'normal';

  return {
    daysOld,
    level,
    holdDays,
    submittedDate: bid.bid_submitted_date,
    expirationDate: expiration.toISOString().slice(0, 10),
  };
}
