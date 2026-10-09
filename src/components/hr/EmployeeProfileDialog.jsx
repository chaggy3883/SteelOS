import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SystemAccessPortal from '@/components/hr/SystemAccessPortal';
import EmergencyContactPanel from '@/components/hr/EmergencyContactPanel';
import ComplianceDocumentCenter from '@/components/hr/ComplianceDocumentCenter';
import HiringDocumentsPanel from '@/components/hr/HiringDocumentsPanel';
import I9ComplianceCenter from '@/components/hr/I9ComplianceCenter';
import DisciplinaryActionsPanel from '@/components/hr/DisciplinaryActionsPanel';
import PtoPanel from '@/components/hr/PtoPanel';
import PtoPolicyPanel from '@/components/hr/PtoPolicyPanel';
import TerminationPanel from '@/components/hr/TerminationPanel';
import EquipmentPanel from '@/components/hr/EquipmentPanel';
import EmployeeBankingPanel from '@/components/hr/EmployeeBankingPanel';
import { canManageDisciplinaryActions } from '@/lib/disciplinaryAccess';
import { hasFullEmployeeAccess } from '@/lib/employeesApi';
import { GRANULAR_ACTIONS, hasGranularPermission } from '@/lib/permissionCatalog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle, Save } from 'lucide-react';

