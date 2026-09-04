import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Wallet, Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { applyUnappliedCash, appliedTotalFromList, outstandingFor } from '@/lib/paymentEngine';
import { memoTotalFromList } from '@/lib/memoEngine';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { generateUnappliedCashPdf } from '@/lib/unappliedCashPdf';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Stage 10 (minimum viable) — surfaces every Payment row left partially or
// fully unapplied (an overpayment recorded against an InvoiceReceivable or
// VendorBill in either detail modal — see paymentEngine.js's recordPayment)
// and lets it be applied to a different open invoice/bill. Deliberately does
// NOT auto-flip an InvoiceReceivable to Released/trigger commission when
// applying closes out its balance — that's a distinct, fuller "payment
// received" event (see recordInvoiceReceivablePayment, used by
// InvoiceReceivableDetailModal and IncomingAchPanel's ACH-to-invoice
// assignment); this panel is just re-routing cash already on the books.
export default function UnappliedCashPanel() {
  const { toast } = useToast();
  const { user } = useAuth();
  const identity = user?.full_name || user?.email || 'Unknown';

  const [loading, setLoading] = useState(true);
  const [allPayments, setAllPayments] = useState([]);
  const [memos, setMemos] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [bills, setBills] = useState([]);

  const [applying, setApplying] = useState(null);
  const [applyForm, setApplyForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [payRows, memoRows, invRows, billRows] = await Promise.all([
        db.entities.Payment.list('-payment_date', 2000),
        db.entities.Memo.list('-issued_date', 2000),
        db.entities.InvoiceReceivable.list('-created_date', 2000),
        db.entities.VendorBill.list('-created_date', 500),
      ]);
      setAllPayments(payRows);
      setMemos(memoRows);
      setInvoices(invRows);
      setBills(billRows);
    } catch (e) {
      toast({ title: 'Unable to load unapplied cash', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const unapplied = allPayments.filter((p) => p.is_unapplied && Number(p.unapplied_amount) > 0.005);

  const sourceLabel = (p) => {
    if (p.related_entity_type === 'InvoiceReceivable') {
      const inv = invoices.find((i) => i.id === p.related_entity_id);
      return `Overpayment on Invoice — ${inv?.billing_period || p.related_entity_id}`;
    }
    if (p.related_entity_type === 'VendorBill') {
      const bill = bills.find((b) => b.id === p.related_entity_id);
      return `Overpayment on Bill — ${bill?.invoice_number || p.related_entity_id}`;
    }
    return `Overpayment — ${p.related_entity_type} ${p.related_entity_id}`;
  };

  const startApply = (p) => {
    setApplying(p);
    setApplyForm({ targetType: p.direction === 'receivable' ? 'InvoiceReceivable' : 'VendorBill', targetId: '', amount: p.unapplied_amount });
  };

  const targetOptions = () => {
    if (!applyForm) return [];
    if (applyForm.targetType === 'InvoiceReceivable') {
      return invoices
        .filter((i) => !['Draft', 'Released'].includes(i.payment_status))
        .map((i) => ({ value: i.id, label: `${i.billing_period} — ${money(i.net_billing)}` }));
    }
    return bills
      .filter((b) => b.status === 'Approved')
      .map((b) => ({ value: b.id, label: `${b.invoice_number || b.id} — ${money(b.gross_amount)}` }));
  };

  const handleApply = async () => {
    if (!applyForm.targetId) {
      toast({ title: 'Select an invoice or bill to apply to', variant: 'destructive' });
      return;
    }
    const target = applyForm.targetType === 'InvoiceReceivable'
      ? invoices.find((i) => i.id === applyForm.targetId)
      : bills.find((b) => b.id === applyForm.targetId);
    if (!target) return;

    const existingApplied = appliedTotalFromList(allPayments, applyForm.targetType, target.id);
    const existingMemo = memoTotalFromList(memos, applyForm.targetType, target.id);
    const base = applyForm.targetType === 'InvoiceReceivable' ? target.net_billing : target.gross_amount;
    const owedAmount = outstandingFor(base, existingApplied + existingMemo);
    if (owedAmount <= 0.005) {
      toast({ title: 'That record has no outstanding balance to apply to', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      await applyUnappliedCash(applying, {
        relatedEntityType: applyForm.targetType, relatedEntityId: target.id,
        amount: applyForm.amount, owedAmount, createdBy: identity,
      });
      toast({ title: 'Unapplied cash applied' });
      setApplying(null);
      setApplyForm(null);
      load();
    } catch (e) {
      toast({ title: e.message || 'Unable to apply unapplied cash', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleExportPdf = async () => {
    try {
      const company = await getEffectiveCompany().catch(() => null);
      generateUnappliedCashPdf({ company, rows: unapplied.map((p) => ({ source: sourceLabel(p), date: p.payment_date, amount: p.unapplied_amount })) });
      toast({ title: 'Unapplied Cash PDF generated' });
    } catch (e) {
      toast({ title: 'Unable to generate Unapplied Cash PDF', variant: 'destructive' });
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="steel-card p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" />Unapplied Cash</h3>
          <Button size="sm" variant="outline" onClick={handleExportPdf}><Download className="w-3.5 h-3.5 mr-1" />Export PDF</Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Payments recorded against an invoice or bill for more than was owed — the excess sits here until it's applied to a different open invoice/bill.
        </p>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-3 px-4">Source</th>
                <th className="text-left py-3 px-4">Date</th>
                <th className="text-right py-3 px-4">Unapplied Amount</th>
                <th className="text-right py-3 px-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {unapplied.length === 0 ? (
                <tr><td colSpan={4} className="py-10 text-center text-muted-foreground">No unapplied cash right now.</td></tr>
              ) : unapplied.map((p) => (
                <tr key={p.id} className="border-b border-border/50">
                  <td className="py-3 px-4">{sourceLabel(p)}</td>
                  <td className="py-3 px-4">{p.payment_date || '—'}</td>
                  <td className="py-3 px-4 text-right font-mono font-semibold">{money(p.unapplied_amount)}</td>
                  <td className="py-3 px-4 text-right">
                    <Button size="sm" variant="outline" onClick={() => startApply(p)}>Apply to Invoice/Bill</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!applying} onOpenChange={(o) => { if (!o) { setApplying(null); setApplyForm(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply Unapplied Cash — {applying ? money(applying.unapplied_amount) : ''}</DialogTitle></DialogHeader>
          {applyForm && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Apply To</label>
                <Select value={applyForm.targetId} onValueChange={(v) => setApplyForm((f) => ({ ...f, targetId: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder={applyForm.targetType === 'InvoiceReceivable' ? 'Select an invoice…' : 'Select a bill…'} /></SelectTrigger>
                  <SelectContent>{targetOptions().map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setApplying(null); setApplyForm(null); }}>Cancel</Button>
            <Button onClick={handleApply} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Applying…' : 'Apply'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
