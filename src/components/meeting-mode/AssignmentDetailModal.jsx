import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// The date range's own "detail record" is the assignment itself — this is
// what a click on an assignment row's dates opens.
export default function AssignmentDetailModal({ open, onOpenChange, assignment, project, onRemove, removing }) {
  if (!assignment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{assignment.employee?.full_name || 'Unknown employee'} — {assignment.role_on_job}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-muted-foreground text-xs">Job</p><p className="font-medium">{project?.name || '—'}</p></div>
          <div><p className="text-muted-foreground text-xs">Role on Job</p><p className="font-medium">{assignment.role_on_job}</p></div>
          <div><p className="text-muted-foreground text-xs">Start Date</p><p className="font-medium">{assignment.start_date}</p></div>
          <div><p className="text-muted-foreground text-xs">End Date</p><p className="font-medium">{assignment.end_date}</p></div>
          <div><p className="text-muted-foreground text-xs">Assigned By</p><p className="font-medium">{assignment.assigned_by || '—'}</p></div>
          <div><p className="text-muted-foreground text-xs">Assigned At</p><p className="font-medium">{assignment.assigned_at ? new Date(assignment.assigned_at).toLocaleString() : '—'}</p></div>
          {assignment.notes && (
            <div className="col-span-2"><p className="text-muted-foreground text-xs">Notes</p><p className="font-medium">{assignment.notes}</p></div>
          )}
        </div>
        <DialogFooter className="justify-between">
          {onRemove && (
            <Button variant="destructive" onClick={onRemove} disabled={removing}>
              {removing ? 'Removing…' : 'Remove Assignment'}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
