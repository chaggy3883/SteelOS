import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { hasFullEmployeeAccess } from '@/lib/employeesApi';
import { ShieldCheck, Plus, Edit2, Trash2, Loader2, CalendarClock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';

const LEAVE_TYPES = ['PTO', 'Sick', 'Bereavement'];
const ACCRUAL_METHODS = [
  { value: 'anniversary_grant', label: 'Anniversary Grant' },
  { value: 'per_pay_period', label: 'Per Pay Period' },
  { value: 'per_hour_worked', label: 'Per Hour Worked' },
];

const PAYOUT_ON_TERMINATION_OPTIONS = [
  { value: 'never', label: 'Never — forfeit unused balance' },
  { value: 'always', label: 'Always — pay out on final check' },
  { value: 'policy_dependent', label: 'Jurisdiction-dependent (stub — treated as Never)' },
];

const emptyForm = () => ({
  policy_name: '', leave_type: 'PTO', accrual_method: 'anniversary_grant',
  annual_hours: '', accrual_rate: '', max_balance: '', carryover_allowed: true,
  max_carryover_hours: '', waiting_period_days: '', overdraft_action: 'hard_block',
  payout_on_termination: 'never', tenure_tiers: [], is_active: true,
});

export default function PtoPoliciesAdmin() {
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    db.auth.me().then((u) => { setCurrentUser(u); setCheckingAccess(false); }).catch(() => setCheckingAccess(false));
  }, []);

  useEffect(() => { loadPolicies(); }, []);

  const loadPolicies = async () => {
    setLoading(true);
    try {
      const list = await db.entities.PtoPolicy.list('leave_type', 200);
      setPolicies(list);
    } catch (e) {
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (policy) => {
    setEditId(policy.id);
    setForm({
      policy_name: policy.policy_name || '',
      leave_type: policy.leave_type || 'PTO',
      accrual_method: policy.accrual_method || 'anniversary_grant',
      annual_hours: String(policy.annual_hours ?? ''),
      accrual_rate: String(policy.accrual_rate ?? ''),
      max_balance: String(policy.max_balance ?? ''),
      carryover_allowed: policy.carryover_allowed !== false,
      max_carryover_hours: String(policy.max_carryover_hours ?? ''),
      waiting_period_days: String(policy.waiting_period_days ?? ''),
      overdraft_action: policy.overdraft_action || 'hard_block',
      payout_on_termination: policy.payout_on_termination || 'never',
      tenure_tiers: Array.isArray(policy.tenure_tiers) ? policy.tenure_tiers.map((t) => ({ years_of_service: String(t.years_of_service ?? ''), annual_hours: String(t.annual_hours ?? '') })) : [],
      is_active: policy.is_active !== false,
    });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditId(null); setForm(emptyForm()); };

  const addTier = () => setForm((f) => ({ ...f, tenure_tiers: [...f.tenure_tiers, { years_of_service: '', annual_hours: '' }] }));
  const updateTier = (index, field, value) => setForm((f) => ({
    ...f,
    tenure_tiers: f.tenure_tiers.map((t, i) => (i === index ? { ...t, [field]: value } : t)),
  }));
  const removeTier = (index) => setForm((f) => ({ ...f, tenure_tiers: f.tenure_tiers.filter((_, i) => i !== index) }));

  const handleSave = async () => {
    if (!form.policy_name.trim()) {
      toast({ title: 'Policy name is required', variant: 'destructive' });
      return;
    }
    const tenureTiers = form.tenure_tiers
      .filter((t) => t.years_of_service !== '' && t.annual_hours !== '')
      .map((t) => ({ years_of_service: Number(t.years_of_service) || 0, annual_hours: Number(t.annual_hours) || 0 }))
      .sort((a, b) => a.years_of_service - b.years_of_service);

    const data = {
      policy_name: form.policy_name.trim(),
      leave_type: form.leave_type,
      accrual_method: form.accrual_method,
      annual_hours: Number(form.annual_hours) || 0,
      accrual_rate: Number(form.accrual_rate) || 0,
      max_balance: Number(form.max_balance) || 0,
      carryover_allowed: form.carryover_allowed,
      max_carryover_hours: Number(form.max_carryover_hours) || 0,
      waiting_period_days: Number(form.waiting_period_days) || 0,
      overdraft_action: form.overdraft_action,
      payout_on_termination: form.payout_on_termination,
      tenure_tiers: tenureTiers,
      is_active: form.is_active,
    };

    setSaving(true);
    try {
      if (editId) {
        await db.entities.PtoPolicy.update(editId, data);
        toast({ title: 'PTO policy updated' });
      } else {
        await db.entities.PtoPolicy.create(data);
        toast({ title: 'PTO policy created' });
      }
      closeModal();
      loadPolicies();
    } catch (e) {
      toast({ title: 'Failed to save policy', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (policy) => {
    if (!confirm(`Delete the "${policy.policy_name}" policy? Existing balances and transaction history are kept.`)) return;
    try {
      await db.entities.PtoPolicy.delete(policy.id);
      setPolicies((prev) => prev.filter((p) => p.id !== policy.id));
      toast({ title: 'PTO policy deleted' });
      if (editId === policy.id) closeModal();
    } catch (e) {
      toast({ title: 'Failed to delete policy', variant: 'destructive' });
    }
  };

  if (checkingAccess) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!hasFullEmployeeAccess(currentUser?.roles)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">HR/Admin Access Required</h2>
        <p className="text-sm text-muted-foreground">You need an HR Admin, Payroll Admin, or Admin role to manage PTO policies.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="PTO Policies"
        subtitle="Accrual rules per leave type — tenure tiers, carryover caps, and waiting periods. Employee balances renew against these automatically on anniversary_date."
        actions={<Button onClick={openAdd} className="steel-gradient text-white border-0"><Plus className="w-4 h-4" />Add Policy</Button>}
      />

      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Policy</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Leave Type</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Method</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Annual Hours</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Carryover</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Termination Payout</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></td></tr>
            ) : policies.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-muted-foreground">
                  <CalendarClock className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No PTO policies yet. Click "Add Policy" to create one.
                </td>
              </tr>
            ) : policies.map((policy) => (
              <tr key={policy.id} onClick={() => openEdit(policy)} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer">
                <td className="px-4 py-3">
                  <button onClick={(e) => { e.stopPropagation(); openEdit(policy); }} className="font-medium text-primary hover:underline">{policy.policy_name}</button>
                  {Array.isArray(policy.tenure_tiers) && policy.tenure_tiers.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">{policy.tenure_tiers.length} tenure tier{policy.tenure_tiers.length > 1 ? 's' : ''}</p>
                  )}
                </td>
                <td className="px-4 py-3">{policy.leave_type}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{ACCRUAL_METHODS.find((m) => m.value === policy.accrual_method)?.label || policy.accrual_method}</td>
                <td className="px-4 py-3 font-mono text-xs">{policy.annual_hours}h</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{policy.carryover_allowed ? `Up to ${policy.max_carryover_hours}h` : 'None'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${(policy.payout_on_termination || 'never') === 'always' ? 'bg-amber-500/10 text-amber-600' : 'bg-gray-500/10 text-gray-500'}`}>
                    {(policy.payout_on_termination || 'never') === 'always' ? 'Paid out' : (policy.payout_on_termination === 'policy_dependent' ? 'Jurisdiction (→ forfeit)' : 'Forfeited')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${policy.is_active ? 'bg-green-500/10 text-green-600' : 'bg-gray-500/10 text-gray-500'}`}>{policy.is_active ? 'Active' : 'Inactive'}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); openEdit(policy); }}><Edit2 className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleDelete(policy); }}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Dialog open onOpenChange={closeModal}>
          <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editId ? 'Edit PTO Policy' : 'Add PTO Policy'}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Policy Name</Label>
                  <Input value={form.policy_name} onChange={(e) => setForm((f) => ({ ...f, policy_name: e.target.value }))} placeholder="Standard PTO" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Leave Type</Label>
                  <Select value={form.leave_type} onValueChange={(v) => setForm((f) => ({ ...f, leave_type: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LEAVE_TYPES.map((lt) => <SelectItem key={lt} value={lt}>{lt}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Accrual Method</Label>
                  <Select value={form.accrual_method} onValueChange={(v) => setForm((f) => ({ ...f, accrual_method: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ACCRUAL_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Base Annual Hours</Label>
                  <Input type="number" value={form.annual_hours} onChange={(e) => setForm((f) => ({ ...f, annual_hours: e.target.value }))} placeholder="80" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Max Balance (0 = uncapped)</Label>
                  <Input type="number" value={form.max_balance} onChange={(e) => setForm((f) => ({ ...f, max_balance: e.target.value }))} placeholder="240" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Max Carryover Hours</Label>
                  <Input type="number" value={form.max_carryover_hours} onChange={(e) => setForm((f) => ({ ...f, max_carryover_hours: e.target.value }))} placeholder="40" className="mt-1" disabled={!form.carryover_allowed} />
                </div>
                <div>
                  <Label className="text-xs">Waiting Period (days)</Label>
                  <Input type="number" value={form.waiting_period_days} onChange={(e) => setForm((f) => ({ ...f, waiting_period_days: e.target.value }))} placeholder="90" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">If a request exceeds balance</Label>
                  <Select value={form.overdraft_action} onValueChange={(v) => setForm((f) => ({ ...f, overdraft_action: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hard_block">Hard block approval</SelectItem>
                      <SelectItem value="allow_negative">Allow negative balance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">On Termination</Label>
                  <Select value={form.payout_on_termination} onValueChange={(v) => setForm((f) => ({ ...f, payout_on_termination: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYOUT_ON_TERMINATION_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-2.5">
                <Label className="text-xs">Carryover Allowed</Label>
                <Switch checked={form.carryover_allowed} onCheckedChange={(v) => setForm((f) => ({ ...f, carryover_allowed: v }))} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-2.5">
                <Label className="text-xs">Active</Label>
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
              </div>

              <div className="pt-2 border-t border-border/50">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-semibold">Tenure Tiers (optional — overrides base annual hours by years of service)</Label>
                  <Button size="sm" variant="outline" className="h-7 gap-1" onClick={addTier}><Plus className="w-3 h-3" />Add Tier</Button>
                </div>
                {form.tenure_tiers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No tenure tiers — every employee accrues the flat base annual hours above.</p>
                ) : (
                  <div className="space-y-2">
                    {form.tenure_tiers.map((tier, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input type="number" value={tier.years_of_service} onChange={(e) => updateTier(index, 'years_of_service', e.target.value)} placeholder="Years of service" className="h-8 text-xs" />
                        <span className="text-xs text-muted-foreground flex-shrink-0">yr+ →</span>
                        <Input type="number" value={tier.annual_hours} onChange={(e) => updateTier(index, 'annual_hours', e.target.value)} placeholder="Annual hours" className="h-8 text-xs" />
                        <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => removeTier(index)}><X className="w-3.5 h-3.5 text-destructive" /></Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter className="flex items-center justify-between sm:justify-between">
              {editId ? (
                <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => handleDelete({ id: editId, policy_name: form.policy_name })}>
                  <Trash2 className="w-4 h-4" />Delete
                </Button>
              ) : <span />}
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={closeModal}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{editId ? 'Update' : 'Save'}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
