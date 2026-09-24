import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle } from 'lucide-react';

const REMOVAL_REASONS = [
  { value: 'added_in_error', label: 'Added in Error' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'scrapped', label: 'Scrapped' },
  { value: 'other', label: 'Other' },
];

// Reason-required confirm gate for "Remove from Inventory" (remnant_inventory
// status -> 'removed'), same reason-dropdown + conditional free-text-on-Other
// shape as HumanResources.jsx's Reject Candidate modal. A remnant already
// status:'consumed' (used by a project, whether whole-piece-matched or
// cut-plan-consumed) needs a second explicit acknowledgment before it can
// still be removed, since removal there is closing out a record of material
// already used rather than pulling unused stock out of circulation.
export default function RemoveRemnantDialog({ remnant, open, onOpenChange, onConfirm }) {
  const [reasonCode, setReasonCode] = useState(REMOVAL_REASONS[0].value);
  const [reasonOther, setReasonOther] = useState('');
  const [acknowledgeConsumed, setAcknowledgeConsumed] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setReasonCode(REMOVAL_REASONS[0].value);
    setReasonOther('');
    setAcknowledgeConsumed(false);
    setError('');
  }, [open, remnant?.id]);

  if (!remnant) return null;

  const isConsumed = remnant.status === 'consumed';

  const handleConfirm = async () => {
    const isOther = reasonCode === 'other';
    const finalReason = isOther ? reasonOther.trim() : REMOVAL_REASONS.find((r) => r.value === reasonCode)?.label;
    if (isOther && !finalReason) {
      setError('Please specify a reason.');
      return;
    }
    if (isConsumed && !acknowledgeConsumed) {
      setError('Please acknowledge this remnant was already used before removing it.');
      return;
    }
    setError('');
    setRemoving(true);
    try {
      await onConfirm(finalReason);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Remove {remnant.material_shape} from Inventory</DialogTitle></DialogHeader>

        {isConsumed && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">This remnant was already used by a project.</p>
              <p className="text-xs mt-0.5">Removing it only closes out the inventory record — it does not affect the piece already fabricated from it.</p>
              <label className="flex items-center gap-2 mt-2 text-xs cursor-pointer">
                <input type="checkbox" checked={acknowledgeConsumed} onChange={(e) => setAcknowledgeConsumed(e.target.checked)} />
                I understand this remnant was already used and want to remove it anyway.
              </label>
            </div>
          </div>
        )}

        <div>
          <Label>Reason</Label>
          <Select value={reasonCode} onValueChange={setReasonCode}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {REMOVAL_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {reasonCode === 'other' && (
          <div>
            <Label>Specify Reason</Label>
            <Textarea value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} rows={2} className="mt-1" />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <p className="text-xs text-muted-foreground">
          This does not delete the record — it stays visible under "Show Removed" for audit purposes. Any QR code already printed for this remnant stays as-is.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={removing}>
            {removing ? 'Removing…' : 'Remove from Inventory'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
