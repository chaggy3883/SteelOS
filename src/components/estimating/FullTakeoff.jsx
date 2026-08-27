import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Calculator, Gauge, Clock3, Save, Plus, Trash2, Minus, Download, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { SHAPE_CLASSES, getShapeClass, estimateWeightPerFt } from '@/data/steelShapeSelector';
import { calculateSteelSurfaceArea } from '@/lib/steelShapeMath';
import { exportRequisitionToPdf } from '@/lib/requisitionPdfExport';

const COATING_TYPES = ['No Coating', 'Paint', 'Galvanized'];
const STANDARD_MATERIAL_GRADES = ['A36', 'A572 Gr50', 'A992', 'A500 Gr B/C', 'A53', 'A1085'];

function emptyRow() {
  return {
    id: null,
    shape_class: 'W-Beam',
    material_size: getShapeClass('W-Beam').sizes[0],
    grade: '',
    length_ft: '',
    quantity: '',
    coating_type: 'No Coating',
  };
}

function rowCalc(row, catalogRows) {
  const lengthFt = Number(row.length_ft) || 0;
  const weightPerFt = estimateWeightPerFt(row.shape_class, row.material_size);
  const qty = Number(row.quantity) || 0;
  const tonsPerPiece = lengthFt && weightPerFt ? (lengthFt * weightPerFt) / 2000 : 0;
  const totalTons = tonsPerPiece * qty;
  const paintAreaSqIn = row.coating_type === 'Paint' ? calculateSteelSurfaceArea(row.material_size, lengthFt, qty, catalogRows) : 0;
  return { lengthFt, weightPerFt, tonsPerPiece, totalTons, paintAreaSqIn };
}

