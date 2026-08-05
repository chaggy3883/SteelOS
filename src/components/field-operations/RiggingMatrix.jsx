import React, { useState } from 'react';
import { db } from '@/api/apiClient';
import { Plus, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

const RIGGING_CATEGORIES = ['Spreader_Bar', 'Cable_Sling', 'Nylon_Sling', 'Endless_Sling', 'Shackle_Hook'];
const PLY_COUNTS = ['1-Ply', '2-Ply'];
// Standard wire-rope/shackle pin diameters — a fixed picker, not a free
// number field, per spec ("output specific Diameter Inches options picker").
const DIAMETER_OPTIONS = [
  { value: '0.375', label: '3/8"' },
  { value: '0.5', label: '1/2"' },
  { value: '0.625', label: '5/8"' },
  { value: '0.75', label: '3/4"' },
  { value: '0.875', label: '7/8"' },
  { value: '1', label: '1"' },
  { value: '1.25', label: '1-1/4"' },
];

const emptyRiggingForm = () => ({
  serial_tag: '', rigging_category: 'Spreader_Bar', length_inches: '',
  capacity_tons: '', beam_width_feet: '', diameter_inches: '', ply_count: '1-Ply', width_inches: '',
});

function dimensionSummary(item) {
  switch (item.rigging_category) {
    case 'Spreader_Bar':
      return `${item.capacity_tons || 0}T capacity • ${item.beam_width_feet || 0}ft beam`;
    case 'Cable_Sling':
    case 'Shackle_Hook':
      return item.diameter_inches ? `${item.diameter_inches}" diameter` : '—';
    case 'Nylon_Sling':
      return `${item.ply_count || '—'} • ${item.width_inches || 0}in wide`;
    default:
      return '—';
  }
}

export default function RiggingMatrix({ ledger, canManageFleet, onReload }) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyRiggingForm());
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.serial_tag.trim()) {
      toast({ title: 'Serial tag is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        serial_tag: form.serial_tag.trim(),
        rigging_category: form.rigging_category,
        length_inches: Number(form.length_inches) || 0,
        created_at: new Date().toISOString(),
      };
      if (form.rigging_category === 'Spreader_Bar') {
        payload.capacity_tons = Number(form.capacity_tons) || 0;
        payload.beam_width_feet = Number(form.beam_width_feet) || 0;
      } else if (form.rigging_category === 'Cable_Sling' || form.rigging_category === 'Shackle_Hook') {
        payload.diameter_inches = Number(form.diameter_inches) || 0;
      } else if (form.rigging_category === 'Nylon_Sling') {
        payload.ply_count = form.ply_count;
        payload.width_inches = Number(form.width_inches) || 0;
      }
      await db.entities.rigging_inventory_ledger.create(payload);
      await onReload();
      setShowForm(false);
      setForm(emptyRiggingForm());
      toast({ title: 'Rigging asset logged' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {canManageFleet && (
        <div className="flex justify-end">
          <Button size="sm" className="gap-2 steel-gradient text-white border-0" onClick={() => setShowForm(true)}>
            <Plus className="w-3.5 h-3.5" />Add Rigging Asset
          </Button>
        </div>
      )}

      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><Link2 className="w-4 h-4 text-primary" />Rigging Inventory ({ledger.length})</h4>
        {ledger.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No rigging inventory on file.</p>
        ) : ledger.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm mb-2">
            <div>
              <p className="font-medium">{item.serial_tag} — {item.rigging_category.replace(/_/g, ' ')}</p>
              <p className="text-xs text-muted-foreground">{item.length_inches || 0}in length • {dimensionSummary(item)}</p>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Rigging Asset</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Serial Tag</Label>
                <Input value={form.serial_tag} onChange={(e) => setForm((f) => ({ ...f, serial_tag: e.target.value }))} className="mt-1" placeholder="SB-1002" />
              </div>
              <div>
                <Label>Length (inches)</Label>
                <Input type="number" value={form.length_inches} onChange={(e) => setForm((f) => ({ ...f, length_inches: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Rigging Category</Label>
              <Select value={form.rigging_category} onValueChange={(v) => setForm((f) => ({ ...f, rigging_category: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{RIGGING_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {form.rigging_category === 'Spreader_Bar' && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3">
                <div>
                  <Label>Capacity (Tons)</Label>
                  <Input type="number" value={form.capacity_tons} onChange={(e) => setForm((f) => ({ ...f, capacity_tons: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label>Beam Width (Feet)</Label>
                  <Input type="number" value={form.beam_width_feet} onChange={(e) => setForm((f) => ({ ...f, beam_width_feet: e.target.value }))} className="mt-1" />
                </div>
              </div>
            )}

            {(form.rigging_category === 'Cable_Sling' || form.rigging_category === 'Shackle_Hook') && (
              <div className="rounded-lg border border-border p-3">
                <Label>Diameter (Inches)</Label>
                <Select value={form.diameter_inches} onValueChange={(v) => setForm((f) => ({ ...f, diameter_inches: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select diameter" /></SelectTrigger>
                  <SelectContent>{DIAMETER_OPTIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}

            {form.rigging_category === 'Nylon_Sling' && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3">
                <div>
                  <Label>Ply Count</Label>
                  <Select value={form.ply_count} onValueChange={(v) => setForm((f) => ({ ...f, ply_count: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{PLY_COUNTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Width (Inches)</Label>
                  <Input type="number" value={form.width_inches} onChange={(e) => setForm((f) => ({ ...f, width_inches: e.target.value }))} className="mt-1" />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Add Asset'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
