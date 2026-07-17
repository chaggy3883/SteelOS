import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Save, TrendingUp, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

export const COST_CATEGORIES = [
  { key: 'detailing', label: 'Detailing', unit: 'hrs' },
  { key: 'engineering', label: 'Engineering', unit: 'hrs' },
  { key: 'bim', label: 'BIM', unit: 'hrs' },
  { key: 'structural_material', label: 'Structural Material', unit: 'tons' },
  { key: 'bolts_fasteners', label: 'Bolts / Fasteners', unit: 'ea' },
  { key: 'outsourced_fabrication', label: 'Outsourced Fabrication', unit: 'lot' },
  { key: 'structural_fabrication', label: 'Structural Fabrication', unit: 'tons' },
  { key: 'galvanizing', label: 'Galvanizing', unit: 'tons' },
  { key: 'steel_rolling', label: 'Steel Rolling', unit: 'tons' },
  { key: 'joist_deck', label: 'Joist & Deck', unit: 'tons' },
  { key: 'anchor_bolts', label: 'Anchor Bolts', unit: 'ea' },
  { key: 'shop_priming', label: 'Shop Priming', unit: 'tons' },
  { key: 'grating', label: 'Grating', unit: 'sqft' },
  { key: 'outsourced_paint', label: 'Outsourced Paint', unit: 'tons' },
  { key: 'outsourced_shot_blasting', label: 'Outsourced Shot Blasting', unit: 'tons' },
  { key: 'jobsite_freight', label: 'Jobsite Freight (Material Delivery)', unit: 'load' },
  { key: 'misc_fabrication', label: 'Misc. Fabrication', unit: 'hrs' },
  { key: 'misc_material', label: 'Misc. Material', unit: 'ea' },
  { key: 'steel_erection', label: 'Steel Erection', unit: 'tons' },
  { key: 'outsourced_misc_material_erection', label: 'Outsourced Misc. Material & Erection', unit: 'lot' },
  { key: 'subcontractor_other', label: 'Subcontractor Other', unit: 'lot' },
  { key: 'allowances', label: 'Allowance(s)', unit: 'lot' },
  { key: 'hss_contingency', label: 'HSS Contingency', unit: 'lot' },
  { key: 'additional_cost_insurance', label: 'Additional Cost: Insurance', unit: 'lot', override: true },
  { key: 'additional_cost_leed_govt', label: "Additional Cost: LEED / Gov't Job", unit: 'lot', override: true },
];

