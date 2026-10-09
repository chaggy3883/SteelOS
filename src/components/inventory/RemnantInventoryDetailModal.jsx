import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Printer, QrCode, Trash2, PackageCheck } from 'lucide-react';

// Standing rule 1 (clickable row -> detail view), applied to drop pieces the
// same way InventoryItemDetailModal.jsx applies it to SKU rows. Editable
// here: notes/condition and location (inventory_zone_id/rack/bin — "move" is
// just changing these). Shape/grade/length/source project/heat number are
// read-only — those describe the physical drop as logged, not something
// that should silently drift after the fact. Once is_assigned (or, for the
// Other-use path, status:'consumed' without an assignment) is true this
// becomes a read-only history view, matching how a consumed
// StockMaterialUnit/remnant already behaves elsewhere in this app rather
// than allowing an already-transferred QR to be edited out from under the
// piece now wearing it.
export default function RemnantInventoryDetailModal({ remnant, open, onOpenChange, shopFloorZones = [], projectsById = {}, onUpdated, onPrint, onRemove, onUse }) {
  const { toast } = useToast();
  const [notes, setNotes] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [rack, setRack] = useState('');
  const [bin, setBin] = useState('');
  const [saving, setSaving] = useState(false);
  const [assignedPieceMark, setAssignedPieceMark] = useState(null);

  useEffect(() => {
    if (!remnant) return;
    setNotes(remnant.notes || '');
    setZoneId(remnant.inventory_zone_id || '');
    setRack(remnant.rack || '');
    setBin(remnant.bin || '');
  }, [remnant?.id, open]);

  useEffect(() => {
    if (!remnant?.assigned_piece_mark_id) { setAssignedPieceMark(null); return; }
    db.entities.PieceMark.get(remnant.assigned_piece_mark_id).then(setAssignedPieceMark).catch(() => setAssignedPieceMark(null));
  }, [remnant?.assigned_piece_mark_id]);

  if (!remnant) return null;

  const canEdit = !remnant.is_assigned && remnant.status !== 'removed' && remnant.status !== 'consumed';
  const canUse = remnant.status === 'available' && !remnant.is_assigned;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await db.entities.remnant_inventory.update(remnant.id, {
        notes: notes.trim(),
        inventory_zone_id: zoneId,
        rack: rack.trim(),
        bin: bin.trim(),
      });
      onUpdated(updated);
      toast({ title: 'Drop updated' });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Unable to save drop', variant: 'destructive' });
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
            {remnant.status === 'removed' ? (
              <span className="text-slate-500 font-medium">Removed — {remnant.removed_reason || '—'}{remnant.removed_date ? ` (${new Date(remnant.removed_date).toLocaleDateString()})` : ''}</span>
            ) : remnant.is_assigned ? (
              <span className="text-amber-600 font-medium">
                Assigned to {assignedProject?.name || remnant.assigned_project_id}
                {assignedPieceMark ? ` — Piece Mark ${assignedPieceMark.piece_mark}` : ''}
              </span>
            ) : remnant.status === 'consumed' ? (
              <span className="text-amber-600 font-medium">Used — Other{remnant.consumed_date ? ` (${new Date(remnant.consumed_date).toLocaleDateString()})` : ''}</span>
            ) : (
              <span className="text-green-600 font-medium">Available / Unassigned</span>
            )}
          </p>
          {(remnant.used_by || remnant.used_note) && (
            <div className="col-span-2 rounded-lg border border-border p-2 text-xs space-y-0.5">
              {remnant.used_by && <p><span className="text-muted-foreground">Used by:</span> {remnant.used_by}</p>}
              {remnant.used_note && <p><span className="text-muted-foreground">Note:</span> {remnant.used_note}</p>}
            </div>
          )}
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
            <div className="grid grid-cols-3 gap-2 mt-1">
              <Select value={zoneId} onValueChange={setZoneId}>
                <SelectTrigger><SelectValue placeholder="Zone" /></SelectTrigger>
                <SelectContent>
                  {shopFloorZones.map((z) => <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input value={rack} onChange={(e) => setRack(e.target.value)} placeholder="Rack" />
              <Input value={bin} onChange={(e) => setBin(e.target.value)} placeholder="Bin" />
            </div>
          ) : zoneId || remnant.rack || remnant.bin ? (
            <p className="mt-1 text-sm">
              {shopFloorZones.find((z) => z.id === zoneId)?.label || zoneId || '—'}
              {[remnant.rack, remnant.bin].filter(Boolean).length > 0 ? ` — ${[remnant.rack, remnant.bin].filter(Boolean).join(' / ')}` : ''}
            </p>
          ) : (
            <p className="mt-1"><span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600">No location</span></p>
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
          {remnant.status !== 'removed' && onRemove && (
            <Button variant="destructive" className="gap-1.5" onClick={() => onRemove(remnant)}>
              <Trash2 className="w-3.5 h-3.5" />Remove from Inventory
            </Button>
          )}
          {canUse && onUse && (
            <Button variant="outline" className="gap-1.5" onClick={() => onUse(remnant)}>
              <PackageCheck className="w-3.5 h-3.5" />Use this Drop
            </Button>
          )}
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
