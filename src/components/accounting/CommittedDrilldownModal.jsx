import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Committed cost isn't composed of JobCostLedgerEntry rows the way Actual
// is — it's the still-unpaid remainder of open Subcontracts, so this is a
// separate drilldown from LedgerDrilldownModal rather than reusing its
// ledger-row table shape.
export default function CommittedDrilldownModal({ open, onOpenChange, title, subcontracts = [], emptyMessage }) {
  const total = subcontracts.reduce((sum, s) => sum + Math.max(0, (s.subcontract?.contract_value || 0) - (s.paidToDate || 0)), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {subcontracts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {emptyMessage || 'No open subcontract commitments recorded against this cost code yet.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="py-2 pr-3">Subcontract</th>
                  <th className="py-2 pr-3">Subcontractor</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Contract Value</th>
                  <th className="py-2 pr-3 text-right">Paid to Date</th>
                  <th className="py-2 pr-3 text-right">Remaining Committed</th>
                </tr>
              </thead>
              <tbody>
                {subcontracts.map(({ subcontract, paidToDate }) => (
                  <tr key={subcontract.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-mono">{subcontract.subcontract_number || '—'}</td>
                    <td className="py-2 pr-3">{subcontract.subcontractor_name || '—'}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground capitalize">{subcontract.status}</td>
                    <td className="py-2 pr-3 text-right font-mono">${(subcontract.contract_value || 0).toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right font-mono">${(paidToDate || 0).toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right font-mono">${Math.max(0, (subcontract.contract_value || 0) - (paidToDate || 0)).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="py-2 pr-3 text-right font-semibold">Total Committed</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold">${total.toLocaleString()}</td>
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
