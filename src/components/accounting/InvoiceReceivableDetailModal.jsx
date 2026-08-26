import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import StatusBadge from '@/components/ui/StatusBadge';
import { Loader2, DollarSign } from 'lucide-react';
import { PAYMENT_METHODS, appliedTotalFromList, outstandingFor, recordPayment, recordInvoiceReceivablePayment, todayISO } from '@/lib/paymentEngine';
import { memoTotalFromList, issueMemo } from '@/lib/memoEngine';
import { isPeriodLocked, periodLockedMessage } from '@/lib/periodLock';
import { logFinancialOverride } from '@/lib/financialAudit';
import { useToast } from '@/components/ui/use-toast';

// Read-only detail view for a progress billing (InvoiceReceivable) — the
// drill-down target for billing period, amounts, and status cells. There's
// no direct FK from an AIA billing to specific SOV lines in this data model,
// so this shows the project's current Schedule of Values as the composing
// context rather than fabricating a period-specific link. Also the home for
// Payment history + the "Record Payment" action (see paymentEngine.js),
// which supersedes the manual payment_status dropdown flip going forward
// without removing it — see the release logic below.
export default function InvoiceReceivableDetailModal({ open, onOpenChange, invoiceId, currentUser, canOverrideFinanceLock, onChanged }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [project, setProject] = useState(null);
  const [sovLines, setSovLines] = useState([]);
  const [payments, setPayments] = useState([]);
  const [memos, setMemos] = useState([]);

  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const [lockedReason, setLockedReason] = useState(null);
  const [showIssueMemo, setShowIssueMemo] = useState(false);
  const [memoForm, setMemoForm] = useState(null);
  const [savingMemo, setSavingMemo] = useState(false);
  const [showWriteOff, setShowWriteOff] = useState(false);
  const [writeOffForm, setWriteOffForm] = useState(null);
  const [savingWriteOff, setSavingWriteOff] = useState(false);
  const [writeOffLockedReason, setWriteOffLockedReason] = useState(null);
  const identity = currentUser?.full_name || currentUser?.email || 'Unknown';

  const load = async () => {
    if (!invoiceId) return;
    setLoading(true);
    try {
      const invoiceRecord = await db.entities.InvoiceReceivable.get(invoiceId);
      if (!invoiceRecord) return;
      const [projectRecord, sovRows, paymentRows, memoRows] = await Promise.all([
        invoiceRecord.project_id ? db.entities.Project.get(invoiceRecord.project_id).catch(() => null) : Promise.resolve(null),
        invoiceRecord.project_id ? db.entities.SovLine.filter({ project_id: invoiceRecord.project_id }, '-created_date', 200).catch(() => []) : Promise.resolve([]),
        db.entities.Payment.filter({ related_entity_type: 'InvoiceReceivable', related_entity_id: invoiceId }, '-payment_date', 200).catch(() => []),
        db.entities.Memo.filter({ related_entity_type: 'InvoiceReceivable', related_entity_id: invoiceId }, '-issued_date', 200).catch(() => []),
      ]);
      setInvoice(invoiceRecord);
      setProject(projectRecord);
      setSovLines(sovRows);
      setPayments(paymentRows);
      setMemos(memoRows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !invoiceId) return;
    setInvoice(null); setProject(null); setSovLines([]); setPayments([]); setMemos([]);
    setShowRecordPayment(false); setLockedReason(null); setShowIssueMemo(false); setShowWriteOff(false); setWriteOffLockedReason(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId]);

  const sovBilledTotal = sovLines.reduce((s, l) => s + (Number(l.current_billed_amount) || 0), 0);
  const appliedTotal = invoice ? appliedTotalFromList(payments, 'InvoiceReceivable', invoice.id) : 0;
  // A credit memo permanently reduces what's owed, so it's passed through to
  // recordInvoiceReceivablePayment (memoTotal) — that's where it shrinks both
  // the outstanding balance and the "fully paid"/commission-proration base.
  const memoTotal = invoice ? memoTotalFromList(memos, 'InvoiceReceivable', invoice.id) : 0;
  const outstanding = invoice ? outstandingFor(invoice.net_billing, appliedTotal + memoTotal) : 0;
  const canRecordPayment = invoice && !['Draft', 'Released'].includes(invoice.payment_status) && outstanding > 0.01;

  const startRecordPayment = () => {
    setPaymentForm({ amount: outstanding, payment_date: todayISO(), payment_method: 'check', reference_number: '', notes: '' });
    setLockedReason(null);
    setShowRecordPayment(true);
  };

  const startIssueMemo = () => {
    setMemoForm({ amount: outstanding, reason: '', issued_date: todayISO() });
    setShowIssueMemo(true);
  };

  const handleSubmitMemo = async () => {
    if (!memoForm?.amount || Number(memoForm.amount) <= 0) {
      toast({ title: 'Enter a memo amount', variant: 'destructive' });
      return;
    }
    if (!memoForm.reason.trim()) {
      toast({ title: 'A reason is required', variant: 'destructive' });
      return;
    }
    setSavingMemo(true);
    try {
      await issueMemo({
        type: 'customer_credit', relatedEntityType: 'InvoiceReceivable', relatedEntityId: invoice.id,
        amount: memoForm.amount, reason: memoForm.reason, issuedDate: memoForm.issued_date, createdBy: identity,
      });
      toast({ title: 'Credit memo issued' });
      setShowIssueMemo(false);
      setMemoForm(null);
      await load();
      onChanged?.();
    } catch (e) {
      toast({ title: 'Unable to issue credit memo', variant: 'destructive' });
    } finally {
      setSavingMemo(false);
    }
  };

  const startWriteOff = () => {
    setWriteOffForm({ amount: outstanding, write_off_date: todayISO(), reason: '' });
    setWriteOffLockedReason(null);
    setShowWriteOff(true);
  };

  // Stage 8 — a write-off is a Payment row (is_write_off) rather than a
  // separate entity, so it shows in payment history and zeroes the balance
  // everywhere appliedTotalFromList is used (aging/balances/statements), but
  // is EXCLUDED from cashAppliedTotalFromList — it never flips payment_status
  // to Released and never triggers commission (no real cash moved). Gated on
  // canOverrideFinanceLock (Admin/Controller/Super Admin) same as the
  // closed-period override, plus a mandatory reason logged via
  // logFinancialOverride as its own reason-bearing gate point.
  const handleSubmitWriteOff = async () => {
    if (!writeOffForm?.amount || Number(writeOffForm.amount) <= 0) {
      toast({ title: 'Enter a write-off amount', variant: 'destructive' });
      return;
    }
    if (!writeOffForm.reason.trim()) {
      toast({ title: 'A reason is required to write off a balance', variant: 'destructive' });
      return;
    }
    const locked = await isPeriodLocked(writeOffForm.write_off_date);
    if (locked && writeOffLockedReason === null) {
      setWriteOffLockedReason('');
      return;
    }
    if (locked && !writeOffLockedReason.trim()) {
      toast({ title: 'A reason is required to write off a balance in a closed period', variant: 'destructive' });
      return;
    }

    setSavingWriteOff(true);
    try {
      await recordPayment({
        direction: 'receivable', relatedEntityType: 'InvoiceReceivable', relatedEntityId: invoice.id,
        amount: writeOffForm.amount, paymentDate: writeOffForm.write_off_date, paymentMethod: 'other',
        notes: writeOffForm.reason.trim(), createdBy: identity, owedAmount: outstanding, isWriteOff: true,
      });
      await logFinancialOverride({
        entityType: 'InvoiceReceivable', entityId: invoice.id, action: 'update',
        reason: `Write-off: ${writeOffForm.reason.trim()}`, changedBy: currentUser,
      });
      if (locked) {
        await logFinancialOverride({
          entityType: 'InvoiceReceivable', entityId: invoice.id, action: 'update',
          reason: `Closed-period override — write-off: ${writeOffLockedReason.trim()}`, changedBy: currentUser,
        });
      }
      toast({ title: 'Balance written off' });
      setShowWriteOff(false);
      setWriteOffForm(null);
      setWriteOffLockedReason(null);
      await load();
      onChanged?.();
    } catch (e) {
      toast({ title: 'Unable to write off balance', variant: 'destructive' });
    } finally {
      setSavingWriteOff(false);
    }
  };

  const handleSubmitPayment = async () => {
    if (!paymentForm?.amount || Number(paymentForm.amount) <= 0) {
      toast({ title: 'Enter a payment amount', variant: 'destructive' });
      return;
    }
    const locked = await isPeriodLocked(paymentForm.payment_date);
    if (locked && lockedReason === null) {
      if (!canOverrideFinanceLock) {
        toast({ title: periodLockedMessage(paymentForm.payment_date), variant: 'destructive' });
        return;
      }
      setLockedReason('');
      return;
    }
    if (locked && !lockedReason.trim()) {
      toast({ title: 'A reason is required to record a payment in a closed period', variant: 'destructive' });
      return;
    }

    setSavingPayment(true);
    try {
      // Release + commission trigger live in paymentEngine.js's
      // recordInvoiceReceivablePayment — shared with IncomingAchPanel's
      // ACH-to-invoice assignment (Stage 10) so both paths that can complete
      // an invoice use the exact same wasReleased/isNowReleased guard rather
      // than drifting copies of it.
      const { isNowReleased, commissionPayment, commissionError } = await recordInvoiceReceivablePayment({
        invoice,
        amount: paymentForm.amount,
        paymentDate: paymentForm.payment_date,
        paymentMethod: paymentForm.payment_method,
        referenceNumber: paymentForm.reference_number,
        notes: paymentForm.notes,
        createdBy: identity,
        existingPayments: payments,
        memoTotal,
      });

      if (locked) {
        await logFinancialOverride({
          entityType: 'InvoiceReceivable', entityId: invoice.id, action: 'update',
          reason: `Closed-period override — payment recorded: ${lockedReason.trim()}`, changedBy: currentUser,
        });
      }

      if (isNowReleased) {
        if (commissionPayment) {
          toast({ title: `Commission triggered: $${commissionPayment.commission_for_this_payment.toLocaleString(undefined, { minimumFractionDigits: 2 })} to be paid in next payroll cycle` });
        } else if (commissionError) {
          toast({ title: 'Payment recorded, but commission could not be calculated', variant: 'destructive' });
        }
      }

      toast({ title: 'Payment recorded' });
      setShowRecordPayment(false);
      setPaymentForm(null);
      setLockedReason(null);
      await load();
      onChanged?.();
    } catch (e) {
      toast({ title: 'Unable to record payment', variant: 'destructive' });
    } finally {
      setSavingPayment(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !invoice ? (
          <div className="py-10 text-center">
            <p className="text-sm text-destructive">Could not load this progress billing.</p>
            <div className="flex justify-center mt-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span>Progress Billing — {invoice.billing_period}</span>
                <StatusBadge status={invoice.payment_status} />
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Project</p>
                {project ? (
                  <button className="font-medium text-primary hover:underline" onClick={() => navigate(`/projects/${project.id}`)}>{project.name}</button>
                ) : <p className="font-medium">—</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Expected Payment Date</p>
                <p className="font-medium">{invoice.expected_payment_date || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Gross Amount</p>
                <p className="font-mono font-bold">${(invoice.gross_amount || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Retainage Held</p>
                <p className="font-mono font-bold">${(invoice.retainage_held || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Net Billing</p>
                <p className="font-mono font-bold">${(invoice.net_billing || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Outstanding Balance</p>
                <p className={`font-mono font-bold ${outstanding > 0.01 ? 'text-amber-600' : 'text-green-600'}`}>${outstanding.toLocaleString()}</p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm">Payment History</h4>
                <div className="flex gap-2">
                  {canOverrideFinanceLock && invoice.payment_status !== 'Released' && outstanding > 0.01 && !showWriteOff && (
                    <Button size="sm" variant="outline" className="text-red-600 border-red-500/30 hover:bg-red-500/10" onClick={startWriteOff}>Write Off</Button>
                  )}
                  {invoice.payment_status !== 'Released' && outstanding > 0.01 && !showIssueMemo && (
                    <Button size="sm" variant="outline" onClick={startIssueMemo}>Issue Credit Memo</Button>
                  )}
                  {canRecordPayment && !showRecordPayment && (
                    <Button size="sm" onClick={startRecordPayment} className="gap-1.5 steel-gradient text-white border-0">
                      <DollarSign className="w-3.5 h-3.5" />Record Payment
                    </Button>
                  )}
                </div>
              </div>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded against this invoice yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="py-2 pr-3">Date</th>
                        <th className="py-2 pr-3">Method</th>
                        <th className="py-2 pr-3">Reference</th>
                        <th className="py-2 pr-3 text-right">Amount</th>
                        <th className="py-2 pr-3">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} className="border-b border-border/50">
                          <td className="py-2 pr-3 text-xs">{p.payment_date || '—'}</td>
                          <td className="py-2 pr-3 text-xs capitalize">{p.is_write_off ? 'Write-Off' : (p.payment_method || '').replace(/_/g, ' ')}</td>
                          <td className="py-2 pr-3 text-xs">{p.reference_number || '—'}</td>
                          <td className="py-2 pr-3 text-right font-mono">${(p.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{p.created_by || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3} className="py-2 pr-3 text-right font-semibold">Total Applied</td>
                        <td className="py-2 pr-3 text-right font-mono font-bold">${appliedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {showRecordPayment && paymentForm && (
                <div className="mt-3 rounded-lg border border-border p-4 space-y-3">
                  <p className="text-sm font-semibold">Record Payment</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Amount ($)</Label>
                      <Input type="number" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Payment Date</Label>
                      <Input type="date" value={paymentForm.payment_date} onChange={(e) => setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Method</Label>
                      <Select value={paymentForm.payment_method} onValueChange={(v) => setPaymentForm((f) => ({ ...f, payment_method: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Reference # (check/ACH/wire)</Label>
                      <Input value={paymentForm.reference_number} onChange={(e) => setPaymentForm((f) => ({ ...f, reference_number: e.target.value }))} className="mt-1" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Textarea value={paymentForm.notes} onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1" rows={2} />
                  </div>
                  {Number(paymentForm.amount) > outstanding && (
                    <p className="text-xs text-amber-600">This exceeds the outstanding balance (${outstanding.toLocaleString()}) — the excess will be tracked as unapplied cash rather than applied here.</p>
                  )}
                  {lockedReason !== null && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                      <p className="text-xs text-amber-700 mb-2">{periodLockedMessage(paymentForm.payment_date)} Enter a reason to override and continue.</p>
                      <Textarea value={lockedReason} onChange={(e) => setLockedReason(e.target.value)} className="text-xs" rows={2} placeholder="Reason for closed-period override" />
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setShowRecordPayment(false); setPaymentForm(null); setLockedReason(null); }}>Cancel</Button>
                    <Button size="sm" onClick={handleSubmitPayment} disabled={savingPayment} className="steel-gradient text-white border-0">
                      {savingPayment ? 'Saving…' : lockedReason !== null ? 'Confirm & Save Payment' : 'Save Payment'}
                    </Button>
                  </div>
                </div>
              )}

              {showIssueMemo && memoForm && (
                <div className="mt-3 rounded-lg border border-border p-4 space-y-3">
                  <p className="text-sm font-semibold">Issue Credit Memo</p>
                  <p className="text-xs text-muted-foreground">Reduces this invoice's effective balance without changing its original gross_amount/net_billing — the original stays as history.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Amount ($)</Label>
                      <Input type="number" step="0.01" value={memoForm.amount} onChange={(e) => setMemoForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Issued Date</Label>
                      <Input type="date" value={memoForm.issued_date} onChange={(e) => setMemoForm((f) => ({ ...f, issued_date: e.target.value }))} className="mt-1" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Reason (required)</Label>
                    <Textarea value={memoForm.reason} onChange={(e) => setMemoForm((f) => ({ ...f, reason: e.target.value }))} className="mt-1" rows={2} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setShowIssueMemo(false); setMemoForm(null); }}>Cancel</Button>
                    <Button size="sm" onClick={handleSubmitMemo} disabled={savingMemo} className="steel-gradient text-white border-0">{savingMemo ? 'Saving…' : 'Issue Memo'}</Button>
                  </div>
                </div>
              )}

              {showWriteOff && writeOffForm && (
                <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
                  <p className="text-sm font-semibold text-red-700">Write Off Balance</p>
                  <p className="text-xs text-muted-foreground">Zeroes this amount out of the customer's balance/aging without real cash — never triggers commission. Requires Admin/Controller/Super Admin and a reason.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Amount ($)</Label>
                      <Input type="number" step="0.01" value={writeOffForm.amount} onChange={(e) => setWriteOffForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Write-Off Date</Label>
                      <Input type="date" value={writeOffForm.write_off_date} onChange={(e) => setWriteOffForm((f) => ({ ...f, write_off_date: e.target.value }))} className="mt-1" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Reason (required)</Label>
                    <Textarea value={writeOffForm.reason} onChange={(e) => setWriteOffForm((f) => ({ ...f, reason: e.target.value }))} className="mt-1" rows={2} />
                  </div>
                  {writeOffLockedReason !== null && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                      <p className="text-xs text-amber-700 mb-2">{periodLockedMessage(writeOffForm.write_off_date)} Enter a reason to override and continue.</p>
                      <Textarea value={writeOffLockedReason} onChange={(e) => setWriteOffLockedReason(e.target.value)} className="text-xs" rows={2} placeholder="Reason for closed-period override" />
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setShowWriteOff(false); setWriteOffForm(null); setWriteOffLockedReason(null); }}>Cancel</Button>
                    <Button size="sm" variant="destructive" onClick={handleSubmitWriteOff} disabled={savingWriteOff}>
                      {savingWriteOff ? 'Saving…' : writeOffLockedReason !== null ? 'Confirm & Write Off' : 'Write Off'}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {memos.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2">Credit Memos</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="py-2 pr-3">Date</th>
                        <th className="py-2 pr-3">Reason</th>
                        <th className="py-2 pr-3 text-right">Amount</th>
                        <th className="py-2 pr-3">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {memos.map((m) => (
                        <tr key={m.id} className="border-b border-border/50">
                          <td className="py-2 pr-3 text-xs">{m.issued_date || '—'}</td>
                          <td className="py-2 pr-3 text-xs">{m.reason || '—'}</td>
                          <td className="py-2 pr-3 text-right font-mono">${(m.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{m.created_by || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {invoice.billing_type === 'time_and_material' ? (
              <div>
                <h4 className="font-semibold text-sm mb-2">Time &amp; Material Breakdown</h4>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-border/50"><td className="py-2 pr-3 text-muted-foreground">Labor</td><td className="py-2 pr-3 text-right font-mono">${(invoice.tm_labor_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>
                    <tr className="border-b border-border/50"><td className="py-2 pr-3 text-muted-foreground">Materials</td><td className="py-2 pr-3 text-right font-mono">${(invoice.tm_material_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>
                    <tr className="border-b border-border/50"><td className="py-2 pr-3 text-muted-foreground">Subcontractors</td><td className="py-2 pr-3 text-right font-mono">${(invoice.tm_subcontractor_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>
                    <tr><td className="py-2 pr-3 text-muted-foreground">Markup</td><td className="py-2 pr-3 text-right font-mono">${(invoice.tm_markup_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>
                  </tbody>
                </table>
                {project && (
                  <button className="text-xs text-primary hover:underline mt-2" onClick={() => navigate(`/projects/${project.id}`, { state: { tab: 'tm-tracking' } })}>
                    View T&amp;M Tracking for this project →
                  </button>
                )}
              </div>
            ) : (
            <div>
              <h4 className="font-semibold text-sm mb-2">Schedule of Values — {project?.name || 'this project'}</h4>
              <p className="text-xs text-muted-foreground mb-2">
                Billings aren't linked to specific SOV lines in this data model — shown for reference as the composing context for this project's billed amounts.
              </p>
              {sovLines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No SOV lines on file for this project.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="py-2 pr-3">Item</th>
                        <th className="py-2 pr-3 text-right">% Complete</th>
                        <th className="py-2 pr-3 text-right">Billed to Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sovLines.map((l) => (
                        <tr key={l.id} className="border-b border-border/50">
                          <td className="py-2 pr-3">{l.item_description}</td>
                          <td className="py-2 pr-3 text-right font-mono">{l.completion_percentage || 0}%</td>
                          <td className="py-2 pr-3 text-right font-mono">${(l.current_billed_amount || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2} className="py-2 pr-3 text-right font-semibold">Total Billed to Date</td>
                        <td className="py-2 pr-3 text-right font-mono font-bold">${sovBilledTotal.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
            )}
          </>
        )}

        {invoice && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
