import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

const CATEGORIES = ['wide_flange', 'hss', 'angle', 'channel', 'plate', 'rebar', 'bolt', 'weld_material', 'paint', 'other'];

// Standing rule 1 (clickable row -> detail view): Inventory.jsx's list rows
// had no click/edit path at all before this — this is that detail view,
// covering everything Inventory.jsx's own "Add Item" dialog captures plus
// location (warehouse_zone/rack/bin — "move" is just changing these) and
// notes, which the list never surfaced before either.
export default function InventoryItemDetailModal({ item, open, onOpenChange, shopFloorZones = [], onUpdated }) {
  const { toast } = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setForm({
      item_number: item.item_number || '',
      description: item.description || '',
      category: item.category || 'other',
      material_grade: item.material_grade || '',
      size: item.size || '',
      unit_of_measure: item.unit_of_measure || 'ea',
      quantity_on_hand: item.quantity_on_hand ?? 0,
      quantity_reserved: item.quantity_reserved ?? 0,
      unit_cost: item.unit_cost ?? 0,
      warehouse_zone: item.warehouse_zone || '',
      warehouse_rack: item.warehouse_rack || '',
      warehouse_bin: item.warehouse_bin || '',
      reorder_point: item.reorder_point ?? 0,
      notes: item.notes || '',
    });
  }, [item?.id, open]);

  if (!item || !form) return null;

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const quantityOnHand = Number(form.quantity_on_hand) || 0;
      const quantityReserved = Number(form.quantity_reserved) || 0;
      const updated = await db.entities.InventoryItem.update(item.id, {
        item_number: form.item_number.trim(),
        description: form.description.trim(),
        category: form.category,
        material_grade: form.material_grade.trim(),
        size: form.size.trim(),
        unit_of_measure: form.unit_of_measure.trim() || 'ea',
        quantity_on_hand: quantityOnHand,
        quantity_reserved: quantityReserved,
        quantity_available: Math.max(0, quantityOnHand - quantityReserved),
        unit_cost: Number(form.unit_cost) || 0,
        warehouse_zone: form.warehouse_zone,
        warehouse_rack: form.warehouse_rack.trim(),
        warehouse_bin: form.warehouse_bin.trim(),
        reorder_point: Number(form.reorder_point) || 0,
        notes: form.notes.trim(),
      });
      onUpdated(updated);
      toast({ title: 'Inventory item updated' });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Unable to save item', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{item.description} — #{item.item_number || item.id.slice(0, 8)}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => set('description')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Item Number</Label>
            <Input value={form.item_number} onChange={(e) => set('item_number')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category} onValueChange={set('category')}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Material Grade</Label>
            <Input value={form.material_grade} onChange={(e) => set('material_grade')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Size</Label>
            <Input value={form.size} onChange={(e) => set('size')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Unit of Measure</Label>
            <Input value={form.unit_of_measure} onChange={(e) => set('unit_of_measure')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Unit Cost ($)</Label>
            <Input type="number" value={form.unit_cost} onChange={(e) => set('unit_cost')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Quantity on Hand</Label>
            <Input type="number" value={form.quantity_on_hand} onChange={(e) => set('quantity_on_hand')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Quantity Reserved</Label>
            <Input type="number" value={form.quantity_reserved} onChange={(e) => set('quantity_reserved')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Reorder Point</Label>
            <Input type="number" value={form.reorder_point} onChange={(e) => set('reorder_point')(e.target.value)} className="mt-1" />
          </div>
          <div className="col-span-2 pt-2 border-t border-border/50">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Location (move by changing these)</p>
          </div>
          <div>
            <Label>Warehouse Zone</Label>
            <Select value={form.warehouse_zone} onValueChange={set('warehouse_zone')}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select a zone" /></SelectTrigger>
              <SelectContent>
                {shopFloorZones.map((z) => <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Rack</Label>
            <Input value={form.warehouse_rack} onChange={(e) => set('warehouse_rack')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Bin</Label>
            <Input value={form.warehouse_bin} onChange={(e) => set('warehouse_bin')(e.target.value)} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => set('notes')(e.target.value)} className="mt-1" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
