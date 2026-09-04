import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, DollarSign } from 'lucide-react';
import { getSalesmanCommissionSummary } from '@/lib/commissionEngine';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

// Which byProject row a tile's filter matches. A project can be earned AND
// have a pending balance simultaneously, so "thisMonthEarned"/"thisMonthPending"
// aren't mutually exclusive — both check the relevant amount is > 0.
const TILE_FILTERS = {
  thisMonthEarned: (row) => (Number(row.commissionPaid) || 0) > 0,
  thisMonthPending: (row) => (Number(row.commissionPending) || 0) > 0,
  ytdPaid: (row) => (Number(row.commissionPaid) || 0) > 0,
};

export default function CommissionWidget({ salesmanId }) {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTile, setActiveTile] = useState(null);

  useEffect(() => {
    setLoading(true);
    getSalesmanCommissionSummary(salesmanId).then(setSummary).catch(() => setSummary(null)).finally(() => setLoading(false));
  }, [salesmanId]);

  const toggleTile = (tile) => setActiveTile((prev) => (prev === tile ? null : tile));

  const allRows = summary?.byProject || [];
  const visibleRows = activeTile ? allRows.filter(TILE_FILTERS[activeTile]) : allRows;

  return (
    <div className="steel-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">Commission YTD</h3>
      </div>

      {loading ? (
        <div className="py-8 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <button
              type="button"
              onClick={() => toggleTile('thisMonthEarned')}
              className={`border rounded-lg p-3 text-left transition-colors ${activeTile === 'thisMonthEarned' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/30'}`}
            >
              <p className="text-xs text-muted-foreground">This Month's Commission</p>
              <p className="text-xl font-bold mt-1">{money(summary?.thisMonthEarned)}</p>
            </button>
            <button
              type="button"
              onClick={() => toggleTile('thisMonthPending')}
              className={`border rounded-lg p-3 text-left transition-colors ${activeTile === 'thisMonthPending' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/30'}`}
            >
              <p className="text-xs text-muted-foreground">This Month Pending</p>
              <p className="text-xl font-bold mt-1">{money(summary?.thisMonthPending)}</p>
            </button>
            <button
              type="button"
              onClick={() => toggleTile('ytdPaid')}
              className={`border rounded-lg p-3 text-left transition-colors ${activeTile === 'ytdPaid' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/30'}`}
            >
              <p className="text-xs text-muted-foreground">Year-to-Date</p>
              <p className="text-xl font-bold mt-1">{money(summary?.ytdPaid)}</p>
            </button>
          </div>

          {activeTile && (
            <div className="flex items-center gap-2 mb-2 text-xs">
              <span className="px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
                Filtered to projects matching {activeTile === 'thisMonthEarned' ? "This Month's Commission" : activeTile === 'thisMonthPending' ? 'This Month Pending' : 'Year-to-Date'}
              </span>
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => setActiveTile(null)}>Clear</button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-1.5 pr-3">Project</th>
                  <th className="text-right py-1.5 pr-3">Bid Amount</th>
                  <th className="text-right py-1.5 pr-3">Rate</th>
                  <th className="text-right py-1.5 pr-3">Total Commission</th>
                  <th className="text-right py-1.5 pr-3">Payments Received</th>
                  <th className="text-right py-1.5 pr-3">Paid</th>
                  <th className="text-right py-1.5 pr-3">Pending</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">{activeTile ? 'No projects match this filter.' : 'No commission activity yet.'}</td></tr>
                ) : visibleRows.map((row) => (
                  <tr key={row.projectId} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-1.5 pr-3">
                      <button type="button" className="font-medium hover:underline text-left" onClick={() => navigate(`/projects/${row.projectId}`)}>{row.projectName}</button>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono">{money(row.bidAmount)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{row.calcMethod === 'flat_rate' ? money(row.rate) : `${row.rate}%`}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{money(row.totalCommission)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{money(row.paymentsReceived)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-green-600">{money(row.commissionPaid)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-amber-600">{money(row.commissionPending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
