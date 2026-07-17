import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { BarChart3, TrendingUp, TrendingDown, AlertTriangle, Factory, Target, Percent } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const COLORS = ['#1d7ed8', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#eab308', '#14b8a6'];
const STATIONS = ['saw', 'drill', 'fab', 'weld', 'paint'];

export default function EstimatingAnalytics() {
  const [variances, setVariances] = useState([]);
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [varData, bidData] = await Promise.all([
        base44.entities.HistoricalVariance.list('-completed_date', 100),
        base44.entities.Bid.filter({ is_archived: false }, '-created_date', 500),
      ]);
      setVariances(varData);
      setBids(bidData);
    } catch (e) {} finally { setLoading(false); }
  };

  // Win/Loss post-mortem charts
  const lostBids = bids.filter(b => b.status === 'lost');
  const wonBids = bids.filter(b => b.status === 'won');
  const decided = [...wonBids, ...lostBids];

  // Win rate by General Contractor
  const gcStats = {};
  decided.forEach(b => {
    const gc = b.general_contractor_name || 'Unknown';
    if (!gcStats[gc]) gcStats[gc] = { won: 0, lost: 0, total: 0 };
    gcStats[gc].total++;
    if (b.status === 'won') gcStats[gc].won++; else gcStats[gc].lost++;
  });
  const winRateByGC = Object.entries(gcStats).map(([gc, s]) => ({
    name: gc.length > 15 ? gc.substring(0, 13) + '…' : gc,
    winRate: s.total > 0 ? Math.round(s.won / s.total * 100) : 0,
    total: s.total,
  })).filter(d => d.total >= 1).sort((a, b) => b.winRate - a.winRate);

  // Win rate by geometry type
  const geoStats = {};
  decided.forEach(b => {
    const geo = b.structural_geometry_type || 'other';
    if (!geoStats[geo]) geoStats[geo] = { won: 0, total: 0 };
    geoStats[geo].total++;
    if (b.status === 'won') geoStats[geo].won++;
  });
  const winRateByGeo = Object.entries(geoStats).map(([geo, s]) => ({
    name: geo.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    value: s.total,
    winRate: Math.round(s.won / s.total * 100),
  }));

  // Win rate by margin bracket
  const marginBrackets = [
    { label: '0-5%', min: 0, max: 5 },
    { label: '5-10%', min: 5, max: 10 },
    { label: '10-15%', min: 10, max: 15 },
    { label: '15-20%', min: 15, max: 20 },
    { label: '20%+', min: 20, max: 999 },
  ];
  const winRateByMargin = marginBrackets.map(bracket => {
    const inBracket = decided.filter(b => b.margin_percentage >= bracket.min && b.margin_percentage < bracket.max);
    const won = inBracket.filter(b => b.status === 'won').length;
    return {
      name: bracket.label,
      winRate: inBracket.length > 0 ? Math.round(won / inBracket.length * 100) : 0,
      count: inBracket.length,
    };
  });

  // Smart Adjuster alerts
  const adjusterAlerts = variances.filter(v => v.auto_adjuster_alert);
  const stationVariances = variances.length > 0
    ? STATIONS.map(station => {
        const totalVar = variances.reduce((sum, v) => sum + (v.station_variances?.[station]?.variance_pct || 0), 0);
        return { station: station.toUpperCase(), avgVariance: variances.length > 0 ? totalVar / variances.length : 0 };
      })
    : [];

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader title="Historic Cost Analytics" subtitle="Estimating vs. Actuals loop, win/loss post-mortem, and mill pricing intelligence" />

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Completed Projects (EVA)', value: variances.length, icon: BarChart3, color: 'text-blue-500' },
          { label: 'Active Adjuster Alerts', value: adjusterAlerts.length, icon: AlertTriangle, color: 'text-red-500' },
          { label: 'Avg Win Rate', value: decided.length > 0 ? `${Math.round(wonBids.length / decided.length * 100)}%` : '—', icon: Target, color: 'text-green-500' },
          { label: 'Bids Decided', value: decided.length, icon: Percent, color: 'text-purple-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      {/* Smart Adjuster Alerts */}
      {adjusterAlerts.length > 0 && (
        <div className="steel-card p-5 mb-6 border-red-500/20">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" />Smart Estimating Adjuster — Active Alerts</h3>
          <div className="space-y-2">
            {adjusterAlerts.map(v => (
              <div key={v.id} className="flex items-center gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                <TrendingUp className="w-4 h-4 text-red-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{v.bid_number} → {v.project_number}</p>
                  <p className="text-xs text-muted-foreground">
                    Historical {v.structural_geometry_type?.replace(/_/g, ' ')} actuals ran {Math.abs(v.overall_variance_pct).toFixed(0)}% {v.overall_variance_pct > 0 ? 'over' : 'under'} bid.
                    Suggested multiplier: <strong className="text-red-500">{v.adjuster_suggestion_pct > 0 ? '+' : ''}{v.adjuster_suggestion_pct}%</strong>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* EVA Station Variances */}
      <div className="steel-card p-5 mb-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Estimated vs. Actual Hours by Shop Station</h3>
        {stationVariances.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            No completed-project variance data yet. When projects complete in PM, EVA pairs will appear here.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stationVariances}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="station" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} formatter={v => `${v.toFixed(1)}%`} />
              <Bar dataKey="avgVariance" name="Avg Variance %" radius={[4, 4, 0, 0]}>
                {stationVariances.map((entry, i) => (
                  <Cell key={i} fill={entry.avgVariance > 15 ? '#ef4444' : entry.avgVariance > 5 ? '#f97316' : '#22c55e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Win/Loss Post-Mortem Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Win Rate by GC */}
        <div className="steel-card p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2"><Target className="w-4 h-4 text-blue-500" />Win Rate by General Contractor</h3>
          {winRateByGC.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No decided bids yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={winRateByGC} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={80} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} formatter={v => `${v}%`} />
                <Bar dataKey="winRate" name="Win Rate" fill="#1d7ed8" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Win Rate by Geometry Type */}
        <div className="steel-card p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2"><Factory className="w-4 h-4 text-purple-500" />Bid Volume by Geometry Type</h3>
          {winRateByGeo.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No decided bids yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={winRateByGeo} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, winRate }) => `${name}: ${winRate}%`} labelLine={false}>
                  {winRateByGeo.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Win Rate by Margin Bracket */}
      <div className="steel-card p-5 mb-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Percent className="w-4 h-4 text-green-500" />Win Rate by Margin Markup — Identify Your Sweet Spot</h3>
        {winRateByMargin.every(d => d.count === 0) ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No margin data on decided bids yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={winRateByMargin}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} formatter={(v, n) => n === 'winRate' ? `${v}%` : v} />
              <Bar dataKey="winRate" name="Win Rate" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="count" name="Bid Count" fill="hsl(213 94% 45% / 0.3)" radius={[4, 4, 0, 0]} />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* EVA Detail Table */}
      <div className="steel-card p-5">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><TrendingDown className="w-4 h-4 text-orange-500" />EVA Pairs — Estimated vs. Actuals</h3>
        {variances.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            No EVA pairs yet. When a project completes, the original bid is automatically paired with actuals.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-3 px-4">Bid → Project</th>
                  <th className="text-right py-3 px-4">Est. Tons</th>
                  <th className="text-right py-3 px-4">Actual Tons</th>
                  <th className="text-right py-3 px-4">Est. Hrs</th>
                  <th className="text-right py-3 px-4">Actual Hrs</th>
                  <th className="text-right py-3 px-4">Est. Mat. $</th>
                  <th className="text-right py-3 px-4">Buyout $</th>
                  <th className="text-right py-3 px-4">Overall Var.</th>
                </tr>
              </thead>
              <tbody>
                {variances.map(v => (
                  <tr key={v.id} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-3 px-4"><p className="font-medium">{v.bid_number}</p><p className="text-xs text-muted-foreground">{v.project_number}</p></td>
                    <td className="py-3 px-4 text-right font-mono">{v.estimated_tons?.toLocaleString() || '—'}</td>
                    <td className="py-3 px-4 text-right font-mono">{v.actual_tons?.toLocaleString() || '—'}</td>
                    <td className="py-3 px-4 text-right font-mono">{v.estimated_man_hours?.toLocaleString() || '—'}</td>
                    <td className="py-3 px-4 text-right font-mono">{v.actual_man_hours?.toLocaleString() || '—'}</td>
                    <td className="py-3 px-4 text-right font-mono">{v.estimated_material_cost?.toLocaleString() || '—'}</td>
                    <td className="py-3 px-4 text-right font-mono">{v.actual_buyout_cost?.toLocaleString() || '—'}</td>
                    <td className={`py-3 px-4 text-right font-mono font-bold ${(v.overall_variance_pct || 0) > 10 ? 'text-red-500' : (v.overall_variance_pct || 0) < -5 ? 'text-green-500' : 'text-yellow-500'}`}>
                      {v.overall_variance_pct ? `${v.overall_variance_pct > 0 ? '+' : ''}${v.overall_variance_pct.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}