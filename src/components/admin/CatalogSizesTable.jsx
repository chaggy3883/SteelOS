import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import MathDrill from '@/components/estimating/MathDrill';
import { calcCatalogRow, entryFamily, formatSetDate, WEIGHT_SOURCE_LABELS } from '@/lib/materialEntryMath';
import { findDuplicateSize, sizeWeightStatus, WEIGHT_FIELD_BY_FAMILY, WEIGHT_UNIT_BY_FAMILY, savedByText } from '@/lib/catalogSizeRules';
import { addMasterSize, deleteCatalogRecord, setAdminSizeWeight, sizeUsage, updateCatalogRecord } from '@/lib/materialCatalogWrites';

const PAGE = 150;
const FROM_LABEL = { takeoff: 'Full Takeoff', ironsight: 'IRONSIGHT', admin: 'Admin' };
const SOURCE_TEXT = { typed: 'typed on a takeoff', admin: 'set by an admin', aisc: 'copied from AISC', import: 'imported' };

// One editable MaterialSizeOption row. Each field saves on its own when it
// loses focus (or toggles), through materialCatalogWrites.js — admin only;
// localData.js writes the AuditLog row.
function SizeRow({ size, shapeType, showShape, siblings, catalogRows, canEdit, onUpdated, onRemoved }) {
  const { toast } = useToast();
  const family = entryFamily(shapeType?.shape_code, shapeType?.category);
  const field = WEIGHT_FIELD_BY_FAMILY[family];
  const unit = WEIGHT_UNIT_BY_FAMILY[family];
  const [value, setValue] = useState(size.size_value);
  const [sort, setSort] = useState(String(size.sort_order ?? 0));
  const [weight, setWeight] = useState(size[field] != null ? String(size[field]) : '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(size.size_value);
    setSort(String(size.sort_order ?? 0));
    setWeight(size[field] != null ? String(size[field]) : '');
  }, [size, field]);

  // What the takeoffs would use for this size right now — drill-down text.
  const calc = useMemo(() => calcCatalogRow(
    { shape_code: shapeType?.shape_code, size_value: size.size_value, quantity: 1, length_in: 12, width_in: 12 },
    { shapeType, catalogRows, sizeOption: size },
  ), [shapeType, size, catalogRows]);

  const save = async (patch, label) => {
    setBusy(true);
    try {
      const updated = await updateCatalogRecord('MaterialSizeOption', size.id, patch);
      onUpdated(updated);
    } catch (e) {
      toast({ title: `Couldn't save ${label}`, description: e?.message || 'Please retry.', variant: 'destructive' });
      setValue(size.size_value);
      setSort(String(size.sort_order ?? 0));
    } finally {
      setBusy(false);
    }
  };

  const commitValue = () => {
    const v = value.trim();
    if (v === size.size_value) return;
    if (!v) { toast({ title: 'A size can\'t be blank', variant: 'destructive' }); setValue(size.size_value); return; }
    const dup = findDuplicateSize(shapeType?.shape_code, v, siblings.filter((o) => o.id !== size.id).map((o) => o.size_value));
    if (dup) { toast({ title: `"${dup}" is already on ${shapeType?.shape_code}`, variant: 'destructive' }); setValue(size.size_value); return; }
    save({ size_value: v }, 'the size');
  };

  const commitSort = () => {
    const n = Number(sort);
    if (!Number.isFinite(n) || n === Number(size.sort_order ?? 0)) { setSort(String(size.sort_order ?? 0)); return; }
    save({ sort_order: n }, 'the sort order');
  };

  const commitWeight = async () => {
    const before = size[field] != null ? Number(size[field]) : null;
    const n = weight.trim() === '' ? null : Number(weight);
    if (n != null && !(n > 0)) { toast({ title: 'Weight must be greater than 0 (or blank to clear)', variant: 'destructive' }); setWeight(before != null ? String(before) : ''); return; }
    if (n === before) return;
    setBusy(true);
    try {
      onUpdated(await setAdminSizeWeight(size, family, n));
    } catch (e) {
      toast({ title: 'Couldn\'t save the weight', description: e?.message || 'Please retry.', variant: 'destructive' });
      setWeight(before != null ? String(before) : '');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      const usage = await sizeUsage(shapeType, size.size_value);
      if (usage.count > 0) {
        const where = [usage.lines.length ? `${usage.lines.length} takeoff line${usage.lines.length === 1 ? '' : 's'}` : '', usage.sessions.length ? `${usage.sessions.length} IRONSIGHT session${usage.sessions.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
        if (size.is_active === false) { toast({ title: `Can't delete ${size.size_value}`, description: `Used by ${where}. It's already turned off.` }); return; }
        if (confirm(`${shapeType?.shape_code} ${size.size_value} is used by ${where}, so it can't be deleted.\n\nTurn it off instead? It stays on those lines but won't be offered for new ones.`)) {
          onUpdated(await updateCatalogRecord('MaterialSizeOption', size.id, { is_active: false }));
        }
        return;
      }
      if (!confirm(`Delete ${shapeType?.shape_code} ${size.size_value} from the catalog? This can't be undone.`)) return;
      await deleteCatalogRecord('MaterialSizeOption', size.id);
      onRemoved(size.id);
    } catch (e) {
      toast({ title: 'Couldn\'t delete the size', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const savedLines = [
    `${size[field]} ${unit} stored on ${shapeType?.shape_code} ${size.size_value}`,
    savedByText(size),
    SOURCE_TEXT[size.weight_source] ? `Source: ${SOURCE_TEXT[size.weight_source]}` : '',
  ];

  return (
    <tr className="border-b border-border last:border-0 align-middle">
      {showShape && <td className="px-2 py-1.5 font-mono text-xs">{shapeType?.shape_code}</td>}
      <td className="px-2 py-1.5">
        <Input value={value} onChange={(e) => setValue(e.target.value)} onBlur={commitValue} disabled={!canEdit || busy} className="h-7 text-xs font-mono min-w-[9rem]" />
      </td>
      <td className="px-2 py-1.5">
        <Input type="number" value={sort} onChange={(e) => setSort(e.target.value)} onBlur={commitSort} disabled={!canEdit || busy} className="h-7 text-xs w-16" />
      </td>
      <td className="px-2 py-1.5">
        <Switch checked={size.is_active !== false} disabled={!canEdit || busy} onCheckedChange={(v) => save({ is_active: v }, 'active')} />
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          <Input type="number" min={0} step="any" value={weight} onChange={(e) => setWeight(e.target.value)} onBlur={commitWeight} disabled={!canEdit || busy} placeholder={unit} className="h-7 text-xs w-20" />
          <span className="text-[10px] text-muted-foreground">{unit}</span>
        </div>
      </td>
      <td className="px-2 py-1.5 text-xs">
        {calc.weightSource === 'saved' ? (
          <span className="text-green-700">Saved weight <MathDrill value={`${size[field]} ${unit}`} title="Saved weight" lines={savedLines} align="start" /></span>
        ) : calc.needsWeight ? (
          <span className="text-amber-700">Weight needed</span>
        ) : (
          <span className="text-muted-foreground">{WEIGHT_SOURCE_LABELS[calc.weightSource] || calc.weightSource} <MathDrill value={`${Number(calc.unitWeight.toFixed(3))} ${calc.weightUnit}`} title="Weight the takeoffs use" lines={[calc.weightFormula]} align="start" /></span>
        )}
        {size.weight_set_date && calc.weightSource !== 'saved' && <p className="text-[10px] text-muted-foreground">{savedByText(size)}</p>}
      </td>
      <td className="px-2 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
        {size.created_from ? `${FROM_LABEL[size.created_from] || size.created_from} · ` : ''}{size.created_by && size.created_by !== 'system-seed' ? size.created_by : 'seed'}
        {size.created_date && <span> · {formatSetDate(size.created_date)}</span>}
      </td>
      <td className="px-2 py-1.5 text-right">
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!canEdit || busy} onClick={handleDelete} title="Delete (or turn off if a takeoff uses it)">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 text-destructive" />}
        </Button>
      </td>
    </tr>
  );
}

// Sizes of one shape (detail modal) or of every shape (Material Catalog's
// All sizes tab): search, a weight filter (has weight / weight needed /
// added from a takeoff) and inline editing that saves per row.
export default function CatalogSizesTable({ sizes, shapeTypesById, catalogRows = [], canEdit, showShape = false, addForShapeType = null, onChange }) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const [newValue, setNewValue] = useState('');
  const [adding, setAdding] = useState(false);

  const statusById = useMemo(() => {
    if (!['has_weight', 'saved', 'needed'].includes(filter)) return null;
    const map = new Map();
    sizes.forEach((s) => map.set(s.id, sizeWeightStatus(s, shapeTypesById.get(s.shape_type_id), catalogRows)));
    return map;
  }, [sizes, shapeTypesById, catalogRows, filter]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...sizes]
      .filter((s) => {
        if (needle) {
          const code = shapeTypesById.get(s.shape_type_id)?.shape_code || '';
          if (!`${code} ${s.size_value}`.toLowerCase().includes(needle)) return false;
        }
        if (filter === 'has_weight') return statusById.get(s.id) !== 'needed';
        if (filter === 'saved') return statusById.get(s.id) === 'saved';
        if (filter === 'needed') return statusById.get(s.id) === 'needed';
        if (filter === 'from_takeoff') return s.created_from === 'takeoff' || s.created_from === 'ironsight';
        if (filter === 'inactive') return s.is_active === false;
        return true;
      })
      .sort((a, b) => {
        if (showShape) {
          const ca = shapeTypesById.get(a.shape_type_id)?.shape_code || '';
          const cb = shapeTypesById.get(b.shape_type_id)?.shape_code || '';
          if (ca !== cb) return ca.localeCompare(cb);
        }
        return (a.sort_order || 0) - (b.sort_order || 0);
      });
  }, [sizes, search, filter, statusById, shapeTypesById, showShape]);

  const handleAdd = async () => {
    if (!addForShapeType || !newValue.trim()) return;
    setAdding(true);
    try {
      const result = await addMasterSize({ shapeType: addForShapeType, sizeValue: newValue, from: 'admin' });
      if (result.duplicate) {
        toast({ title: `Already listed as "${result.duplicate.size_value}"`, variant: 'destructive' });
        return;
      }
      onChange([...sizes, result.record]);
      setNewValue('');
      toast({ title: `Added ${addForShapeType.shape_code} ${result.record.size_value}`, description: result.mirror?.created ? `Also added ${result.mirror.created.size_designation} to the IRONSIGHT steel catalog.` : undefined });
    } catch (e) {
      toast({ title: 'Failed to add size', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-3">
      {addForShapeType && canEdit && (
        <div className="flex items-end gap-2">
          <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} placeholder="Add a size, e.g. 12 x 40" className="h-8 text-sm" />
          <Button onClick={handleAdd} disabled={adding || !newValue.trim()} className="steel-gradient text-white border-0 h-8">
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Add
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE); }} placeholder={`Search ${sizes.length} size${sizes.length === 1 ? '' : 's'}…`} className="h-8 text-xs flex-1 min-w-[12rem]" />
        <Select value={filter} onValueChange={(v) => { setFilter(v); setLimit(PAGE); }}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sizes</SelectItem>
            <SelectItem value="has_weight">Has a weight (any source)</SelectItem>
            <SelectItem value="saved">Has a saved weight</SelectItem>
            <SelectItem value="needed">Weight needed</SelectItem>
            <SelectItem value="from_takeoff">Added from a takeoff</SelectItem>
            <SelectItem value="inactive">Turned off</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{filtered.length} shown</span>
      </div>
      <div className="steel-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr className="text-left text-xs text-muted-foreground">
              {showShape && <th className="px-2 py-2 font-medium">Shape</th>}
              <th className="px-2 py-2 font-medium">Size</th>
              <th className="px-2 py-2 font-medium">Sort</th>
              <th className="px-2 py-2 font-medium">Active</th>
              <th className="px-2 py-2 font-medium">Stored weight</th>
              <th className="px-2 py-2 font-medium">Takeoffs use</th>
              <th className="px-2 py-2 font-medium">Added</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={showShape ? 8 : 7} className="text-center py-8 text-muted-foreground text-xs">No sizes match.</td></tr>
            ) : filtered.slice(0, limit).map((s) => (
              <SizeRow
                key={s.id}
                size={s}
                shapeType={shapeTypesById.get(s.shape_type_id)}
                showShape={showShape}
                siblings={sizes.filter((o) => o.shape_type_id === s.shape_type_id)}
                catalogRows={catalogRows}
                canEdit={canEdit}
                onUpdated={(updated) => onChange(sizes.map((o) => (o.id === updated.id ? updated : o)))}
                onRemoved={(id) => onChange(sizes.filter((o) => o.id !== id))}
              />
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && (
        <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more of {filtered.length - limit}</Button>
      )}
    </div>
  );
}
