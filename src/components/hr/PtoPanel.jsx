import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { hasFullEmployeeAccess } from '@/lib/employeesApi';
import { PTO_TRACKED_LEAVE_TYPES, listPtoBalancesForEmployee, listPtoTransactionsForEmployee, adjustPtoBalance } from '@/lib/ptoEngine';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { CalendarClock, Wallet, History, Loader2 } from 'lucide-react';

const TRANSACTION_LABELS = {
  accrual: { label: 'Accrual', class: 'bg-green-500/10 text-green-600' },
  usage: { label: 'Usage', class: 'bg-blue-500/10 text-blue-600' },
  adjustment: { label: 'Adjustment', class: 'bg-purple-500/10 text-purple-600' },
  carryover: { label: 'Carryover', class: 'bg-teal-500/10 text-teal-600' },
  forfeiture: { label: 'Forfeiture', class: 'bg-red-500/10 text-red-600' },
  payout: { label: 'Termination Payout', class: 'bg-amber-500/10 text-amber-600' },
};

const fmtHours = (n) => `${Number(n) > 0 ? '+' : ''}${Number(n || 0).toFixed(1)}h`;
const emptyAdjustForm = () => ({ leave_type: 'PTO', hours: '', reason: '' });

// Per-employee HR view of the PTO ledger — read/write for HR & admin roles,
// opened from EmployeeProfileDialog's "PTO" tab. Employee Center's read-only
// "My PTO" view reuses listPtoBalancesForEmployee/listPtoTransactionsForEmployee
// from the same engine, it just never renders the Adjust Balance action.
export default function PtoPanel({ employee, roles = [] }) {
  const { toast } = useToast();
  const canAdjust = hasFullEmployeeAccess(roles);
  const [currentUser, setCurrentUser] = useState(null);
  const [balances, setBalances] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdjustDialog, setShowAdjustDialog] = useState(false);
  const [adjustForm, setAdjustForm] = useState(emptyAdjustForm());
  const [saving, setSaving] = useState(false);
  const [viewingTransaction, setViewingTransaction] = useState(null);
  const [viewingSourceRequest, setViewingSourceRequest] = useState(null);

  useEffect(() => {
    db.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  useEffect(() => { load(); }, [employee?.id]);

  const load = async () => {
    setLoading(true);
    try {
      const [balanceRows, txnRows] = await Promise.all([
        listPtoBalancesForEmployee(employee.id),
        listPtoTransactionsForEmployee(employee.id),
      ]);
      setBalances(balanceRows);
      setTransactions(txnRows);
    } catch (e) {
      setBalances([]);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  };

  const balanceFor = (leaveType) => balances.find((b) => b.leave_type === leaveType);

  const openAdjust = () => {
    setAdjustForm(emptyAdjustForm());
    setShowAdjustDialog(true);
  };

  const handleSaveAdjustment = async () => {
    const hours = Number(adjustForm.hours);
    if (!Number.isFinite(hours) || hours === 0) {
      toast({ title: 'Enter a non-zero number of hours', variant: 'destructive' });
      return;
    }
    if (!adjustForm.reason.trim()) {
      toast({ title: 'A reason is required to adjust a balance', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await adjustPtoBalance({
        employee,
        leaveType: adjustForm.leave_type,
        hours,
        reason: adjustForm.reason,
        changedBy: currentUser?.full_name || currentUser?.email || 'Unknown',
      });
      setShowAdjustDialog(false);
      setAdjustForm(emptyAdjustForm());
      toast({
        title: `${hours > 0 ? 'Added' : 'Subtracted'} ${Math.abs(hours)} hour${Math.abs(hours) === 1 ? '' : 's'} ${adjustForm.leave_type}`,
        description: adjustForm.reason.trim(),
      });
      load();
    } catch (e) {
      toast({ title: e.message || 'Unable to adjust balance', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const openTransaction = async (txn) => {
    setViewingTransaction(txn);
    setViewingSourceRequest(null);
    if (txn.source_type === 'time_off_request' && txn.source_id) {
      try {
        const request = await db.entities.time_off_requests.get(txn.source_id);
        setViewingSourceRequest(request);
      } catch (e) {}
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PTO_TRACKED_LEAVE_TYPES.map((leaveType) => {
          const balance = balanceFor(leaveType);
          return (
            <div key={leaveType} className="steel-card p-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{leaveType}</p>
              <p className="text-2xl font-bold font-mono">{Number(balance?.balance_hours || 0).toFixed(1)}h</p>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>Accrued YTD: {Number(balance?.accrued_ytd || 0).toFixed(1)}h</p>
                <p>Used YTD: {Number(balance?.used_ytd || 0).toFixed(1)}h</p>
                <p>Carried over: {Number(balance?.carried_over_hours || 0).toFixed(1)}h</p>
                <p>Anniversary: {balance?.anniversary_date || employee.hire_date || '—'}</p>
                <p>Next renewal: {balance?.policy_year_end || '—'}</p>
              </div>
            </div>
          );
        })}
      </div>

      {canAdjust && (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={openAdjust}>
          <Wallet className="w-3.5 h-3.5" />Adjust Balance
        </Button>
      )}

      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><History className="w-4 h-4 text-primary" />Transaction History</h4>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No PTO transactions on file yet.</p>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {transactions.map((t) => {
              const meta = TRANSACTION_LABELS[t.transaction_type] || { label: t.transaction_type, class: 'bg-gray-500/10 text-gray-600' };
              return (
                <button
                  key={t.id}
                  onClick={() => openTransaction(t)}
                  className="w-full flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm text-left hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.class}`}>{meta.label}</span>
                      <span className="text-xs text-muted-foreground">{t.leave_type}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.effective_date} • {t.reason}</p>
                  </div>
                  <span className={`font-mono text-sm font-semibold flex-shrink-0 ${t.hours < 0 ? 'text-red-600' : 'text-green-600'}`}>{fmtHours(t.hours)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {showAdjustDialog && (
        <Dialog open onOpenChange={setShowAdjustDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Adjust PTO Balance — {employee.full_name}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label className="text-xs">Leave Type</Label>
                <Select value={adjustForm.leave_type} onValueChange={(v) => setAdjustForm((f) => ({ ...f, leave_type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PTO_TRACKED_LEAVE_TYPES.map((lt) => <SelectItem key={lt} value={lt}>{lt}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Hours (positive to add, negative to remove)</Label>
                <Input type="number" step="0.1" value={adjustForm.hours} onChange={(e) => setAdjustForm((f) => ({ ...f, hours: e.target.value }))} placeholder="e.g. 8 or -4" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Reason (required)</Label>
                <Textarea value={adjustForm.reason} onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))} rows={3} placeholder="Explain why this balance is being manually adjusted…" className="mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAdjustDialog(false)}>Cancel</Button>
              <Button onClick={handleSaveAdjustment} disabled={saving} className="steel-gradient text-white border-0">
                {saving ? 'Saving…' : 'Save Adjustment'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={!!viewingTransaction} onOpenChange={(o) => !o && setViewingTransaction(null)}>
        <DialogContent>
          {viewingTransaction && (
            <>
              <DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-primary" />{TRANSACTION_LABELS[viewingTransaction.transaction_type]?.label || viewingTransaction.transaction_type} — {viewingTransaction.leave_type}</DialogTitle></DialogHeader>
              <div className="space-y-2 text-sm">
                <p><span className="text-muted-foreground">Hours: </span><span className={`font-mono font-semibold ${viewingTransaction.hours < 0 ? 'text-red-600' : 'text-green-600'}`}>{fmtHours(viewingTransaction.hours)}</span></p>
                <p><span className="text-muted-foreground">Balance after: </span><span className="font-mono">{Number(viewingTransaction.balance_after).toFixed(1)}h</span></p>
                <p><span className="text-muted-foreground">Effective date: </span>{viewingTransaction.effective_date}</p>
                <p><span className="text-muted-foreground">Reason: </span>{viewingTransaction.reason || '—'}</p>
                <p><span className="text-muted-foreground">Recorded by: </span>{viewingTransaction.created_by}</p>
                <p><span className="text-muted-foreground">Recorded at: </span>{new Date(viewingTransaction.created_at).toLocaleString()}</p>
                {viewingSourceRequest && (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Source Time Off Request</p>
                    <p>{viewingSourceRequest.leave_type} — {viewingSourceRequest.start_date} to {viewingSourceRequest.end_date} ({viewingSourceRequest.total_hours}h)</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Status: {viewingSourceRequest.status}{viewingSourceRequest.reason ? ` • ${viewingSourceRequest.reason}` : ''}</p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setViewingTransaction(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
