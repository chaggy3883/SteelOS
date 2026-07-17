import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save, RotateCcw } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const FIELDS = [
  { key: 'shop_burden_rate', label: 'Shop Burden Rate', prefix: '$', suffix: '/hr', default: 65 },
  { key: 'standard_scrap_factor_pct', label: 'Standard Scrap Factor', suffix: '%', default: 5 },
  { key: 'base_insurance_multiplier_pct', label: 'Base Insurance Multiplier', suffix: '%', default: 3 },
  { key: 'retainage_default_pct', label: 'Retainage Default', suffix: '%', default: 10 },
  { key: 'default_labor_rate', label: 'Default Labor Rate', prefix: '$', suffix: '/hr', default: 45 },
  { key: 'overhead_pct', label: 'Overhead', suffix: '%', default: 12 },
  { key: 'profit_margin_default_pct', label: 'Default Profit Margin', suffix: '%', default: 15 },
  { key: 'fab_shop_rate', label: 'Fab Shop Rate', prefix: '$', suffix: '/hr', default: 85 },
  { key: 'field_erection_rate', label: 'Field Erection Rate', prefix: '$', suffix: '/hr', default: 95 },
];

export default function CostVariables() {
  const { toast } = useToast();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.SystemSetting.filter({ setting_group: 'cost_variables' }, '-created_date', 1);
      if (list.length > 0) {
        setSettings(list[0]);
      } else {
        const created = await base44.entities.SystemSetting.create({ setting_group: 'cost_variables' });
        setSettings(created);
      }
    } catch (e) {
      toast({ title: 'Failed to load settings', variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = {};
      FIELDS.forEach(f => { updates[f.key] = parseFloat(settings[f.key]) || 0; });
      const updated = await base44.entities.SystemSetting.update(settings.id, updates);
      setSettings(updated);
      toast({ title: 'Cost variables saved successfully' });
    } catch (e) {
      toast({ title: 'Failed to save settings', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  if (loading || !settings) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="steel-card p-6">
        <h3 className="font-semibold mb-1">Core Math Control Panel</h3>
        <p className="text-xs text-muted-foreground mb-6">These variables feed the calculation engines in Estimating and Accounting modules.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FIELDS.map(f => (
            <div key={f.key}>
              <Label className="text-xs">{f.label}</Label>
              <div className="relative mt-1">
                {f.prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{f.prefix}</span>}
                <Input type="number" step="0.01" value={settings[f.key] ?? f.default}
                  onChange={e => setSettings(s => ({ ...s, [f.key]: e.target.value }))}
                  className={`${f.prefix ? 'pl-7' : ''} ${f.suffix ? 'pr-10' : ''}`} />
                {f.suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{f.suffix}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-6 pt-4 border-t border-border">
          <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </Button>
          <Button variant="outline" onClick={loadSettings}><RotateCcw className="w-4 h-4" />Reset</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Last updated: {settings.updated_date ? new Date(settings.updated_date).toLocaleString() : 'Never'}</p>
    </div>
  );
}