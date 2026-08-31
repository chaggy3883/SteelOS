import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, GitCompareArrows } from 'lucide-react';

// Stage 11: opens in front of BatchReviewModal.jsx's commit action whenever
// detailerImportCommit.js's detectRevisions finds staged rows that match an
// EXISTING PieceMark with different dimensions/material/quantity — rather
// than commitBatch silently overwriting those fields, this requires an
// explicit per-piece checkbox before any of them apply. Unchecked rows are
// passed to commitBatch as skipRowIds and stay uncommitted (revisit later);
// every non-revision row (new pieces, unchanged matches) commits regardless,
// since only genuinely changed existing pieces need this gate.
export default function RevisionCompareModal({ open, revisions, committing, onCancel, onConfirm }) {
  const [checkedRowIds, setCheckedRowIds] = useState(new Set());

  // This modal stays mounted with `open` toggling (not conditionally
  // rendered), so a fresh set of revisions needs its own clean slate rather
  // than inheriting checkbox state left over from a previous open/cancel.
  useEffect(() => { if (open) setCheckedRowIds(new Set()); }, [open, revisions]);

  const toggleRow = (rowId) => {
    setCheckedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  };

  const toggleAll = (checked) => {
    setCheckedRowIds(checked ? new Set(revisions.map((r) => r.row.id)) : new Set());
  };

  const allChecked = revisions.length > 0 && checkedRowIds.size === revisions.length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GitCompareArrows className="w-4 h-4 text-primary" />Revised Pieces Found — {revisions.length}</DialogTitle>
          <DialogDescription>
            These piece marks already exist on this project with different dimensions, material, or quantity than this import. Check which revisions to apply — unchecked pieces are left as-is and skipped for now. Every other row in this batch (new pieces, unchanged matches) commits regardless of what you choose here.
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} />
          Select all
        </label>

        <div className="space-y-3">
          {revisions.map(({ row, pieceMark, changes }) => (
            <div key={row.id} className="rounded-lg border border-border p-3">
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input type="checkbox" checked={checkedRowIds.has(row.id)} onChange={() => toggleRow(row.id)} />
                <span className="font-mono font-medium text-sm">{pieceMark.piece_mark}</span>
              </label>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border/50">
                    <th className="py-1 pr-3 font-medium">Field</th>
                    <th className="py-1 pr-3 font-medium">Current</th>
                    <th className="py-1 pr-3 font-medium">Incoming</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((change) => (
                    <tr key={change.field} className="border-b border-border/30 last:border-0">
                      <td className="py-1 pr-3">{change.label}</td>
                      <td className="py-1 pr-3 text-muted-foreground">{change.oldValue ?? '—'}</td>
                      <td className="py-1 pr-3 font-medium text-primary">{change.newValue ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={committing}>Cancel — Commit Nothing</Button>
          <Button
            onClick={() => onConfirm(checkedRowIds)}
            disabled={committing}
            className="steel-gradient text-white border-0"
          >
            {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Apply {checkedRowIds.size} Revision{checkedRowIds.size === 1 ? '' : 's'} &amp; Commit Batch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
