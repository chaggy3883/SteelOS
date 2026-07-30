import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { setManualPin } from '@/lib/employeesApi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { KeyRound, Save } from 'lucide-react';

// Wage editing is intentionally a narrower set than general HR record
// access (FULL_ACCESS_ROLES in employeesApi.js also grants hr_admin) —
// hourly pay rate is payroll-sensitive, so only these three roles can write it.
const WAGE_EDIT_ROLES = ['admin', 'super_admin', 'payroll_admin'];

export default function SystemAccessPortal({ employee, roles, onUpdated }) {
  const { toast } = useToast();
  const [newPin, setNewPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [wageInput, setWageInput] = useState(String(((employee.pay_rate_cents || 0) / 100).toFixed(2)));
  const [savingWage, setSavingWage] = useState(false);
  const canEditWage = (roles || []).some((r) => WAGE_EDIT_ROLES.includes(String(r).toLowerCase()));

  const handleSavePin = async () => {
    if (newPin.length !== 5) {
      toast({ title: 'PIN must be exactly 5 digits', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const updated = await setManualPin(employee, newPin);
      onUpdated(updated);
      setNewPin('');
      toast({ title: 'PIN overwritten', description: `${employee.full_name}'s login PIN has been manually set.` });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (value) => {
    const updated = await base44.entities.employees.update(employee.id, { is_active_login: value });
    onUpdated(updated);
    toast({ title: value ? 'Login re-enabled' : 'Login suspended' });
  };

  const handleSaveWage = async () => {
    const dollars = Number(wageInput);
    if (!Number.isFinite(dollars) || dollars < 0) {
      toast({ title: 'Enter a valid hourly rate', variant: 'destructive' });
      return;
    }
    setSavingWage(true);
    try {
      const updated = await base44.entities.employees.update(employee.id, { pay_rate_cents: Math.round(dollars * 100) });
      onUpdated(updated);
      toast({ title: 'Hourly pay rate updated' });
    } finally {
      setSavingWage(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary" />System Access Portal</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Badge ID (auto-assigned)</Label>
            <div className="mt-1">
              <Badge variant="secondary" className="font-mono text-sm">{employee.employee_number}</Badge>
            </div>
          </div>
          <div>
            <Label className="text-xs">Account Active</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <Switch checked={employee.is_active_login !== false} onCheckedChange={handleToggleActive} />
              <span className="text-xs text-muted-foreground">{employee.is_active_login !== false ? 'Active' : 'Suspended'}</span>
            </div>
          </div>
        </div>

        {canEditWage && (
          <div className="mt-4 pt-4 border-t border-border">
            <Label className="text-xs">Hourly Pay Rate ($)</Label>
            <div className="flex gap-2 mt-1">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={wageInput}
                onChange={(e) => setWageInput(e.target.value)}
                className="font-mono"
              />
              <Button onClick={handleSaveWage} disabled={savingWage} className="gap-1.5 steel-gradient text-white border-0 flex-shrink-0">
                <Save className="w-3.5 h-3.5" />{savingWage ? 'Saving…' : 'Save Rate'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Visible only to Admin, Super Admin, and Payroll Admin roles.</p>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-border">
          <Label className="text-xs">Overwrite Login PIN (5 digits)</Label>
          <div className="flex gap-2 mt-1">
            <Input
              type="password"
              maxLength={5}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="•••••"
              className="font-mono"
            />
            <Button onClick={handleSavePin} disabled={saving} className="gap-1.5 steel-gradient text-white border-0 flex-shrink-0">
              <Save className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save PIN'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Overwrites the formula-derived default. Editing this employee's SSN or Badge ID later recomputes the formula and replaces this override.
          </p>
        </div>
      </div>
    </div>
  );
}
