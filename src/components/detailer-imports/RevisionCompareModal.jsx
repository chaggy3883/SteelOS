import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/ui/StatusBadge';
import PieceDetailModal from '@/components/shipping/PieceDetailModal';
import { workflowStatusLabel } from '@/lib/pieceWorkflowStatus';
import { REMOVAL_DECISION } from '@/lib/detailerImportRemovals';
import { Loader2, CheckCircle2, GitCompareArrows, AlertTriangle, PackageX } from 'lucide-react';

const DECISION_OPTIONS = [
  { value: REMOVAL_DECISION.KEEP, label: 'Keep', hint: 'No change' },
  { value: REMOVAL_DECISION.HOLD, label: 'Put on hold', hint: "Don't cut or ship until someone checks" },
  { value: REMOVAL_DECISION.VOID, label: 'Void', hint: 'Removed from job' },
];

const decisionButtonClass = (value, active) => {
  if (!active) return 'bg-background text-muted-foreground border-border hover:bg-muted';
  if (value === REMOVAL_DECISION.VOID) return 'bg-red-600 text-white border-red-600';
  if (value === REMOVAL_DECISION.HOLD) return 'bg-amber-500 text-white border-amber-500';
  return 'bg-primary text-primary-foreground border-primary';
};

// Stage 11: opens in front of BatchReviewModal.jsx's commit action whenever
// detailerImportCommit.js's detectRevisions finds staged rows that match an
// EXISTING PieceMark with different dimensions/material/quantity — rather
// than commitBatch silently overwriting those fields, this requires an
// explicit per-piece checkbox before any of them apply. Unchecked rows are
// passed to commitBatch as skipRowIds and stay uncommitted (revisit later);
// every non-revision row (new pieces, unchanged matches) commits regardless,
// since only genuinely changed existing pieces need this gate.
//
// Also opens when detailerImportRemovals.js's detectRemovedPieces finds
// pieces in the job that aren't in the new file (the "not in the new file"
// step below). Each gets a Keep / Put on hold / Void choice, prefilled from
// its defaultDecision; the choices go back to commitBatch as
// removalDecisions. Nothing is written until the confirm button — Cancel
// commits nothing at all.
export default function RevisionCompareModal({ open, revisions, removal, committing, onCancel, onConfirm }) {
  const removed = useMemo(() => removal?.removed || [], [removal]);
  const [checkedRowIds, setCheckedRowIds] = useState(new Set());
  const [decisions, setDecisions] = useState(new Map());
  const [selectedRemovedIds, setSelectedRemovedIds] = useState(new Set());
  const [removalNote, setRemovalNote] = useState('');
  const [viewingPieceMarkId, setViewingPieceMarkId] = useState(null);

  // This modal stays mounted with `open` toggling (not conditionally
  // rendered), so a fresh set of revisions/removals needs its own clean
  // slate rather than inheriting state left over from a previous open/cancel.
  useEffect(() => {
    if (!open) return;
    setCheckedRowIds(new Set());
    setDecisions(new Map(removed.map((r) => [r.pieceMark.id, r.defaultDecision])));
    setSelectedRemovedIds(new Set());
    setRemovalNote('');
  }, [open, revisions, removed]);

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

  const toggleRemovedSelected = (pieceMarkId) => {
    setSelectedRemovedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pieceMarkId)) next.delete(pieceMarkId); else next.add(pieceMarkId);
      return next;
    });
  };

  const setDecision = (pieceMarkId, value) => {
    setDecisions((prev) => new Map(prev).set(pieceMarkId, value));
  };

  const applyToSelected = (value) => {
    setDecisions((prev) => {
      const next = new Map(prev);
      selectedRemovedIds.forEach((id) => next.set(id, value));
      return next;
    });
  };

  const allChecked = revisions.length > 0 && checkedRowIds.size === revisions.length;
  const allRemovedSelected = removed.length > 0 && selectedRemovedIds.size === removed.length;
  const inShopCount = removed.filter((r) => r.inShop).length;
  const counts = { keep: 0, hold: 0, void: 0 };
  removed.forEach((r) => { counts[decisions.get(r.pieceMark.id) || REMOVAL_DECISION.KEEP] += 1; });
  const removedStep = revisions.length > 0 ? 2 : 1;

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GitCompareArrows className="w-4 h-4 text-primary" />Check What Changed Before Committing</DialogTitle>
          <DialogDescription>
            This file doesn&apos;t match what&apos;s already in the job. Go through each step below — nothing is saved until you press the button at the bottom. Cancel saves nothing.
          </DialogDescription>
        </DialogHeader>

        {revisions.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Step 1: {revisions.length} piece{revisions.length === 1 ? ' was' : 's were'} changed by the detailer</h3>
            <p className="text-xs text-muted-foreground">
              These piece marks already exist on this job with different dimensions, material, or quantity (or were put on hold/voided and are back in the file). Check the ones to update — unchecked pieces are left as-is and skipped for now. New pieces and unchanged pieces in this file commit either way.
            </p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} />
              Select all
            </label>

            {revisions.map(({ row, pieceMark, changes }) => (
              <div key={row.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2 mb-2">
                  <input type="checkbox" checked={checkedRowIds.has(row.id)} onChange={() => toggleRow(row.id)} aria-label={`Apply revision to ${pieceMark.piece_mark}`} />
                  <button type="button" className="font-mono font-medium text-sm text-primary hover:underline" onClick={() => setViewingPieceMarkId(pieceMark.id)}>
                    {pieceMark.piece_mark}
                  </button>
                </div>
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
          </section>
        )}

        {removed.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <PackageX className="w-4 h-4 text-red-500" />
              Step {removedStep}: {removed.length} piece{removed.length === 1 ? ' is' : 's are'} in this job but not in the new file
            </h3>
            <p className="text-xs text-muted-foreground">
              Compared against {removal.scopeLabel} ({removal.inScopeCount} piece{removal.inScopeCount === 1 ? '' : 's'}). The detailer may have deleted these from the model. Pick what to do with each one. <strong>Keep</strong> changes nothing. <strong>Put on hold</strong> flags it so nobody cuts or ships it until someone checks. <strong>Void</strong> marks it removed from the job and drops it from shipping and cut lists. The shop status is never changed.
            </p>

            {removal.partialSuspected && (
              <div className="rounded-lg border-2 border-amber-500 bg-amber-500/10 p-3 text-xs flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>This file looks partial.</strong> More than half of those {removal.inScopeCount} pieces are missing from it, which usually means the detailer sent only part of the job rather than deleting pieces. Everything below starts at Keep. Only change a piece if you know it was really removed.
                </span>
              </div>
            )}

            {inShopCount > 0 && (
              <div className="rounded-lg border-2 border-red-500 bg-red-500/10 p-3 text-xs flex gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>
                  <strong>{inShopCount} of these {inShopCount === 1 ? 'is' : 'are'} already being fabricated.</strong> They start at Keep. Talk to the shop before you hold or void one.
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-2 text-muted-foreground cursor-pointer mr-2">
                <input
                  type="checkbox"
                  checked={allRemovedSelected}
                  onChange={(e) => setSelectedRemovedIds(e.target.checked ? new Set(removed.map((r) => r.pieceMark.id)) : new Set())}
                />
                Select all
              </label>
              <span className="text-muted-foreground">Set {selectedRemovedIds.size} selected to:</span>
              {DECISION_OPTIONS.map((opt) => (
                <Button key={opt.value} type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={selectedRemovedIds.size === 0} onClick={() => applyToSelected(opt.value)}>
                  {opt.label}
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              {removed.map(({ pieceMark, shopPieces, inShop, alreadyOnHold }) => {
                const current = decisions.get(pieceMark.id) || REMOVAL_DECISION.KEEP;
                return (
                  <div
                    key={pieceMark.id}
                    className={`rounded-lg p-3 flex flex-wrap items-center gap-3 ${inShop ? 'border-2 border-red-500 bg-red-500/5' : 'border border-border'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedRemovedIds.has(pieceMark.id)}
                      onChange={() => toggleRemovedSelected(pieceMark.id)}
                      aria-label={`Select ${pieceMark.piece_mark}`}
                    />
                    <button type="button" className="font-mono font-medium text-sm text-primary hover:underline" onClick={() => setViewingPieceMarkId(pieceMark.id)}>
                      {pieceMark.piece_mark}
                    </button>
                    <span className="text-xs text-muted-foreground">{[pieceMark.material_profile, pieceMark.finished_length].filter(Boolean).join(' · ')}</span>
                    <button type="button" onClick={() => setViewingPieceMarkId(pieceMark.id)} title="Open piece record">
                      <StatusBadge status={pieceMark.status || 'not_started'} />
                    </button>
                    {shopPieces.map((sp) => (
                      <button key={sp.id} type="button" onClick={() => setViewingPieceMarkId(pieceMark.id)} title="Open piece record">
                        <StatusBadge status="shop" label={`Shop: ${workflowStatusLabel(sp.workflow_status) || 'tracked'}`} />
                      </button>
                    ))}
                    {inShop && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-600 text-white px-2.5 py-0.5 text-xs font-semibold">
                        <AlertTriangle className="w-3 h-3" /> Already being fabricated
                      </span>
                    )}
                    {alreadyOnHold && <span className="text-xs font-medium text-amber-600">Already on hold</span>}
                    <div className="ml-auto flex rounded-md overflow-hidden border border-border" role="group" aria-label={`What to do with ${pieceMark.piece_mark}`}>
                      {DECISION_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          title={opt.hint}
                          aria-pressed={current === opt.value}
                          onClick={() => setDecision(pieceMark.id, opt.value)}
                          className={`px-2.5 py-1 text-xs font-medium border-l first:border-l-0 ${decisionButtonClass(opt.value, current === opt.value)}`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="removal-note">Note for held/voided pieces (optional)</label>
              <Input id="removal-note" value={removalNote} onChange={(e) => setRemovalNote(e.target.value)} placeholder="e.g. Confirmed with detailer, beam deleted in Rev C" className="h-8 text-xs" />
            </div>

            <p className="text-xs font-medium">
              When you commit: {counts.keep} kept as-is, {counts.hold} put on hold, {counts.void} voided.
            </p>
          </section>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={committing}>Cancel — Commit Nothing</Button>
          <Button
            onClick={() => onConfirm(checkedRowIds, decisions, removalNote)}
            disabled={committing}
            className="steel-gradient text-white border-0"
          >
            {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {[
              revisions.length > 0 ? `Apply ${checkedRowIds.size} Revision${checkedRowIds.size === 1 ? '' : 's'}` : null,
              removed.length > 0 ? `${counts.hold} Hold / ${counts.void} Void` : null,
              'Commit Batch',
            ].filter(Boolean).join(' & ')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <PieceDetailModal
      open={!!viewingPieceMarkId}
      onOpenChange={(o) => !o && setViewingPieceMarkId(null)}
      pieceMarkId={viewingPieceMarkId}
    />
    </>
  );
}
