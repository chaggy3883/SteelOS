import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Package } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function WidgetSkeleton({ lines = 4 }) {
  return <div className="space-y-2">{Array.from({ length: lines }).map((_, i) => <div key={i} className="h-8 bg-muted rounded animate-pulse" />)}</div>;
}
function WidgetEmpty({ message }) {
  return <div className="flex items-center justify-center h-full py-6"><p className="text-xs text-muted-foreground">{message}</p></div>;
}

function BidListWidget() {
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { base44.entities.Bid.list('-created_date', 8).then(l => { setBids(l); setLoading(false); }).catch(() => setLoading(false)); }, []);
  if (loading) return <WidgetSkeleton lines={5} />;
  if (bids.length === 0) return <WidgetEmpty message="No bids yet" />;
  return <div className="space-y-1">{bids.map(b => (
    <Link key={b.id} to={`/estimating/${b.id}`} className="flex items-center justify-between p-1.5 rounded hover:bg-muted transition-colors">
      <div className="min-w-0 flex-1"><p className="text-xs font-medium truncate">{b.job_name || b.bid_number}</p><p className="text-[10px] text-muted-foreground truncate">{b.customer_name}</p></div>
      <StatusBadge status={b.status} />
    </Link>
  ))}</div>;
}

function ActiveBidsCountWidget() {
  const [count, setCount] = useState(null);
  useEffect(() => { base44.entities.Bid.filter({ status: 'in_progress' }, '-created_date', 100).then(l => setCount(l.length)).catch(() => setCount(0)); }, []);
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <p className="text-3xl font-bold text-primary">{count === null ? '—' : count}</p>
      <p className="text-xs text-muted-foreground mt-1">Active Bids</p>
    </div>
  );
}

function BidWinRateWidget() {
  const [rate, setRate] = useState(null);
  useEffect(() => {
    base44.entities.Bid.list('-created_date', 200).then(bids => {
      const won = bids.filter(b => b.status === 'won').length;
      const lost = bids.filter(b => b.status === 'lost').length;
      const total = won + lost;
      setRate(total > 0 ? Math.round((won / total) * 100) : 0);
    }).catch(() => setRate(0));
  }, []);
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="34" fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
          <circle cx="40" cy="40" r="34" fill="none" stroke="hsl(var(--primary))" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${(rate || 0) * 2.14} 214`} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold">{rate === null ? '—' : `${rate}%`}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-1">Win Rate</p>
    </div>
  );
}

function BidHistoryWidget() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    base44.entities.Bid.list('-created_date', 100).then(bids => {
      const months = {};
      bids.forEach(b => {
        const d = new Date(b.created_date || b.bid_due_date);
        const key = d.toLocaleDateString('en', { month: 'short' });
        if (!months[key]) months[key] = { month: key, Won: 0, Lost: 0, Submitted: 0 };
        if (b.status === 'won') months[key].Won++;
        if (b.status === 'lost') months[key].Lost++;
        if (b.status === 'submitted') months[key].Submitted++;
      });
      setData(Object.values(months).slice(-6));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);
  if (loading) return <WidgetSkeleton lines={3} />;
  if (data.length === 0) return <WidgetEmpty message="No bid history yet" />;
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} barSize={16}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={20} />
        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }} />
        <Bar dataKey="Won" stackId="a" fill="hsl(142 71% 45%)" />
        <Bar dataKey="Submitted" stackId="a" fill="hsl(213 94% 45%)" />
        <Bar dataKey="Lost" stackId="a" fill="hsl(0 84% 60%)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function QuickAddBidWidget() {
  const { toast } = useToast();
  const [form, setForm] = useState({ job_name: '', customer_name: '' });
  const [saving, setSaving] = useState(false);
  const handleSubmit = async () => {
    if (!form.job_name || !form.customer_name) return;
    setSaving(true);
    try {
      const existing = await base44.entities.Bid.list('-created_date', 1);
      const num = String((existing.length || 0) + 1).padStart(5, '0');
      await base44.entities.Bid.create({ ...form, bid_number: `BID-${num}`, status: 'draft' });
      toast({ title: 'Bid created' });
      setForm({ job_name: '', customer_name: '' });
    } catch (e) { toast({ title: 'Failed to create bid', variant: 'destructive' }); }
    finally { setSaving(false); }
  };
  return (
    <div className="space-y-2">
      <Input placeholder="Job name" value={form.job_name} onChange={e => setForm(f => ({ ...f, job_name: e.target.value }))} className="h-8 text-xs" />
      <Input placeholder="Customer name" value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} className="h-8 text-xs" />
      <Button onClick={handleSubmit} disabled={saving || !form.job_name || !form.customer_name} size="sm" className="w-full steel-gradient text-white border-0">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Create Bid'}
      </Button>
    </div>
  );
}

function ActiveProjectsWidget() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    base44.entities.Project.filter({ is_archived: false }, '-created_date', 10).then(p => {
      setProjects(p.filter(x => !['complete', 'cancelled'].includes(x.status)));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);
  if (loading) return <WidgetSkeleton lines={5} />;
  if (projects.length === 0) return <WidgetEmpty message="No active projects" />;
  return <div className="space-y-1">{projects.slice(0, 6).map(p => (
    <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between p-1.5 rounded hover:bg-muted transition-colors">
      <div className="min-w-0 flex-1"><p className="text-xs font-medium truncate">{p.name}</p><p className="text-[10px] text-muted-foreground">{p.project_number}</p></div>
      <StatusBadge status={p.status} />
    </Link>
  ))}</div>;
}

function ChangeOrdersWidget() {
  const [data, setData] = useState({ pending: 0, approved: 0, draft: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    base44.entities.RFI.list('-created_date', 100).then(rfis => {
      setData({
        pending: rfis.filter(r => r.status === 'submitted' || r.status === 'under_review').length,
        approved: rfis.filter(r => r.status === 'answered' || r.status === 'closed').length,
        draft: rfis.filter(r => r.status === 'draft').length,
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);
  if (loading) return <WidgetSkeleton lines={3} />;
  return (
    <div className="space-y-3">
      {[
        { label: 'Pending Approval', count: data.pending, color: 'bg-yellow-500' },
        { label: 'Approved', count: data.approved, color: 'bg-green-500' },
        { label: 'Draft', count: data.draft, color: 'bg-gray-500' },
      ].map(s => (
        <div key={s.label} className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${s.color}`} />
          <span className="text-xs flex-1">{s.label}</span>
          <span className="text-sm font-semibold">{s.count}</span>
        </div>
      ))}
    </div>
  );
}

