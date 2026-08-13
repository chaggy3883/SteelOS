import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Generic drill-down for "this number is made of these JobCostLedgerEntry
// rows" — reused for cost-code totals, JTD costs, profit/loss, SOV billed
// amounts, and single-entry detail (pass a one-item array). Entries are
// filtered by the caller (already-loaded, project-scoped ledgerEntries
// state) rather than re-fetched here.
export default function LedgerDrilldownModal({ open, onOpenChange, title, subtitle, entries = [], emptyMessage }) {
  const total = entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {subtitle && <p className="text-xs text-muted-foreground -mt-2">{subtitle}</p>}

        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {emptyMessage || 'No job cost ledger entries are recorded against this yet.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Cost Code</th>
                    <th className="py-2 pr-3">Class</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="py-2 pr-3">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b border-border/50">
                      <td className="py-2 pr-3 text-xs whitespace-nowrap">{e.transaction_date || '—'}</td>
                      <td className="py-2 pr-3 font-mono">{e.cost_code || '—'}</td>
                      <td className="py-2 pr-3">{e.cost_class || '—'}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{(e.source_type || 'other').replace(/_/g, ' ')}</td>
                      <td className="py-2 pr-3 text-right font-mono">${(Number(e.amount) || 0).toLocaleString()}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{e.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="py-2 pr-3 text-right font-semibold">Total</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold">${total.toLocaleString()}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
