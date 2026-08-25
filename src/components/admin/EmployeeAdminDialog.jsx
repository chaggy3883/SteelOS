import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { assignPlatformRole } from '@/lib/employeesApi';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { ExternalLink } from 'lucide-react';

const EMPLOYEE_STATUSES = ['Active', 'On Leave', 'Probation', 'Inactive'];

export default function EmployeeAdminDialog({ employee, open, onOpenChange, allRoles, onUpdated }) {
  const { toast } = useToast();
  const [platformRole, setPlatformRole] = useState('');
  const [employeeStatus, setEmployeeStatus] = useState('Active');
  const [isSalesman, setIsSalesman] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!employee) return;
    setPlatformRole(employee.platform_role || '');
    setEmployeeStatus(employee.employee_status || 'Active');
    setIsSalesman(!!employee.is_salesman);
  }, [employee?.id, open]);

  if (!employee) return null;

  const isTerminated = !!employee.termination_date;

  const handleSave = async () => {
    setSaving(true);
    try {
      let updated = employee;
      // Role is deterministic — see assignPlatformRole's comment in
      // employeesApi.js — it also cascades to a linked portal login so real
      // access actually changes, not just the badge on this row.
      if (platformRole !== (employee.platform_role || '')) {
        updated = await assignPlatformRole(employee, platformRole);
      }
      if (!isTerminated && (employeeStatus !== (employee.employee_status || 'Active') || isSalesman !== !!employee.is_salesman)) {
        updated = await db.entities.employees.update(employee.id, {
          employee_status: employeeStatus,
          is_active: employeeStatus !== 'Inactive',
          is_salesman: isSalesman,
        });
      }
      onUpdated(updated);
      toast({ title: `${updated.full_name} updated` });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Unable to save changes', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const emergencyContact2 = employee.emergency_contact2_name || employee.emergency_contact2_phone;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employee.full_name} — #{employee.employee_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <p><span className="text-muted-foreground">Email:</span> {employee.personal_email || '—'}</p>
            <p><span className="text-muted-foreground">Phone:</span> {employee.phone || '—'}</p>
            <p><span className="text-muted-foreground">Hire Date:</span> {employee.hire_date || '—'}</p>
            <p><span className="text-muted-foreground">Position:</span> {employee.job_title || '—'}</p>
            <p><span className="text-muted-foreground">Department:</span> {employee.department || '—'}</p>
            <p><span className="text-muted-foreground">Classification:</span> {employee.classification || '—'}</p>
          </div>

          <div className="pt-2 border-t border-border/50 text-sm space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Emergency Contact 1</p>
            <p>{employee.emergency_contact_name || '—'} {employee.emergency_contact_relationship ? `(${employee.emergency_contact_relationship})` : ''} {employee.emergency_contact_phone}</p>
            {emergencyContact2 && (
              <>
                <p className="text-xs font-semibold text-muted-foreground mt-2">Emergency Contact 2</p>
                <p>{employee.emergency_contact2_name || '—'} {employee.emergency_contact2_relationship ? `(${employee.emergency_contact2_relationship})` : ''} {employee.emergency_contact2_phone}</p>
              </>
            )}
          </div>

          <div className="pt-2 border-t border-border/50 grid grid-cols-2 gap-3">
            <div>
              <Label>Role</Label>
              <Select value={platformRole} onValueChange={setPlatformRole} disabled={saving}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  {allRoles.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              {isTerminated ? (
                <p className="mt-1 text-sm inline-flex items-center px-2.5 py-1.5 rounded-full bg-red-500/10 text-red-600 font-medium">Terminated</p>
              ) : (
                <Select value={employeeStatus} onValueChange={setEmployeeStatus} disabled={saving}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EMPLOYEE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm col-span-2">
              <Checkbox checked={isSalesman} onCheckedChange={(v) => setIsSalesman(!!v)} disabled={saving || isTerminated} />
              Eligible for sales commission (is_salesman)
            </label>
          </div>

          {isTerminated && (
            <p className="text-xs text-muted-foreground">
              This employee is terminated. To reinstate or manage the termination record, use the full HR profile below.
            </p>
          )}

          <div className="flex items-center justify-between pt-2">
            <Link to={`/human-resources?employee=${employee.id}`} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
              Open full HR profile<ExternalLink className="w-3 h-3" />
            </Link>
            <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