function FabProgressWidget() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      base44.entities.Project.filter({ is_archived: false }, '-created_date', 10),
      base44.entities.PieceMark.list('-created_date', 200),
    ]).then(([projs, pieces]) => {
      const result = projs.filter(p => ['fabrication', 'erection', 'awarded', 'engineering'].includes(p.status)).slice(0, 5).map(p => {
        const projPieces = pieces.filter(pi => pi.project_id === p.id);
        const done = projPieces.filter(pi => ['fabricated', 'inspected', 'painted', 'shipped', 'erected'].includes(pi.status)).length;
        const pct = projPieces.length > 0 ? Math.round((done / projPieces.length) * 100) : 0;
        return { ...p, pct, total: projPieces.length, done };
      }).filter(p => p.total > 0);
      setProjects(result);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);
  if (loading) return <WidgetSkeleton lines={3} />;
  if (projects.length === 0) return <WidgetEmpty message="No projects in fabrication" />;
  return <div className="space-y-3">{projects.map(p => (
    <div key={p.id}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium truncate flex-1">{p.name}</p>
        <span className="text-xs text-muted-foreground ml-2">{p.pct}%</span>
      </div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${p.pct}%` }} />
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5">{p.done}/{p.total} pieces complete</p>
    </div>
  ))}</div>;
}

function ShipmentsCalendarWidget() {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    base44.entities.PieceMark.list('-created_date', 200).then(pieces => {
      const upcoming = pieces.filter(p => p.ship_date && new Date(p.ship_date) >= new Date())
        .sort((a, b) => new Date(a.ship_date) - new Date(b.ship_date))
        .slice(0, 8);
      setShipments(upcoming);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);
  if (loading) return <WidgetSkeleton lines={5} />;
  if (shipments.length === 0) return <WidgetEmpty message="No upcoming shipments" />;
  return <div className="space-y-1">{shipments.map(s => (
    <div key={s.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted transition-colors">
      <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex flex-col items-center justify-center flex-shrink-0">
        <span className="text-[9px] font-bold text-blue-500">{new Date(s.ship_date).toLocaleDateString('en', { month: 'short' })}</span>
        <span className="text-xs font-bold text-blue-500">{new Date(s.ship_date).getDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{s.piece_mark}</p>
        <p className="text-[10px] text-muted-foreground truncate">{s.description || s.assembly || ''}</p>
      </div>
      <Package className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
    </div>
  ))}</div>;
}

function InvoicedVsRemainingWidget() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    base44.entities.Project.filter({ is_archived: false }, '-created_date', 10).then(projs => {
      const result = projs.filter(p => p.contract_value > 0).slice(0, 5).map(p => {
        const invoiced = Math.round((p.contract_value || 0) * 0.6);
        return { name: p.name?.substring(0, 12), Invoiced: invoiced, Remaining: (p.contract_value || 0) - invoiced };
      });
      setData(result);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);
  if (loading) return <WidgetSkeleton lines={3} />;
  if (data.length === 0) return <WidgetEmpty message="No billing data available" />;
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} barSize={20}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={40} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }} formatter={v => `$${v.toLocaleString()}`} />
        <Bar dataKey="Invoiced" stackId="a" fill="hsl(142 71% 45%)" />
        <Bar dataKey="Remaining" stackId="a" fill="hsl(213 94% 45% / 0.4)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const WIDGET_RENDERERS = {
  bid_list: BidListWidget, active_bids_count: ActiveBidsCountWidget, bid_win_rate: BidWinRateWidget,
  bid_history: BidHistoryWidget, quick_add_bid: QuickAddBidWidget, active_projects: ActiveProjectsWidget,
  change_orders: ChangeOrdersWidget, fab_progress: FabProgressWidget, shipments_calendar: ShipmentsCalendarWidget,
  invoiced_vs_remaining: InvoicedVsRemainingWidget,
};

export default function WidgetContent({ widgetId }) {
  const Renderer = WIDGET_RENDERERS[widgetId];
  if (!Renderer) return <WidgetEmpty message="Widget not found" />;
  return <Renderer />;
}