import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Generic "this balance/bucket total is made of these rows" drill-down —
// reused by Customer Balances, Vendor Balances, AR Aging, and AP Aging
// (standing rule: every data point navigates to its full underlying
// record). Rows are plain {id, label, sublabel, amount} shaped by the
// caller; onRowClick receives the row's raw source object back so the
// caller can route to the right detail modal (InvoiceReceivableDetailModal,
// VendorBillDetailModal, or the Subcontracts page for a pay app).
export default function BalanceDrilldownModal({ open, onOpenChange, title, subtitle, rows = [], emptyMessage, onRowClick }) {
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {subtitle && <p className="text-xs text-muted-foreground -mt-2">{subtitle}</p>}

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{emptyMessage || 'Nothing makes up this total.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="py-2 pr-3">Record</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={onRowClick ? 'border-b border-border/50 hover:bg-muted/50 cursor-pointer' : 'border-b border-border/50'}
                    onClick={() => onRowClick?.(r)}
                  >
                    <td className="py-2 pr-3 text-primary hover:underline">{r.label}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{r.sublabel || '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono">${(Number(r.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="py-2 pr-3 text-right font-semibold">Total</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold">${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
