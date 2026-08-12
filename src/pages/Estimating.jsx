import React, { useState, useEffect, useRef } from 'react';
import { db } from '@/api/apiClient';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Settings2, Calculator, TrendingUp, CheckCircle2, XCircle, Archive, ListChecks, Eye, EyeOff, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import DNBReasonModal from '@/components/estimating/DNBReasonModal';

const BID_STATUSES = ['draft', 'in_progress', 'submitted', 'won', 'lost', 'cancelled', 'Did_Not_Bid'];

const formatDate = (d) => d ? new Date(d).toLocaleDateString() : null;

const WIDGETS = [
  { key: 'bidList', label: 'Bid List', icon: ListChecks, description: 'Active bids table' },
  { key: 'activeCount', label: 'Active Bids', icon: Calculator, description: 'Count of in-progress bids' },
  { key: 'frontEndReview', label: 'Front End Reviews', icon: Eye, description: 'Review status dashboard' },
  { key: 'winRate', label: 'Bid Win %', icon: TrendingUp, description: 'Won / Total ratio' },
  { key: 'bidHistory', label: 'Bid History', icon: Archive, description: 'Archived & past bids' },
];

export default function Estimating() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const bidListRef = useRef(null);
  const bidHistoryRef = useRef(null);
  const [bids, setBids] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [widgetConfig, setWidgetConfig] = useState({
    bidList: true, activeCount: true, frontEndReview: true, winRate: true, bidHistory: true,
  });
  const [showConfig, setShowConfig] = useState(false);
  const [editingBid, setEditingBid] = useState(null);
  const [editForm, setEditForm] = useState({ job_name: '', customer_name: '', bid_due_date: '', status: 'draft', tags: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [showDnbModal, setShowDnbModal] = useState(false);
  const [statusBid, setStatusBid] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem('estimating_widgets');
    if (saved) setWidgetConfig(JSON.parse(saved));
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [data, employeeList] = await Promise.all([
        db.entities.Bid.list('-bid_due_date', 200),
        db.entities.employees.list('full_name', 500),
      ]);
      setBids(data);
      setEmployees(employeeList);
    } catch (e) {} finally { setLoading(false); }
  };

  const estimatorName = (id) => employees.find(e => e.id === id)?.full_name || 'Unassigned';

  const goToCompany = (companyId, e) => {
    e?.stopPropagation();
    if (companyId) navigate(`/crm?customer=${companyId}`);
  };

  const goToBidFinancials = (bidId, e) => {
    e?.stopPropagation();
    navigate(`/estimating/${bidId}`, { state: { tab: 'fulltakeoff' } });
  };

  const scrollToRef = (ref) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const startEditBid = (bid) => {
    setEditingBid(bid);
    setEditForm({
      job_name: bid.job_name || '',
      customer_name: bid.customer_name || '',
      bid_due_date: bid.bid_due_date || '',
      status: bid.status || 'draft',
      tags: Array.isArray(bid.tags) ? bid.tags.join(', ') : '',
    });
  };

  const handleSaveBidEdit = async () => {
    if (!editForm.job_name || !editForm.customer_name) {
      toast({ title: 'Job Name and Customer are required', variant: 'destructive' });
      return;
    }
    setSavingEdit(true);
    try {
      await db.entities.Bid.update(editingBid.id, {
        job_name: editForm.job_name,
        customer_name: editForm.customer_name,
        bid_due_date: editForm.bid_due_date || null,
        status: editForm.status,
        tags: editForm.tags.split(',').map(t => t.trim()).filter(Boolean),
      });
      toast({ title: 'Bid updated' });
      setEditingBid(null);
      loadData();
    } catch (e) {
      toast({ title: 'Unable to update bid', variant: 'destructive' });
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleWidget = (key) => {
    const updated = { ...widgetConfig, [key]: !widgetConfig[key] };
    setWidgetConfig(updated);
    localStorage.setItem('estimating_widgets', JSON.stringify(updated));
  };

  const activeBids = bids.filter(b => ['draft', 'in_progress', 'submitted'].includes(b.status));
  const wonBids = bids.filter(b => b.status === 'won');
  const lostBids = bids.filter(b => b.status === 'lost');
  const dnbBids = bids.filter(b => b.status === 'Did_Not_Bid');
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
          <button
            type="button"
            onClick={() => scrollToRef(bidListRef)}
            className="steel-card p-5 text-left hover:ring-1 hover:ring-primary/40 transition-shadow"
          >
            <div className="flex items-center gap-2 mb-2"><Calculator className="w-4 h-4 text-blue-500" /><p className="text-xs text-muted-foreground">Active Bids</p></div>
            <p className="text-3xl font-bold text-blue-500">{loading ? '—' : activeBids.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{bids.length} total bids in system</p>
          </button>
        )}
        {widgetConfig.winRate && (
          <button
            type="button"
            onClick={() => scrollToRef(bidHistoryRef)}
            className="steel-card p-5 text-left hover:ring-1 hover:ring-primary/40 transition-shadow"
          >
            <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-green-500" /><p className="text-xs text-muted-foreground">Bid Win %</p></div>
            <p className="text-3xl font-bold text-green-500">{loading ? '—' : `${winRate.toFixed(0)}%`}</p>
            <p className="text-xs text-muted-foreground mt-1">{wonBids.length} won / {decidedBids} decided</p>
          </button>
        )}
        {widgetConfig.frontEndReview && (
          <button
            type="button"
            onClick={() => navigate('/estimating/spec-review')}
            className="steel-card p-5 text-left hover:ring-1 hover:ring-primary/40 transition-shadow"
          >
            <div className="flex items-center gap-2 mb-2"><Eye className="w-4 h-4 text-purple-500" /><p className="text-xs text-muted-foreground">Front End Reviews</p></div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-xs flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400"></span>{frontEndStats.not_started} N/A</span>
              <span className="text-xs flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500"></span>{frontEndStats.in_review} Review</span>
              <span className="text-xs flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500"></span>{frontEndStats.approved} OK</span>
              <span className="text-xs flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"></span>{frontEndStats.flagged} Flag</span>
            </div>
          </button>
        )}
      </div>

      {/* Bid List widget */}
      {widgetConfig.bidList && (
        <div ref={bidListRef} className="steel-card overflow-hidden mb-6">
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
                  <th className="text-left py-3 px-4">Assigned To</th>
                  <th className="text-left py-3 px-4">Due Date</th>
                  <th className="text-right py-3 px-4">Bid Total</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-right py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}><td colSpan={8} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                  ))
                ) : activeBids.length === 0 ? (
                  <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">No active bids. Click "Add Bid" to create one.</td></tr>
                ) : (
                  activeBids.map(b => (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => navigate(`/estimating/${b.id}`)}>
                      <td className="py-3 px-4 font-mono font-bold text-primary">{b.bid_number}</td>
                      <td className="py-3 px-4 font-medium">{b.job_name}</td>
                      <td className="py-3 px-4">
                        {b.customer_id ? (
                          <button onClick={(e) => goToCompany(b.customer_id, e)} className="text-muted-foreground hover:text-primary hover:underline text-left">
                            {b.customer_name}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">{b.customer_name}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate('/human-resources'); }}
                          className="text-muted-foreground hover:text-primary hover:underline text-left"
                        >
                          {estimatorName(b.estimator_id)}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <button onClick={(e) => { e.stopPropagation(); navigate(`/estimating/${b.id}`); }} className="hover:text-primary hover:underline">
                          {b.bid_due_date || '—'}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button onClick={(e) => goToBidFinancials(b.id, e)} className="font-mono font-bold hover:text-primary hover:underline">
                          {b.bid_total_cost ? `$${b.bid_total_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <button onClick={(e) => { e.stopPropagation(); setStatusBid(b); }}>
                          <StatusBadge status={b.status} />
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); startEditBid(b); }}
                          className="text-muted-foreground hover:text-primary p-1 rounded"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      </td>
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
        <div ref={bidHistoryRef} className="steel-card overflow-hidden">
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
                  <th className="text-left py-3 px-4">Assigned To</th>
                  <th className="text-right py-3 px-4">Quoted Price</th>
                  <th className="text-right py-3 px-4">Margin %</th>
                  <th className="text-left py-3 px-4">Result</th>
                  <th className="text-left py-3 px-4">Loss Reason</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}><td colSpan={8} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                  ))
                ) : (wonBids.length + lostBids.length) === 0 ? (
                  <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">No bid history yet.</td></tr>
                ) : (
                  [...wonBids, ...lostBids].map(b => (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => navigate(`/estimating/${b.id}`)}>
                      <td className="py-3 px-4 font-mono font-bold text-primary">{b.bid_number}</td>
                      <td className="py-3 px-4 font-medium">{b.job_name}</td>
                      <td className="py-3 px-4">
                        {b.general_contractor_id ? (
                          <button onClick={(e) => goToCompany(b.general_contractor_id, e)} className="text-muted-foreground hover:text-primary hover:underline text-left">
                            {b.general_contractor_name || '—'}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">{b.general_contractor_name || '—'}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate('/human-resources'); }}
                          className="text-muted-foreground hover:text-primary hover:underline text-left"
                        >
                          {estimatorName(b.estimator_id)}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button onClick={(e) => goToBidFinancials(b.id, e)} className="font-mono hover:text-primary hover:underline">
                          {b.bid_quoted_price ? `$${b.bid_quoted_price.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right font-mono">{b.margin_percentage ? `${b.margin_percentage}%` : '—'}</td>
                      <td className="py-3 px-4">
                        <button onClick={(e) => { e.stopPropagation(); setStatusBid(b); }}>
                          {b.status === 'won'
                            ? <span className="inline-flex items-center gap-1 text-green-500 text-xs font-medium hover:underline"><CheckCircle2 className="w-3.5 h-3.5" />Won</span>
                            : <span className="inline-flex items-center gap-1 text-red-500 text-xs font-medium hover:underline"><XCircle className="w-3.5 h-3.5" />Lost</span>}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        <button onClick={(e) => { e.stopPropagation(); setStatusBid(b); }} className="hover:text-primary hover:underline text-left">
                          {b.loss_reason ? b.loss_reason.replace(/_/g, ' ') : '—'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Did Not Bid — pinned directly below Bid History */}
      {widgetConfig.bidHistory && (
        <div className="steel-card overflow-hidden mt-6">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold flex items-center gap-2"><XCircle className="w-4 h-4 text-muted-foreground" />Did Not Bid</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-3 px-4">Bid #</th>
                  <th className="text-left py-3 px-4">Job</th>
                  <th className="text-left py-3 px-4">Customer</th>
                  <th className="text-left py-3 px-4">Assigned To</th>
                  <th className="text-left py-3 px-4">Reason</th>
                  <th className="text-left py-3 px-4">Notes</th>
                </tr>
              </thead>
              <tbody>
                {dnbBids.length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No bids marked Did Not Bid yet.</td></tr>
                ) : (
                  dnbBids.map(b => (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => navigate(`/estimating/${b.id}`)}>
                      <td className="py-3 px-4 font-mono font-bold text-primary">{b.bid_number}</td>
                      <td className="py-3 px-4 font-medium">{b.job_name}</td>
                      <td className="py-3 px-4">
                        {b.customer_id ? (
                          <button onClick={(e) => goToCompany(b.customer_id, e)} className="text-muted-foreground hover:text-primary hover:underline text-left">
                            {b.customer_name}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">{b.customer_name}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate('/human-resources'); }}
                          className="text-muted-foreground hover:text-primary hover:underline text-left"
                        >
                          {estimatorName(b.estimator_id)}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <button onClick={(e) => { e.stopPropagation(); setStatusBid(b); }} className="hover:text-primary hover:underline text-left">
                          {b.dnb_reason ? b.dnb_reason.replace(/_/g, ' ') : '—'}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">{b.dnb_reason_notes || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DNBReasonModal
        open={showDnbModal}
        onOpenChange={setShowDnbModal}
        bidId={editingBid?.id}
        bidLabel={editingBid?.job_name}
        onSaved={() => { setEditingBid(null); loadData(); }}
      />

      <Dialog open={!!editingBid} onOpenChange={(open) => !open && setEditingBid(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Bid {editingBid?.bid_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Job Name</Label>
              <Input value={editForm.job_name} onChange={(e) => setEditForm(f => ({ ...f, job_name: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Customer</Label>
              <Input value={editForm.customer_name} onChange={(e) => setEditForm(f => ({ ...f, customer_name: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Bid Due Date</Label>
              <Input type="date" value={editForm.bid_due_date} onChange={(e) => setEditForm(f => ({ ...f, bid_due_date: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(v) => {
                  if (v === 'Did_Not_Bid') {
                    setShowDnbModal(true);
                    return;
                  }
                  setEditForm(f => ({ ...f, status: v }));
                }}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BID_STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tags</Label>
              <Input value={editForm.tags} onChange={(e) => setEditForm(f => ({ ...f, tags: e.target.value }))} className="mt-1" placeholder="comma, separated, tags" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingBid(null)}>Cancel</Button>
            <Button onClick={handleSaveBidEdit} disabled={savingEdit} className="steel-gradient text-white border-0">
              {savingEdit ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!statusBid} onOpenChange={(open) => !open && setStatusBid(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bid Status — {statusBid?.bid_number}</DialogTitle>
          </DialogHeader>
          {statusBid && (() => {
            const rows = [
              ['Status', statusBid.status.replace(/_/g, ' ')],
              ['Created', formatDate(statusBid.created_date)],
              ['Bid Due Date', formatDate(statusBid.bid_due_date)],
              ['Front End Review', statusBid.front_end_review_status?.replace(/_/g, ' ')],
              ...(statusBid.status === 'lost' ? [
                ['Loss Reason', statusBid.loss_reason?.replace(/_/g, ' ')],
                ['Loss Notes', statusBid.loss_reason_notes],
                ['Competitor', statusBid.competitor_name],
              ] : []),
              ...(statusBid.status === 'Did_Not_Bid' ? [
                ['DNB Reason', statusBid.dnb_reason?.replace(/_/g, ' ')],
                ['DNB Notes', statusBid.dnb_reason_notes],
              ] : []),
              ['Notes', statusBid.notes],
            ];
            return (
              <div className="space-y-2">
                {rows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-3 gap-2 text-sm border-b border-border/50 pb-2">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="col-span-2 font-medium whitespace-pre-wrap break-words">{value || '—'}</span>
                  </div>
                ))}
                {statusBid.status === 'won' && statusBid.won_project_id && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => { const id = statusBid.won_project_id; setStatusBid(null); navigate(`/projects/${id}`); }}
                  >
                    View Won Project
                  </Button>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusBid(null)}>Close</Button>
            <Button
              className="steel-gradient text-white border-0"
              onClick={() => { const id = statusBid.id; setStatusBid(null); navigate(`/estimating/${id}`); }}
            >
              View Full Bid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}