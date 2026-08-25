import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { hasFullEmployeeAccess } from '@/lib/employeesApi';
import { PTO_TRACKED_LEAVE_TYPES, getActivePolicy, listEmployeePtoPoliciesForEmployee, setEmployeePtoPolicy } from '@/lib/ptoEngine';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { CalendarClock, Loader2, ShieldAlert } from 'lucide-react';

const emptyRow = () => ({ useStandardPolicy: true, ptoPolicyId: '', notes: '' });

const policySummary = (policy) => {
  if (!policy) return 'No active company policy on file for this leave type';
  const tiers = Array.isArray(policy.tenure_tiers) ? policy.tenure_tiers : [];
  const tierText = tiers.length > 0
    ? ` (tiers: ${tiers.map((t) => `${t.years_of_service}y→${t.annual_hours}h`).join(', ')})`
    : '';
  return `${policy.policy_name} — ${policy.annual_hours}h/year${tierText}`;
};

// HR's per-employee PTO policy assignment — one row per tracked leave type
// (PtoPolicy is itself scoped to a single leave type, so PTO/Sick/Bereavement
// can each independently follow the company standard or a negotiated one).
// Writes through setEmployeePtoPolicy in ptoEngine.js, the same module every
// accrual/approval/termination path reads the effective policy from.
export default function PtoPolicyPanel({ employee, roles = [] }) {
  const { toast } = useToast();
  const canEdit = hasFullEmployeeAccess(roles);
  const [loading, setLoading] = useState(true);
  const [companyDefaults, setCompanyDefaults] = useState({});
  const [policyOptions, setPolicyOptions] = useState({});
  const [form, setForm] = useState({});
  const [savingType, setSavingType] = useState(null);

  useEffect(() => { load(); }, [employee?.id]);

  const load = async () => {
    setLoading(true);
    try {
      // Alternative-policy choices intentionally include INACTIVE policies too
      // (unlike getActivePolicy's company-default lookup) — a one-off
      // negotiated policy assigned to a single employee shouldn't need
      // is_active: true, since that flag is what makes a policy the company
      // standard, and an extra active policy for the same leave type would
      // ambiguously compete with the real standard one (getActivePolicy just
      // picks the newest active row when more than one exists).
      const [overrides, allPolicies, ...defaults] = await Promise.all([
        listEmployeePtoPoliciesForEmployee(employee.id),
        db.entities.PtoPolicy.filter({ company_id: employee.company_id }, 'leave_type', 200),
        ...PTO_TRACKED_LEAVE_TYPES.map((lt) => getActivePolicy(employee.company_id, lt)),
      ]);
      const overrideByType = Object.fromEntries(overrides.map((o) => [o.leave_type, o]));
      setCompanyDefaults(Object.fromEntries(PTO_TRACKED_LEAVE_TYPES.map((lt, i) => [lt, defaults[i]])));
      setPolicyOptions(Object.fromEntries(PTO_TRACKED_LEAVE_TYPES.map((lt) => [lt, allPolicies.filter((p) => p.leave_type === lt)])));
      setForm(Object.fromEntries(PTO_TRACKED_LEAVE_TYPES.map((lt) => {
        const o = overrideByType[lt];
        return [lt, o ? { useStandardPolicy: o.use_standard_policy !== false, ptoPolicyId: o.pto_policy_id || '', notes: o.notes || '' } : emptyRow()];
      })));
    } finally {
      setLoading(false);
    }
  };

  const setRow = (leaveType, patch) => setForm((f) => ({ ...f, [leaveType]: { ...f[leaveType], ...patch } }));

  const handleSave = async (leaveType) => {
    const row = form[leaveType];
    if (!row.useStandardPolicy && !row.ptoPolicyId) {
      toast({ title: 'Select an alternative policy or turn standard policy back on', variant: 'destructive' });
      return;
    }
    setSavingType(leaveType);
    try {
      await setEmployeePtoPolicy(employee, leaveType, {
        useStandardPolicy: row.useStandardPolicy,
        ptoPolicyId: row.ptoPolicyId,
        notes: row.notes,
      });
      toast({ title: `${leaveType} policy assignment saved` });
    } catch (e) {
      toast({ title: 'Unable to save PTO policy assignment', variant: 'destructive' });
    } finally {
      setSavingType(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  if (!canEdit) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
        <ShieldAlert className="w-8 h-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">HR Admin, Payroll Admin, or Admin access is required to view PTO policy assignments.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {PTO_TRACKED_LEAVE_TYPES.map((leaveType) => {
        const row = form[leaveType] || emptyRow();
        const alternatives = policyOptions[leaveType] || [];
        return (
          <div key={leaveType} className="steel-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm flex items-center gap-2"><CalendarClock className="w-4 h-4 text-primary" />{leaveType}</h4>
              <label className="flex items-center gap-2 text-xs">
                Use Standard Company Policy
                <Switch checked={row.useStandardPolicy} onCheckedChange={(v) => setRow(leaveType, { useStandardPolicy: v })} />
              </label>
            </div>

            {row.useStandardPolicy ? (
              <p className="text-sm text-muted-foreground">{policySummary(companyDefaults[leaveType])}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Alternative Policy</Label>
                  <Select value={row.ptoPolicyId} onValueChange={(v) => setRow(leaveType, { ptoPolicyId: v })}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select a policy…" /></SelectTrigger>
                    <SelectContent>
                      {alternatives.map((p) => <SelectItem key={p.id} value={p.id}>{p.policy_name}{!p.is_active ? ' (inactive — custom only)' : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Notes (reason for custom policy)</Label>
                  <Input value={row.notes} onChange={(e) => setRow(leaveType, { notes: e.target.value })} placeholder="e.g. Negotiated 150 hours/year" className="mt-1" />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button size="sm" onClick={() => handleSave(leaveType)} disabled={savingType === leaveType} className="steel-gradient text-white border-0">
                {savingType === leaveType ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
