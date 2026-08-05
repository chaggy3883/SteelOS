import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { computeWinLossStats, computeProjectWipRadar, computeQuarterlyTaxExposure } from '@/lib/financialAnalytics';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import { Save, Gauge, TrendingUp, Landmark, Loader2 } from 'lucide-react';

const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;

const REASON_LABELS = {
  price: 'Price — Too High', competitor: 'Competitor Selected', schedule: 'Schedule — Too Long',
  capacity: 'Capacity — No Shop Availability', scope_clarity: 'Scope Clarity', relationship: 'Relationship / Preference',
  other: 'Other', not_enough_time_to_bid: 'Not Enough Time to Bid', not_enough_time_in_shop: 'Not Enough Time in Shop',
  not_in_scope: 'Not In Scope', cannot_meet_requirements: "Can't Meet Requirements",
};

export default function ExecutiveAnalytics() {
  const { toast } = useToast();
  const [projects, setProjects] = useState([]);
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [bids, setBids] = useState([]);
  const [taxRows, setTaxRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [projectData, ledgerData, bidData] = await Promise.all([
        db.entities.Project.filter({ is_archived: false }, 'name', 100),
        db.entities.JobCostLedgerEntry.list('-created_date', 500),
        db.entities.Bid.list('-created_date', 200),
      ]);
      setProjects(projectData);
      setLedgerEntries(ledgerData);
      setBids(bidData);
      setTaxRows(await computeQuarterlyTaxExposure(bidData));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const wipRadar = useMemo(() => computeProjectWipRadar(projects, ledgerEntries), [projects, ledgerEntries]);
  const winLoss = useMemo(() => computeWinLossStats(bids), [bids]);

  const winLossChartData = [
    { name: 'Won', count: winLoss.won, fill: '#16a34a' },
    { name: 'Lost', count: winLoss.lost, fill: '#dc2626' },
    { name: 'Did Not Bid', count: winLoss.dnb, fill: '#f59e0b' },
    { name: 'Active Pipeline', count: winLoss.active, fill: '#2563eb' },
  ];

  const handleSaveSnapshot = async () => {
    setSavingSnapshot(true);
    try {
      const totalWip = wipRadar.reduce((s, p) => s + p.contractValue, 0);
      const totalCash = projects.reduce((s, p) => s + (p.total_invoiced_to_date || 0), 0);
      await db.entities.executive_metrics_snapshots.create({
        snapshot_date: new Date().toISOString().slice(0, 10),
        total_wip_value_cents: Math.round(totalWip * 100),
        total_cash_collected_cents: Math.round(totalCash * 100),
        win_loss_ratio_percentage: winLoss.winRatePct || 0,
        updated_at: new Date().toISOString(),
      });
      toast({ title: 'Snapshot saved' });
    } catch (e) {
      toast({ title: 'Unable to save snapshot', variant: 'destructive' });
    } finally {
      setSavingSnapshot(false);
    }
  };

  if (loading) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">
      <PageHeader
        title="Executive Analytics"
        subtitle="Corporate WIP radar, bid win/loss performance, and quarterly tax exposure across all active projects"
        actions={
          <Button size="sm" onClick={handleSaveSnapshot} disabled={savingSnapshot} className="gap-2 steel-gradient text-white border-0">
            {savingSnapshot ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save Snapshot
          </Button>
        }
      />
      <p className="text-xs text-muted-foreground -mt-4">
        Snapshots are captured manually here — there's no backend scheduler in this app to run them automatically.
      </p>

      {/* 1. Financial WIP Radar */}
      <div className="steel-card p-5">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Gauge className="w-4 h-4 text-primary" />Financial WIP Radar</h3>
        <p className="text-xs text-muted-foreground mb-4">Total contract value vs. actual job-to-date cost recognized (from the job cost ledger), per active project.</p>
        {wipRadar.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No active projects to chart.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(160, wipRadar.length * 60)}>
            <BarChart data={wipRadar} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={fmtMoney} />
              <YAxis type="category" dataKey="projectName" width={140} />
              <Tooltip formatter={(value) => fmtMoney(value)} />
              <Legend />
              <Bar dataKey="contractValue" name="Contract Value" fill="#2563eb" radius={[0, 4, 4, 0]} />
              <Bar dataKey="jtdCost" name="JTD Cost Recognized" fill="#f97316" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 2. Bid Win/Loss */}
      <div className="steel-card p-5">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" />Commercial Bid Win/Loss</h3>
        <p className="text-xs text-muted-foreground mb-4">Won/Lost/Did-Not-Bid are parallel outcomes, not funnel stages — shown as a categorical comparison rather than a funnel.</p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-4">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={winLossChartData} layout="vertical" margin={{ left: 16 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={110} />
              <Tooltip />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {winLossChartData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="steel-card bg-primary/5 p-4 flex flex-col items-center justify-center text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Win Rate</p>
            <p className="text-3xl font-bold text-primary">{winLoss.winRatePct === null ? '—' : `${winLoss.winRatePct}%`}</p>
            <p className="text-xs text-muted-foreground mt-1">Won ÷ (Won + Lost)</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Top Loss Reasons</p>
            {winLoss.topLossReasons.length === 0 ? <p className="text-xs text-muted-foreground">None logged.</p> : winLoss.topLossReasons.map((r) => (
              <div key={r.reason} className="flex justify-between text-sm py-1 border-b border-border/50">
                <span>{REASON_LABELS[r.reason] || r.reason}</span><span className="font-mono">{r.count}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Top Did-Not-Bid Reasons</p>
            {winLoss.topDnbReasons.length === 0 ? <p className="text-xs text-muted-foreground">None logged.</p> : winLoss.topDnbReasons.map((r) => (
              <div key={r.reason} className="flex justify-between text-sm py-1 border-b border-border/50">
                <span>{REASON_LABELS[r.reason] || r.reason}</span><span className="font-mono">{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Quarterly Tax Exposure Grid */}
      <div className="steel-card overflow-hidden">
        <div className="p-5 pb-3">
          <h3 className="font-semibold mb-1 flex items-center gap-2"><Landmark className="w-4 h-4 text-primary" />Quarterly Tax Exposure Grid</h3>
          <p className="text-xs text-muted-foreground">Hancock County structural tax vs. Joist &amp; Deck jobsite tax overrides, by billing quarter, across all bids.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-3 px-5">Quarter</th>
                <th className="text-right py-3 px-5">Hancock County Tax</th>
                <th className="text-right py-3 px-5">Joist &amp; Deck Tax</th>
                <th className="text-right py-3 px-5">Total</th>
              </tr>
            </thead>
            <tbody>
              {taxRows.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">No bid tax data available yet.</td></tr>
              ) : taxRows.map((row) => (
                <tr key={row.quarter} className="border-b border-border/50">
                  <td className="py-3 px-5 font-medium">{row.quarter}</td>
                  <td className="py-3 px-5 text-right font-mono">{fmtMoney(row.hancockCountyTax)}</td>
                  <td className="py-3 px-5 text-right font-mono">{fmtMoney(row.joistDeckTax)}</td>
                  <td className="py-3 px-5 text-right font-mono font-semibold">{fmtMoney(row.hancockCountyTax + row.joistDeckTax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
