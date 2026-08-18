import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SystemAccessPortal from '@/components/hr/SystemAccessPortal';
import EmergencyContactPanel from '@/components/hr/EmergencyContactPanel';
import ComplianceDocumentCenter from '@/components/hr/ComplianceDocumentCenter';
import PermissionsGridPanel from '@/components/hr/PermissionsGridPanel';
import DisciplinaryActionsPanel from '@/components/hr/DisciplinaryActionsPanel';
import PtoPanel from '@/components/hr/PtoPanel';
import { canManageDisciplinaryActions } from '@/lib/disciplinaryAccess';

export default function EmployeeProfileDialog({ employee, employees = [], roles, open, onOpenChange, onEmployeeUpdated }) {
  const [current, setCurrent] = useState(employee);
  const showDisciplinary = canManageDisciplinaryActions(roles);

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
            <TabsTrigger value="pto">PTO</TabsTrigger>
            <TabsTrigger value="permissions">Permissions</TabsTrigger>
            {showDisciplinary && <TabsTrigger value="disciplinary">Disciplinary</TabsTrigger>}
          </TabsList>
          <TabsContent value="access">
            <SystemAccessPortal employee={current} roles={roles} onUpdated={handleUpdated} />
          </TabsContent>
          <TabsContent value="emergency">
            <EmergencyContactPanel employee={current} onUpdated={handleUpdated} />
          </TabsContent>
          <TabsContent value="documents">
            <ComplianceDocumentCenter employee={current} />
          </TabsContent>
          <TabsContent value="pto">
            <PtoPanel employee={current} roles={roles} />
          </TabsContent>
          <TabsContent value="permissions">
            <PermissionsGridPanel subject={current} subjectType="employees" onUpdated={handleUpdated} />
          </TabsContent>
          {showDisciplinary && (
            <TabsContent value="disciplinary">
              <DisciplinaryActionsPanel employee={current} employees={employees} roles={roles} />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
