import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Calculator, Gauge, Clock3, Save, Plus, Trash2, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { MATERIAL_TYPES, SHAPE_CATALOG, firstSizeValue } from '@/data/steelShapes';
import { parseStructuralLength } from '@/lib/structuralLength';

function emptyRow() {
  return {
    id: null,
    material_type: 'beams',
    material_size: firstSizeValue('beams'),
    custom_name: '',
    custom_weight_per_ft: '',
    grade: '',
    length_raw: '',
    quantity: '',
  };
}

function rowWeightPerFt(row) {
  if (row.material_type === 'custom') return Number(row.custom_weight_per_ft) || 0;
  const catalog = SHAPE_CATALOG[row.material_type];
  const size = catalog?.sizes.find((s) => s.value === row.material_size);
  return size?.weightPerFt || 0;
}

function rowCalc(row) {
  const lengthFt = parseStructuralLength(row.length_raw);
  const weightPerFt = rowWeightPerFt(row);
  const qty = Number(row.quantity) || 0;
  const tonsPerPiece = lengthFt && weightPerFt ? (lengthFt * weightPerFt) / 2000 : 0;
  const totalTons = tonsPerPiece * qty;
  return { lengthFt, weightPerFt, tonsPerPiece, totalTons };
}

const FullTakeoff = forwardRef(function FullTakeoff({ bid, onSaved }, ref) {
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [shopEfficiencyPct, setShopEfficiencyPct] = useState(bid?.shop_efficiency_pct ?? 100);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { loadRows(); }, [bid?.id]);

  const loadRows = async () => {
    if (!bid?.id) return;
    setLoading(true);
    try {
      const existing = await base44.entities.MaterialTakeoffLine.filter({ bid_id: bid.id }, '-created_date', 200);
      setRows(existing.length ? existing.map((r) => ({
        id: r.id,
        material_type: r.material_type || 'beams',
        material_size: r.material_type === 'custom' ? '' : (r.material_size || firstSizeValue(r.material_type || 'beams')),
        custom_name: r.custom_name || '',
        custom_weight_per_ft: r.material_type === 'custom' ? (r.weight_per_ft || '') : '',
        grade: r.grade || '',
        length_raw: r.length_raw || '',
        quantity: r.quantity ?? '',
      })) : [emptyRow()]);
    } catch (e) {
      setRows([emptyRow()]);
    } finally {
      setLoading(false);
      setDirty(false);
    }
  };

  const addRow = () => { setRows((prev) => [...prev, emptyRow()]); setDirty(true); };
  const removeRow = (idx) => { setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)); setDirty(true); };

  const updateRow = (idx, field, value) => {
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: value };
      if (field === 'material_type') {
        updated.material_size = value === 'custom' ? '' : firstSizeValue(value);
        updated.custom_weight_per_ft = '';
      }
      return updated;
    }));
    setDirty(true);
  };

  const updateShopEfficiencyPct = (value) => {
    setShopEfficiencyPct(value);
    setDirty(true);
  };

  const calcs = useMemo(() => rows.map(rowCalc), [rows]);
  const totalTons = calcs.reduce((sum, c) => sum + c.totalTons, 0);
  const baselineManHours = rows.reduce((sum, row, i) => {
    const hoursPerTon = SHAPE_CATALOG[row.material_type]?.hoursPerTon || 0;
    return sum + calcs[i].totalTons * hoursPerTon;
  }, 0);
  const efficiencyFactor = (Number(shopEfficiencyPct) || 0) / 100;
  const totalManHours = efficiencyFactor > 0 ? baselineManHours / efficiencyFactor : baselineManHours;

  const handleSave = async () => {
    if (!bid?.id) return;
    setSaving(true);
    try {
      const ops = rows.map((row, i) => {
        const { lengthFt, weightPerFt, tonsPerPiece, totalTons: rowTotalTons } = calcs[i];
        const payload = {
          bid_id: bid.id,
          material_type: row.material_type,
          material_size: row.material_type === 'custom' ? '' : row.material_size,
          custom_name: row.material_type === 'custom' ? row.custom_name : '',
          grade: row.grade || '',
          length_raw: row.length_raw || '',
          length_decimal_ft: lengthFt || 0,
          quantity: Number(row.quantity) || 0,
          weight_per_ft: weightPerFt || 0,
          tons_per_piece: tonsPerPiece || 0,
          total_tons: rowTotalTons || 0,
        };
        if (row.id) return base44.entities.MaterialTakeoffLine.update(row.id, payload);
        return base44.entities.MaterialTakeoffLine.create(payload);
      });
      await Promise.all(ops);
      await base44.entities.Bid.update(bid.id, {
        estimated_tons: totalTons,
        estimated_man_hours: totalManHours,
        shop_efficiency_pct: Number(shopEfficiencyPct) || 100,
      });
      toast({ title: 'Material takeoff saved', description: 'Tons and man-hours were pushed to the bid workspace.' });
      setDirty(false);
      onSaved?.();
      loadRows();
    } catch (e) {
      toast({ title: 'Unable to save material takeoff', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({
    save: handleSave,
    isDirty: () => dirty,
  }));

  if (loading) return <div className="h-64 bg-muted rounded-xl animate-pulse" />;

  return (
    <div className="space-y-4">
      <div className="steel-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-primary" />
            <h4 className="font-semibold">Material Takeoff</h4>
          </div>
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="w-3.5 h-3.5 mr-1" />Add Material Line
          </Button>
        </div>

        <div className="space-y-2">
          {rows.map((row, idx) => {
            const catalog = SHAPE_CATALOG[row.material_type];
            const calc = calcs[idx];
            const lengthInvalid = !!row.length_raw && calc.lengthFt === null;
            return (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end rounded-lg border border-border p-2">
                <div className="col-span-6 sm:col-span-2">
                  <Label className="text-xs">Type</Label>
                  <Select value={row.material_type} onValueChange={(v) => updateRow(idx, 'material_type', v)}>
                    <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MATERIAL_TYPES.map((t) => <SelectItem key={t} value={t}>{SHAPE_CATALOG[t].label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {row.material_type === 'custom' ? (
                  <>
                    <div className="col-span-6 sm:col-span-2">
                      <Label className="text-xs">Name</Label>
                      <Input value={row.custom_name} onChange={(e) => updateRow(idx, 'custom_name', e.target.value)} className="mt-1 h-8 text-sm" placeholder="Custom item" />
                    </div>
                    <div className="col-span-6 sm:col-span-1">
                      <Label className="text-xs">Wt/FT (lb)</Label>
                      <Input type="number" value={row.custom_weight_per_ft} onChange={(e) => updateRow(idx, 'custom_weight_per_ft', e.target.value)} className="mt-1 h-8 text-sm" placeholder="0.0" />
                    </div>
                  </>
                ) : (
                  <div className="col-span-12 sm:col-span-3">
                    <Label className="text-xs">Size</Label>
                    <Select value={row.material_size} onValueChange={(v) => updateRow(idx, 'material_size', v)}>
                      <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select size" /></SelectTrigger>
                      <SelectContent>
                        {catalog.sizes.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="col-span-6 sm:col-span-1">
                  <Label className="text-xs">Grade</Label>
                  <Input value={row.grade} onChange={(e) => updateRow(idx, 'grade', e.target.value)} className="mt-1 h-8 text-sm" placeholder="A992" />
                </div>

                <div className="col-span-6 sm:col-span-2">
                  <Label className="text-xs">Length</Label>
                  <Input
                    value={row.length_raw}
                    onChange={(e) => updateRow(idx, 'length_raw', e.target.value)}
                    className={cn('mt-1 h-8 text-sm', lengthInvalid && 'border-red-500 focus-visible:ring-red-500')}
                    placeholder={`20' 6-1/2"`}
                  />
                </div>

                <div className="col-span-8 sm:col-span-2">
                  <Label className="text-xs">Qty</Label>
                  <div className="flex items-center gap-1 mt-1">
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => updateRow(idx, 'quantity', Math.max(0, (Number(row.quantity) || 0) - 1))}>
                      <Minus className="w-3.5 h-3.5" />
                    </Button>
                    <Input type="number" value={row.quantity} onChange={(e) => updateRow(idx, 'quantity', e.target.value === '' ? '' : (parseFloat(e.target.value) || 0))} className="h-8 text-sm text-center px-1" />
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => updateRow(idx, 'quantity', (Number(row.quantity) || 0) + 1)}>
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="col-span-3 sm:col-span-1 text-right">
                  <Label className="text-xs">Tons</Label>
                  <p className="mt-1 h-8 flex items-center justify-end font-mono text-sm font-bold">{calc.totalTons.toFixed(3)}</p>
                </div>

                <div className="col-span-1 flex justify-end">
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600" onClick={() => removeRow(idx)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="steel-card p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-primary">
            <Gauge className="w-4 h-4" />
            <span className="text-sm font-semibold">Shop Efficiency %</span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={shopEfficiencyPct}
              onChange={(e) => updateShopEfficiencyPct(parseFloat(e.target.value) || 0)}
              className="h-8 w-24 text-sm text-right"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Applied to baseline man-hours/ton. 100% = baseline; below 100% (less efficient) increases hours; above 100% decreases them.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="steel-card p-4">
          <div className="flex items-center gap-2 text-primary"><Gauge className="w-4 h-4" /><span className="text-sm font-semibold">Total Estimated Tons</span></div>
          <p className="text-2xl font-bold mt-2">{totalTons.toFixed(2)}</p>
        </div>
        <div className="steel-card p-4">
          <div className="flex items-center gap-2 text-primary"><Clock3 className="w-4 h-4" /><span className="text-sm font-semibold">Total Estimated Man-Hours</span></div>
          <p className="text-2xl font-bold mt-2">{totalManHours.toFixed(1)}</p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">
          <Save className="w-4 h-4 mr-2" />{saving ? 'Saving…' : 'Save Material Takeoff'}
        </Button>
      </div>
    </div>
  );
});

export default FullTakeoff;
