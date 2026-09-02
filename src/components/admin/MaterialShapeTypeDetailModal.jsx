import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Plus, Trash2, ArrowUp, ArrowDown, UploadCloud, Ruler, Award } from 'lucide-react';

// Shared "add one, list all, toggle active, hard delete, reorder via adjacent
// sort_order swap" panel for both MaterialSizeOption and MaterialGradeOption —
// the two child lists differ only in entity name / field name / label text.
function OptionListPanel({ entity, valueField, label, shapeTypeId, options, onChange, toastOnError }) {
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [filterText, setFilterText] = useState('');

  const sorted = useMemo(() => [...options].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)), [options]);
  const filtered = filterText.trim()
    ? sorted.filter((o) => o[valueField].toLowerCase().includes(filterText.trim().toLowerCase()))
    : sorted;

  const handleAdd = async () => {
    if (!newValue.trim()) return;
    setSaving(true);
    try {
      const nextSort = sorted.length ? Math.max(...sorted.map((o) => o.sort_order || 0)) + 1 : 0;
      const created = await db.entities[entity].create({
        shape_type_id: shapeTypeId,
        [valueField]: newValue.trim(),
        sort_order: nextSort,
        is_active: true,
      });
      onChange([...options, created]);
      setNewValue('');
    } catch (e) {
      toastOnError(e, `Failed to add ${label.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!confirm(`Remove "${row[valueField]}" from this shape's ${label.toLowerCase()} list?`)) return;
    try {
      await db.entities[entity].delete(row.id);
      onChange(options.filter((o) => o.id !== row.id));
    } catch (e) {
      toastOnError(e, `Failed to remove ${label.toLowerCase()}`);
    }
  };

  const toggleActive = async (row) => {
    try {
      const updated = await db.entities[entity].update(row.id, { is_active: !row.is_active });
      onChange(options.map((o) => (o.id === row.id ? updated : o)));
    } catch (e) {
      toastOnError(e, `Failed to update ${label.toLowerCase()}`);
    }
  };

  const move = async (row, direction) => {
    const idx = sorted.findIndex((o) => o.id === row.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const neighbor = sorted[swapIdx];
    try {
      const [updatedRow, updatedNeighbor] = await Promise.all([
        db.entities[entity].update(row.id, { sort_order: neighbor.sort_order }),
        db.entities[entity].update(neighbor.id, { sort_order: row.sort_order }),
      ]);
      onChange(options.map((o) => {
        if (o.id === updatedRow.id) return updatedRow;
        if (o.id === updatedNeighbor.id) return updatedNeighbor;
        return o;
      }));
    } catch (e) {
      toastOnError(e, `Failed to reorder ${label.toLowerCase()}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label className="text-xs">Add {label}</Label>
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            className="mt-1"
            placeholder={`e.g. ${label === 'Size' ? 'W12x40' : 'A992'}`}
          />
        </div>
        <Button onClick={handleAdd} disabled={saving || !newValue.trim()} className="steel-gradient text-white border-0">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add
        </Button>
      </div>

      {sorted.length > 10 && (
        <Input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder={`Filter ${sorted.length} ${label.toLowerCase()}s...`}
          className="text-xs"
        />
      )}

      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">{label}</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Active</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Order</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No {label.toLowerCase()}s yet.</td></tr>
            ) : filtered.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-mono text-xs">{row[valueField]}</td>
                <td className="px-3 py-2"><Switch checked={row.is_active !== false} onCheckedChange={() => toggleActive(row)} /></td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(row, -1)}><ArrowUp className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(row, 1)}><ArrowDown className="w-3 h-3" /></Button>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(row)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BulkAddSizesPanel({ shapeTypeId, existingSizes, onAdded }) {
  const { toast } = useToast();
  const [bulkText, setBulkText] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileChosen = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBulkText((prev) => (prev ? `${prev}\n${reader.result}` : String(reader.result || '')));
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    const existingValues = new Set(existingSizes.map((s) => s.size_value.toLowerCase()));
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    const uniqueNew = [];
    const seenThisPaste = new Set();
    lines.forEach((line) => {
      const value = (line.includes(',') || line.includes('\t')) ? line.split(/[,\t]/)[0].trim() : line;
      if (!value) return;
      const key = value.toLowerCase();
      if (existingValues.has(key) || seenThisPaste.has(key)) return;
      seenThisPaste.add(key);
      uniqueNew.push(value);
    });

    if (uniqueNew.length === 0) {
      toast({ title: 'Nothing new to import', description: 'Every pasted size already exists on this shape, or the box is empty.', variant: 'destructive' });
      return;
    }

    setImporting(true);
    try {
      let nextSort = existingSizes.length ? Math.max(...existingSizes.map((s) => s.sort_order || 0)) + 1 : 0;
      const created = await db.entities.MaterialSizeOption.bulkCreate(uniqueNew.map((value) => ({
        shape_type_id: shapeTypeId,
        size_value: value,
        sort_order: nextSort++,
        is_active: true,
      })));
      onAdded(created);
      setBulkText('');
      toast({ title: `Imported ${created.length} size(s)`, description: lines.length > uniqueNew.length ? `${lines.length - uniqueNew.length} duplicate(s) skipped.` : undefined });
    } catch (e) {
      toast({ title: 'Bulk import failed', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="steel-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bulk Add Sizes</p>
        <div>
          <input ref={fileInputRef} type="file" accept=".txt,.csv" className="hidden" onChange={handleFileChosen} />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <UploadCloud className="w-3.5 h-3.5 mr-1" />Upload File
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">One size per line (or upload a .txt/.csv). Duplicates already on this shape are skipped automatically.</p>
      <Textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} className="min-h-[100px] font-mono text-xs" placeholder={'W12x40\nW14x22\nW18x35'} />
      <div className="flex justify-end">
        <Button onClick={handleImport} disabled={importing || !bulkText.trim()} className="steel-gradient text-white border-0">
          {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
          Import Sizes
        </Button>
      </div>
    </div>
  );
}

export default function MaterialShapeTypeDetailModal({ shapeType, onClose }) {
  const { toast } = useToast();
  const [sizes, setSizes] = useState([]);
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [shapeType.id]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sizeRows, gradeRows] = await Promise.all([
        db.entities.MaterialSizeOption.filter({ shape_type_id: shapeType.id }, 'sort_order', 2000),
        db.entities.MaterialGradeOption.filter({ shape_type_id: shapeType.id }, 'sort_order', 2000),
      ]);
      setSizes(sizeRows);
      setGrades(gradeRows);
    } catch (e) {
      toast({ title: 'Failed to load shape details', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const toastOnError = (e, title) => toast({ title, description: e?.message || 'Please retry.', variant: 'destructive' });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{shapeType.shape_code} — {shapeType.description}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <Tabs defaultValue="sizes">
            <TabsList>
              <TabsTrigger value="sizes"><Ruler className="w-3.5 h-3.5 mr-1" />Sizes ({sizes.length})</TabsTrigger>
              <TabsTrigger value="grades"><Award className="w-3.5 h-3.5 mr-1" />Grades ({grades.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="sizes" className="space-y-4 pt-3">
              <BulkAddSizesPanel shapeTypeId={shapeType.id} existingSizes={sizes} onAdded={(created) => setSizes((prev) => [...prev, ...created])} />
              <OptionListPanel
                entity="MaterialSizeOption"
                valueField="size_value"
                label="Size"
                shapeTypeId={shapeType.id}
                options={sizes}
                onChange={setSizes}
                toastOnError={toastOnError}
              />
            </TabsContent>
            <TabsContent value="grades" className="pt-3">
              <OptionListPanel
                entity="MaterialGradeOption"
                valueField="grade_value"
                label="Grade"
                shapeTypeId={shapeType.id}
                options={grades}
                onChange={setGrades}
                toastOnError={toastOnError}
              />
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
