import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, CheckCircle2, Lock, Unlock, ListChecks, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { hasFinanceOverrideAccess } from '@/lib/financeAccess';
import BalanceDrilldownModal from '@/components/accounting/BalanceDrilldownModal';
import VendorBillDetailModal from '@/components/accounting/VendorBillDetailModal';
import InvoiceReceivableDetailModal from '@/components/accounting/InvoiceReceivableDetailModal';

// This is a checklist/status workflow that ties together data that already
// exists elsewhere (bank reconciliation, vendor bills, AR, WIP) — it does
// NOT create journal entries, accruals, or depreciation schedules. General
// ledger bookkeeping stays in QuickBooks/Sage via the existing glExport.js;
// this is purely "did we do the things" tracking on top of that.
const CATEGORY_ORDER = ['AP', 'AR', 'Cash', 'Job Cost', 'Payroll', 'Reporting'];
const CHECKLIST_STATUSES = ['Not Started', 'In Progress', 'Complete', 'N/A'];

const STANDARD_TASKS = [
  { category: 'AP', task_name: 'Review and approve all pending vendor bills' },
  { category: 'AP', task_name: 'Confirm all vendor bills for the period are entered' },
  { category: 'AR', task_name: 'Send all progress billings for the period' },
  { category: 'AR', task_name: 'Review AR aging and follow up on overdue accounts' },
  { category: 'Cash', task_name: 'Reconcile all bank accounts for the period' },
  { category: 'Job Cost', task_name: 'Run/update the WIP schedule' },
  { category: 'Job Cost', task_name: 'Review estimated vs actual variances on active jobs' },
  { category: 'Payroll', task_name: 'Confirm labor hours are allocated to correct job numbers' },
  { category: 'Reporting', task_name: 'Export period ledger entries to QuickBooks/Sage' },
  { category: 'Reporting', task_name: 'Final review and sign-off' },
];

const currentPeriod = () => new Date().toISOString().slice(0, 7);

