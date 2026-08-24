import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { isAdminUser } from '@/lib/tenantContext';
import { useAuth } from '@/lib/AuthContext';
import { ShieldCheck, Loader2, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';
import { SALES_WIDGETS } from '@/lib/salesDashboardData';

const CALC_METHODS = [
  { value: 'profit_percent', label: 'Profit %', description: 'Commission = (bid amount − actual job cost) × rate%' },
  { value: 'bid_amount_percent', label: 'Bid Amount %', description: 'Commission = bid amount × rate%' },
  { value: 'flat_rate', label: 'Flat Rate per Job', description: 'A fixed dollar amount per project, regardless of size' },
];

const emptyConfig = () => ({
  commission_enabled: true,
  default_commission_rate: 5,
  commission_calc_method: 'profit_percent',
  flat_rate_amount: 0,
  per_salesman_override: true,
  payment_trigger: 'on_payment_received',
  next_payroll_cycle: true,
  allow_salesmen_see_pipeline: true,
  default_dashboard_widgets: SALES_WIDGETS.map((w) => w.id),
});

export default function CommissionSetup() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [currentUser, setCurrentUser] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [configId, setConfigId] = useState(null);
  const [form, setForm] = useState(emptyConfig());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    db.auth.me().then((u) => { setCurrentUser(u); setCheckingAccess(false); }).catch(() => setCheckingAccess(false));
  }, []);

  useEffect(() => { loadConfig(); }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const existing = await db.entities.SalesCommissionConfig.list('-created_date', 1);
      if (existing[0]) {
        setConfigId(existing[0].id);
        setForm({ ...emptyConfig(), ...existing[0] });
      } else {
        setConfigId(null);
        setForm(emptyConfig());
      }
    } catch (e) {
      setForm(emptyConfig());
    } finally {
      setLoading(false);
    }
  };

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const toggleDefaultWidget = (id) => setForm((f) => {
    const current = f.default_dashboard_widgets || [];
    const next = current.includes(id) ? current.filter((w) => w !== id) : [...current, id];
    return { ...f, default_dashboard_widgets: next };
  });

  const handleSave = async () => {
    const rate = parseFloat(form.default_commission_rate);
    const flatAmount = parseFloat(form.flat_rate_amount);
    if (form.commission_calc_method === 'flat_rate' && (Number.isNaN(flatAmount) || flatAmount < 0)) {
      toast({ title: 'Enter a valid flat rate amount', variant: 'destructive' });
      return;
    }
    if (form.commission_calc_method !== 'flat_rate' && (Number.isNaN(rate) || rate < 0)) {
      toast({ title: 'Enter a valid default commission rate', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        commission_enabled: !!form.commission_enabled,
        default_commission_rate: Number.isNaN(rate) ? 0 : rate,
        commission_calc_method: form.commission_calc_method,
        flat_rate_amount: Number.isNaN(flatAmount) ? 0 : flatAmount,
        per_salesman_override: !!form.per_salesman_override,
        payment_trigger: 'on_payment_received',
        next_payroll_cycle: !!form.next_payroll_cycle,
        allow_salesmen_see_pipeline: !!form.allow_salesmen_see_pipeline,
        default_dashboard_widgets: form.default_dashboard_widgets,
      };
      if (configId) {
        await db.entities.SalesCommissionConfig.update(configId, payload);
      } else {
        const created = await db.entities.SalesCommissionConfig.create({ ...payload, created_by: user?.full_name || user?.email || 'Unknown' });
        setConfigId(created.id);
      }
      toast({ title: 'Commission settings saved' });
    } catch (e) {
      toast({ title: 'Unable to save commission settings', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (checkingAccess || loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!isAdminUser(currentUser)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Admin Access Required</h2>
        <p className="text-sm text-muted-foreground">You need administrator privileges to configure sales commissions.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <PageHeader
        title="Sales Commission Setup"
        subtitle="How commissions are calculated and paid, company-wide."
        actions={<Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Save Settings</Button>}
      />

      <div className="steel-card p-5 mb-4 flex items-center justify-between">
        <div>
          <p className="font-medium">Commission Program Enabled</p>
          <p className="text-sm text-muted-foreground">Turn off to stop calculating and triggering new commissions company-wide.</p>
        </div>
        <Switch checked={!!form.commission_enabled} onCheckedChange={(v) => update('commission_enabled', v)} />
      </div>

      <div className="steel-card p-5 mb-4">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Commission Calculation Method</Label>
        <RadioGroup value={form.commission_calc_method} onValueChange={(v) => update('commission_calc_method', v)} className="mt-3 space-y-3">
          {CALC_METHODS.map((m) => (
            <div key={m.value} className="flex items-start gap-2">
              <RadioGroupItem value={m.value} id={`method-${m.value}`} className="mt-0.5" />
              <div>
                <Label htmlFor={`method-${m.value}`} className="font-medium cursor-pointer">{m.label}</Label>
                <p className="text-xs text-muted-foreground">{m.description}</p>
              </div>
            </div>
          ))}
        </RadioGroup>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {form.commission_calc_method === 'flat_rate' ? (
            <div>
              <Label>Flat Rate per Job ($)</Label>
              <div className="relative mt-1">
                <DollarSign className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input type="number" step="0.01" min="0" className="pl-7" value={form.flat_rate_amount} onChange={(e) => update('flat_rate_amount', e.target.value)} />
              </div>
            </div>
          ) : (
            <div>
              <Label>Default Commission Rate (%)</Label>
              <Input type="number" step="0.1" min="0" max="100" className="mt-1" value={form.default_commission_rate} onChange={(e) => update('default_commission_rate', e.target.value)} />
            </div>
          )}
        </div>
      </div>

      <div className="steel-card p-5 mb-4 flex items-center justify-between">
        <div>
          <p className="font-medium">Per-Salesman Rate Override</p>
          <p className="text-sm text-muted-foreground">Allow individual salesmen to have their own rate instead of always using the default (managed in Salesman Rates).</p>
        </div>
        <Switch checked={!!form.per_salesman_override} onCheckedChange={(v) => update('per_salesman_override', v)} />
      </div>

      <div className="steel-card p-5 mb-4 flex items-center justify-between">
        <div>
          <p className="font-medium">Queue for Next Payroll Cycle</p>
          <p className="text-sm text-muted-foreground">When a customer payment triggers a commission, automatically queue it for the next payroll cycle rather than requiring a manual queue action.</p>
        </div>
        <Switch checked={!!form.next_payroll_cycle} onCheckedChange={(v) => update('next_payroll_cycle', v)} />
      </div>

      <div className="steel-card p-5 mb-4 flex items-center justify-between">
        <div>
          <p className="font-medium">Salesmen Can See Pipeline</p>
          <p className="text-sm text-muted-foreground">When off, the Sales Pipeline widget is hidden on every salesman's own dashboard company-wide. Admin/Payroll Admin viewing for support always see it.</p>
        </div>
        <Switch checked={!!form.allow_salesmen_see_pipeline} onCheckedChange={(v) => update('allow_salesmen_see_pipeline', v)} />
      </div>

      <div className="steel-card p-5">
        <p className="font-medium">Default Dashboard Widgets</p>
        <p className="text-sm text-muted-foreground mb-3">Widgets enabled by default the first time a salesman loads their dashboard — each salesman can still toggle their own set afterward.</p>
        <div className="space-y-2">
          {SALES_WIDGETS.map((w) => (
            <div key={w.id} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{w.label}</p>
                <p className="text-xs text-muted-foreground">{w.description}</p>
              </div>
              <Switch checked={(form.default_dashboard_widgets || []).includes(w.id)} onCheckedChange={() => toggleDefaultWidget(w.id)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
