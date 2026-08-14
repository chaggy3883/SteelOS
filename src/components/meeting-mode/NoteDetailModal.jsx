import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { isOverdue } from '@/lib/meetingNotes';

const STATUS_STYLE = {
  Open: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
  In_Progress: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  Complete: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
};

// Theme-token styling throughout (no hardcoded dark-slate colors) so this
// renders correctly both inside Meeting Mode's forced-dark presentation and
// on ProjectDetail's normal light/dark app theme.
export default function NoteDetailModal({ open, onOpenChange, note, authorName, employeesById = new Map(), onOpenEmployee }) {
  if (!note) return null;
  const items = note.action_items || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Meeting Note — {note.meeting_date}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Type: {(note.meeting_type || '—').replace(/_/g, ' ')}</span>
            <span>Author: {authorName || '—'}</span>
          </div>
          <p className="whitespace-pre-wrap">{note.note_body}</p>

          {items.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Action Items</p>
              <div className="space-y-2">
                {items.map((item, idx) => {
                  const owner = employeesById.get(item.owner_id);
                  const overdue = isOverdue(item);
                  return (
                    <div key={idx} className="flex items-center gap-3 border border-border rounded-lg px-3 py-2">
                      <span className="flex-1">{item.description}</span>
                      {owner ? (
                        <button type="button" onClick={() => onOpenEmployee?.(owner)} className="text-primary underline text-xs whitespace-nowrap">
                          {owner.full_name}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">Unassigned</span>
                      )}
                      <span className={`text-xs whitespace-nowrap ${overdue ? 'text-red-500 font-semibold' : 'text-muted-foreground'}`}>
                        {item.due_date || 'No due date'}{overdue ? ' (overdue)' : ''}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_STYLE[item.status] || STATUS_STYLE.Open}`}>
                        {(item.status || 'Open').replace(/_/g, ' ')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
