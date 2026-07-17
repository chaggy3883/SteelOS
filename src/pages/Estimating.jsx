import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { Plus, Settings2, Calculator, TrendingUp, CheckCircle2, XCircle, Archive, ListChecks, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { cn } from '@/lib/utils';

const WIDGETS = [
  { key: 'bidList', label: 'Bid List', icon: ListChecks, description: 'Active bids table' },
  { key: 'activeCount', label: 'Active Bids', icon: Calculator, description: 'Count of in-progress bids' },
  { key: 'frontEndReview', label: 'Front End Reviews', icon: Eye, description: 'Review status dashboard' },
  { key: 'winRate', label: 'Bid Win %', icon: TrendingUp, description: 'Won / Total ratio' },
  { key: 'bidHistory', label: 'Bid History', icon: Archive, description: 'Archived & past bids' },
];

export default function Estimating() {
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [widgetConfig, setWidgetConfig] = useState({
    bidList: true, activeCount: true, frontEndReview: true, winRate: true, bidHistory: true,
  });
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('estimating_widgets');
    if (saved) setWidgetConfig(JSON.parse(saved));
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.Bid.list('-bid_due_date', 200);
      setBids(data);
    } catch (e) {} finally { setLoading(false); }
  };

  const toggleWidget = (key) => {
    const updated = { ...widgetConfig, [key]: !widgetConfig[key] };
    setWidgetConfig(updated);
    localStorage.setItem('estimating_widgets', JSON.stringify(updated));
  };

  const activeBids = bids.filter(b => ['draft', 'in_progress', 'submitted'].includes(b.status));
  const wonBids = bids.filter(b => b.status === 'won');
  const lostBids = bids.filter(b => b.status === 'lost');
  const decidedBids = wonBids.length + lostBids.length;
  const winRate = decidedBids > 0 ? (wonBids.length / decidedBids * 100) : 0;

  const frontEndStats = {
    not_started: bids.filter(b => b.front_end_review_status === 'not_started').length,
    in_review: bids.filter(b => b.front_end_review_status === 'in_review').length,
    approved: bids.filter(b => b.front_end_review_status === 'approved').length,
    flagged: bids.filter(b => b.front_end_review_status === 'flagged').length,
  };

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Estimating"
        subtitle="Bids, takeoff, and historic cost analytics"
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Button variant="outline" onClick={() => setShowConfig(s => !s)}>
                <Settings2 className="w-4 h-4 mr-2" />Widgets
              </Button>
              {showConfig && (
                <div className="absolute right-0 top-11 z-20 w-56 bg-card border border-border rounded-lg shadow-xl p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Toggle Widgets</p>
                  {WIDGETS.map(w => (
                    <button key={w.key} onClick={() => toggleWidget(w.key)}
                      className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-muted transition-colors">
                      <span className="text-sm flex items-center gap-2"><w.icon className="w-4 h-4 text-muted-foreground" />{w.label}</span>
                      {widgetConfig[w.key] ? <Eye className="w-4 h-4 text-primary" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Link to="/estimating/new">
              <Button className="steel-gradient text-white border-0"><Plus className="w-4 h-4 mr-2" />Add Bid</Button>
            </Link>
          </div>
        }
      />

      {/* Top row: count widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {widgetConfig.activeCount && (
          <div className="steel-card p-5">
            <div className="flex items-center gap-2 mb-2"><Calculator className="w-4 h-4 text-blue-500" /><p className="text-xs text-muted-foreground">Active Bids</p></div>
            <p className="text-3xl font-bold text-blue-500">{loading ? '—' : activeBids.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{bids.length} total bids in system</p>
          </div>
        )}
        {widgetConfig.winRate && (
          <div className="steel-card p-5">
            <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-green-500" /><p className="text-xs text-muted-foreground">Bid Win %</p></div>
            <p className="text-3xl font-bold text-green-500">{loading ? '—' : `${winRate.toFixed(0)}%`}</p>
            <p className="text-xs text-muted-foreground mt-1">{wonBids.length} won / {decidedBids} decided</p>
          </div>
        )}
        {widgetConfig.frontEndReview && (
          <div className="steel-card p-5">
            <div className="flex items-center gap-2 mb-2"><Eye className="w-4 h-4 text-purple-500" /><p className="text-xs text-muted-foreground">Front End Reviews</p></div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-xs flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400"></span>{frontEndStats.not_started} N/A</span>
              <span className="text-xs flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500"></span>{frontEndStats.in_review} Review</span>
              <span className="text-xs flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500"></span>{frontEndStats.approved} OK</span>
              <span className="text-xs flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"></span>{frontEndStats.flagged} Flag</span>
            </div>
          </div>
        )}
      </div>

      {/* Bid List widget */}
      {widgetConfig.bidList && (
        <div className="steel-card overflow-hidden mb-6">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold flex items-center gap-2"><ListChecks className="w-4 h-4 text-primary" />Bid List — Active</h3>
            <Link to="/estimating/new" className="text-xs text-primary hover:underline">+ New Bid</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-3 px-4">Bid #</th>
                  <th className="text-left py-3 px-4">Job</th>
                  <th className="text-left py-3 px-4">Customer</th>
                  <th className="text-left py-3 px-4">Due Date</th>
                  <th className="text-right py-3 px-4">Bid Total</th>
                  <th className="text-left py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}><td colSpan={6} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                  ))
                ) : activeBids.length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No active bids. Click "Add Bid" to create one.</td></tr>
                ) : (
                  activeBids.map(b => (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => window.location.href = `/estimating/${b.id}`}>
                      <td className="py-3 px-4 font-mono font-bold text-primary">{b.bid_number}</td>
                      <td className="py-3 px-4 font-medium">{b.job_name}</td>
                      <td className="py-3 px-4 text-muted-foreground">{b.customer_name}</td>
                      <td className="py-3 px-4 text-xs">{b.bid_due_date || '—'}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold">{b.bid_total_cost ? `$${b.bid_total_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}</td>
                      <td className="py-3 px-4"><StatusBadge status={b.status} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bid History widget */}
      {widgetConfig.bidHistory && (
        <div className="steel-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold flex items-center gap-2"><Archive className="w-4 h-4 text-muted-foreground" />Bid History — Won & Lost</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-3 px-4">Bid #</th>
                  <th className="text-left py-3 px-4">Job</th>
                  <th className="text-left py-3 px-4">GC</th>
                  <th className="text-right py-3 px-4">Quoted Price</th>
                  <th className="text-right py-3 px-4">Margin %</th>
                  <th className="text-left py-3 px-4">Result</th>
                  <th className="text-left py-3 px-4">Loss Reason</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}><td colSpan={7} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                  ))
                ) : (wonBids.length + lostBids.length) === 0 ? (
                  <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">No bid history yet.</td></tr>
                ) : (
                  [...wonBids, ...lostBids].map(b => (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => window.location.href = `/estimating/${b.id}`}>
                      <td className="py-3 px-4 font-mono font-bold text-primary">{b.bid_number}</td>
                      <td className="py-3 px-4 font-medium">{b.job_name}</td>
                      <td className="py-3 px-4 text-muted-foreground">{b.general_contractor_name || '—'}</td>
                      <td className="py-3 px-4 text-right font-mono">{b.bid_quoted_price ? `$${b.bid_quoted_price.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}</td>
                      <td className="py-3 px-4 text-right font-mono">{b.margin_percentage ? `${b.margin_percentage}%` : '—'}</td>
                      <td className="py-3 px-4">
                        {b.status === 'won'
                          ? <span className="inline-flex items-center gap-1 text-green-500 text-xs font-medium"><CheckCircle2 className="w-3.5 h-3.5" />Won</span>
                          : <span className="inline-flex items-center gap-1 text-red-500 text-xs font-medium"><XCircle className="w-3.5 h-3.5" />Lost</span>}
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        {b.loss_reason ? b.loss_reason.replace(/_/g, ' ') : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}