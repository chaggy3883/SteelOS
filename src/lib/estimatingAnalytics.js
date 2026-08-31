// Shared with EstimatingAnalytics.jsx (per-GC/estimator win-loss
// post-mortem) and ExecutiveAnalytics.jsx (company-wide rollup), so bid
// volume/average size is computed identically in both places instead of two
// inline copies drifting apart.

// Company-wide bid volume + average bid size — trivial aggregation over
// whatever bid set the caller passes in (e.g. all bids for an executive
// rollup, or one estimator's bids for a personal view).
export function computeBidVolumeStats(bids) {
  const priced = (bids || []).filter((b) => Number(b.bid_quoted_price) > 0);
  const avgBidSize = priced.length > 0
    ? priced.reduce((sum, b) => sum + Number(b.bid_quoted_price), 0) / priced.length
    : 0;
  return { totalBids: (bids || []).length, avgBidSize };
}
