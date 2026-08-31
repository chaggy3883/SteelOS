import React, { useState, useEffect, useRef } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { db } from '@/api/apiClient';
import { BarChart3, TrendingUp, TrendingDown, AlertTriangle, Factory, Target, Percent, Clock3, Download } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { flagCostCodeOverruns } from '@/lib/jobCostAnalysis';
import { exportNodeToPdf } from '@/lib/exportNodeToPdf';
import { computeGeometryBreakdown } from '@/lib/estimatingAnalytics';

const COLORS = ['#1d7ed8', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#eab308', '#14b8a6'];
const STATIONS = ['saw', 'drill', 'fab', 'weld', 'paint'];

function computeLabelWidth(items, { max = 150, min = 70, charWidth = 6.5, pad = 16 } = {}) {
  const longest = items.reduce((m, d) => Math.max(m, (d.name || '').length), 0);
  const width = Math.min(max, Math.max(min, longest * charWidth + pad));
  return { width, maxChars: Math.max(4, Math.floor((width - pad) / charWidth)) };
}

function TruncatedYAxisTick({ x, y, payload, maxChars }) {
  const label = payload?.value || '';
  const display = label.length > maxChars ? `${label.slice(0, Math.max(1, maxChars - 1))}…` : label;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={10} fill="hsl(var(--muted-foreground))">
      <title>{label}</title>
      {display}
    </text>
  );
}