// Distinct from personal_email (emergency-contact purpose, never used on
// generated documents) — this is the work email printed as the estimator
// sign-off on bid proposals (bidProposalPdf.js). Employees provisioned
// before this field existed have it blank; flagged here so HR notices and
// backfills it rather than a proposal silently going out with no email.
function CompanyEmailField({ employee, roles, onUpdated }) {
  const { toast } = useToast();
  const canEdit = hasFullEmployeeAccess(roles);
  const [value, setValue] = useState(employee.company_email || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(employee.company_email || ''); }, [employee.id, employee.company_email]);

  const dirty = value !== (employee.company_email || '');

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await db.entities.employees.update(employee.id, { company_email: value.trim() });
      onUpdated(updated);
      toast({ title: 'Company email updated' });
    } catch (e) {
      toast({ title: 'Unable to save company email', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4">
      <Label className="text-xs">Company Email</Label>
      {canEdit ? (
        <div className="flex items-center gap-2 mt-1">
          <Input type="email" value={value} onChange={(e) => setValue(e.target.value)} placeholder="name@hancocksteel.com" className="max-w-xs" />
          {dirty && (
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5 steel-gradient text-white border-0">
              <Save className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-1 text-sm">{employee.company_email || '—'}</p>
      )}
      {!employee.company_email && (
        <p className="mt-1 text-[11px] text-amber-600 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          No company email on file — bid proposals will omit the estimator email line until this is set.
        </p>
      )}
    </div>
  );
}

// employees.supervisor_id drives Timecard's supervisor-approval stage (see
// Timecard.jsonc) — distinct from the free-text supervisor_name, which stays
// untouched here. Same edit pattern as CompanyEmailField above: HR-editable,
// read-only display otherwise. Excludes the employee themself from the
// picker (never self-supervise) and offers "No supervisor assigned" so HR
// can explicitly clear a stale/incorrect link rather than being stuck once set.
function SupervisorField({ employee, employees, roles, onUpdated }) {
  const { toast } = useToast();
  const canEdit = hasFullEmployeeAccess(roles);
  const [value, setValue] = useState(employee.supervisor_id || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(employee.supervisor_id || ''); }, [employee.id, employee.supervisor_id]);

  const dirty = value !== (employee.supervisor_id || '');
  const candidates = employees.filter((e) => e.id !== employee.id && e.is_active);
  const supervisorName = employees.find((e) => e.id === employee.supervisor_id)?.full_name;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await db.entities.employees.update(employee.id, { supervisor_id: value || null });
      onUpdated(updated);
      toast({ title: 'Supervisor updated' });
    } catch (e) {
      toast({ title: 'Unable to save supervisor', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4">
      <Label className="text-xs">Supervisor</Label>
      {canEdit ? (
        <div className="flex items-center gap-2 mt-1">
          <Select value={value || '__none__'} onValueChange={(v) => setValue(v === '__none__' ? '' : v)}>
            <SelectTrigger className="max-w-xs"><SelectValue placeholder="No supervisor assigned" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No supervisor assigned</SelectItem>
              {candidates.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
          {dirty && (
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5 steel-gradient text-white border-0">
              <Save className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-1 text-sm">{supervisorName || '—'}</p>
      )}
      {!employee.supervisor_id && (
        <p className="mt-1 text-[11px] text-amber-600 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          No supervisor assigned — this employee's timecards skip straight to payroll approval.
        </p>
      )}
    </div>
  );
}

export default function EmployeeProfileDialog({ employee, employees = [], roles, granularPermissions, open, onOpenChange, onEmployeeUpdated }) {
  const [current, setCurrent] = useState(employee);
  const [currentUserName, setCurrentUserName] = useState('');
  const showDisciplinary = canManageDisciplinaryActions(roles, granularPermissions);
  const showTermination = hasFullEmployeeAccess(roles);
  // Equipment issue/return history is HR/admin-only, same as Compliance and
  // Termination below — employees never see their own issued_assets records.
  const showEquipment = hasFullEmployeeAccess(roles);
  // Banking (EmployeeBankAccount) is equally sensitive HR/payroll data —
  // gated the same as Equipment/Compliance/Termination, never exposed to an
  // employee viewing their own profile.
  const showBanking = hasFullEmployeeAccess(roles);
  // Deliberately separate from showTermination: that flag also gates the
  // Compliance and PTO Policy tabs below, which aren't part of this pass's
  // granular-permission scope — widening showTermination itself would hand a
  // custom "can terminate" role those two unrelated tabs as a side effect.
  const canTerminate = showTermination || hasGranularPermission(granularPermissions, GRANULAR_ACTIONS.TERMINATE_EMPLOYEE);

  useEffect(() => { setCurrent(employee); }, [employee?.id]);
  useEffect(() => {
    db.auth.me().then((me) => setCurrentUserName(me?.full_name || me?.email || '')).catch(() => {});
  }, []);

  const handleUpdated = (updated) => {
    setCurrent(updated);
    onEmployeeUpdated(updated);
  };

  if (!current) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{current.full_name} — #{current.employee_number}</DialogTitle>
          <DialogDescription>
            {current.position || current.classification} • Hired {current.hire_date || '—'}
          </DialogDescription>
        </DialogHeader>
        <CompanyEmailField employee={current} roles={roles} onUpdated={handleUpdated} />
        <SupervisorField employee={current} employees={employees} roles={roles} onUpdated={handleUpdated} />
        <Tabs defaultValue="access">
          <TabsList className="mb-4">
            <TabsTrigger value="access">System Access</TabsTrigger>
            <TabsTrigger value="emergency">Emergency Contact</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            {showEquipment && <TabsTrigger value="equipment">Equipment</TabsTrigger>}
            {showBanking && <TabsTrigger value="banking">Banking</TabsTrigger>}
            {showTermination && <TabsTrigger value="compliance">Compliance</TabsTrigger>}
            <TabsTrigger value="pto">PTO</TabsTrigger>
            {showTermination && <TabsTrigger value="pto-policy">PTO Policy</TabsTrigger>}
            {showDisciplinary && <TabsTrigger value="disciplinary">Disciplinary</TabsTrigger>}
            {canTerminate && <TabsTrigger value="termination">Termination</TabsTrigger>}
          </TabsList>
          <TabsContent value="access">
            <SystemAccessPortal employee={current} roles={roles} onUpdated={handleUpdated} />
          </TabsContent>
          <TabsContent value="emergency">
            <EmergencyContactPanel employee={current} roles={roles} onUpdated={handleUpdated} />
          </TabsContent>
          <TabsContent value="documents" className="space-y-4">
            <ComplianceDocumentCenter employee={current} />
            <div className="steel-card p-4">
              <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">Hiring Documents</h4>
              <HiringDocumentsPanel ownerType="employee" ownerId={current.id} uploadedByName={currentUserName} />
            </div>
          </TabsContent>
          {showEquipment && (
            <TabsContent value="equipment">
              <EquipmentPanel employee={current} />
            </TabsContent>
          )}
          {showBanking && (
            <TabsContent value="banking">
              <EmployeeBankingPanel employee={current} roles={roles} onUpdated={handleUpdated} />
            </TabsContent>
          )}
          {showTermination && (
            <TabsContent value="compliance">
              <I9ComplianceCenter employee={current} onUpdated={handleUpdated} />
            </TabsContent>
          )}
          <TabsContent value="pto">
            <PtoPanel employee={current} roles={roles} />
          </TabsContent>
          {showTermination && (
            <TabsContent value="pto-policy">
              <PtoPolicyPanel employee={current} roles={roles} />
            </TabsContent>
          )}
          {showDisciplinary && (
            <TabsContent value="disciplinary">
              <DisciplinaryActionsPanel employee={current} employees={employees} roles={roles} granularPermissions={granularPermissions} />
            </TabsContent>
          )}
          {canTerminate && (
            <TabsContent value="termination">
              <TerminationPanel employee={current} roles={roles} granularPermissions={granularPermissions} onUpdated={handleUpdated} />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
