import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/ui/StatusBadge';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

// Read-only "full record" view for a Vendor Bill — the drill-down target for
// its invoice #, vendor, amount, variance, status, and waiver cells. Shows
// the JobCostLedgerEntry rows actually linked via source_id (honest empty
// state if none are linked — this codebase doesn't guarantee every bill
// posts a matching ledger entry).
export default function VendorBillDetailModal({ open, onOpenChange, billId, onViewPO }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [bill, setBill] = useState(null);
  const [vendor, setVendor] = useState(null);
  const [po, setPo] = useState(null);
  const [project, setProject] = useState(null);
  const [ledgerEntries, setLedgerEntries] = useState([]);

  useEffect(() => {
    if (!open || !billId) return;
    let cancelled = false;
    setLoading(true);
    setBill(null); setVendor(null); setPo(null); setProject(null); setLedgerEntries([]);

    (async () => {
      try {
        const billRecord = await db.entities.VendorBill.get(billId);
        if (!billRecord) return;
        const [vendorRecord, poRecord, projectRecord, ledgerRows] = await Promise.all([
          billRecord.vendor_id ? db.entities.Vendor.get(billRecord.vendor_id).catch(() => null) : Promise.resolve(null),
          billRecord.po_id ? db.entities.purchase_orders.get(billRecord.po_id).catch(() => null) : Promise.resolve(null),
          billRecord.project_id ? db.entities.Project.get(billRecord.project_id).catch(() => null) : Promise.resolve(null),
          db.entities.JobCostLedgerEntry.filter({ source_id: billId }, '-transaction_date', 100).catch(() => []),
        ]);
        if (cancelled) return;
        setBill(billRecord);
        setVendor(vendorRecord);
        setPo(poRecord);
        setProject(projectRecord);
        setLedgerEntries(ledgerRows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, billId]);

  const ledgerTotal = ledgerEntries.reduce((s, e) => s + (Number(e.amount) || 0), 0);

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