export default function EstimatingAnalytics() {
  useDocumentTitle('SteelOS — Historical Analytics');
  const [variances, setVariances] = useState([]);
  const [bids, setBids] = useState([]);
  const [costOverruns, setCostOverruns] = useState([]);
  const [projectNames, setProjectNames] = useState({});
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [shopHoursProjectId, setShopHoursProjectId] = useState('all');
  const shopHoursCardRef = useRef(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [varData, bidData, allJobCostRows, projectData, employeeData] = await Promise.all([
        db.entities.HistoricalVariance.list('-completed_date', 100),
        db.entities.Bid.filter({ is_archived: false }, '-created_date', 500),
        db.entities.ProjectJobCostSummary.list('-created_date', 500),
        db.entities.Project.list('-created_date', 200),
        db.entities.employees.list('full_name', 500),
      ]);
      const jobCostRows = allJobCostRows.filter((r) => !r.is_deleted);
      setVariances(varData);
      setBids(bidData);
      setProjectNames(projectData.reduce((acc, p) => ({ ...acc, [p.id]: p.name }), {}));
      setEmployees(employeeData);

      const projectIds = [...new Set(jobCostRows.map(r => r.project_id))];
      const flaggedLists = await Promise.all(projectIds.map(pid => flagCostCodeOverruns(pid)));
      setCostOverruns(flaggedLists.flat());
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
    name: gc,
    winRate: s.total > 0 ? Math.round(s.won / s.total * 100) : 0,
    total: s.total,
  })).filter(d => d.total >= 1).sort((a, b) => b.winRate - a.winRate);
  const gcLabel = computeLabelWidth(winRateByGC);

  // Win rate by Estimator
  const employeeNames = employees.reduce((acc, e) => ({ ...acc, [e.id]: e.full_name }), {});
  const estimatorStats = {};
  decided.forEach(b => {
    const estimator = b.estimator_id ? (employeeNames[b.estimator_id] || 'Unknown') : 'Unassigned';
    if (!estimatorStats[estimator]) estimatorStats[estimator] = { won: 0, lost: 0, total: 0 };
    estimatorStats[estimator].total++;
    if (b.status === 'won') estimatorStats[estimator].won++; else estimatorStats[estimator].lost++;
  });
  const winRateByEstimator = Object.entries(estimatorStats).map(([estimator, s]) => ({
    name: estimator,
    winRate: s.total > 0 ? Math.round(s.won / s.total * 100) : 0,
    total: s.total,
  })).filter(d => d.total >= 1).sort((a, b) => b.winRate - a.winRate);
  const estimatorLabel = computeLabelWidth(winRateByEstimator);

  // Win rate by geometry type
  const winRateByGeo = computeGeometryBreakdown(bids);

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

  // Estimated vs. Shop Hours — project selector for the Est. vs. Actual Hours
  // by Shop Station chart below. Options come from variances themselves (only
  // completed projects that actually have EVA data), not the full Project
  // list, so "All Projects" never offers a project with nothing to show.
  const shopHoursProjectOptions = Array.from(new Map(variances.map(v => [v.project_id, v])).values())
    .map(v => ({ id: v.project_id, label: v.project_number ? `${v.project_number} — ${projectNames[v.project_id] || v.project_id}` : (projectNames[v.project_id] || v.project_id) }));
  const shopHoursVariances = shopHoursProjectId === 'all'
    ? variances
    : variances.filter(v => v.project_id === shopHoursProjectId);
  const stationVariances = shopHoursVariances.length > 0
    ? STATIONS.map(station => {
        const totalVar = shopHoursVariances.reduce((sum, v) => sum + (v.station_variances?.[station]?.variance_pct || 0), 0);
        return { station: station.toUpperCase(), avgVariance: totalVar / shopHoursVariances.length };
      })
    : [];
  const handleExportShopHoursPdf = () => {
    const suffix = shopHoursProjectId === 'all' ? 'all-projects' : (shopHoursProjectOptions.find(p => p.id === shopHoursProjectId)?.label || shopHoursProjectId).replace(/[^a-z0-9_-]+/gi, '_');
    exportNodeToPdf(shopHoursCardRef.current, `estimated-vs-shop-hours_${suffix}.pdf`);
  };

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader title="Historic Cost Analytics" subtitle="Estimating vs. Actuals loop, win/loss post-mortem" />

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

      {/* Job Cost Overruns — closes the loop between Worksheet estimates and job-cost JTD actuals */}
      {costOverruns.length > 0 && (
        <div className="steel-card p-5 mb-6 border-red-500/20">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Clock3 className="w-4 h-4 text-red-500" />Job Cost Overruns — Est. vs. JTD Hours by Cost Code</h3>
          <div className="space-y-2">
            {costOverruns.map((o, i) => (
              <div key={`${o.project_id}-${o.cost_code}-${i}`} className="flex items-center gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                <TrendingUp className="w-4 h-4 text-red-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{projectNames[o.project_id] || o.project_id} · {o.cost_code}{o.description ? ` — ${o.description}` : ''}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.estimated_hours.toLocaleString()} Estimated Hours vs {o.jtd_hours.toLocaleString()} JTD Hours —
                    <strong className="text-red-500"> {o.overrun_pct > 0 ? '+' : ''}{o.overrun_pct.toFixed(0)}% over</strong>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
      <div className="steel-card p-5 mb-6" ref={shopHoursCardRef}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h3 className="font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Estimated vs. Actual Hours by Shop Station</h3>
          <div className="flex items-center gap-2">
            <Select value={shopHoursProjectId} onValueChange={setShopHoursProjectId}>
              <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {shopHoursProjectOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={handleExportShopHoursPdf} disabled={stationVariances.length === 0}>
              <Download className="w-3.5 h-3.5 mr-1.5" />Export to PDF
            </Button>
          </div>
        </div>
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
                <YAxis type="category" dataKey="name" tick={<TruncatedYAxisTick maxChars={gcLabel.maxChars} />} axisLine={false} tickLine={false} width={gcLabel.width} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} formatter={v => `${v}%`} />
                <Bar dataKey="winRate" name="Win Rate" fill="#1d7ed8" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Win Rate by Estimator */}
        <div className="steel-card p-5">
          <h3 className="font-semibold mb-1 flex items-center gap-2"><Target className="w-4 h-4 text-blue-500" />Win Rate by Estimator</h3>
          <p className="text-xs text-muted-foreground mb-4">Bids decided while still unassigned won't be attributed to any estimator — assign the estimator before marking a bid won or lost for accurate tracking.</p>
          {winRateByEstimator.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No decided bids yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={winRateByEstimator} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={<TruncatedYAxisTick maxChars={estimatorLabel.maxChars} />} axisLine={false} tickLine={false} width={estimatorLabel.width} />
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