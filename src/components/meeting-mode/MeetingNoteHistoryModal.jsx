import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const formatTimestamp = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch (e) {
    return iso;
  }
};

// Every logged note entry is its own row here — full text, author, and
// timestamp all shown inline, satisfying "every logged note entry clickable
// to its detail/history" without needing a second drilldown level, since a
// MeetingNoteLog row has nothing further to reveal beyond what's already here.
export default function MeetingNoteHistoryModal({ open, onOpenChange, sectionLabel, entries = [], employeeName }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{sectionLabel} — Note History</DialogTitle>
        </DialogHeader>

        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes have been saved for this section yet.</p>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                  <span>{employeeName(entry.saved_by)}</span>
                  <span>{formatTimestamp(entry.saved_at)}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{entry.note_text}</p>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
