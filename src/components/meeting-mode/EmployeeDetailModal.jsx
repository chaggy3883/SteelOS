import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const CERT_STATUS_STYLE = {
  Valid: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  Expiring_Soon: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  Expired: 'bg-red-500/10 text-red-500 border-red-500/20',
};

export default function EmployeeDetailModal({ open, onOpenChange, employee, certifications = [] }) {
  if (!employee) return null;
  const employeeCerts = certifications.filter((c) => c.employee_id === employee.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{employee.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-muted-foreground text-xs">Employee #</p><p className="font-medium">{employee.employee_number || '—'}</p></div>
            <div><p className="text-muted-foreground text-xs">Classification</p><p className="font-medium">{employee.classification || '—'}</p></div>
            <div><p className="text-muted-foreground text-xs">Department</p><p className="font-medium">{employee.department || '—'}</p></div>
            <div><p className="text-muted-foreground text-xs">Status</p><p className="font-medium">{employee.is_active ? 'Active' : 'Inactive'}</p></div>
            <div><p className="text-muted-foreground text-xs">Phone</p><p className="font-medium">{employee.phone || '—'}</p></div>
            <div><p className="text-muted-foreground text-xs">Supervisor</p><p className="font-medium">{employee.supervisor_name || '—'}</p></div>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-1">Certifications</p>
            {employeeCerts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No certifications on file.</p>
            ) : (
              <div className="space-y-1.5">
                {employeeCerts.map((c) => (
                  <div key={c.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
                    <span className="font-medium">{c.cert_type.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-muted-foreground">exp {c.expiration_date || '—'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${CERT_STATUS_STYLE[c.status] || CERT_STATUS_STYLE.Valid}`}>{(c.status || 'Valid').replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
