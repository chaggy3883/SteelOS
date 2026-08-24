import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, DollarSign } from 'lucide-react';
import { getSalesmanCommissionSummary } from '@/lib/commissionEngine';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

export default function CommissionWidget({ salesmanId }) {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSalesmanCommissionSummary(salesmanId).then(setSummary).catch(() => setSummary(null)).finally(() => setLoading(false));
  }, [salesmanId]);

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
            <div className="border border-border rounded-lg p-3">
              <p className="text-xs text-muted-foreground">This Month's Commission</p>
              <p className="text-xl font-bold mt-1">{money(summary?.thisMonthEarned)}</p>
            </div>
            <div className="border border-border rounded-lg p-3">
              <p className="text-xs text-muted-foreground">This Month Pending</p>
              <p className="text-xl font-bold mt-1">{money(summary?.thisMonthPending)}</p>
            </div>
            <div className="border border-border rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Year-to-Date</p>
              <p className="text-xl font-bold mt-1">{money(summary?.ytdPaid)}</p>
            </div>
          </div>

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
                {(summary?.byProject || []).length === 0 ? (
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No commission activity yet.</td></tr>
                ) : summary.byProject.map((row) => (
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
