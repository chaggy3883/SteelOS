import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Package, CalendarClock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { getBidHoldDays, getBidPricingHoldState } from '@/lib/bidPricingHold';

export const REQUISITION_APPROVAL_ROLES = ['controller', 'finance_department', 'admin', 'super_admin'];

function WidgetSkeleton({ lines = 4 }) {
  return <div className="space-y-2">{Array.from({ length: lines }).map((_, i) => <div key={i} className="h-8 bg-muted rounded animate-pulse" />)}</div>;
}
function WidgetEmpty({ message }) {
  return <div className="flex items-center justify-center h-full py-6"><p className="text-xs text-muted-foreground">{message}</p></div>;
}

function BidListWidget() {
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { db.entities.Bid.list('-created_date', 8).then(l => { setBids(l); setLoading(false); }).catch(() => setLoading(false)); }, []);
  if (loading) return <WidgetSkeleton lines={5} />;
  if (bids.length === 0) return <WidgetEmpty message="No bids yet" />;
  return <div className="space-y-1">{bids.map(b => (
    <Link key={b.id} to={`/estimating/${b.id}`} className="flex items-center justify-between p-1.5 rounded hover:bg-muted transition-colors cursor-pointer min-h-[44px]" title={`Open ${b.job_name || b.bid_number}`}>
      <div className="min-w-0 flex-1"><p className="text-xs font-medium truncate" title={b.job_name || b.bid_number}>{b.job_name || b.bid_number}</p><p className="text-[10px] text-muted-foreground truncate" title={b.customer_name}>{b.customer_name}</p></div>
      <StatusBadge status={b.status} />
    </Link>
  ))}</div>;
}

function ActiveBidsCountWidget() {
  const navigate = useNavigate();
  const [count, setCount] = useState(null);
  useEffect(() => { db.entities.Bid.filter({ status: 'in_progress' }, '-created_date', 100).then(l => setCount(l.length)).catch(() => setCount(0)); }, []);
  return (
    <button
      type="button"
      onClick={() => navigate('/estimating')}
      title="View active bids"
      className="flex flex-col items-center justify-center h-full w-full min-h-[44px] rounded cursor-pointer hover:bg-muted/50 transition-colors"
    >
      <p className="text-3xl font-bold text-primary">{count === null ? '—' : count}</p>
      <p className="text-xs text-muted-foreground mt-1">Active Bids</p>
    </button>
  );
}

function BidPricingHoldWidget() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState(null);
  useEffect(() => {
    Promise.all([getEffectiveCompany(), db.entities.Bid.list('-created_date', 500)])
      .then(([company, bids]) => {
        const holdDays = getBidHoldDays(company);
        const levels = bids.map(b => getBidPricingHoldState(b, holdDays)?.level);
        setCounts({
          warning: levels.filter(l => l === 'warning').length,
          expired: levels.filter(l => l === 'expired').length,
        });
      })
      .catch(() => setCounts({ warning: 0, expired: 0 }));
  }, []);
  if (!counts) return <WidgetSkeleton lines={2} />;
  return (
    <div className="grid grid-cols-2 gap-2 h-full">
      <button
        type="button"
        onClick={() => navigate('/estimating?pricing_hold=warning')}
        title="View bids with an expiring pricing hold"
        className="flex flex-col items-center justify-center rounded cursor-pointer hover:bg-muted/50 transition-colors min-h-[44px]"
      >
        <p className="text-2xl font-bold text-yellow-600">{counts.warning}</p>
        <p className="text-xs text-muted-foreground mt-1">Expiring Soon</p>
      </button>
      <button
        type="button"
        onClick={() => navigate('/estimating?pricing_hold=expired')}
        title="View bids with an expired pricing hold"
        className="flex flex-col items-center justify-center rounded cursor-pointer hover:bg-muted/50 transition-colors min-h-[44px]"
      >
        <p className="text-2xl font-bold text-red-600">{counts.expired}</p>
        <p className="text-xs text-muted-foreground mt-1">Pricing Expired</p>
      </button>
    </div>
  );
}

