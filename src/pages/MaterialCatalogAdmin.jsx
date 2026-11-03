import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { materialCatalogPermissions } from '@/lib/materialCatalogAccess';
import { createCatalogRecord, updateCatalogRecord } from '@/lib/materialCatalogWrites';
import { ShieldCheck, Loader2, Plus, Layers, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';
import MaterialShapeTypeDetailModal from '@/components/admin/MaterialShapeTypeDetailModal';
import CatalogSizesTable from '@/components/admin/CatalogSizesTable';
import SteelCatalogPanel from '@/components/settings/SteelCatalogPanel';

const CATEGORIES = ['Structural Steel', 'Bolts/Fasteners', 'Aluminum', 'Stainless', 'Other/Misc'];

const emptyForm = () => ({ shape_code: '', description: '', category: CATEGORIES[0], is_active: true });

// One shape type, edited in place: code and description save when the box
// loses focus, category and active save on change. Sizes / Grades counts
// open the shape's detail (drill-down).
function ShapeRow({ shape, shapeTypes, sizeCount, gradeCount, canEdit, onUpdated, onOpen }) {
  const { toast } = useToast();
  const [code, setCode] = useState(shape.shape_code);
  const [description, setDescription] = useState(shape.description);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCode(shape.shape_code); setDescription(shape.description); }, [shape]);

  const save = async (patch) => {
    setBusy(true);
    try {
      onUpdated(await updateCatalogRecord('MaterialShapeType', shape.id, patch));
    } catch (e) {
      toast({ title: 'Failed to update shape type', description: e?.message || 'Please retry.', variant: 'destructive' });
      setCode(shape.shape_code);
      setDescription(shape.description);
    } finally {
      setBusy(false);
    }
  };

  const commitCode = async () => {
    const next = code.trim().toUpperCase();
    if (next === shape.shape_code) { setCode(shape.shape_code); return; }
    if (!next) { toast({ title: 'Shape code can\'t be blank', variant: 'destructive' }); setCode(shape.shape_code); return; }
    if (shapeTypes.some((s) => s.id !== shape.id && s.shape_code.toLowerCase() === next.toLowerCase())) {
      toast({ title: `Shape code "${next}" already exists`, variant: 'destructive' });
      setCode(shape.shape_code);
      return;
    }
    // Takeoff lines store the code itself, so a rename leaves them on the old one.
    const lines = await db.entities.MaterialTakeoffLine.filter({ shape_code: shape.shape_code }, '-created_date', 100000);
    if (lines.length && !confirm(`${lines.length} takeoff line${lines.length === 1 ? '' : 's'} use "${shape.shape_code}" and will keep that code (they won't follow the rename). Rename to "${next}" anyway?`)) {
      setCode(shape.shape_code);
      return;
    }
    save({ shape_code: next });
  };

  const commitDescription = () => {
    const next = description.trim();
    if (next === shape.description) return;
    if (!next) { toast({ title: 'Description can\'t be blank', variant: 'destructive' }); setDescription(shape.description); return; }
    save({ description: next });
  };

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/30">
      <td className="px-3 py-1.5">
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onBlur={commitCode} disabled={!canEdit || busy} className="h-7 w-24 text-xs font-mono font-medium" />
      </td>
      <td className="px-3 py-1.5">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} onBlur={commitDescription} disabled={!canEdit || busy} className="h-7 text-xs min-w-[12rem]" />
      </td>
      <td className="px-3 py-1.5">
        <Select value={shape.category} onValueChange={(v) => save({ category: v })} disabled={!canEdit || busy}>
          <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-1.5">
        <button type="button" className="underline decoration-dotted hover:text-primary" onClick={onOpen}>{sizeCount}</button>
      </td>
      <td className="px-3 py-1.5">
        <button type="button" className="underline decoration-dotted hover:text-primary" onClick={onOpen}>{gradeCount}</button>
      </td>
      <td className="px-3 py-1.5">
        <Switch checked={shape.is_active !== false} disabled={!canEdit || busy} onCheckedChange={(v) => save({ is_active: v })} />
      </td>
      <td className="px-3 py-1.5 text-right">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onOpen}>Sizes &amp; grades</Button>
      </td>
    </tr>
  );
}