const FullTakeoff = forwardRef(function FullTakeoff({ bid, onSaved }, ref) {
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [shopEfficiencyPct, setShopEfficiencyPct] = useState(bid?.shop_efficiency_pct ?? 100);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { loadRows(); }, [bid?.id]);
  useEffect(() => {
    db.entities.steel_catalog.list('size_designation', 1000).then(setCatalog).catch(() => setCatalog([]));
  }, []);

  // Live catalog lookup — the "Available Size" dropdown no longer reads the
  // hardcoded SHAPE_CLASSES.sizes array, it reads whatever sizes are
  // currently in steel_catalog for this class (built-ins + anything an
  // admin added via the Steel Inventory Catalog panel).
  const sizesForClass = (shapeClass) => {
    const fromCatalog = catalog.filter((c) => c.shape_class === shapeClass).map((c) => c.size_designation);
    return fromCatalog.length > 0 ? fromCatalog : getShapeClass(shapeClass).sizes;
  };

  const loadRows = async () => {
    if (!bid?.id) return;
    setLoading(true);
    try {
      const existing = await db.entities.MaterialTakeoffLine.filter({ bid_id: bid.id }, '-created_date', 200);
      setRows(existing.length ? existing.map((r) => {
        const shapeClass = r.shape_class || 'W-Beam';
        return {
          id: r.id,
          shape_class: shapeClass,
          material_size: r.material_size || getShapeClass(shapeClass).sizes[0],
          grade: r.grade || '',
          length_ft: r.length_ft ?? r.length_decimal_ft ?? '',
          quantity: r.quantity ?? '',
          coating_type: r.coating_type || 'No Coating',
          source: r.source || 'manual',
        };
      }) : [emptyRow()]);
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
      if (field === 'shape_class') {
        updated.material_size = sizesForClass(value)[0] || '';
      }
      return updated;
    }));
    setDirty(true);
  };

  const updateShopEfficiencyPct = (value) => {
    setShopEfficiencyPct(value);
    setDirty(true);
  };

  const calcs = useMemo(() => rows.map((row) => rowCalc(row, catalog)), [rows, catalog]);
  const totalTons = calcs.reduce((sum, c) => sum + c.totalTons, 0);
  const baselineManHours = rows.reduce((sum, row, i) => {
    const hoursPerTon = getShapeClass(row.shape_class).hoursPerTon || 0;
    return sum + calcs[i].totalTons * hoursPerTon;
  }, 0);
  const efficiencyFactor = (Number(shopEfficiencyPct) || 0) / 100;
  const totalManHours = efficiencyFactor > 0 ? baselineManHours / efficiencyFactor : baselineManHours;

  const handleSave = async () => {
    if (!bid?.id) return;
    setSaving(true);
    try {
      const ops = rows.map((row, i) => {
        const { lengthFt, weightPerFt, tonsPerPiece, totalTons: rowTotalTons, paintAreaSqIn } = calcs[i];
        const payload = {
          bid_id: bid.id,
          shape_class: row.shape_class,
          material_type: getShapeClass(row.shape_class).label,
          material_size: row.material_size,
          grade: row.grade || '',
          length_ft: lengthFt || 0,
          quantity: Number(row.quantity) || 0,
          weight_per_ft: weightPerFt || 0,
          tons_per_piece: tonsPerPiece || 0,
          total_tons: rowTotalTons || 0,
          coating_type: row.coating_type || 'No Coating',
          paint_area_sq_in: paintAreaSqIn || 0,
        };
        if (row.id) return db.entities.MaterialTakeoffLine.update(row.id, payload);
        return db.entities.MaterialTakeoffLine.create(payload);
      });
      await Promise.all(ops);
      await db.entities.Bid.update(bid.id, {
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

  // "Unpriced" on purpose — this goes to suppliers for a quote, so cost/margin
  // columns are deliberately left out. The computed paint area rides along
  // as its own column, same as every other quantity/spec field.
  const handleExportUnpricedCsv = () => {
    const header = ['Material Type', 'Size', 'Grade', 'Length', 'Quantity', 'Coating', 'Paint Area (Sq In)'];
    const csvRows = [header, ...rows.map((row, i) => [
      getShapeClass(row.shape_class).label,
      row.material_size,
      row.grade || '',
      row.length_ft || 0,
      row.quantity || 0,
      row.coating_type || 'No Coating',
      calcs[i].paintAreaSqIn ? calcs[i].paintAreaSqIn.toFixed(0) : '0',
    ])];
    const csvText = csvRows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvText], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bid?.bid_number || 'takeoff'}-unpriced-supplier.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportRequisitionPdf = () => {
    exportRequisitionToPdf({
      title: 'Material Takeoff Requisition',
      subtitle: `${bid?.bid_number || 'Bid TBD'} — ${bid?.job_name || ''} — unpriced, for supplier quoting`,
      columns: ['Shape Type', 'Selected Size', 'Length (ft)', 'Weight (lb/ft)', 'Qty', 'Coating', 'Calculated Metrics'],
      rows: rows.map((row, i) => [
        getShapeClass(row.shape_class).label,
        row.material_size,
        row.length_ft || 0,
        calcs[i].weightPerFt ? calcs[i].weightPerFt.toFixed(1) : '0',
        row.quantity || 0,
        row.coating_type || 'No Coating',
        row.coating_type === 'Paint' ? `${calcs[i].paintAreaSqIn.toLocaleString(undefined, { maximumFractionDigits: 0 })} Sq In`
          : row.coating_type === 'Galvanized' ? `${calcs[i].totalTons.toFixed(3)} Tons`
          : '—',
      ]),
    });
  };

  if (loading) return <div className="h-64 bg-muted rounded-xl animate-pulse" />;

  return (
    <div className="space-y-4">
      <div className="steel-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-primary" />
            <h4 className="font-semibold">Material Takeoff</h4>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportRequisitionPdf}>
              <FileDown className="w-3.5 h-3.5 mr-1" />EXPORT REQUISITION TO PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportUnpricedCsv}>
              <Download className="w-3.5 h-3.5 mr-1" />Export Unpriced Supplier CSV
            </Button>
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus className="w-3.5 h-3.5 mr-1" />Add Material Line
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {rows.map((row, idx) => {
            const calc = calcs[idx];
            return (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end rounded-lg border border-border p-2">
                {row.source === 'ironsight' && (
                  <div className="col-span-12">
                    <Badge variant="outline" className="text-blue-600 border-blue-300 text-[10px]">IRONSIGHT</Badge>
                  </div>
                )}
                <div className="col-span-6 sm:col-span-3">
                  <Label className="text-xs">Shape Classification Type</Label>
                  <Select value={row.shape_class} onValueChange={(v) => updateRow(idx, 'shape_class', v)}>
                    <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SHAPE_CLASSES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="col-span-6 sm:col-span-2">
                  <Label className="text-xs">Available Size</Label>
                  <Select value={row.material_size} onValueChange={(v) => updateRow(idx, 'material_size', v)}>
                    <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select size" /></SelectTrigger>
                    <SelectContent>
                      {sizesForClass(row.shape_class).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="col-span-6 sm:col-span-2">
                  <Label className="text-xs">Grade</Label>
                  {(() => {
                    // A row loaded from an existing bid may carry a custom
                    // grade string typed before this dropdown existed (or one
                    // outside the standard list below) — treat anything not in
                    // the standard list as "Other" automatically so it's never
                    // silently dropped, matching the requirement to keep a
                    // free-text escape hatch.
                    const isOther = !!row.grade_is_other || (!!row.grade && !STANDARD_MATERIAL_GRADES.includes(row.grade));
                    return (
                      <>
                        <Select
                          value={isOther ? 'Other' : row.grade}
                          onValueChange={(v) => {
                            if (v === 'Other') {
                              updateRow(idx, 'grade_is_other', true);
                            } else {
                              updateRow(idx, 'grade', v);
                              updateRow(idx, 'grade_is_other', false);
                            }
                          }}
                        >
                          <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select grade" /></SelectTrigger>
                          <SelectContent>
                            {STANDARD_MATERIAL_GRADES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        {isOther && (
                          <Input
                            value={row.grade}
                            onChange={(e) => updateRow(idx, 'grade', e.target.value)}
                            className="mt-1 h-8 text-sm"
                            placeholder="Enter grade"
                          />
                        )}
                      </>
                    );
                  })()}
                </div>

                <div className="col-span-6 sm:col-span-2">
                  <Label className="text-xs">Length (decimal ft)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={row.length_ft}
                    onChange={(e) => updateRow(idx, 'length_ft', e.target.value === '' ? '' : (parseFloat(e.target.value) || 0))}
                    className="mt-1 h-8 text-sm"
                    placeholder="20.5"
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

                <div className="col-span-12 flex items-center gap-3 border-t border-border/60 pt-2 mt-1">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs whitespace-nowrap">Coating</Label>
                    <select
                      value={row.coating_type || 'No Coating'}
                      onChange={(e) => updateRow(idx, 'coating_type', e.target.value)}
                      className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {COATING_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Calculated Metrics: {calc.paintAreaSqIn ? `${calc.paintAreaSqIn.toLocaleString(undefined, { maximumFractionDigits: 0 })} Sq In` : '—'}
                  </p>
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
