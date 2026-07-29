import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle } from 'lucide-react';

const DNB_REASONS = [
  { value: 'not_enough_time_to_bid', label: 'Not enough time to Bid' },
  { value: 'not_enough_time_in_shop', label: 'Not enough time in the shop' },
  { value: 'not_in_scope', label: 'Not in our scope' },
  { value: 'cannot_meet_requirements', label: 'Cannot meet special requirements' },
  { value: 'other', label: 'Other' },
];

export default function DNBReasonModal({ open, onOpenChange, bidId, bidLabel, onSaved }) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleClose = (nextOpen) => {
    if (!nextOpen) {
      setReason('');
      setNotes('');
    }
    onOpenChange(nextOpen);
  };

  const handleSaveReason = async () => {
    if (!reason) {
      toast({ title: 'Select a reason', description: 'A reason is required to mark this bid Did Not Bid.', variant: 'destructive' });
      return;
    }
    if (reason === 'other' && !notes.trim()) {
      toast({ title: 'Notes required', description: 'Enter a reason in the free-text box.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await base44.entities.Bid.update(bidId, {
        status: 'Did_Not_Bid',
        dnb_reason: reason,
        dnb_reason_notes: reason === 'other' ? notes.trim() : '',
      });
      toast({ title: 'Marked Did Not Bid' });
      handleClose(false);
      onSaved?.();
    } catch (e) {
      toast({ title: 'Unable to save reason', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="border-2 border-red-500/60">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-500">
            <AlertTriangle className="w-5 h-5" />
            Did Not Bid — Reason Required
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          {bidLabel ? `Marking "${bidLabel}" as Did Not Bid. ` : ''}Select a reason before this can be saved.
        </p>
        <RadioGroup value={reason} onValueChange={setReason} className="gap-3">
          {DNB_REASONS.map((r) => (
            <label key={r.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <RadioGroupItem value={r.value} />
              {r.label}
            </label>
          ))}
        </RadioGroup>
        {reason === 'other' && (
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Describe the reason…"
            className="mt-1"
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          <Button onClick={handleSaveReason} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white border-0">
            {saving ? 'Saving…' : 'Save Reason'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
