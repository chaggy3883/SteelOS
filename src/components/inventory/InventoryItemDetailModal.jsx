import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { formatLocation, locationOf } from '@/lib/inventoryLedger';
import InventoryStockActions from '@/components/inventory/InventoryStockActions';
import InventoryHistoryPanel from '@/components/inventory/InventoryHistoryPanel';

const CATEGORIES = ['wide_flange', 'hss', 'angle', 'channel', 'plate', 'rebar', 'bolt', 'weld_material', 'paint', 'other'];

// Standing rule 1 (clickable row -> detail view) for Inventory.jsx's list.
// Descriptive fields (description, grade, size, cost, ...) are edited in place
// on "Details". Stock numbers and location are NOT editable fields any more —
// every on-hand / set-aside / spot change goes through "Change stock", which
// writes an inventory_transactions row via src/lib/inventoryLedger.js so it
// shows up on "History" and can be undone.
export default function InventoryItemDetailModal({ item, open, onOpenChange, shopFloorZones = [], onUpdated }) {
  const { toast } = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('details');
  const [projects, setProjects] = useState([]);
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(() => {
    if (!item) return;
    setForm({
      item_number: item.item_number || '',
      description: item.description || '',
      category: item.category || 'other',
      material_grade: item.material_grade || '',
      size: item.size || '',
      unit_of_measure: item.unit_of_measure || 'ea',
      unit_cost: item.unit_cost ?? 0,
      heat_number: item.heat_number || '',
      reorder_point: item.reorder_point ?? 0,
      notes: item.notes || '',
    });
  }, [item?.id, open]);

  useEffect(() => { if (open) setTab('details'); }, [item?.id, open]);

  useEffect(() => {
    if (!open) return;
    db.entities.Project.filter({ is_archived: false }, 'name', 200).then(setProjects).catch(() => setProjects([]));
  }, [open]);

  if (!item || !form) return null;

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));
  const zoneLabel = (id) => shopFloorZones.find((z) => z.id === id)?.label || id;
  const uom = item.unit_of_measure || 'ea';

  const handleStockChanged = (updated) => {
    onUpdated(updated);
    setHistoryKey((k) => k + 1);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await db.entities.InventoryItem.update(item.id, {
        item_number: form.item_number.trim(),
        description: form.description.trim(),
        category: form.category,
        material_grade: form.material_grade.trim(),
        size: form.size.trim(),
        unit_of_measure: form.unit_of_measure.trim() || 'ea',
        unit_cost: Number(form.unit_cost) || 0,
        heat_number: form.heat_number.trim(),
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

  const stockTiles = [
    { label: 'On hand', value: `${item.quantity_on_hand ?? 0} ${uom}` },
    { label: 'Set aside', value: item.quantity_reserved ?? 0 },
    { label: 'Free to use', value: item.quantity_available ?? 0 },
    { label: 'Spot', value: formatLocation(locationOf(item), zoneLabel) },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{item.description} — #{item.item_number || item.id.slice(0, 8)}</DialogTitle></DialogHeader>

        {/* Each stock number drills into the History that produced it. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {stockTiles.map(({ label, value }) => (
            <button type="button" key={label} onClick={() => setTab('history')} className="rounded-lg border border-border p-2 text-left hover:ring-2 hover:ring-primary/30 transition">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className="text-sm font-semibold truncate">{value}</p>
            </button>
          ))}
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="change">Change stock</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="details">
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
                <Label>Heat Number</Label>
                <Input value={form.heat_number} onChange={(e) => set('heat_number')(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Reorder Point</Label>
                <Input type="number" value={form.reorder_point} onChange={(e) => set('reorder_point')(e.target.value)} className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => set('notes')(e.target.value)} className="mt-1" rows={3} />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                To change how many there are or where it sits, use{' '}
                <button type="button" className="text-primary hover:underline" onClick={() => setTab('change')}>Change stock</button>
                {' '}— every change is kept in History.
              </p>
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="change">
            <InventoryStockActions
              key={`${item.id}-${historyKey}`}
              item={item}
              shopFloorZones={shopFloorZones}
              projects={projects}
              onChanged={handleStockChanged}
            />
          </TabsContent>

          <TabsContent value="history">
            <InventoryHistoryPanel
              item={item}
              shopFloorZones={shopFloorZones}
              projects={projects}
              refreshKey={historyKey}
              onChanged={handleStockChanged}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
