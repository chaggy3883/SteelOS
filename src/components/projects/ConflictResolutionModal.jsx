import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Surfaces an optimistic-concurrency conflict: someone else saved a change to
// this same row/record between when this browser tab loaded it and when this
// tab tried to save. Never resolved automatically — the whole point is that
// silently picking a winner is exactly the data-loss bug this exists to
// prevent. Same "no ambiguous escape hatch" discipline as
// meeting-mode/UnsavedChangesModal.jsx: onOpenChange is a no-op and the only
// way out is one of the two explicit buttons.
export default function ConflictResolutionModal({ open, title, description, rows, resolving, onKeepMine, onTakeTheirs, keepLabel, takeLabel }) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl [&>button]:hidden" resizable={false}>
        <DialogHeader>
          <DialogTitle>{title || 'Someone else changed this first'}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {description || 'This was updated by someone else after you loaded it. Review both versions below, then choose whether to keep your edit (overwriting theirs) or take their version (discarding yours).'}
        </p>
        <div className="space-y-3 max-h-[50vh] overflow-y-auto">
          {(rows || []).map(({ label, mine, theirs }) => (
            <div key={label} className="grid grid-cols-2 gap-3 border-b border-border pb-2">
              <div className="col-span-2 text-xs font-semibold text-muted-foreground">{label}</div>
              <div className="text-sm rounded-md bg-blue-500/5 border border-blue-500/20 p-2 whitespace-pre-wrap">
                <p className="text-[10px] uppercase tracking-wide text-blue-600 mb-1">Your version</p>
                {mine || <span className="text-muted-foreground">(blank)</span>}
              </div>
              <div className="text-sm rounded-md bg-amber-500/5 border border-amber-500/20 p-2 whitespace-pre-wrap">
                <p className="text-[10px] uppercase tracking-wide text-amber-600 mb-1">Their version (current)</p>
                {theirs || <span className="text-muted-foreground">(blank)</span>}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onTakeTheirs} disabled={resolving}>{takeLabel || 'Take Their Version'}</Button>
          <Button onClick={onKeepMine} disabled={resolving}>{resolving ? 'Saving…' : (keepLabel || 'Keep My Version')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
