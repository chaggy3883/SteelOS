import React, { useState, useEffect } from 'react';
import { Loader2, Gauge } from 'lucide-react';
import { getPipelineBids, computeQuickStats } from '@/lib/salesDashboardData';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function QuickStatsWidget({ salesmanId }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getPipelineBids(salesmanId)
      .then((bids) => setStats(computeQuickStats(bids)))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [salesmanId]);

  return (
    <div className="steel-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Gauge className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">Quick Stats</h3>
      </div>
      {loading ? (
        <div className="py-8 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div className="border border-border rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Quotes Submitted</p>
            <p className="text-2xl font-bold mt-1">{stats?.quotesSubmitted ?? 0}</p>
          </div>
          <div className="border border-border rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Win %</p>
            <p className="text-2xl font-bold mt-1">{stats?.winPct != null ? `${stats.winPct}%` : '—'}</p>
          </div>
          <div className="border border-border rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Avg Deal Size</p>
            <p className="text-2xl font-bold mt-1">{money(stats?.avgDealSize)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
