import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SystemAccessPortal from '@/components/hr/SystemAccessPortal';
import EmergencyContactPanel from '@/components/hr/EmergencyContactPanel';
import ComplianceDocumentCenter from '@/components/hr/ComplianceDocumentCenter';
import I9ComplianceCenter from '@/components/hr/I9ComplianceCenter';
import DisciplinaryActionsPanel from '@/components/hr/DisciplinaryActionsPanel';
import PtoPanel from '@/components/hr/PtoPanel';
import PtoPolicyPanel from '@/components/hr/PtoPolicyPanel';
import TerminationPanel from '@/components/hr/TerminationPanel';
import EquipmentPanel from '@/components/hr/EquipmentPanel';
import { canManageDisciplinaryActions } from '@/lib/disciplinaryAccess';
import { hasFullEmployeeAccess } from '@/lib/employeesApi';

export default function EmployeeProfileDialog({ employee, employees = [], roles, open, onOpenChange, onEmployeeUpdated }) {
  const [current, setCurrent] = useState(employee);
  const showDisciplinary = canManageDisciplinaryActions(roles);
  const showTermination = hasFullEmployeeAccess(roles);
  // Equipment issue/return history is HR/admin-only, same as Compliance and
  // Termination below — employees never see their own issued_assets records.
  const showEquipment = hasFullEmployeeAccess(roles);

  useEffect(() => { setCurrent(employee); }, [employee?.id]);

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
            {showTermination && <TabsTrigger value="termination">Termination</TabsTrigger>}
          </TabsList>
          <TabsContent value="access">
            <SystemAccessPortal employee={current} roles={roles} onUpdated={handleUpdated} />
          </TabsContent>
          <TabsContent value="emergency">
            <EmergencyContactPanel employee={current} roles={roles} onUpdated={handleUpdated} />
          </TabsContent>
          <TabsContent value="documents">
            <ComplianceDocumentCenter employee={current} />
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
              <DisciplinaryActionsPanel employee={current} employees={employees} roles={roles} />
            </TabsContent>
          )}
          {showTermination && (
            <TabsContent value="termination">
              <TerminationPanel employee={current} roles={roles} onUpdated={handleUpdated} />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
