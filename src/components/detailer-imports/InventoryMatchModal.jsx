import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, PackageSearch } from 'lucide-react';

// QR lifecycle: opens in front of BatchReviewModal.jsx's commit action
// whenever detailerImportCommit.js's findInventoryMatches finds on-hand
// UNASSIGNED remnant_inventory rows that fit a brand-new piece in this batch
// closely enough (shape/grade/length) to reuse as-is. Checking a row means
// "use that physical leftover for this piece" — its existing
// qr_payload_string transfers onto the new PieceMark instead of a fresh one
// being generated, and the remnant is marked assigned/consumed. Unlike
// RevisionCompareModal (which blocks the whole commit until every revision
// is explicitly resolved), declining every match here never blocks anything
// — an unmatched piece just gets a normal freshly generated QR, exactly as
// it did before this feature existed. Every row starts checked, matching the
// "found a real match, use it" default — unchecking one opts that single
// piece out.
export default function InventoryMatchModal({ open, matches, committing, onSkipAll, onConfirm }) {
  const [checkedRowIds, setCheckedRowIds] = useState(new Set());

  useEffect(() => { if (open) setCheckedRowIds(new Set(matches.map((m) => m.row.id))); }, [open, matches]);

  const toggleRow = (rowId) => {
    setCheckedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onSkipAll()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PackageSearch className="w-4 h-4 text-primary" />Inventory Matches Found — {matches.length}</DialogTitle>
          <DialogDescription>
            These new pieces match an unassigned leftover already on hand (same shape/grade, compatible length). Check which ones to reuse — the leftover's existing QR label transfers onto the new piece instead of a new one being generated, and the leftover is marked assigned and removed from available inventory. Unchecked pieces just get a normal, freshly generated QR.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {matches.map(({ row, remnant }) => (
            <label key={row.id} className="flex items-start gap-2 rounded-lg border border-border p-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={checkedRowIds.has(row.id)} onChange={() => toggleRow(row.id)} />
              <div className="text-sm min-w-0">
                <p className="font-mono font-medium">
                  {row.piece_mark} <span className="text-muted-foreground font-sans">({row.material_profile} {row.material_grade}, {row.finished_length})</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Matches on-hand remnant {remnant.dimensions || `${remnant.length_in}"`} {remnant.material_shape} {remnant.material_grade}
                  {remnant.heat_number_string ? `, heat ${remnant.heat_number_string}` : ''} — QR <span className="font-mono">{remnant.qr_payload_string}</span>
                </p>
              </div>
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onSkipAll} disabled={committing}>Skip All — Commit With New QRs</Button>
          <Button onClick={() => onConfirm(checkedRowIds)} disabled={committing} className="steel-gradient text-white border-0">
            {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Use {checkedRowIds.size} Match{checkedRowIds.size === 1 ? '' : 'es'} &amp; Commit Batch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
