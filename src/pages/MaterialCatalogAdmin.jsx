import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { hasMaterialCatalogAccess } from '@/lib/materialCatalogAccess';
import { ShieldCheck, Loader2, Plus, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';
import MaterialShapeTypeDetailModal from '@/components/admin/MaterialShapeTypeDetailModal';

const CATEGORIES = ['Structural Steel', 'Bolts/Fasteners', 'Aluminum', 'Stainless', 'Other/Misc'];

const emptyForm = () => ({ shape_code: '', description: '', category: CATEGORIES[0], is_active: true });

export default function MaterialCatalogAdmin() {
  const { toast } = useToast();
  const { user } = useAuth();
  const roles = user?.roles || user?.user?.roles || ['user'];
  const canAccess = hasMaterialCatalogAccess(roles);

  const [shapeTypes, setShapeTypes] = useState([]);
  const [sizeCounts, setSizeCounts] = useState(new Map());
  const [gradeCounts, setGradeCounts] = useState(new Map());
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
      const [types, sizes, grades] = await Promise.all([
        db.entities.MaterialShapeType.list('shape_code', 1000),
        db.entities.MaterialSizeOption.list('shape_type_id', 10000),
        db.entities.MaterialGradeOption.list('shape_type_id', 10000),
      ]);
      setShapeTypes(types);
      const sc = new Map();
      sizes.forEach((s) => sc.set(s.shape_type_id, (sc.get(s.shape_type_id) || 0) + 1));
      setSizeCounts(sc);
      const gc = new Map();
      grades.forEach((g) => gc.set(g.shape_type_id, (gc.get(g.shape_type_id) || 0) + 1));
      setGradeCounts(gc);
    } catch (e) {
      toast({ title: 'Failed to load material catalog', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

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

  const toggleActive = async (shapeType) => {
    try {
      const updated = await db.entities.MaterialShapeType.update(shapeType.id, { is_active: !shapeType.is_active });
      setShapeTypes((prev) => prev.map((s) => (s.id === shapeType.id ? updated : s)));
    } catch (e) {
      toast({ title: 'Failed to update shape type', variant: 'destructive' });
    }
  };

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
      const created = await db.entities.MaterialShapeType.create({
        shape_code: code,
        description,
        category: form.category,
        is_active: form.is_active,
        created_by: user?.full_name || user?.email || user?.user?.full_name || user?.user?.email || 'Unknown',
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
        <p className="text-sm text-muted-foreground">Material catalog management requires Admin, Estimator, or Super Admin.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Material Catalog"
        subtitle="Master list of shape types and their available sizes/grades — feeds the Material Takeoff grade dropdown."
        actions={<Button onClick={() => setAddOpen(true)} className="steel-gradient text-white border-0"><Plus className="w-4 h-4" />Add Shape Type</Button>}
      />

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

      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Shape Code</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Sizes</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Grades</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Active</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-muted-foreground">
                  <Layers className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No shape types match this filter.
                </td>
              </tr>
            ) : filtered.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => setDetailShapeType(s)}>
                <td className="px-4 py-3 font-mono font-medium">{s.shape_code}</td>
                <td className="px-4 py-3">{s.description}</td>
                <td className="px-4 py-3 text-muted-foreground">{s.category}</td>
                <td className="px-4 py-3">
                  <button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); setDetailShapeType(s); }}>
                    {sizeCounts.get(s.id) || 0}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); setDetailShapeType(s); }}>
                    {gradeCounts.get(s.id) || 0}
                  </button>
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <Switch checked={s.is_active !== false} onCheckedChange={() => toggleActive(s)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
          onClose={() => { setDetailShapeType(null); load(); }}
        />
      )}
    </div>
  );
}