function BidWinRateWidget() {
  const navigate = useNavigate();
  const [rate, setRate] = useState(null);
  useEffect(() => {
    db.entities.Bid.list('-created_date', 200).then(bids => {
      const won = bids.filter(b => b.status === 'won').length;
      const lost = bids.filter(b => b.status === 'lost').length;
      const total = won + lost;
      setRate(total > 0 ? Math.round((won / total) * 100) : 0);
    }).catch(() => setRate(0));
  }, []);
  return (
    <button
      type="button"
      onClick={() => navigate('/estimating/analytics')}
      title="View bid win-rate analytics"
      className="flex flex-col items-center justify-center h-full w-full min-h-[44px] rounded cursor-pointer hover:bg-muted/50 transition-colors"
    >
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
    </button>
  );
}

function BidHistoryWidget() {
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    db.entities.Bid.list('-created_date', 100).then(bids => {
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
  const goToAnalytics = () => navigate('/estimating/analytics');
  return (
    <div onClick={goToAnalytics} title="View bid analytics" className="cursor-pointer rounded hover:bg-muted/30 transition-colors -m-1 p-1">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} barSize={16}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={20} />
          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }} />
          <Bar dataKey="Won" stackId="a" fill="hsl(142 71% 45%)" onClick={goToAnalytics} className="cursor-pointer" />
          <Bar dataKey="Submitted" stackId="a" fill="hsl(213 94% 45%)" onClick={goToAnalytics} className="cursor-pointer" />
          <Bar dataKey="Lost" stackId="a" fill="hsl(0 84% 60%)" radius={[4, 4, 0, 0]} onClick={goToAnalytics} className="cursor-pointer" />
        </BarChart>
      </ResponsiveContainer>
    </div>
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
      const existing = await db.entities.Bid.list('-created_date', 1);
      const num = String((existing.length || 0) + 1).padStart(5, '0');
      await db.entities.Bid.create({ ...form, bid_number: `BID-${num}`, status: 'draft' });
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
    db.entities.Project.filter({ is_archived: false }, '-created_date', 10).then(p => {
      setProjects(p.filter(x => !['complete', 'cancelled'].includes(x.status)));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);
  if (loading) return <WidgetSkeleton lines={5} />;
  if (projects.length === 0) return <WidgetEmpty message="No active projects" />;
  return <div className="space-y-1">{projects.slice(0, 6).map(p => (
    <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between p-1.5 rounded hover:bg-muted transition-colors cursor-pointer min-h-[44px]" title={`Open ${p.name}`}>
      <div className="min-w-0 flex-1"><p className="text-xs font-medium truncate" title={p.name}>{p.name}</p><p className="text-[10px] text-muted-foreground">{p.project_number}</p></div>
      <StatusBadge status={p.status} />
    </Link>
  ))}</div>;
}

function ChangeOrdersWidget() {
  const navigate = useNavigate();
  const [data, setData] = useState({ pending: 0, approved: 0, draft: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    db.entities.RFI.list('-created_date', 100).then(rfis => {
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
    <div className="space-y-1">
      {[
        { label: 'Pending Approval', count: data.pending, color: 'bg-yellow-500' },
        { label: 'Approved', count: data.approved, color: 'bg-green-500' },
        { label: 'Draft', count: data.draft, color: 'bg-gray-500' },
      ].map(s => (
        <button
          type="button"
          key={s.label}
          onClick={() => navigate('/rfis')}
          title="View RFIs"
          className="flex items-center gap-3 w-full p-1.5 min-h-[44px] rounded cursor-pointer hover:bg-muted transition-colors text-left"
        >
          <div className={`w-2 h-2 rounded-full ${s.color}`} />
          <span className="text-xs flex-1">{s.label}</span>
          <span className="text-sm font-semibold">{s.count}</span>
        </button>
      ))}
    </div>
  );
}

function FabProgressWidget() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      db.entities.Project.filter({ is_archived: false }, '-created_date', 10),
      db.entities.PieceMark.list('-created_date', 200),
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
  return <div className="space-y-2">{projects.map(p => (
    <Link key={p.id} to={`/projects/${p.id}`} className="block p-1 -m-1 rounded min-h-[44px] cursor-pointer hover:bg-muted transition-colors" title={`Open ${p.name}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium truncate flex-1" title={p.name}>{p.name}</p>
        <span className="text-xs text-muted-foreground ml-2">{p.pct}%</span>
      </div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${p.pct}%` }} />
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5">{p.done}/{p.total} pieces complete</p>
    </Link>
  ))}</div>;
}

function ShipmentsCalendarWidget() {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    db.entities.PieceMark.list('-created_date', 200).then(pieces => {
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
    <Link key={s.id} to="/shipping" className="flex items-center gap-2 p-1.5 min-h-[44px] rounded cursor-pointer hover:bg-muted transition-colors" title="Open Shipping">
      <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex flex-col items-center justify-center flex-shrink-0">
        <span className="text-[9px] font-bold text-blue-500">{new Date(s.ship_date).toLocaleDateString('en', { month: 'short' })}</span>
        <span className="text-xs font-bold text-blue-500">{new Date(s.ship_date).getDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{s.piece_mark}</p>
        <p className="text-[10px] text-muted-foreground truncate">{s.description || s.assembly || ''}</p>
      </div>
      <Package className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
    </Link>
  ))}</div>;
}

function InterviewsCalendarWidget() {
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    db.entities.calendar_events.filter({ event_type: 'Interview' }, '-created_date', 200).then((events) => {
      const upcoming = events
        .filter((e) => e.scheduled_datetime && new Date(e.scheduled_datetime) >= new Date())
        .sort((a, b) => new Date(a.scheduled_datetime) - new Date(b.scheduled_datetime))
        .slice(0, 8);
      setInterviews(upcoming);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);
  if (loading) return <WidgetSkeleton lines={5} />;
  if (interviews.length === 0) return <WidgetEmpty message="No upcoming interviews" />;
  return <div className="space-y-1">{interviews.map((i) => (
    <Link key={i.id} to="/human-resources" className="flex items-center gap-2 p-1.5 min-h-[44px] rounded cursor-pointer hover:bg-muted transition-colors" title="Open Human Resources">
      <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex flex-col items-center justify-center flex-shrink-0">
        <span className="text-[9px] font-bold text-purple-500">{new Date(i.scheduled_datetime).toLocaleDateString('en', { month: 'short' })}</span>
        <span className="text-xs font-bold text-purple-500">{new Date(i.scheduled_datetime).getDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate" title={i.candidate_name}>{i.candidate_name}</p>
        <p className="text-[10px] text-muted-foreground truncate" title={i.interviewer || 'Interviewer TBD'}>{i.interviewer || 'Interviewer TBD'}</p>
      </div>
      <CalendarClock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
    </Link>
  ))}</div>;
}

function InvoicedVsRemainingWidget() {
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    db.entities.Project.filter({ is_archived: false }, '-created_date', 10).then(projs => {
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
  const goToAccounting = () => navigate('/accounting');
  return (
    <div onClick={goToAccounting} title="View Accounting" className="cursor-pointer rounded hover:bg-muted/30 transition-colors -m-1 p-1">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} barSize={20}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={40} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }} formatter={v => `$${v.toLocaleString()}`} />
          <Bar dataKey="Invoiced" stackId="a" fill="hsl(142 71% 45%)" onClick={goToAccounting} className="cursor-pointer" />
          <Bar dataKey="Remaining" stackId="a" fill="hsl(213 94% 45% / 0.4)" radius={[4, 4, 0, 0]} onClick={goToAccounting} className="cursor-pointer" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProjectHealthSummaryWidget() {
  const [project, setProject] = useState(null);
  useEffect(() => {
    db.entities.Project.filter({ is_archived: false }, '-created_date', 1).then((projects) => setProject(projects[0] || null)).catch(() => setProject(null));
  }, []);

  if (!project) return <WidgetEmpty message="No project data yet" />;

  const progress = project.estimated_tons ? Math.min(100, Math.round(((project.fabricated_tons || 0) / project.estimated_tons) * 100)) : 0;
  return (
    <Link to={`/projects/${project.id}`} className="block space-y-3 -m-1 p-1 rounded min-h-[44px] cursor-pointer hover:bg-muted/30 transition-colors" title={`Open ${project.name}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{project.project_number}</p>
          <p className="text-sm font-semibold">{project.name}</p>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">{project.execution_status || 'Prefabrication'}</span>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>Tonnage</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </Link>
  );
}

function ChangeOrderPipelineWidget() {
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  useEffect(() => {
    db.entities.change_orders.list('-created_date', 50).then((orders) => {
      const summary = {
        Draft: orders.filter((item) => item.status === 'Draft').length,
        Submitted: orders.filter((item) => item.status === 'Submitted to GC').length,
        Approved: orders.filter((item) => item.status === 'Approved').length,
        Rejected: orders.filter((item) => item.status === 'Rejected').length,
        Void: orders.filter((item) => item.status === 'Void').length,
      };
      setData(Object.entries(summary).filter(([, value]) => value > 0).map(([name, value]) => ({ name, value })));
    }).catch(() => setData([]));
  }, []);

  if (data.length === 0) return <WidgetEmpty message="No change orders yet" />;

  const goToChangeOrders = () => navigate('/projects/change-orders');
  return (
    <div onClick={goToChangeOrders} title="View Change Orders" className="h-full cursor-pointer rounded hover:bg-muted/30 transition-colors">
      <ResponsiveContainer width="100%" height={140}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={34} outerRadius={58} paddingAngle={2} onClick={goToChangeOrders} className="cursor-pointer">
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={['#0ea5e9', '#f59e0b', '#22c55e', '#ef4444', '#64748b'][index % 5]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function ShipmentsCalendarWidgetCard() {
  const [loads, setLoads] = useState([]);
  const [carriers, setCarriers] = useState([]);
  useEffect(() => {
    Promise.all([
      db.entities.loads.list('-created_date', 8),
      db.entities.Vendor.filter({ vendor_type: 'carrier' }, 'name', 50),
    ]).then(([loadItems, carrierItems]) => { setLoads(loadItems); setCarriers(carrierItems); })
      .catch(() => { setLoads([]); setCarriers([]); });
  }, []);

  if (loads.length === 0) return <WidgetEmpty message="No shipments logged" />;

  const carrierName = (load) => load.carrier_name || carriers.find((c) => c.id === load.carrier_vendor_id)?.name || 'No carrier';

  return <div className="space-y-2">{loads.map((load) => (
    <Link key={load.id} to="/shipping" className="block rounded-lg border border-border px-2.5 py-2 text-xs min-h-[44px] cursor-pointer hover:bg-muted/50 transition-colors" title="Open Shipping">
      <div className="flex items-center justify-between">
        <span className="font-medium">{load.load_number_id}</span>
        <span className="text-muted-foreground">{load.status}</span>
      </div>
      <p className="text-muted-foreground">{carrierName(load)} • {((load.total_weight_lbs || 0) / 2000).toFixed(1)}T</p>
    </Link>
  ))}</div>;
}

function BuyoutVarianceWidget() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    db.entities.purchase_orders.list('-created_date', 10).then((items) => setOrders(items)).catch(() => setOrders([]));
  }, []);

  if (orders.length === 0) return <WidgetEmpty message="No buyout data yet" />;
  const budgeted = orders.reduce((sum, item) => sum + Number(item.budgeted_cost || 0), 0);
  const actual = orders.reduce((sum, item) => sum + Number(item.actual_cost || 0), 0);
  return (
    <button
      type="button"
      onClick={() => navigate('/purchasing/module')}
      title="View Procurement Module"
      className="space-y-3 w-full min-h-[44px] p-1 -m-1 rounded cursor-pointer hover:bg-muted/30 transition-colors text-left"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Budgeted</span>
        <span className="font-semibold">${budgeted.toLocaleString()}</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Actual</span>
        <span className="font-semibold">${actual.toLocaleString()}</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Variance</span>
        <span className="font-semibold text-primary">${(budgeted - actual).toLocaleString()}</span>
      </div>
    </button>
  );
}

function PendingRequisitionApprovalsWidget() {
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [canApprove, setCanApprove] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [rejectItem, setRejectItem] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [saving, setSaving] = useState(false);

  const loadItems = () => {
    db.entities.purchase_requisitions.list('-created_date', 10).then((result) => setItems(result.filter((item) => item.requires_signature && item.status !== 'Rejected' && item.status !== 'Auto_Approved'))).catch(() => setItems([]));
  };

  useEffect(() => {
    loadItems();
    db.auth.me()
      .then((me) => setCanApprove((me?.roles || []).some((r) => REQUISITION_APPROVAL_ROLES.includes(r))))
      .catch(() => setCanApprove(false));
  }, []);

  const handleApprove = async (item, e) => {
    e.stopPropagation();
    setSaving(true);
    try {
      const me = await db.auth.me().catch(() => null);
      await db.entities.purchase_requisitions.update(item.id, {
        status: 'Auto_Approved',
        approved_by: me?.id || me?.email || '',
        approved_date: new Date().toISOString(),
      });
      loadItems();
      toast({ title: `Requisition ${item.job_number} approved` });
    } finally {
      setSaving(false);
    }
  };

  const confirmReject = async () => {
    if (!rejectItem || rejectReason.trim().length < 5) return;
    setSaving(true);
    try {
      await db.entities.purchase_requisitions.update(rejectItem.id, {
        status: 'Rejected',
        rejection_reason: rejectReason.trim(),
      });
      loadItems();
      setRejectItem(null);
      setRejectReason('');
      toast({ title: `Requisition ${rejectItem.job_number} rejected` });
    } finally {
      setSaving(false);
    }
  };

  if (items.length === 0) return <WidgetEmpty message="No pending approvals" />;
  return (
    <>
      <div className="space-y-2">{items.map((item) => (
        <div key={item.id} onClick={() => setDetailItem(item)} className="rounded-lg border border-border px-2.5 py-2 text-xs cursor-pointer hover:bg-muted/50 transition-colors min-h-[44px]">
          <div className="flex items-center justify-between">
            <span className="font-medium">{item.job_number}</span>
            <span className="text-muted-foreground">${Number(item.requisition_total || 0).toLocaleString()}</span>
          </div>
          <p className="text-muted-foreground">{item.item_description}</p>
          {canApprove && (
            <div className="flex gap-1.5 mt-1.5">
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={saving} onClick={(e) => handleApprove(item, e)}>Approve</Button>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] border-red-500/40 text-red-600" disabled={saving} onClick={(e) => { e.stopPropagation(); setRejectItem(item); setRejectReason(''); }}>Reject</Button>
            </div>
          )}
        </div>
      ))}</div>

      <Dialog open={!!detailItem} onOpenChange={(open) => !open && setDetailItem(null)}>
        <DialogContent>
          {detailItem && (
            <>
              <DialogHeader><DialogTitle>Requisition — {detailItem.job_number}</DialogTitle></DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-xs text-muted-foreground">Job Number</p><p className="font-medium">{detailItem.job_number}</p></div>
                  <div><p className="text-xs text-muted-foreground">Requisition Total</p><p className="font-medium">${Number(detailItem.requisition_total || 0).toLocaleString()}</p></div>
                  <div><p className="text-xs text-muted-foreground">Required On-Site</p><p className="font-medium">{detailItem.required_on_site_date || '—'}</p></div>
                  <div><p className="text-xs text-muted-foreground">Urgency</p><p className="font-medium">{detailItem.urgency || '—'}</p></div>
                  <div><p className="text-xs text-muted-foreground">Status</p><p className="font-medium">{detailItem.status?.replace(/_/g, ' ')}</p></div>
                  <div><p className="text-xs text-muted-foreground">Requires Signature</p><p className="font-medium">{detailItem.requires_signature ? 'Yes' : 'No'}</p></div>
                </div>
                <div><p className="text-xs text-muted-foreground">Item Description</p><p className="font-medium">{detailItem.item_description || '—'}</p></div>
                {detailItem.approved_by && (
                  <div><p className="text-xs text-muted-foreground">Approved By</p><p className="font-medium">{detailItem.approved_by} on {detailItem.approved_date ? new Date(detailItem.approved_date).toLocaleString() : '—'}</p></div>
                )}
                {detailItem.rejection_reason && (
                  <div><p className="text-xs text-muted-foreground">Rejection Reason</p><p className="font-medium">{detailItem.rejection_reason}</p></div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailItem(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectItem} onOpenChange={(open) => { if (!open) { setRejectItem(null); setRejectReason(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Requisition — {rejectItem?.job_number}</DialogTitle></DialogHeader>
          <div>
            <Label>Rejection Reason (min 5 characters)</Label>
            <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectItem(null); setRejectReason(''); }}>Cancel</Button>
            <Button onClick={confirmReject} disabled={rejectReason.trim().length < 5 || saving} className="bg-red-600 hover:bg-red-700 text-white border-0">
              {saving ? 'Saving…' : 'Confirm Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MaterialReceivedTrackerWidget() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    db.entities.receiving_logs.list('-created_date', 10).then(setItems).catch(() => setItems([]));
  }, []);

  if (items.length === 0) return <WidgetEmpty message="No receiving activity yet" />;
  return <div className="space-y-2">{items.map((item) => (
    <Link key={item.id} to="/purchasing/receiving-kiosk" className="block rounded-lg border border-border px-2.5 py-2 text-xs min-h-[44px] cursor-pointer hover:bg-muted/50 transition-colors" title="Open Receiving Kiosk">
      <div className="flex items-center justify-between">
        <span className="font-medium">{item.po_number}</span>
        <span className={item.delivery_status === 'Partial Delivery' ? 'text-orange-500' : 'text-green-600'}>{item.delivery_status}</span>
      </div>
      <p className="text-muted-foreground">Heat {item.material_heat_number || '—'} · {item.quantity_received}/{item.quantity_ordered} received</p>
    </Link>
  ))}</div>;
}

const WIDGET_RENDERERS = {
  bid_list: BidListWidget, active_bids_count: ActiveBidsCountWidget, bid_win_rate: BidWinRateWidget,
  bid_pricing_hold: BidPricingHoldWidget,
  bid_history: BidHistoryWidget, quick_add_bid: QuickAddBidWidget, active_projects: ActiveProjectsWidget,
  change_orders: ChangeOrdersWidget, fab_progress: FabProgressWidget, shipments_calendar: ShipmentsCalendarWidget,
  interviews_calendar: InterviewsCalendarWidget,
  invoiced_vs_remaining: InvoicedVsRemainingWidget,
  project_health_summary: ProjectHealthSummaryWidget,
  change_order_pipeline: ChangeOrderPipelineWidget,
  shipments_calendar_widget: ShipmentsCalendarWidgetCard,
  buyout_variance_widget: BuyoutVarianceWidget,
  pending_requisition_approvals_widget: PendingRequisitionApprovalsWidget,
  material_received_tracker_widget: MaterialReceivedTrackerWidget,
};

export default function WidgetContent({ widgetId }) {
  const Renderer = WIDGET_RENDERERS[widgetId];
  if (!Renderer) return <WidgetEmpty message="Widget not found" />;
  return <Renderer />;
}