const formatPeriodLabel = (period) => {
  const [y, m] = String(period || '').split('-').map(Number);
  if (!y || !m) return period;
  const parsed = new Date(y, m - 1, 1); // local-time constructor, not UTC string parsing
  return parsed.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

// task_name values that link to a real report tab rather than staying a
// bare checklist string — currently only AR aging, since that's the report
// this checklist previously had nothing to point to.
const TASK_LINKS = {
  'Review AR aging and follow up on overdue accounts': { label: 'View AR Aging →', to: '/accounting?tab=araging' },
};

export default function MonthEndClosePanel() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [period, setPeriod] = useState(currentPeriod());
  const [close, setClose] = useState(null);
  const [loadingClose, setLoadingClose] = useState(true);
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenNote, setReopenNote] = useState('');
  const [showReopenInput, setShowReopenInput] = useState(false);

  const [checklistItems, setChecklistItems] = useState([]);
  const [loadingChecklist, setLoadingChecklist] = useState(false);

  const [readiness, setReadiness] = useState(null);
  const [loadingReadiness, setLoadingReadiness] = useState(false);

  // --- Drill-down targets (standing rule: every data point navigates to its
  // full underlying record). listDrilldown is a generic "here are the raw
  // rows behind this count" dialog (reusing BalanceDrilldownModal, the same
  // component Accounting.jsx uses for Customer/Vendor Balances and Aging);
  // viewingBillId/viewingInvoiceId open the same full detail modals
  // Accounting.jsx's Vendor Bills / AR Billings tabs use. ---
  const [listDrilldown, setListDrilldown] = useState(null);
  const [viewingBillId, setViewingBillId] = useState(null);
  const [viewingInvoiceId, setViewingInvoiceId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const canOverrideFinanceLock = hasFinanceOverrideAccess(currentUser?.roles || []);

  useEffect(() => { db.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null)); }, []);
  useEffect(() => { loadClose(period); }, [period]);

  const loadClose = async (p) => {
    setLoadingClose(true);
    setChecklistItems([]);
    setReadiness(null);
    setShowReopenInput(false);
    setReopenNote('');
    try {
      const rows = await db.entities.MonthEndClose.filter({ period: p }, '-created_date', 5);
      const record = rows[0] || null;
      setClose(record);
      if (record) {
        loadChecklist(record.id);
        loadReadiness(p);
      }
    } catch (e) {
      setClose(null);
    } finally {
      setLoadingClose(false);
    }
  };

  const loadChecklist = async (closeId) => {
    setLoadingChecklist(true);
    try {
      const rows = await db.entities.CloseChecklistItem.filter({ close_id: closeId }, 'sort_order', 200);
      setChecklistItems(rows);
    } catch (e) {
      setChecklistItems([]);
    } finally {
      setLoadingChecklist(false);
    }
  };

  // Informational only — never blocks starting or closing a period. Real
  // month-end work often closes with known, accepted exceptions; this is
  // just visibility into what's still open, not a gate.
  const loadReadiness = async (p) => {
    setLoadingReadiness(true);
    try {
      const accounts = await db.entities.BankAccount.filter({ is_active: true }, '-created_date', 100);
      const transactionsByAccount = await Promise.all(
        accounts.map((a) => db.entities.BankTransaction.filter({ bank_account_id: a.id }, '-transaction_date', 1000))
      );
      const unreconciledTransactions = transactionsByAccount
        .flat()
        .filter((t) => !t.reconciled && String(t.transaction_date || '').startsWith(p));

      const bills = await db.entities.VendorBill.list('-created_date', 1000);
      const pendingBills = bills.filter(
        (b) => ['Pending_Match', 'Flagged_Review'].includes(b.status) && String(b.invoice_date || '').startsWith(p)
      );

      const invoices = await db.entities.InvoiceReceivable.list('-created_date', 1000);
      // billing_period on older records isn't guaranteed to be strict
      // YYYY-MM, so this matches on substring rather than exact equality.
      const draftInvoices = invoices.filter(
        (inv) => inv.payment_status === 'Draft' && String(inv.billing_period || '').includes(p)
      );

      setReadiness({ unreconciledTransactions, pendingBills, draftInvoices });
    } catch (e) {
      setReadiness(null);
    } finally {
      setLoadingReadiness(false);
    }
  };

  // Raw-record drill-downs behind the three readiness stat boxes below —
  // each opens the same generic list dialog (BalanceDrilldownModal), with
  // bills/invoices click-through to their real detail modal. Bank
  // transactions have no dedicated detail modal in this app, so those rows
  // just list the transaction and clicking one deep-links to the account
  // reconciliation screen where it can actually be reconciled.
  const openUnreconciledDrilldown = () => {
    setListDrilldown({
      title: `Unreconciled Bank Transactions — ${formatPeriodLabel(period)}`,
      subtitle: 'Bank transactions dated in this period that are not yet marked reconciled.',
      rows: (readiness?.unreconciledTransactions || []).map((t) => ({
        id: t.id,
        label: `${t.transaction_date || '—'} — ${t.description || 'Transaction'}`,
        sublabel: t.transaction_type || '—',
        amount: t.amount,
      })),
      onRowClick: () => { setListDrilldown(null); navigate('/accounting?tab=cash'); },
    });
  };

  const openPendingBillsDrilldown = () => {
    setListDrilldown({
      title: `Vendor Bills Pending Match / Flagged — ${formatPeriodLabel(period)}`,
      subtitle: 'Vendor bills invoiced in this period still awaiting 3-way match or flagged for review.',
      rows: (readiness?.pendingBills || []).map((b) => ({
        id: b.id,
        label: `Bill ${b.invoice_number || b.id}`,
        sublabel: (b.status || '').replace(/_/g, ' '),
        amount: b.gross_amount,
        raw: b,
      })),
      onRowClick: (r) => { setListDrilldown(null); setViewingBillId(r.raw.id); },
    });
  };

  const openDraftInvoicesDrilldown = () => {
    setListDrilldown({
      title: `Draft AR Invoices — ${formatPeriodLabel(period)}`,
      subtitle: 'Progress billings for this period still sitting in Draft status.',
      rows: (readiness?.draftInvoices || []).map((inv) => ({
        id: inv.id,
        label: inv.billing_period || inv.id,
        sublabel: inv.payment_status,
        amount: inv.gross_amount,
        raw: inv,
      })),
      onRowClick: (r) => { setListDrilldown(null); setViewingInvoiceId(r.raw.id); },
    });
  };

  const handleStartClose = async () => {
    setStarting(true);
    try {
      const created = await db.entities.MonthEndClose.create({ period, status: 'In Progress' });
      await db.entities.CloseChecklistItem.bulkCreate(
        STANDARD_TASKS.map((t, i) => ({
          close_id: created.id,
          period,
          category: t.category,
          task_name: t.task_name,
          sort_order: i,
        }))
      );
      toast({ title: `Close started for ${formatPeriodLabel(period)}` });
      loadClose(period);
    } catch (e) {
      toast({ title: 'Unable to start close', variant: 'destructive' });
    } finally {
      setStarting(false);
    }
  };

  const updateChecklistLocal = (id, patch) => {
    setChecklistItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const persistChecklistField = async (item, patch) => {
    try {
      await db.entities.CloseChecklistItem.update(item.id, patch);
    } catch (e) {
      toast({ title: 'Unable to save checklist item', variant: 'destructive' });
    }
  };

  const handleStatusChange = (item, status) => {
    const patch = { status, completed_date: status === 'Complete' ? new Date().toISOString().slice(0, 10) : null };
    updateChecklistLocal(item.id, patch);
    persistChecklistField(item, patch);
  };

  const handleClosePeriod = async () => {
    if (!close) return;
    setClosing(true);
    try {
      const me = await db.auth.me();
      await db.entities.MonthEndClose.update(close.id, {
        status: 'Closed',
        closed_date: new Date().toISOString().slice(0, 10),
        closed_by: me?.full_name || '',
      });
      toast({ title: `${formatPeriodLabel(period)} closed` });
      loadClose(period);
    } catch (e) {
      toast({ title: 'Unable to close period', variant: 'destructive' });
    } finally {
      setClosing(false);
    }
  };

  const handleReopen = async () => {
    if (!close) return;
    if (!reopenNote.trim()) {
      toast({ title: 'A note explaining why is required to reopen', variant: 'destructive' });
      return;
    }
    setReopening(true);
    try {
      await db.entities.MonthEndClose.update(close.id, { status: 'In Progress', notes: reopenNote.trim() });
      toast({ title: `${formatPeriodLabel(period)} reopened` });
      setReopenNote('');
      setShowReopenInput(false);
      loadClose(period);
    } catch (e) {
      toast({ title: 'Unable to reopen period', variant: 'destructive' });
    } finally {
      setReopening(false);
    }
  };

  const itemsByCategory = CATEGORY_ORDER.map((category) => ({
    category,
    items: checklistItems.filter((i) => i.category === category),
  })).filter((group) => group.items.length > 0);

  const readinessStats = readiness
    ? [
        { label: 'Unreconciled Bank Transactions', count: readiness.unreconciledTransactions.length, onClick: openUnreconciledDrilldown },
        { label: 'Vendor Bills Pending Match / Flagged', count: readiness.pendingBills.length, onClick: openPendingBillsDrilldown },
        { label: 'Draft AR Invoices', count: readiness.draftInvoices.length, onClick: openDraftInvoicesDrilldown },
      ]
    : [];

  return (
    <div className="max-w-5xl space-y-4">
      <div className="steel-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label className="text-xs">Period</Label>
            <Input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value || currentPeriod())}
              className="mt-1 max-w-[180px]"
            />
          </div>

          {loadingClose ? (
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          ) : close ? (
            <div className="flex items-center gap-3">
              {close.status === 'Closed' ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600">
                  <Lock className="w-4 h-4" />Closed {close.closed_date ? `on ${close.closed_date}` : ''}{close.closed_by ? ` by ${close.closed_by}` : ''}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600">
                  <Unlock className="w-4 h-4" />In Progress
                </span>
              )}

              {close.status === 'Closed' ? (
                !showReopenInput ? (
                  <Button size="sm" variant="outline" onClick={() => setShowReopenInput(true)}>
                    <Unlock className="w-3.5 h-3.5 mr-1" />Reopen
                  </Button>
                ) : null
              ) : (
                <Button size="sm" onClick={handleClosePeriod} disabled={closing} className="steel-gradient text-white border-0">
                  {closing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                  Close Period
                </Button>
              )}
            </div>
          ) : (
            <Button onClick={handleStartClose} disabled={starting} className="steel-gradient text-white border-0">
              {starting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ListChecks className="w-4 h-4 mr-1" />}
              Start Close for {formatPeriodLabel(period)}
            </Button>
          )}
        </div>

        {close?.status === 'Closed' && showReopenInput && (
          <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <Label className="text-xs">Why are you reopening this period? (required)</Label>
              <Input value={reopenNote} onChange={(e) => setReopenNote(e.target.value)} className="mt-1" placeholder="e.g. Found an unposted vendor bill" />
            </div>
            <Button size="sm" variant="outline" onClick={() => { setShowReopenInput(false); setReopenNote(''); }}>Cancel</Button>
            <Button size="sm" onClick={handleReopen} disabled={reopening} className="steel-gradient text-white border-0">
              {reopening ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Confirm Reopen
            </Button>
          </div>
        )}

        {close?.status === 'In Progress' && close?.notes && (
          <p className="text-xs text-muted-foreground mt-3">Last reopen note: {close.notes}</p>
        )}
      </div>

      {close && (
        <>
          <div className="steel-card p-6">
            <h3 className="font-semibold mb-1">Close Readiness</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Informational only — these don't block starting or closing this period. Real month-end work often closes with known exceptions.
            </p>
            {loadingReadiness ? (
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {readinessStats.map((stat) => (
                  <button
                    type="button"
                    key={stat.label}
                    onClick={stat.onClick}
                    className={`text-left rounded-lg border p-3 transition-colors ${stat.count > 0 ? 'border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20' : 'border-border bg-muted/30 hover:bg-muted/50'}`}
                  >
                    <div className="flex items-center gap-1.5">
                      {stat.count > 0 && <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                    <p className={`font-mono font-bold text-lg ${stat.count > 0 ? 'text-amber-600' : ''}`}>{stat.count}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="steel-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold flex items-center gap-2"><ListChecks className="w-4 h-4 text-primary" />Close Checklist</h3>
            </div>
            {loadingChecklist ? (
              <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : (
              <div className="divide-y divide-border">
                {itemsByCategory.map(({ category, items }) => (
                  <div key={category} className="p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{category}</p>
                    <div className="space-y-3">
                      {items.map((item) => (
                        <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_160px_160px_1fr] gap-2 items-start">
                          <p className={`text-sm mt-1.5 ${item.status === 'Complete' ? 'text-muted-foreground line-through' : ''}`}>
                            {item.task_name}
                            {TASK_LINKS[item.task_name] && (
                              <button type="button" onClick={() => navigate(TASK_LINKS[item.task_name].to)} className="ml-2 inline-flex items-center gap-0.5 text-xs text-primary hover:underline align-middle">
                                {TASK_LINKS[item.task_name].label}<ArrowUpRight className="w-3 h-3" />
                              </button>
                            )}
                          </p>
                          <Select value={item.status || 'Not Started'} onValueChange={(v) => handleStatusChange(item, v)}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {CHECKLIST_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Input
                            value={item.assigned_to || ''}
                            placeholder="Assigned to"
                            onChange={(e) => updateChecklistLocal(item.id, { assigned_to: e.target.value })}
                            onBlur={(e) => persistChecklistField(item, { assigned_to: e.target.value })}
                            className="h-9"
                          />
                          <Textarea
                            value={item.notes || ''}
                            placeholder="Notes"
                            onChange={(e) => updateChecklistLocal(item.id, { notes: e.target.value })}
                            onBlur={(e) => persistChecklistField(item, { notes: e.target.value })}
                            className="min-h-9 h-9 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <BalanceDrilldownModal
        open={!!listDrilldown}
        onOpenChange={(open) => !open && setListDrilldown(null)}
        title={listDrilldown?.title}
        subtitle={listDrilldown?.subtitle}
        rows={listDrilldown?.rows || []}
        onRowClick={listDrilldown?.onRowClick}
      />

      <VendorBillDetailModal
        open={!!viewingBillId}
        onOpenChange={(open) => !open && setViewingBillId(null)}
        billId={viewingBillId}
        onViewPO={() => navigate('/accounting?tab=vendorbills')}
        currentUser={currentUser}
        canOverrideFinanceLock={canOverrideFinanceLock}
        onChanged={() => loadReadiness(period)}
      />

      <InvoiceReceivableDetailModal
        open={!!viewingInvoiceId}
        onOpenChange={(open) => !open && setViewingInvoiceId(null)}
        invoiceId={viewingInvoiceId}
        currentUser={currentUser}
        canOverrideFinanceLock={canOverrideFinanceLock}
        onChanged={() => loadReadiness(period)}
      />
    </div>
  );
}
