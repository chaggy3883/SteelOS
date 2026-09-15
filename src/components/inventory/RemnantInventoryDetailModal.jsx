import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Printer, QrCode } from 'lucide-react';

// Standing rule 1 (clickable row -> detail view), applied to leftover
// pieces the same way InventoryItemDetailModal.jsx applies it to SKU rows.
// Editable here: notes/condition and inventory_zone_id (location — "move"
// is just changing this). Shape/grade/length/source project/heat number are
// read-only — those describe the physical leftover as logged, not something
// that should silently drift after the fact. Once is_assigned is true this
// becomes a read-only history view (whichever project/piece consumed it),
// matching how a consumed StockMaterialUnit/remnant already behaves
// elsewhere in this app rather than allowing an already-transferred QR to be
// edited out from under the piece now wearing it.
export default function RemnantInventoryDetailModal({ remnant, open, onOpenChange, shopFloorZones = [], projectsById = {}, onUpdated, onPrint }) {
  const { toast } = useToast();
  const [notes, setNotes] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!remnant) return;
    setNotes(remnant.notes || '');
    setZoneId(remnant.inventory_zone_id || '');
  }, [remnant?.id, open]);

  if (!remnant) return null;

  const canEdit = !remnant.is_assigned;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await db.entities.remnant_inventory.update(remnant.id, {
        notes: notes.trim(),
        inventory_zone_id: zoneId,
      });
      onUpdated(updated);
      toast({ title: 'Leftover updated' });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Unable to save leftover', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const sourceProject = projectsById[remnant.source_project_id];
  const assignedProject = projectsById[remnant.assigned_project_id];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{remnant.material_shape} {remnant.material_grade}</DialogTitle></DialogHeader>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <p><span className="text-muted-foreground">Dimensions:</span> {remnant.dimensions || '—'}</p>
          <p><span className="text-muted-foreground">Length:</span> {remnant.length_in ? `${remnant.length_in}"` : '—'}</p>
          <p><span className="text-muted-foreground">Heat Number:</span> {remnant.heat_number_string || '—'}</p>
          <p><span className="text-muted-foreground">Source Project:</span> {sourceProject?.name || remnant.source_project_id || '—'}</p>
          <p className="col-span-2">
            <span className="text-muted-foreground">Status:</span>{' '}
            {remnant.is_assigned ? (
              <span className="text-amber-600 font-medium">Assigned to {assignedProject?.name || remnant.assigned_project_id}</span>
            ) : (
              <span className="text-green-600 font-medium">Available / Unassigned</span>
            )}
          </p>
        </div>

        {remnant.qr_payload_string && (
          <div className="rounded-lg border border-border p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><QrCode className="w-3.5 h-3.5" />QR Payload</p>
              <p className="font-mono text-xs truncate">{remnant.qr_payload_string}</p>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5 flex-shrink-0" onClick={() => onPrint(remnant)}>
              <Printer className="w-3.5 h-3.5" />Print Label
            </Button>
          </div>
        )}

        <div>
          <Label>Location {canEdit ? '(move by changing this)' : ''}</Label>
          {canEdit ? (
            <Select value={zoneId} onValueChange={setZoneId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select a zone" /></SelectTrigger>
              <SelectContent>
                {shopFloorZones.map((z) => <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <p className="mt-1 text-sm">{shopFloorZones.find((z) => z.id === zoneId)?.label || zoneId || '—'}</p>
          )}
        </div>

        <div>
          <Label>Condition / Notes</Label>
          {canEdit ? (
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" rows={3} />
          ) : (
            <p className="mt-1 text-sm">{notes || '—'}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canEdit && (
            <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
