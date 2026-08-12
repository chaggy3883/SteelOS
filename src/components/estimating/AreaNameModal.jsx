import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Shown when the Area tool's polygon is closed (double-click) — naming is
// required before the polygon is committed to BlueprintTakeoff's `areas`
// state, so onSave only ever fires with a non-empty name. Any other way of
// closing this dialog (Cancel, Escape, overlay click) is treated by the
// caller as an abandon — see BlueprintTakeoff's handleCancelAreaName.
export default function AreaNameModal({ open, onOpenChange, onSave }) {
  const [name, setName] = useState('');

  const handleClose = (nextOpen) => {
    if (!nextOpen) setName('');
    onOpenChange(nextOpen);
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName('');
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Name This Area</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Deck Pour 1"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
