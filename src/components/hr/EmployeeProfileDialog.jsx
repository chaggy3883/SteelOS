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
import { canManageDisciplinaryActions } from '@/lib/disciplinaryAccess';
import { hasFullEmployeeAccess } from '@/lib/employeesApi';
import { GRANULAR_ACTIONS, hasGranularPermission } from '@/lib/permissionCatalog';

export default function EmployeeProfileDialog({ employee, employees = [], roles, granularPermissions, open, onOpenChange, onEmployeeUpdated }) {
  const [current, setCurrent] = useState(employee);
  const [currentUserName, setCurrentUserName] = useState('');
  const showDisciplinary = canManageDisciplinaryActions(roles, granularPermissions);
  const showTermination = hasFullEmployeeAccess(roles);
  // Equipment issue/return history is HR/admin-only, same as Compliance and
  // Termination below — employees never see their own issued_assets records.
  const showEquipment = hasFullEmployeeAccess(roles);
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
        <Tabs defaultValue="access">
          <TabsList className="mb-4">
            <TabsTrigger value="access">System Access</TabsTrigger>
            <TabsTrigger value="emergency">Emergency Contact</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            {showEquipment && <TabsTrigger value="equipment">Equipment</TabsTrigger>}
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