// Material Catalog admin page — admin and super_admin only (estimators add
// sizes from the takeoffs instead; see AddCatalogSizeDialog). A super_admin
// who hasn't picked a company sees it read-only (and, since catalog data is
// per company, empty) with the usual notice. Tabs: shape types, every size
// across shapes (search, weight filter, inline edit), and IRONSIGHT's
// steel_catalog with stock lengths. Every edit is role-checked again where
// it's written (materialCatalogWrites.js + localData.js) and logged to
// AuditLog by localData.js.
export default function MaterialCatalogAdmin() {
  const { toast } = useToast();
  const { user } = useAuth();
  const roles = user?.roles || user?.user?.roles || ['user'];
  const perms = materialCatalogPermissions(roles);
  const canAccess = perms.canView;
  const canEdit = perms.canEdit;

  const [shapeTypes, setShapeTypes] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [gradeCounts, setGradeCounts] = useState(new Map());
  const [steelRows, setSteelRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchText, setSearchText] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const [detailShapeType, setDetailShapeType] = useState(null);

  useEffect(() => { if (canAccess) load(); else setLoading(false); }, [canAccess]);

  const load = async () => {
    setLoading(true);
    try {
      const [types, sizeRows, grades, steel] = await Promise.all([
        db.entities.MaterialShapeType.list('shape_code', 1000),
        db.entities.MaterialSizeOption.list('shape_type_id', 20000),
        db.entities.MaterialGradeOption.list('shape_type_id', 10000),
        db.entities.steel_catalog.list('size_designation', 10000),
      ]);
      setShapeTypes(types);
      setSizes(sizeRows);
      const gc = new Map();
      grades.forEach((g) => gc.set(g.shape_type_id, (gc.get(g.shape_type_id) || 0) + 1));
      setGradeCounts(gc);
      setSteelRows(steel);
    } catch (e) {
      toast({ title: 'Failed to load material catalog', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const shapeTypesById = useMemo(() => new Map(shapeTypes.map((s) => [s.id, s])), [shapeTypes]);
  const sizeCounts = useMemo(() => {
    const sc = new Map();
    sizes.forEach((s) => sc.set(s.shape_type_id, (sc.get(s.shape_type_id) || 0) + 1));
    return sc;
  }, [sizes]);

  const filtered = useMemo(() => {
    return shapeTypes.filter((s) => {
      if (categoryFilter !== 'all' && s.category !== categoryFilter) return false;
      if (searchText.trim()) {
        const needle = searchText.trim().toLowerCase();
        if (!s.shape_code.toLowerCase().includes(needle) && !s.description.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [shapeTypes, categoryFilter, searchText]);

  const handleAddShapeType = async () => {
    const code = form.shape_code.trim();
    const description = form.description.trim();
    if (!code || !description) {
      toast({ title: 'Shape code and description are required', variant: 'destructive' });
      return;
    }
    if (shapeTypes.some((s) => s.shape_code.toLowerCase() === code.toLowerCase())) {
      toast({ title: `Shape code "${code}" already exists`, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const created = await createCatalogRecord('MaterialShapeType', {
        shape_code: code,
        description,
        category: form.category,
        is_active: form.is_active,
      });
      setShapeTypes((prev) => [...prev, created]);
      setAddOpen(false);
      setForm(emptyForm());
      toast({ title: 'Shape type added' });
    } catch (e) {
      toast({ title: 'Failed to add shape type', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Access Restricted</h2>
        <p className="text-sm text-muted-foreground">Material catalog management requires Admin or Super Admin. Estimators can add sizes from the takeoffs.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Material Catalog"
        subtitle="Shape types, sizes (with saved weights) and grades for Full Takeoff and IRONSIGHT, plus IRONSIGHT's steel catalog and stock lengths."
        actions={canEdit ? <Button onClick={() => setAddOpen(true)} className="steel-gradient text-white border-0"><Plus className="w-4 h-4" />Add Shape Type</Button> : null}
      />

      {perms.readOnly && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 text-xs flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          You&apos;re signed in as the platform operator. The material catalog belongs to one company — pick a company to work as (Impersonate) to see and change it. Read-only until then.
        </div>
      )}

      <Tabs defaultValue="shapes">
        <TabsList>
          <TabsTrigger value="shapes">Shape types ({shapeTypes.length})</TabsTrigger>
          <TabsTrigger value="sizes">All sizes ({sizes.length})</TabsTrigger>
          <TabsTrigger value="steel">IRONSIGHT steel catalog ({steelRows.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="shapes" className="pt-3">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="mt-1 w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs">Search</Label>
              <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} className="mt-1" placeholder="Search shape code or description..." />
            </div>
          </div>

          <div className="steel-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Shape Code</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Description</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Category</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Sizes</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Grades</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Active</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-muted-foreground">
                      <Layers className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      No shape types match this filter.
                    </td>
                  </tr>
                ) : filtered.map((s) => (
                  <ShapeRow
                    key={s.id}
                    shape={s}
                    shapeTypes={shapeTypes}
                    sizeCount={sizeCounts.get(s.id) || 0}
                    gradeCount={gradeCounts.get(s.id) || 0}
                    canEdit={canEdit}
                    onUpdated={(updated) => setShapeTypes((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
                    onOpen={() => setDetailShapeType(s)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="sizes" className="pt-3">
          <CatalogSizesTable
            sizes={sizes}
            shapeTypesById={shapeTypesById}
            catalogRows={steelRows}
            canEdit={canEdit}
            showShape
            onChange={setSizes}
          />
        </TabsContent>

        <TabsContent value="steel" className="pt-3">
          <SteelCatalogPanel onCatalogChange={setSteelRows} />
        </TabsContent>
      </Tabs>

      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setForm(emptyForm()); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Shape Type</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Shape Code</Label>
              <Input value={form.shape_code} onChange={(e) => setForm((f) => ({ ...f, shape_code: e.target.value.toUpperCase() }))} className="mt-1 font-mono" placeholder="e.g. WF" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="mt-1" placeholder="e.g. Wideflange Beams" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.is_active} onCheckedChange={(checked) => setForm((f) => ({ ...f, is_active: checked }))} />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddShapeType} disabled={saving} className="steel-gradient text-white border-0">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {detailShapeType && (
        <MaterialShapeTypeDetailModal
          shapeType={detailShapeType}
          canEdit={canEdit}
          catalogRows={steelRows}
          onClose={() => { setDetailShapeType(null); load(); }}
        />
      )}
    </div>
  );
}
