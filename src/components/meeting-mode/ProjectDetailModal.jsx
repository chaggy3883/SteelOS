import React from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// A lightweight in-meeting summary rather than a hard navigation to
// /projects/:id — leaving Meeting Mode's full-bleed presentation mid-agenda
// to view a job would exit the meeting flow. The full page is one link away
// for anyone who deliberately wants to leave.
export default function ProjectDetailModal({ open, onOpenChange, project }) {
  if (!project) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{project.name}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-muted-foreground text-xs">Project #</p><p className="font-medium">{project.project_number || '—'}</p></div>
          <div><p className="text-muted-foreground text-xs">Status</p><p className="font-medium capitalize">{project.status || '—'}</p></div>
          <div><p className="text-muted-foreground text-xs">Customer</p><p className="font-medium">{project.customer_name || '—'}</p></div>
          <div><p className="text-muted-foreground text-xs">Location</p><p className="font-medium">{[project.city, project.state].filter(Boolean).join(', ') || '—'}</p></div>
          <div><p className="text-muted-foreground text-xs">Start Date</p><p className="font-medium">{project.start_date || '—'}</p></div>
          <div><p className="text-muted-foreground text-xs">Completion Date</p><p className="font-medium">{project.completion_date || '—'}</p></div>
        </div>
        <DialogFooter className="justify-between">
          <Link to={`/projects/${project.id}`} className="text-sm text-primary underline">Open full project page →</Link>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
