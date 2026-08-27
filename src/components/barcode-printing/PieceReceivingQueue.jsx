import React, { useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { logStatusChange } from '@/lib/statusHistory';
import { PackageCheck, Lock } from 'lucide-react';

const MANAGER_ROLES = ['admin', 'super_admin', 'shop_manager'];

// Office/receiving-staff checkpoint for individual fabricated pieces — a
// piece physically confirmed complete and staged, ready for a QR tag. This
// is distinct from receiving_logs (raw material/PO receiving) and from the
// in-app print-tag flow in LabelStagingQueue (which tracks a different
// concept: whether a physical label has been printed via the ZPL/thermal
// path, independent of workflow_status).
export default function PieceReceivingQueue({ pieces, projects, onReload }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [projectFilter, setProjectFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [saving, setSaving] = useState(false);

  const isManager = (user?.roles || []).some((r) => MANAGER_ROLES.includes(r));

  const eligiblePieces = useMemo(
    () => pieces.filter((p) => p.workflow_status === 'In_Fabrication' && (projectFilter === 'all' || p.project_id === projectFilter)),
    [pieces, projectFilter]
  );

  const allSelected = eligiblePieces.length > 0 && eligiblePieces.every((p) => selectedIds.has(p.id));

  const toggleOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (allSelected) return new Set();
      return new Set(eligiblePieces.map((p) => p.id));
    });
  };

  const handleMarkReceived = async () => {
    if (selectedIds.size === 0) return;
    setSaving(true);
    try {
      const verified_date = new Date().toISOString();
      const verified_by = user?.full_name || 'Unknown';
      const targets = eligiblePieces.filter((p) => selectedIds.has(p.id));
      for (const piece of targets) {
        await db.entities.pieces.update(piece.id, { workflow_status: 'Received', verified_by, verified_date });
        await logStatusChange({
          entityType: 'pieces',
          entityId: piece.id,
          fieldName: 'workflow_status',
          fromValue: piece.workflow_status,
          toValue: 'Received',
          changedBy: verified_by,
        });
      }
      setSelectedIds(new Set());
      toast({ title: `${targets.length} piece(s) marked Received` });
      await onReload();
    } finally {
      setSaving(false);
    }
  };

  if (!isManager) {
    return (
      <div className="steel-card p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
        <Lock className="w-6 h-6" />
        Marking pieces Received is restricted to shop managers and admins.
      </div>
    );
  }

  return (
    <div className="steel-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <PackageCheck className="w-4 h-4 text-primary" />Mark Pieces Received ({eligiblePieces.length})
        </h4>
        <div className="flex items-center gap-2">
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="gap-1.5 steel-gradient text-white border-0"
            disabled={selectedIds.size === 0 || saving}
            onClick={handleMarkReceived}
          >
            {saving ? 'Saving…' : `Mark Selected Received (${selectedIds.size})`}
          </Button>
        </div>
      </div>

      {eligiblePieces.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No fabricated pieces awaiting receiving check-in.</p>
      ) : (
        <div className="space-y-1 max-h-80 overflow-y-auto">
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground px-2 py-1">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} />Select All
          </label>
          {eligiblePieces.map((p) => (
            <label key={p.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm cursor-pointer hover:bg-muted/50">
              <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggleOne(p.id)} />
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{p.piece_mark}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {p.material_shape} • {projects.find((proj) => proj.id === p.project_id)?.name || p.project_id}
                </p>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
