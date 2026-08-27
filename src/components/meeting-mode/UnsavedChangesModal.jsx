import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Blocks navigation until the user explicitly picks Save or Discard — never
// a plain window.confirm(), since that only offers an OK/Cancel pair and
// "Cancel" is ambiguous between "stay here" and "discard." onOpenChange is a
// no-op so every Radix-driven close path (X button, outside click, Escape)
// is disabled at once; resizable is off and the (now sole) X button is
// hidden via className so nothing on the dialog looks like an escape hatch.
export default function UnsavedChangesModal({ open, onSave, onDiscard, saving }) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-sm [&>button]:hidden" resizable={false}>
        <DialogHeader>
          <DialogTitle>You have unsaved changes</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Save your notes before leaving, or discard the changes you typed.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onDiscard} disabled={saving}>Discard</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
