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
import { Loader2, CheckCircle2, XCircle, DollarSign } from 'lucide-react';
import { PAYMENT_METHODS, appliedTotalFromList, outstandingFor, recordPayment, round2, todayISO } from '@/lib/paymentEngine';
import { memoTotalFromList, issueMemo } from '@/lib/memoEngine';
import { isPeriodLocked, periodLockedMessage } from '@/lib/periodLock';
import { logFinancialOverride } from '@/lib/financialAudit';
import { useToast } from '@/components/ui/use-toast';

// Read-only "full record" view for a Vendor Bill — the drill-down target for
// its invoice #, vendor, amount, variance, status, and waiver cells. Shows
// the JobCostLedgerEntry rows actually linked via source_id (honest empty
// state if none are linked — this codebase doesn't guarantee every bill
// posts a matching ledger entry), plus the Payment history behind it and a
// Record Payment action (closes the "VendorBill has no paid status" gap —
// see paymentEngine.js).
export default function VendorBillDetailModal({ open, onOpenChange, billId, onViewPO, currentUser, canOverrideFinanceLock, onChanged }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [bill, setBill] = useState(null);
  const [vendor, setVendor] = useState(null);
  const [po, setPo] = useState(null);
  const [project, setProject] = useState(null);
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [payments, setPayments] = useState([]);
  const [memos, setMemos] = useState([]);

  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const [lockedReason, setLockedReason] = useState(null); // null = not locked, '' or text = reason input shown
  const [showIssueMemo, setShowIssueMemo] = useState(false);
  const [memoForm, setMemoForm] = useState(null);
  const [savingMemo, setSavingMemo] = useState(false);
  const identity = currentUser?.full_name || currentUser?.email || 'Unknown';

  const load = async () => {
    if (!billId) return;
    setLoading(true);
    try {
      const billRecord = await db.entities.VendorBill.get(billId);
      if (!billRecord) return;
      const [vendorRecord, poRecord, projectRecord, ledgerRows, paymentRows, memoRows] = await Promise.all([
        billRecord.vendor_id ? db.entities.Vendor.get(billRecord.vendor_id).catch(() => null) : Promise.resolve(null),
        billRecord.po_id ? db.entities.purchase_orders.get(billRecord.po_id).catch(() => null) : Promise.resolve(null),
        billRecord.project_id ? db.entities.Project.get(billRecord.project_id).catch(() => null) : Promise.resolve(null),
        db.entities.JobCostLedgerEntry.filter({ source_id: billId }, '-transaction_date', 100).catch(() => []),
        db.entities.Payment.filter({ related_entity_type: 'VendorBill', related_entity_id: billId }, '-payment_date', 200).catch(() => []),
        db.entities.Memo.filter({ related_entity_type: 'VendorBill', related_entity_id: billId }, '-issued_date', 200).catch(() => []),
      ]);
      setBill(billRecord);
      setVendor(vendorRecord);
      setPo(poRecord);
      setProject(projectRecord);
      setLedgerEntries(ledgerRows);
      setPayments(paymentRows);
      setMemos(memoRows);
      return billRecord;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !billId) return;
    let cancelled = false;
    setBill(null); setVendor(null); setPo(null); setProject(null); setLedgerEntries([]); setPayments([]); setMemos([]);
    setShowRecordPayment(false); setLockedReason(null); setShowIssueMemo(false);
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, billId]);

  const ledgerTotal = ledgerEntries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const appliedTotal = bill ? appliedTotalFromList(payments, 'VendorBill', bill.id) : 0;
  const memoTotal = bill ? memoTotalFromList(memos, 'VendorBill', bill.id) : 0;
  const outstanding = bill ? outstandingFor(bill.gross_amount, appliedTotal + memoTotal) : 0;

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
        type: 'vendor_debit', relatedEntityType: 'VendorBill', relatedEntityId: bill.id,
        amount: memoForm.amount, reason: memoForm.reason, issuedDate: memoForm.issued_date, createdBy: identity,
      });
      toast({ title: 'Debit memo issued' });
      setShowIssueMemo(false);
      setMemoForm(null);
      await load();
      onChanged?.();
    } catch (e) {
      toast({ title: 'Unable to issue debit memo', variant: 'destructive' });
    } finally {
      setSavingMemo(false);
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
      const payment = await recordPayment({
        direction: 'payable',
        relatedEntityType: 'VendorBill',
        relatedEntityId: bill.id,
        amount: paymentForm.amount,
        paymentDate: paymentForm.payment_date,
        paymentMethod: paymentForm.payment_method,
        referenceNumber: paymentForm.reference_number,
        notes: paymentForm.notes,
        createdBy: identity,
        owedAmount: outstanding,
      });

      if (locked) {
        await logFinancialOverride({
          entityType: 'VendorBill', entityId: bill.id, action: 'update',
          reason: `Closed-period override — payment recorded: ${lockedReason.trim()}`, changedBy: currentUser,
        });
      }

      const newAppliedTotal = round2(appliedTotal + memoTotal + (Number(payment.applied_amount) || 0));
      if (newAppliedTotal >= Number(bill.gross_amount) - 0.01 && bill.status === 'Approved') {
        await db.entities.VendorBill.update(bill.id, { status: 'Paid' });
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
        ) : !bill ? (
          <div className="py-10 text-center">
            <p className="text-sm text-destructive">Could not load this vendor bill.</p>
            <div className="flex justify-center mt-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span>Invoice {bill.invoice_number || bill.id}</span>
                <StatusBadge status={bill.status} />
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Vendor</p>
                {vendor ? (
                  <button className="font-medium text-primary hover:underline" onClick={() => navigate(`/crm/directory?vendor=${vendor.id}`)}>{vendor.name}</button>
                ) : <p className="font-medium">—</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Project</p>
                {project ? (
                  <button className="font-medium text-primary hover:underline" onClick={() => navigate(`/projects/${project.id}`)}>{project.name}</button>
                ) : <p className="font-medium">—</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Purchase Order</p>
                {po ? (
                  <button className="font-medium text-primary hover:underline" onClick={() => onViewPO?.(po.id)}>{po.po_number}</button>
                ) : <p className="font-medium">—</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Variance</p>
                <p className="font-medium">{bill.variance_pct != null ? `${bill.variance_pct}%` : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Invoice Date</p>
                <p className="font-medium">{bill.invoice_date || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Due Date</p>
                <p className="font-medium">{bill.due_date || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Gross Amount</p>
                <p className="font-mono font-bold">${(bill.gross_amount || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Outstanding Balance</p>
                <p className={`font-mono font-bold ${outstanding > 0.01 ? 'text-amber-600' : 'text-green-600'}`}>${outstanding.toLocaleString()}</p>
              </div>
            </div>

            <div className="rounded-lg border border-border p-3 space-y-1.5 text-sm">
              <h4 className="font-semibold text-sm mb-1">Lien Waivers</h4>
              <p className="flex items-center gap-1.5">
                {bill.conditional_waiver_signed ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-muted-foreground" />}
                Conditional Waiver Signed
              </p>
              <p className="flex items-center gap-1.5">
                {bill.unconditional_waiver_received ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-muted-foreground" />}
                Unconditional Waiver Received
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm">Payment History</h4>
                <div className="flex gap-2">
                  {outstanding > 0.01 && !showIssueMemo && (
                    <Button size="sm" variant="outline" onClick={startIssueMemo}>Issue Debit Memo</Button>
                  )}
                  {bill.status === 'Approved' && outstanding > 0.01 && !showRecordPayment && (
                    <Button size="sm" onClick={startRecordPayment} className="gap-1.5 steel-gradient text-white border-0">
                      <DollarSign className="w-3.5 h-3.5" />Record Payment
                    </Button>
                  )}
                </div>
              </div>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded against this bill yet.</p>
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
                          <td className="py-2 pr-3 text-xs capitalize">{(p.payment_method || '').replace(/_/g, ' ')}</td>
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
                    <p className="text-xs text-amber-600">This exceeds the outstanding balance (${outstanding.toLocaleString()}) — the excess will be tracked as unapplied cash (see the Unapplied Cash panel under Bank &amp; Cash) rather than applied here.</p>
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
                  <p className="text-sm font-semibold">Issue Debit Memo</p>
                  <p className="text-xs text-muted-foreground">Reduces this bill's effective balance without changing its original gross_amount — the original stays as history.</p>
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
            </div>

            {memos.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2">Debit Memos</h4>
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

            <div>
              <h4 className="font-semibold text-sm mb-2">Job Cost Ledger Entries Linked to This Bill</h4>
              {ledgerEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No ledger entries are linked to this specific bill yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="py-2 pr-3">Date</th>
                        <th className="py-2 pr-3">Cost Code</th>
                        <th className="py-2 pr-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerEntries.map((e) => (
                        <tr key={e.id} className="border-b border-border/50">
                          <td className="py-2 pr-3 text-xs">{e.transaction_date || '—'}</td>
                          <td className="py-2 pr-3 font-mono">{e.cost_code}</td>
                          <td className="py-2 pr-3 text-right font-mono">${(e.amount || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2} className="py-2 pr-3 text-right font-semibold">Total</td>
                        <td className="py-2 pr-3 text-right font-mono font-bold">${ledgerTotal.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {bill && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