export default function TakeoffEngine({ bid }) {
  const { toast } = useToast();
  const [lines, setLines] = useState({});
  const [overrides, setOverrides] = useState({
    insurance: bid?.insurance_override ?? '',
    bond: bid?.bond_override ?? '',
    procore_pay: bid?.procore_pay_override ?? '',
    textura: bid?.textura_override ?? '',
    leed_level: bid?.leed_level_override ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadLines(); }, [bid?.id]);

  const loadLines = async () => {
    if (!bid?.id) return;
    setLoading(true);
    try {
      const existing = await base44.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 100);
      const map = {};
      COST_CATEGORIES.forEach(cat => {
        const found = existing.find(e => e.cost_category === cat.key);
        map[cat.key] = found || { quantity: 0, unit_cost: 0, total_cost: 0, is_auto_filled: false, source: 'manual', id: null };
      });
      setLines(map);
    } catch (e) {
      const empty = {};
      COST_CATEGORIES.forEach(cat => { empty[cat.key] = { quantity: 0, unit_cost: 0, total_cost: 0, is_auto_filled: false, source: 'manual', id: null }; });
      setLines(empty);
    } finally { setLoading(false); }
  };

  const updateLine = (key, field, value) => {
    setLines(prev => {
      const line = prev[key] || { quantity: 0, unit_cost: 0 };
      const updated = { ...line, [field]: value, is_overridden: line.is_auto_filled && field !== 'source' ? true : line.is_overridden };
      updated.total_cost = (updated.quantity || 0) * (updated.unit_cost || 0);
      return { ...prev, [key]: updated };
    });
  };

  const updateOverride = (field, value) => {
    setOverrides(prev => ({ ...prev, [field]: value }));
  };

  const subtotal = Object.values(lines).reduce((s, l) => s + (l.total_cost || 0), 0);
  const overrideTotal = ['insurance', 'bond', 'procore_pay', 'textura'].reduce((s, k) => s + (parseFloat(overrides[k]) || 0), 0);
  const grandTotal = subtotal + overrideTotal;
  const taxAmount = grandTotal * ((bid?.tax_rate || 0));
  const totalWithTax = grandTotal + taxAmount;

  const handleSave = async () => {
    setSaving(true);
    try {
      const ops = COST_CATEGORIES.map(cat => {
        const line = lines[cat.key];
        if (!line) return null;
        const payload = {
          bid_id: bid.id,
          cost_category: cat.key,
          cost_category_label: cat.label,
          quantity: line.quantity || 0,
          unit_cost: line.unit_cost || 0,
          total_cost: line.total_cost || 0,
          is_auto_filled: line.is_auto_filled || false,
          is_overridden: line.is_overridden || false,
          source: line.source || 'manual',
        };
        if (line.id) return base44.entities.TakeoffLine.update(line.id, payload);
        return base44.entities.TakeoffLine.create(payload);
      }).filter(Boolean);
      await Promise.all(ops);
      await base44.entities.Bid.update(bid.id, {
        bid_total_cost: grandTotal,
        insurance_override: parseFloat(overrides.insurance) || null,
        bond_override: parseFloat(overrides.bond) || null,
        procore_pay_override: parseFloat(overrides.procore_pay) || null,
        textura_override: parseFloat(overrides.textura) || null,
        leed_level_override: overrides.leed_level || null,
      });
      toast({ title: 'Takeoff saved!' });
    } catch (e) {
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  if (loading) return <div className="h-64 bg-muted rounded-xl animate-pulse" />;

  return (
    <div className="space-y-4">
      {/* Autofill indicator */}
      {Object.values(lines).some(l => l.is_auto_filled) && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <span className="text-blue-700 dark:text-blue-400">
            Blue-tagged rows were auto-filled from BIM/AI data. Overridden cells are highlighted in yellow.
          </span>
        </div>
      )}

      {/* Cost Breakdown Form */}
      <div className="steel-card p-5">
        <h4 className="font-semibold mb-4">Cost Breakdown — Line Items</h4>
        <div className="space-y-2">
          {COST_CATEGORIES.map(cat => {
            const line = lines[cat.key] || { quantity: 0, unit_cost: 0, total_cost: 0 };
            return (
              <div key={cat.key} className={cn(
                'grid grid-cols-12 gap-2 items-center py-1.5 px-2 rounded-lg transition-colors',
                line.is_overridden && 'bg-yellow-500/10 ring-1 ring-yellow-500/30',
                line.is_auto_filled && !line.is_overridden && 'bg-blue-500/5'
              )}>
                <div className="col-span-12 sm:col-span-4 flex items-center gap-2">
                  <span className="text-sm font-medium">{cat.label}</span>
                  {line.is_auto_filled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium">AUTO</span>}
                  {line.is_overridden && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 font-medium">OVERRIDE</span>}
                </div>
                <div className="col-span-4 sm:col-span-2 flex items-center gap-1">
                  <Input type="number" value={line.quantity || ''} placeholder="0"
                    onChange={e => updateLine(cat.key, 'quantity', parseFloat(e.target.value) || 0)}
                    className="h-8 text-sm" />
                  <span className="text-xs text-muted-foreground w-8">{cat.unit}</span>
                </div>
                <div className="col-span-4 sm:col-span-3 flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">$</span>
                  <Input type="number" value={line.unit_cost || ''} placeholder="0.00" step="0.01"
                    onChange={e => updateLine(cat.key, 'unit_cost', parseFloat(e.target.value) || 0)}
                    className="h-8 text-sm" />
                </div>
                <div className="col-span-4 sm:col-span-3 text-right font-mono text-sm font-bold">
                  ${(line.total_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
            );
          })}

          {/* Subtotal */}
          <div className="flex justify-between items-center py-2 px-2 mt-2 border-t border-border font-semibold">
            <span>Subtotal</span>
            <span className="font-mono">${subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
      </div>

      {/* Administrative Manual Overrides */}
      <div className="steel-card p-5">
        <h4 className="font-semibold mb-1">Administrative Overrides</h4>
        <p className="text-xs text-muted-foreground mb-4">Type over to override calculated values. Overridden cells are highlighted yellow.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { key: 'insurance', label: 'Insurance ($)' },
            { key: 'bond', label: 'Performance / Payment Bonds ($)' },
            { key: 'procore_pay', label: 'Procore Pay ($)' },
            { key: 'textura', label: 'Textura ($)' },
            { key: 'leed_level', label: 'LEED Level', isText: true },
          ].map(field => (
            <div key={field.key} className={cn(
              'p-2 rounded-lg',
              overrides[field.key] !== '' && overrides[field.key] !== undefined && overrides[field.key] !== null
                ? 'bg-yellow-500/10 ring-1 ring-yellow-500/30' : ''
            )}>
              <Label className="text-xs">{field.label}</Label>
              <Input
                type={field.isText ? 'text' : 'number'}
                value={overrides[field.key] ?? ''}
                placeholder={field.isText ? 'e.g. Silver' : '0.00'}
                onChange={e => updateOverride(field.key, e.target.value)}
                className="mt-1 h-8 text-sm"
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between items-center py-2 mt-3 border-t border-border font-semibold">
          <span>Override Total</span>
          <span className="font-mono">${overrideTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
      </div>

      {/* Grand Total */}
      <div className="steel-card p-5 bg-primary/5">
        <div className="space-y-1">
          <div className="flex justify-between text-sm"><span>Line Item Subtotal</span><span className="font-mono">${subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
          <div className="flex justify-between text-sm"><span>Administrative Overrides</span><span className="font-mono">${overrideTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
          <div className="flex justify-between text-sm"><span>Tax ({((bid?.tax_rate || 0) * 100).toFixed(2)}%)</span><span className="font-mono">${taxAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
          <div className="flex justify-between items-center pt-2 mt-1 border-t border-border">
            <span className="font-bold text-lg">Total Cost</span>
            <span className="font-mono font-bold text-lg text-primary">${totalWithTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
      </div>

      {/* Text Blocks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="steel-card p-5">
          <Label className="font-semibold">Inclusions</Label>
          <Textarea
            defaultValue={bid?.inclusions || ''}
            placeholder="List items included in this bid scope…"
            className="mt-2 min-h-[120px]"
            id="inclusions"
          />
        </div>
        <div className="steel-card p-5">
          <Label className="font-semibold">Exclusions</Label>
          <Textarea
            defaultValue={bid?.exclusions || ''}
            placeholder="List items excluded from this bid scope…"
            className="mt-2 min-h-[120px]"
            id="exclusions"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0 min-w-32">
          <Save className="w-4 h-4 mr-2" />{saving ? 'Saving…' : 'Save Takeoff'}
        </Button>
      </div>
    </div>
  );
}