// Shared with EstimatingAnalytics.jsx (per-GC/estimator/geometry win-loss
// post-mortem) and ExecutiveAnalytics.jsx (company-wide rollup), so the
// geometry-type win-rate/volume breakdown is computed identically in both
// places instead of two inline copies drifting apart.

// Only decided bids (won/lost) count toward a win rate — active/DNB bids
// have no outcome yet, matching computeWinLossStats' definition of "decided".
export function computeGeometryBreakdown(bids) {
  const decided = (bids || []).filter((b) => b.status === 'won' || b.status === 'lost');
  const geoStats = {};
  decided.forEach((b) => {
    const geo = b.structural_geometry_type || 'other';
    if (!geoStats[geo]) geoStats[geo] = { won: 0, total: 0 };
    geoStats[geo].total++;
    if (b.status === 'won') geoStats[geo].won++;
  });
  return Object.entries(geoStats).map(([geo, s]) => ({
    name: geo.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    value: s.total,
    winRate: Math.round((s.won / s.total) * 100),
  }));
}

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
