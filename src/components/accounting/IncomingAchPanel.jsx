import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Landmark, Plus, Loader2, AlertTriangle, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { matchIncomingAchToPurchaseOrder, notifyArUnmatchedAch } from '@/lib/achEngine';
import { exportRowsToCsv } from '@/lib/csvExport';
import { cn } from '@/lib/utils';
import { recordInvoiceReceivablePayment } from '@/lib/paymentEngine';
import { memoTotalFromList } from '@/lib/memoEngine';

const ASSIGN_TARGETS = [
  { value: 'PO', label: 'Purchase Order' },
  { value: 'Invoice', label: 'Invoice (AR)' },
  { value: 'Customer', label: 'Customer (Prepayment)' },
  { value: 'Custom', label: 'Custom (free text)' },
];

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);

const emptyLogForm = () => ({ bank_account_id: '', sender_name: '', amount: '', received_date: new Date().toISOString().slice(0, 10), reference_text: '' });
const emptyAssignForm = () => ({ target_type: 'PO', target_id: '', custom_text: '' });

// Manual daily download / log of incoming ACH deposits — the real bank
// webhook/API is deferred to the VPS phase (see NOTE ON BANK API
// IMPLEMENTATION), so this is the manual entry path item #6 describes.
// Matching is deterministic (vendor name + exact amount) per
// src/lib/achEngine.js — no silent auto-match on amount alone.
export default function IncomingAchPanel() {
  const { toast } = useToast();
  const { user } = useAuth();
  const identity = user?.full_name || user?.email || 'Unknown';

  const [loading, setLoading] = useState(true);
  const [achIncoming, setAchIncoming] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);

  const [showLogForm, setShowLogForm] = useState(false);
  const [logForm, setLogForm] = useState(emptyLogForm());
  const [saving, setSaving] = useState(false);

  const [viewing, setViewing] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [assignForm, setAssignForm] = useState(emptyAssignForm());
  const [savingAssign, setSavingAssign] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [ach, accts, pos, invs, custs] = await Promise.all([
        db.entities.AchIncoming.list('-received_date', 1000),
        db.entities.BankAccount.filter({ is_active: true }, '-created_date', 100),
        db.entities.purchase_orders.list('-created_date', 500),
        db.entities.InvoiceReceivable.list('-created_date', 500),
        db.entities.Customer.list('name', 500),
      ]);
      setAchIncoming(ach);
      setBankAccounts(accts);
      setPurchaseOrders(pos);
      setInvoices(invs);
      setCustomers(custs);
      if (!logForm.bank_account_id && accts.length > 0) setLogForm((f) => ({ ...f, bank_account_id: accts[0].id }));
    } catch (e) {
      toast({ title: 'Unable to load incoming ACH deposits', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const unmatched = useMemo(() => achIncoming.filter((a) => a.status === 'unmatched' || a.status === 'received'), [achIncoming]);
  const sorted = useMemo(() => [...achIncoming].sort((a, b) => (b.received_date || '').localeCompare(a.received_date || '')), [achIncoming]);

  const bankAccountLabel = (id) => bankAccounts.find((a) => a.id === id)?.account_name || '—';

  const describeMatch = (row) => {
    if (!row.matched_to_entity) return '—';
    const [kind, id] = String(row.matched_to_entity).split(':');
    if (kind === 'PO') return `PO ${purchaseOrders.find((p) => p.id === id)?.po_number || id}`;
    if (kind === 'Invoice') return `Invoice ${id}`;
    if (kind === 'Customer') return `Customer ${customers.find((c) => c.id === id)?.name || id}`;
    return row.matched_to_entity;
  };

  const handleLogAch = async () => {
    const amount = Number(logForm.amount);
    if (!logForm.bank_account_id || !logForm.sender_name.trim() || !logForm.received_date || !amount || amount <= 0) {
      toast({ title: 'Bank account, sender name, amount, and date are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        bank_account_id: logForm.bank_account_id,
        sender_name: logForm.sender_name.trim(),
        amount,
        received_date: logForm.received_date,
        reference_text: logForm.reference_text.trim(),
        status: 'received',
      };
      const matchedPo = matchIncomingAchToPurchaseOrder(payload, purchaseOrders);
      if (matchedPo) {
        payload.status = 'matched';
        payload.matched_to_entity = `PO:${matchedPo.id}`;
      } else {
        payload.status = 'unmatched';
      }
      const created = await db.entities.AchIncoming.create(payload);

      // Also post it to the bank ledger so it shows in reconciliation
      // (Accounts & Reconciliation tab) the same as any other deposit.
      await db.entities.BankTransaction.create({
        bank_account_id: logForm.bank_account_id,
        transaction_date: logForm.received_date,
        description: `ACH — ${logForm.sender_name.trim()}`,
        amount,
        transaction_type: 'Deposit',
        memo: logForm.reference_text.trim(),
        source: 'manual',
      });

      if (payload.status === 'unmatched') {
        await notifyArUnmatchedAch(created).catch(() => {});
        toast({ title: 'ACH logged — no PO match found', description: 'Flagged for AR assignment.' });
      } else {
        toast({ title: `ACH logged and matched to ${matchedPo.po_number}` });
      }

      setShowLogForm(false);
      setLogForm((f) => ({ ...emptyLogForm(), bank_account_id: f.bank_account_id }));
      load();
    } catch (e) {
      toast({ title: 'Unable to log ACH deposit', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const openAssign = (row) => {
    setAssigning(row);
    setAssignForm(emptyAssignForm());
    setViewing(null);
  };

  const handleAssign = async () => {
    if (assignForm.target_type === 'Custom' && !assignForm.custom_text.trim()) {
      toast({ title: 'Enter a description for the custom assignment', variant: 'destructive' });
      return;
    }
    if (assignForm.target_type !== 'Custom' && !assignForm.target_id) {
      toast({ title: 'Select what to apply this deposit to', variant: 'destructive' });
      return;
    }
    setSavingAssign(true);
    try {
      const matchedToEntity = assignForm.target_type === 'Custom'
        ? assignForm.custom_text.trim()
        : `${assignForm.target_type}:${assignForm.target_id}`;

      // Assigning to an Invoice used to just set this string — it never
      // actually reduced the invoice's balance under the new Payment layer
      // (paymentEngine.js). Route it through the same
      // recordInvoiceReceivablePayment path InvoiceReceivableDetailModal's
      // Record Payment action uses, so it can complete the invoice
      // (Released + commission) exactly like a manually-recorded payment.
      if (assignForm.target_type === 'Invoice') {
        const invoice = invoices.find((i) => i.id === assignForm.target_id);
        if (invoice) {
          const [existingPayments, existingMemos] = await Promise.all([
            db.entities.Payment.filter({ related_entity_type: 'InvoiceReceivable', related_entity_id: invoice.id }, '-payment_date', 200),
            db.entities.Memo.filter({ related_entity_type: 'InvoiceReceivable', related_entity_id: invoice.id }, '-issued_date', 200),
          ]);
          const memoTotal = memoTotalFromList(existingMemos, 'InvoiceReceivable', invoice.id);
          const { commissionPayment } = await recordInvoiceReceivablePayment({
            invoice,
            amount: assigning.amount,
            paymentDate: assigning.received_date,
            paymentMethod: 'ach',
            referenceNumber: assigning.transaction_id || '',
            notes: `Incoming ACH from ${assigning.sender_name}`,
            createdBy: identity,
            existingPayments,
            memoTotal,
          });
          if (commissionPayment) {
            toast({ title: `Commission triggered: $${commissionPayment.commission_for_this_payment.toLocaleString(undefined, { minimumFractionDigits: 2 })} to be paid in next payroll cycle` });
          }
        }
      }

      await db.entities.AchIncoming.update(assigning.id, {
        matched_to_entity: matchedToEntity,
        status: 'assigned',
        assigned_by: identity,
        assigned_date: new Date().toISOString(),
      });
      toast({ title: 'ACH deposit assigned' });
      setAssigning(null);
      load();
    } catch (e) {
      toast({ title: 'Unable to assign ACH deposit', variant: 'destructive' });
    } finally {
      setSavingAssign(false);
    }
  };

  const handleExportCsv = () => {
    exportRowsToCsv({
      filename: 'ach_incoming_reconciliation.csv',
      columns: ['Received Date', 'Sender', 'Amount', 'Bank Account', 'Status', 'Matched/Assigned To', 'Assigned By'],
      rows: sorted.map((a) => [a.received_date || '', a.sender_name, Number(a.amount) || 0, bankAccountLabel(a.bank_account_id), titleCase(a.status), describeMatch(a), a.assigned_by || '']),
    });
  };

  const targetOptions = () => {
    if (assignForm.target_type === 'PO') return purchaseOrders.map((p) => ({ value: p.id, label: `${p.po_number} — ${p.vendor_name}` }));
    if (assignForm.target_type === 'Invoice') return invoices.map((i) => ({ value: i.id, label: `${i.billing_period} — ${money(i.gross_amount)}` }));
    if (assignForm.target_type === 'Customer') return customers.map((c) => ({ value: c.id, label: c.name }));
    return [];
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="steel-card p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2"><Landmark className="w-4 h-4 text-primary" />Incoming ACH Deposits</h3>
          <Button size="sm" onClick={() => setShowLogForm(true)} className="gap-1.5 steel-gradient text-white border-0">
            <Plus className="w-3.5 h-3.5" />Log Incoming ACH
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Manual daily log until the real bank webhook/API is wired in (VPS phase). Each deposit is checked against open purchase orders by vendor
          name + exact amount — anything that doesn't match cleanly is flagged below for AR to assign by hand.
        </p>
      </div>

      {unmatched.length > 0 && (
        <div className="steel-card overflow-hidden border-amber-500/40">
          <div className="flex items-center gap-2 p-4 border-b border-border bg-amber-500/5">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <h3 className="font-semibold text-sm text-amber-700">Unmatched ACH Deposits — {unmatched.length}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-right py-2 px-3">Amount</th>
                  <th className="text-left py-2 px-3">Sender</th>
                  <th className="text-left py-2 px-3">Date</th>
                  <th className="text-left py-2 px-3">Reference</th>
                  <th className="text-right py-2 px-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map((a) => (
                  <tr key={a.id} onClick={() => setViewing(a)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                    <td className="py-2 px-3 text-right font-mono">{money(a.amount)}</td>
                    <td className="py-2 px-3 font-medium">{a.sender_name}</td>
                    <td className="py-2 px-3">{a.received_date}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">{a.reference_text || '—'}</td>
                    <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openAssign(a)}>Assign</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="steel-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-sm">All Incoming ACH — {sorted.length}</h3>
          <Button size="sm" variant="outline" onClick={handleExportCsv} disabled={sorted.length === 0} className="gap-1.5">
            <Download className="w-3.5 h-3.5" />Export CSV
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-2 px-3">Date</th>
                <th className="text-left py-2 px-3">Sender</th>
                <th className="text-right py-2 px-3">Amount</th>
                <th className="text-left py-2 px-3">Bank Account</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-left py-2 px-3">Applied To</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">No incoming ACH deposits logged yet.</td></tr>
              ) : sorted.map((a) => (
                <tr key={a.id} onClick={() => setViewing(a)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                  <td className="py-2 px-3">{a.received_date}</td>
                  <td className="py-2 px-3 font-medium">{a.sender_name}</td>
                  <td className="py-2 px-3 text-right font-mono">{money(a.amount)}</td>
                  <td className="py-2 px-3 text-muted-foreground">{bankAccountLabel(a.bank_account_id)}</td>
                  <td className="py-2 px-3">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                      a.status === 'assigned' || a.status === 'matched' ? 'bg-green-500/10 text-green-600' : 'bg-amber-500/10 text-amber-600')}>
                      {titleCase(a.status)}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{describeMatch(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={showLogForm} onOpenChange={setShowLogForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Incoming ACH Deposit</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Bank Account</Label>
              <Select value={logForm.bank_account_id} onValueChange={(v) => setLogForm((f) => ({ ...f, bank_account_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select bank account" /></SelectTrigger>
                <SelectContent>{bankAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sender Name (vendor/customer, as shown on the bank statement)</Label>
              <Input value={logForm.sender_name} onChange={(e) => setLogForm((f) => ({ ...f, sender_name: e.target.value }))} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Amount ($)</Label>
                <Input type="number" step="0.01" value={logForm.amount} onChange={(e) => setLogForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Received Date</Label>
                <Input type="date" value={logForm.received_date} onChange={(e) => setLogForm((f) => ({ ...f, received_date: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Reference / Memo (optional)</Label>
              <Input value={logForm.reference_text} onChange={(e) => setLogForm((f) => ({ ...f, reference_text: e.target.value }))} className="mt-1" placeholder="Invoice #, PO #, or memo from the bank" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLogForm(false)}>Cancel</Button>
            <Button onClick={handleLogAch} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>ACH Deposit — {viewing?.sender_name}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-1.5 text-sm">
              {[
                ['Amount', money(viewing.amount)],
                ['Received Date', viewing.received_date],
                ['Bank Account', bankAccountLabel(viewing.bank_account_id)],
                ['Reference', viewing.reference_text || '—'],
                ['Status', titleCase(viewing.status)],
                ['Applied To', describeMatch(viewing)],
                ['Assigned By', viewing.assigned_by || '—'],
                ['Assigned Date', viewing.assigned_date ? new Date(viewing.assigned_date).toLocaleString() : '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-border/50 py-1 last:border-0 gap-3">
                  <span className="text-muted-foreground flex-shrink-0">{label}</span>
                  <span className="font-medium text-right">{value}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
            {viewing && (viewing.status === 'unmatched' || viewing.status === 'received' || viewing.status === 'matched') && (
              <Button onClick={() => openAssign(viewing)} className="steel-gradient text-white border-0">{viewing.status === 'matched' ? 'Reassign' : 'Assign'}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assigning} onOpenChange={(o) => !o && setAssigning(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign ACH Deposit — {money(assigning?.amount)} from {assigning?.sender_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Apply To</Label>
              <Select value={assignForm.target_type} onValueChange={(v) => setAssignForm({ target_type: v, target_id: '', custom_text: '' })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{ASSIGN_TARGETS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {assignForm.target_type === 'Custom' ? (
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea value={assignForm.custom_text} onChange={(e) => setAssignForm((f) => ({ ...f, custom_text: e.target.value }))} rows={2} className="mt-1" />
              </div>
            ) : (
              <div>
                <Label className="text-xs">{ASSIGN_TARGETS.find((t) => t.value === assignForm.target_type)?.label}</Label>
                <Select value={assignForm.target_id} onValueChange={(v) => setAssignForm((f) => ({ ...f, target_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{targetOptions().map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssigning(null)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={savingAssign} className="steel-gradient text-white border-0">{savingAssign ? 'Saving…' : 'Save Assignment'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
