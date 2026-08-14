import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/ui/StatusBadge';
import StatusHistoryModal from '@/components/shared/StatusHistoryModal';
import { Loader2 } from 'lucide-react';

const formatDate = (d) => (d ? new Date(d).toLocaleDateString() : null);

// Read-only detail view for a piece, merging the office-side PieceMark
// record (drawing/description/dates) with the shop-floor `pieces` record
// (workflow/field status, QR payload) when both are resolvable — the
// drill-down target for "piece mark" cells across Shipping.jsx, LoadBuilder,
// and YardScanning. Accepts either id since the two call sites deal in
// different entities for the same physical piece.
export default function PieceDetailModal({ open, onOpenChange, pieceMarkId, pieceId, onViewLoad }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [pieceMark, setPieceMark] = useState(null);
  const [piece, setPiece] = useState(null);
  const [project, setProject] = useState(null);
  const [load, setLoad] = useState(null);
  const [historyField, setHistoryField] = useState(null);

  useEffect(() => {
    if (!open || (!pieceMarkId && !pieceId)) return;
    let cancelled = false;
    setLoading(true);
    setPieceMark(null); setPiece(null); setProject(null); setLoad(null);

    (async () => {
      try {
        let pieceRecord = pieceId ? await db.entities.pieces.get(pieceId).catch(() => null) : null;
        let pieceMarkRecord = pieceMarkId ? await db.entities.PieceMark.get(pieceMarkId).catch(() => null) : null;

        // Bridge whichever side wasn't given directly — piece_mark_id first,
        // falling back to a (project_id, piece_mark) string match, the same
        // fallback LoadBuilder's phase lookup uses.
        if (pieceRecord && !pieceMarkRecord) {
          if (pieceRecord.piece_mark_id) {
            pieceMarkRecord = await db.entities.PieceMark.get(pieceRecord.piece_mark_id).catch(() => null);
          }
          if (!pieceMarkRecord && pieceRecord.project_id && pieceRecord.piece_mark) {
            const matches = await db.entities.PieceMark.filter({ project_id: pieceRecord.project_id, piece_mark: pieceRecord.piece_mark }, '-created_date', 1).catch(() => []);
            pieceMarkRecord = matches[0] || null;
          }
        }
        if (pieceMarkRecord && !pieceRecord) {
          const matches = await db.entities.pieces.filter({ piece_mark_id: pieceMarkRecord.id }, '-created_date', 1).catch(() => []);
          pieceRecord = matches[0] || (
            pieceMarkRecord.project_id && pieceMarkRecord.piece_mark
              ? (await db.entities.pieces.filter({ project_id: pieceMarkRecord.project_id, piece_mark: pieceMarkRecord.piece_mark }, '-created_date', 1).catch(() => []))[0] || null
              : null
          );
        }

        const projId = pieceMarkRecord?.project_id || pieceRecord?.project_id;
        const [projectRecord, loadItemMatches] = await Promise.all([
          projId ? db.entities.Project.get(projId).catch(() => null) : Promise.resolve(null),
          pieceRecord ? db.entities.load_items.filter({ piece_id: pieceRecord.id }, '-created_date', 1).catch(() => []) : Promise.resolve([]),
        ]);
        const loadRecord = loadItemMatches[0]?.load_id ? await db.entities.loads.get(loadItemMatches[0].load_id).catch(() => null) : null;

        if (cancelled) return;
        setPieceMark(pieceMarkRecord);
        setPiece(pieceRecord);
        setProject(projectRecord);
        setLoad(loadRecord);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, pieceMarkId, pieceId]);

  const mark = pieceMark?.piece_mark || piece?.piece_mark;
  const rows = [
    ['Assembly', pieceMark?.assembly],
    ['Description', pieceMark?.description],
    ['Weight', (pieceMark?.weight_lbs || piece?.weight) ? `${(pieceMark?.weight_lbs || piece?.weight).toLocaleString()} lbs` : null],
    ['Material', pieceMark?.material_grade || piece?.material_shape],
    ['Phase', pieceMark?.phase],
    ['Workflow Status (Shop)', piece?.workflow_status, 'workflow_status'],
    ['Field Status', piece?.field_status, 'field_status'],
    ['Drawing Number', pieceMark?.drawing_number],
    ['Heat Number', pieceMark?.heat_number],
    ['QR Payload', piece?.qr_payload_string],
    ['Fab Start', formatDate(pieceMark?.fab_start_date)],
    ['Fab Complete', formatDate(pieceMark?.fab_complete_date)],
    ['Ship Date', formatDate(pieceMark?.ship_date)],
    ['Erect Date', formatDate(pieceMark?.erect_date)],
    ['Notes', pieceMark?.notes],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !pieceMark && !piece ? (
          <div className="py-10 text-center">
            <p className="text-sm text-destructive">Could not find this piece.</p>
            <div className="flex justify-center mt-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span className="font-mono">{mark || 'Piece'}</span>
                {pieceMark?.status && <StatusBadge status={pieceMark.status} />}
              </DialogTitle>
            </DialogHeader>

            {project && (
              <button className="text-sm font-medium text-primary hover:underline text-left" onClick={() => navigate(`/projects/${project.id}`)}>
                {project.name} ({project.project_number})
              </button>
            )}

            <div className="space-y-1.5 text-sm">
              {rows.map(([label, value, fieldName]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-border/50 py-1 last:border-0">
                  <span className="text-muted-foreground">{label}</span>
                  {fieldName ? (
                    <button type="button" onClick={() => setHistoryField(fieldName)}>
                      <StatusBadge status={value} label={String(value).replace(/_/g, ' ')} />
                    </button>
                  ) : (
                    <span className="font-medium text-right">{value}</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {(pieceMark || piece) && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            {load && <Button className="steel-gradient text-white border-0" onClick={() => onViewLoad?.(load.id)}>View Load {load.load_number_id}</Button>}
          </DialogFooter>
        )}
      </DialogContent>
      <StatusHistoryModal
        open={!!historyField}
        onOpenChange={(o) => !o && setHistoryField(null)}
        entityType="pieces"
        entityId={piece?.id}
        fieldName={historyField}
        title={`${mark || 'Piece'} — ${historyField === 'field_status' ? 'Field Status' : 'Workflow Status'} History`}
      />
    </Dialog>
  );
}
