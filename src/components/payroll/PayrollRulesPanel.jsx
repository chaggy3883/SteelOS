import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { PAYROLL_RULE_TYPES, RULE_TYPE_LABELS, RULE_TYPE_CONFIG_FIELDS } from '@/lib/payrollRules';

const emptyForm = (ruleType = 'overtime') => ({ rule_type: ruleType, jurisdiction_state: '', effective_date: new Date().toISOString().slice(0, 10), config: {} });

// The setup form only ever writes into `config` — every value shown here
// (thresholds, multipliers, rounding increments) comes from what an admin
// entered, never a constant baked into this component. Any component that
// later needs an actual threshold reads it via getEffectiveRule() in
// payrollRules.js, not from here.
export default function PayrollRulesPanel() {
  const { toast } = useToast();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      setRules(await db.entities.PayrollRule.list('-effective_date', 500));
    } catch (e) {
      toast({ title: 'Unable to load payroll rules', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => a.rule_type.localeCompare(b.rule_type) || (b.effective_date || '').localeCompare(a.effective_date || '')),
    [rules]
  );

  const configFields = RULE_TYPE_CONFIG_FIELDS[form.rule_type] || [];

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setShowForm(true); };
  const openEdit = (rule) => {
    setEditId(rule.id);
    setForm({ rule_type: rule.rule_type, jurisdiction_state: rule.jurisdiction_state || '', effective_date: rule.effective_date, config: { ...(rule.config || {}) } });
    setViewing(null);
    setShowForm(true);
  };

  const setConfigField = (key, value) => setForm((f) => ({ ...f, config: { ...f.config, [key]: value } }));

  const handleRuleTypeChange = (ruleType) => setForm((f) => ({ ...f, rule_type: ruleType, config: {} }));

  const handleSave = async () => {
    if (!form.effective_date) {
      toast({ title: 'Effective date is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        rule_type: form.rule_type,
        jurisdiction_state: form.jurisdiction_state.trim().toUpperCase(),
        effective_date: form.effective_date,
        config: form.config,
      };
      if (editId) {
        await db.entities.PayrollRule.update(editId, payload);
        toast({ title: 'Payroll rule updated' });
      } else {
        await db.entities.PayrollRule.create(payload);
        toast({ title: 'Payroll rule added' });
      }
      setShowForm(false);
      setEditId(null);
      setForm(emptyForm());
      await load();
    } catch (e) {
      toast({ title: 'Unable to save payroll rule', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const configSummary = (rule) => {
    const fields = RULE_TYPE_CONFIG_FIELDS[rule.rule_type] || [];
    const parts = fields
      .filter((f) => rule.config?.[f.key] !== undefined && rule.config?.[f.key] !== '')
      .map((f) => `${f.label}: ${rule.config[f.key]}`);
    return parts.length > 0 ? parts.join(' · ') : 'No config values set';
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="gap-2 steel-gradient text-white border-0" onClick={openAdd}><Plus className="w-4 h-4" />Add Payroll Rule</Button>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-2 px-3">Rule Type</th>
                <th className="text-left py-2 px-3">Jurisdiction</th>
                <th className="text-left py-2 px-3">Config</th>
                <th className="text-left py-2 px-3">Effective</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
              ) : sortedRules.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">No payroll rules configured yet</td></tr>
              ) : sortedRules.map((r) => (
                <tr key={r.id} onClick={() => setViewing(r)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                  <td className="py-2 px-3 font-medium">{RULE_TYPE_LABELS[r.rule_type] || r.rule_type}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.jurisdiction_state || 'Company-wide'}</td>
                  <td className="py-2 px-3 text-muted-foreground text-xs">{configSummary(r)}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.effective_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{RULE_TYPE_LABELS[viewing?.rule_type] || viewing?.rule_type}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Jurisdiction</span><span className="font-medium">{viewing.jurisdiction_state || 'Company-wide'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Effective Date</span><span className="font-medium">{viewing.effective_date}</span></div>
              {(RULE_TYPE_CONFIG_FIELDS[viewing.rule_type] || []).map((f) => (
                <div key={f.key} className="flex justify-between border-b border-border/50 py-1 last:border-0">
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className="font-medium">{viewing.config?.[f.key] !== undefined && viewing.config?.[f.key] !== '' ? String(viewing.config[f.key]) : '—'}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
            <Button onClick={() => openEdit(viewing)} className="steel-gradient text-white border-0">Edit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Add'} Payroll Rule</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Rule Type</Label>
                <Select value={form.rule_type} onValueChange={handleRuleTypeChange}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYROLL_RULE_TYPES.map((t) => <SelectItem key={t} value={t}>{RULE_TYPE_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Effective Date</Label>
                <Input type="date" value={form.effective_date} onChange={(e) => setForm((f) => ({ ...f, effective_date: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Jurisdiction State (optional — blank = company-wide default)</Label>
              <Input
                value={form.jurisdiction_state}
                onChange={(e) => setForm((f) => ({ ...f, jurisdiction_state: e.target.value }))}
                placeholder="e.g. CA — leave blank to apply to every state"
                maxLength={2}
                className="mt-1"
              />
            </div>
            <div className="rounded-lg border border-border p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Config Values</p>
              {configFields.length === 0 ? (
                <p className="text-xs text-muted-foreground">No config fields defined for this rule type yet.</p>
              ) : configFields.map((f) => (
                <div key={f.key} className={f.type === 'boolean' ? 'flex items-center gap-2' : ''}>
                  {f.type === 'boolean' ? (
                    <>
                      <Switch checked={!!form.config[f.key]} onCheckedChange={(v) => setConfigField(f.key, v)} />
                      <Label className="text-xs">{f.label}</Label>
                    </>
                  ) : f.type === 'select' ? (
                    <>
                      <Label className="text-xs">{f.label}</Label>
                      <Select value={form.config[f.key] || ''} onValueChange={(v) => setConfigField(f.key, v)}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>
                          {f.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <>
                      <Label className="text-xs">{f.label}</Label>
                      <Input
                        type="number" step="0.01"
                        value={form.config[f.key] ?? ''}
                        onChange={(e) => setConfigField(f.key, e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder={f.placeholder}
                        className="mt-1"
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
