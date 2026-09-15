import React, { useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { generatePiecePayload } from '@/lib/qrSerialization';

const emptyForm = () => ({
  material_shape: '', material_grade: '', dimensions: '', length_in: '',
  heat_number_string: '', source_project_id: '', notes: '',
});

// Manual entry only, per confirmed intent — a leftover/drop from a job
// isn't detected automatically anywhere in this app. Generates a real,
// printable QR (generatePiecePayload — the exact same function
// detailerImportCommit.js calls for a brand-new piece) at THIS point, while
// the remnant is still unassigned, so the physical leftover can be tagged
// immediately instead of waiting for whatever project eventually consumes
// it. That QR is never regenerated later — see findWholePieceRemnantMatches
// (materialOptimizer.js) and commitBatch (detailerImportCommit.js), which
// transfer this same payload onto a new PieceMark instead of minting a new
// one when this remnant is whole-piece-matched.
export default function AddLeftoverDialog({ open, onOpenChange, projects, shopFloorZones, onCreated }) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));

  const handleClose = (next) => {
    if (!next) setForm(emptyForm());
    onOpenChange(next);
  };

  const handleSave = async () => {
    if (!form.material_shape.trim()) {
      toast({ title: 'Shape is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const sourceProject = projects.find((p) => p.id === form.source_project_id);
      const projectLabel = sourceProject?.project_number || sourceProject?.name || 'LEFTOVER';
      const qrPayload = generatePiecePayload(projectLabel, form.material_shape);

      const created = await db.entities.remnant_inventory.create({
        material_shape: form.material_shape.trim(),
        material_grade: form.material_grade.trim(),
        dimensions: form.dimensions.trim(),
        length_in: Number(form.length_in) || 0,
        heat_number_string: form.heat_number_string.trim(),
        source_project_id: form.source_project_id,
        inventory_zone_id: form.inventory_zone_id || '',
        notes: form.notes.trim(),
        status: 'available',
        is_assigned: false,
        assigned_project_id: '',
        qr_payload_string: qrPayload,
      });

      toast({ title: 'Leftover added to inventory', description: `QR ${qrPayload} — print it now and tag the piece.` });
      onCreated(created);
      handleClose(false);
    } catch (e) {
      toast({ title: 'Unable to add leftover', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Leftover to Inventory</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Shape</Label>
            <Input value={form.material_shape} onChange={(e) => set('material_shape')(e.target.value)} className="mt-1" placeholder="W12x26" />
          </div>
          <div>
            <Label>Grade</Label>
            <Input value={form.material_grade} onChange={(e) => set('material_grade')(e.target.value)} className="mt-1" placeholder="A992" />
          </div>
          <div>
            <Label>Length (in)</Label>
            <Input type="number" value={form.length_in} onChange={(e) => set('length_in')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Dimensions (free text)</Label>
            <Input value={form.dimensions} onChange={(e) => set('dimensions')(e.target.value)} className="mt-1" placeholder="e.g. 14ft-3in drop" />
          </div>
          <div>
            <Label>Heat Number</Label>
            <Input value={form.heat_number_string} onChange={(e) => set('heat_number_string')(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Zone</Label>
            <Select value={form.inventory_zone_id} onValueChange={set('inventory_zone_id')}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select a zone" /></SelectTrigger>
              <SelectContent>
                {shopFloorZones.map((z) => <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Source Project (where it came from)</Label>
            <Select value={form.source_project_id} onValueChange={set('source_project_id')}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Condition / Notes</Label>
            <Textarea value={form.notes} onChange={(e) => set('notes')(e.target.value)} className="mt-1" rows={3} placeholder="e.g. one end field-cut, minor surface rust" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">
            {saving ? 'Saving…' : 'Add Leftover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
