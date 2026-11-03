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
import CatalogSizesTable from '@/components/admin/CatalogSizesTable';
import { createCatalogRecord, createCatalogRecords, deleteCatalogRecord, gradeUsage, updateCatalogRecord } from '@/lib/materialCatalogWrites';
import { findDuplicateSize } from '@/lib/catalogSizeRules';

const clearDraft = (setDrafts, id) => setDrafts((d) => { const next = { ...d }; delete next[id]; return next; });

// Grades of one shape: add, inline rename / sort, active, reorder via
// adjacent sort_order swap, delete — blocked while a takeoff line uses the
// grade (offers to turn it off instead). Every write goes through
// materialCatalogWrites.js (admin only); read-only when !canEdit.
function GradeListPanel({ shapeType, options, onChange, toastOnError, canEdit }) {
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [drafts, setDrafts] = useState({});

  const sorted = useMemo(() => [...options].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)), [options]);
  const filtered = filterText.trim()
    ? sorted.filter((o) => o.grade_value.toLowerCase().includes(filterText.trim().toLowerCase()))
    : sorted;

  const replace = (updated) => onChange(options.map((o) => (o.id === updated.id ? updated : o)));
  const isTaken = (value, exceptId) => options.some((o) => o.id !== exceptId && o.grade_value.trim().toLowerCase() === value.toLowerCase());

  const handleAdd = async () => {
    const v = newValue.trim();
    if (!v) return;
    if (isTaken(v, null)) {
      toastOnError({ message: `"${v}" is already listed.` }, 'Duplicate grade');
      return;
    }
    setSaving(true);
    try {
      const nextSort = sorted.length ? Math.max(...sorted.map((o) => o.sort_order || 0)) + 1 : 0;
      const created = await createCatalogRecord('MaterialGradeOption', { shape_type_id: shapeType.id, grade_value: v, sort_order: nextSort, is_active: true });
      onChange([...options, created]);
      setNewValue('');
    } catch (e) {
      toastOnError(e, 'Failed to add grade');
    } finally {
      setSaving(false);
    }
  };

  const saveField = async (row, patch) => {
    try {
      replace(await updateCatalogRecord('MaterialGradeOption', row.id, patch));
    } catch (e) {
      toastOnError(e, 'Failed to update grade');
    } finally {
      clearDraft(setDrafts, row.id);
    }
  };

  // Saves the row's edited value / sort when the box loses focus.
  const commitDraft = (row) => {
    const draft = drafts[row.id];
    if (!draft) return;
    const patch = {};
    if (draft.grade_value != null) {
      const value = draft.grade_value.trim();
      if (value !== row.grade_value) {
        if (!value) { toastOnError({ message: 'A grade can\'t be blank.' }, 'Not saved'); clearDraft(setDrafts, row.id); return; }
        if (isTaken(value, row.id)) { toastOnError({ message: `"${value}" is already listed.` }, 'Duplicate grade'); clearDraft(setDrafts, row.id); return; }
        patch.grade_value = value;
      }
    }
    if (draft.sort_order != null) {
      const n = Number(draft.sort_order);
      if (Number.isFinite(n) && n !== (row.sort_order || 0)) patch.sort_order = n;
    }
    if (Object.keys(patch).length) saveField(row, patch);
    else clearDraft(setDrafts, row.id);
  };

  const handleDelete = async (row) => {
    try {
      const usage = await gradeUsage(shapeType, row.grade_value);
      if (usage.count > 0) {
        const where = [usage.lines.length ? `${usage.lines.length} takeoff line${usage.lines.length === 1 ? '' : 's'}` : '', usage.sessions.length ? `${usage.sessions.length} IRONSIGHT session${usage.sessions.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
        if (row.is_active === false) { toastOnError({ message: `Used by ${where}. It's already turned off.` }, `Can't delete ${row.grade_value}`); return; }
        if (confirm(`"${row.grade_value}" is used by ${where}, so it can't be deleted.\n\nTurn it off instead?`)) {
          replace(await updateCatalogRecord('MaterialGradeOption', row.id, { is_active: false }));
        }
        return;
      }
      if (!confirm(`Delete "${row.grade_value}" from this shape's grade list? This can't be undone.`)) return;
      await deleteCatalogRecord('MaterialGradeOption', row.id);
      onChange(options.filter((o) => o.id !== row.id));
    } catch (e) {
      toastOnError(e, 'Failed to remove grade');
    }
  };

  const move = async (row, direction) => {
    const idx = sorted.findIndex((o) => o.id === row.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const neighbor = sorted[swapIdx];
    try {
      const [updatedRow, updatedNeighbor] = await Promise.all([
        updateCatalogRecord('MaterialGradeOption', row.id, { sort_order: neighbor.sort_order }),
        updateCatalogRecord('MaterialGradeOption', neighbor.id, { sort_order: row.sort_order }),
      ]);
      onChange(options.map((o) => {
        if (o.id === updatedRow.id) return updatedRow;
        if (o.id === updatedNeighbor.id) return updatedNeighbor;
        return o;
      }));
    } catch (e) {
      toastOnError(e, 'Failed to reorder grades');
    }
  };

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs">Add Grade</Label>
            <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} className="mt-1" placeholder="e.g. A992" />
          </div>
          <Button onClick={handleAdd} disabled={saving || !newValue.trim()} className="steel-gradient text-white border-0">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </Button>
        </div>
      )}

      {sorted.length > 10 && (
        <Input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder={`Search ${sorted.length} grades...`} className="text-xs" />
      )}

      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Grade</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Sort</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Active</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Order</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No grades yet.</td></tr>
            ) : filtered.map((row) => {
              const draft = drafts[row.id] || {};
              return (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5">
                    <Input
                      value={draft.grade_value ?? row.grade_value}
                      onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: { ...d[row.id], grade_value: e.target.value } }))}
                      onBlur={() => commitDraft(row)}
                      disabled={!canEdit}
                      className="h-7 text-xs font-mono"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      type="number"
                      value={draft.sort_order ?? String(row.sort_order ?? 0)}
                      onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: { ...d[row.id], sort_order: e.target.value } }))}
                      onBlur={() => commitDraft(row)}
                      disabled={!canEdit}
                      className="h-7 text-xs w-16"
                    />
                  </td>
                  <td className="px-3 py-1.5"><Switch checked={row.is_active !== false} disabled={!canEdit} onCheckedChange={(v) => saveField(row, { is_active: v })} /></td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!canEdit} onClick={() => move(row, -1)}><ArrowUp className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!canEdit} onClick={() => move(row, 1)}><ArrowDown className="w-3 h-3" /></Button>
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!canEdit} onClick={() => handleDelete(row)} title="Delete (or turn off if a takeoff uses it)"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BulkAddSizesPanel({ shapeType, existingSizes, onAdded }) {
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
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    const uniqueNew = [];
    lines.forEach((line) => {
      const value = (line.includes(',') || line.includes('\t')) ? line.split(/[,\t]/)[0].trim() : line;
      if (!value) return;
      // The same size spelled another way ("3-1/2" vs "3 1/2") is a duplicate too.
      if (findDuplicateSize(shapeType.shape_code, value, [...existingSizes.map((s) => s.size_value), ...uniqueNew])) return;
      uniqueNew.push(value);
    });

    if (uniqueNew.length === 0) {
      toast({ title: 'Nothing new to import', description: 'Every pasted size already exists on this shape, or the box is empty.', variant: 'destructive' });
      return;
    }

    setImporting(true);
    try {
      let nextSort = existingSizes.length ? Math.max(...existingSizes.map((s) => s.sort_order || 0)) + 1 : 0;
      const created = await createCatalogRecords('MaterialSizeOption', uniqueNew.map((value) => ({
        shape_type_id: shapeType.id,
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
      <p className="text-xs text-muted-foreground">One size per line (or upload a .txt/.csv). Sizes already on this shape — in any spelling — are skipped automatically.</p>
      <Textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} className="min-h-[100px] font-mono text-xs" placeholder={'12 x 40\n14 x 22\n18 x 35'} />
      <div className="flex justify-end">
        <Button onClick={handleImport} disabled={importing || !bulkText.trim()} className="steel-gradient text-white border-0">
          {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
          Import Sizes
        </Button>
      </div>
    </div>
  );
}

// One shape's sizes and grades. Sizes: inline edit (value, sort, active,
// stored weight with who/when), search + weight filter, delete guarded by
// takeoff usage. Read-only unless canEdit (admin, or a super_admin working
// as a company).
export default function MaterialShapeTypeDetailModal({ shapeType, onClose, canEdit = false, catalogRows = [] }) {
  const { toast } = useToast();
  const [sizes, setSizes] = useState([]);
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [shapeType.id]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sizeRows, gradeRows] = await Promise.all([
        db.entities.MaterialSizeOption.filter({ shape_type_id: shapeType.id }, 'sort_order', 5000),
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
  const shapeTypesById = useMemo(() => new Map([[shapeType.id, shapeType]]), [shapeType]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-y-auto">
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
              {canEdit && <BulkAddSizesPanel shapeType={shapeType} existingSizes={sizes} onAdded={(created) => setSizes((prev) => [...prev, ...created])} />}
              <CatalogSizesTable
                sizes={sizes}
                shapeTypesById={shapeTypesById}
                catalogRows={catalogRows}
                canEdit={canEdit}
                addForShapeType={shapeType}
                onChange={setSizes}
              />
            </TabsContent>
            <TabsContent value="grades" className="pt-3">
              <GradeListPanel shapeType={shapeType} options={grades} onChange={setGrades} toastOnError={toastOnError} canEdit={canEdit} />
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
