import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { canManageDisciplinaryActions } from '@/lib/disciplinaryAccess';
import { Plus, ShieldAlert, FileCheck2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DisciplinaryActionDialog, { ACTION_LEVELS, STATUS_LABELS, STATUS_COLORS } from '@/components/hr/DisciplinaryActionDialog';

// Per-employee list of DisciplinaryAction records, scoped to whichever
// employee's profile this panel is opened inside (EmployeeProfileDialog).
// Distinct from EmployeeFilesPanel.jsx's generic incident file upload — this
// is the structured fill -> print -> file-signed-copy workflow. Gated to HR
// roles + admin (defense-in-depth; the caller already hides the tab itself).
export default function DisciplinaryActionsPanel({ employee, employees = [], roles = [], granularPermissions }) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [viewingRecord, setViewingRecord] = useState(null);

  const allowed = canManageDisciplinaryActions(roles, granularPermissions);

  useEffect(() => { if (allowed) loadActions(); else setLoading(false); }, [employee?.id, allowed]);

  const loadActions = async () => {
    setLoading(true);
    try {
      const rows = await db.entities.DisciplinaryAction.filter({ employee_id: employee.id }, '-action_date', 100);
      setActions(rows);
    } catch (e) {} finally { setLoading(false); }
  };

  const handleSaved = (updated) => {
    setActions((prev) => {
      const exists = prev.some((a) => a.id === updated.id);
      return exists ? prev.map((a) => (a.id === updated.id ? updated : a)) : [updated, ...prev];
    });
    setViewingRecord(updated);
  };

  const levelLabel = (value) => ACTION_LEVELS.find((l) => l.value === value)?.label || value;

  if (!allowed) {
    return (
      <div className="steel-card p-6 text-center">
        <ShieldAlert className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Disciplinary actions are restricted to HR Admin and Admin roles.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">Disciplinary Actions</h4>
        <Button size="sm" className="gap-1.5 steel-gradient text-white border-0" onClick={() => { setViewingRecord(null); setShowDialog(true); }}>
          <Plus className="w-3.5 h-3.5" />New Disciplinary Action
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
      ) : actions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No disciplinary actions on file for this employee.</p>
      ) : (
        <div className="space-y-2">
          {actions.map((a) => (
            <div
              key={a.id}
              onClick={() => { setViewingRecord(a); setShowDialog(true); }}
              className="rounded-lg border border-border p-3 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{levelLabel(a.action_level)}</p>
                <Badge className={`${STATUS_COLORS[a.status]} text-[10px]`}>{STATUS_LABELS[a.status] || a.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Action {a.action_date} • Incident {a.incident_date}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{a.incident_description}</p>
              {a.signed_document && (
                <p className="text-xs text-green-600 flex items-center gap-1 mt-1"><FileCheck2 className="w-3 h-3" />{a.signed_document.filename}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <DisciplinaryActionDialog
        open={showDialog}
        onOpenChange={(o) => { setShowDialog(o); if (!o) setViewingRecord(null); }}
        employees={employees}
        defaultEmployeeId={employee.id}
        record={viewingRecord}
        onSaved={handleSaved}
      />
    </div>
  );
}
