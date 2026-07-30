import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SystemAccessPortal from '@/components/hr/SystemAccessPortal';
import EmergencyContactPanel from '@/components/hr/EmergencyContactPanel';
import ComplianceDocumentCenter from '@/components/hr/ComplianceDocumentCenter';

export default function EmployeeProfileDialog({ employee, roles, open, onOpenChange, onEmployeeUpdated }) {
  const [current, setCurrent] = useState(employee);

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
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
