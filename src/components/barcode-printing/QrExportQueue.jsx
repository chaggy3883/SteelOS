import React, { useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { assignQrSequenceNumbers } from '@/lib/qrSequence';
import { exportReceivedPiecesCSV } from '@/lib/pieceQrExport';
import { QrCode, Lock, Download } from 'lucide-react';

const MANAGER_ROLES = ['admin', 'super_admin', 'shop_manager'];

// Pieces marked workflow_status='Received' are ready for a QR tag. The QR
// column shows the literal text "Received" as a placeholder until a batch is
// exported — export is what assigns the real sequential qr_sequence_number
// (see qrSequence.js) and replaces the placeholder in this list immediately.
export default function QrExportQueue({ pieces, projects, company, onReload }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [projectFilter, setProjectFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [exporting, setExporting] = useState(false);

  const isManager = (user?.roles || []).some((r) => MANAGER_ROLES.includes(r));

  const receivedPieces = useMemo(
    () => pieces.filter((p) => p.workflow_status === 'Received' && (projectFilter === 'all' || p.project_id === projectFilter)),
    [pieces, projectFilter]
  );

  const projectsById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

  const allSelected = receivedPieces.length > 0 && receivedPieces.every((p) => selectedIds.has(p.id));

  const toggleOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) => (allSelected ? new Set() : new Set(receivedPieces.map((p) => p.id))));
  };

  const handleExport = async () => {
    if (selectedIds.size === 0) return;
    setExporting(true);
    try {
      const selected = receivedPieces.filter((p) => selectedIds.has(p.id));
      const assignments = assignQrSequenceNumbers(selected, pieces, company?.company_code);
      const finalPieces = [];
      for (const { piece, qr_sequence_number, qr_payload_string, alreadyAssigned } of assignments) {
        if (alreadyAssigned) {
          finalPieces.push(piece);
          continue;
        }
        const updated = await db.entities.pieces.update(piece.id, { qr_sequence_number, qr_payload_string });
        finalPieces.push(updated);
      }
      exportReceivedPiecesCSV(finalPieces, Object.fromEntries(projects.map((p) => [p.id, p])));
      setSelectedIds(new Set());
      toast({ title: `Exported ${finalPieces.length} piece(s)`, description: 'QR numbers assigned and downloaded to CSV.' });
      await onReload();
    } finally {
      setExporting(false);
    }
  };

  if (!isManager) {
    return (
      <div className="steel-card p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
        <Lock className="w-6 h-6" />
        QR export is restricted to shop managers and admins.
      </div>
    );
  }

  return (
    <div className="steel-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <QrCode className="w-4 h-4 text-primary" />QR Export Queue ({receivedPieces.length})
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
            disabled={selectedIds.size === 0 || exporting}
            onClick={handleExport}
          >
            <Download className="w-3.5 h-3.5" />
            {exporting ? 'Exporting…' : `Export to CSV (${selectedIds.size})`}
          </Button>
        </div>
      </div>

      {receivedPieces.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No pieces marked Received are awaiting QR export.</p>
      ) : (
        <div className="space-y-1 max-h-80 overflow-y-auto">
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground px-2 py-1">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} />Select All
          </label>
          {receivedPieces.map((p) => (
            <label key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm cursor-pointer hover:bg-muted/50">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggleOne(p.id)} />
                <div className="min-w-0">
                  <p className="font-medium truncate">{p.piece_mark}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {p.material_shape} • {projectsById[p.project_id]?.name || p.project_id}
                  </p>
                </div>
              </div>
              <span className={`text-xs font-mono flex-shrink-0 ${p.qr_sequence_number ? 'text-foreground' : 'text-muted-foreground italic'}`}>
                {p.qr_sequence_number ? p.qr_payload_string : 'Received'}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
