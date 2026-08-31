import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/ui/StatusBadge';
import PieceDetailModal from '@/components/shipping/PieceDetailModal';
import { Loader2, Layers } from 'lucide-react';

const formatDate = (d) => (d ? new Date(d).toLocaleDateString() : null);

// Drill-down for a single physical stock bar (StockMaterialUnit) — reads the
// owning MaterialOptimizationRun back and filters its pieces_assigned array
// for every entry sharing this unit's id, the "queryable both directions"
// link documented on MaterialOptimizationRun.pieces_assigned. Each sibling
// piece resolves to a PieceMark row and opens the existing PieceDetailModal
// on click, rather than duplicating piece detail rendering here.
export default function StockMaterialUnitDetailModal({ open, onOpenChange, unitId }) {
  const [loading, setLoading] = useState(false);
  const [unit, setUnit] = useState(null);
  const [run, setRun] = useState(null);
  const [siblingPieces, setSiblingPieces] = useState([]); // [{ pieceMark, cut_order }]
  const [viewingPieceMarkId, setViewingPieceMarkId] = useState(null);

  useEffect(() => {
    if (!open || !unitId) return;
    let cancelled = false;
    setLoading(true);
    setUnit(null); setRun(null); setSiblingPieces([]);

    (async () => {
      try {
        const unitRecord = await db.entities.StockMaterialUnit.get(unitId).catch(() => null);
        const runRecord = unitRecord?.material_optimization_run_id
          ? await db.entities.MaterialOptimizationRun.get(unitRecord.material_optimization_run_id).catch(() => null)
          : null;
        const entries = (runRecord?.pieces_assigned || []).filter((e) => e.stock_material_unit_id === unitId);
        const resolved = await Promise.all(entries.map(async (entry) => ({
          entry,
          pieceMark: await db.entities.PieceMark.get(entry.piece_id).catch(() => null),
        })));

        if (cancelled) return;
        setUnit(unitRecord);
        setRun(runRecord);
        setSiblingPieces(resolved.filter((r) => r.pieceMark).sort((a, b) => (a.entry.cut_order || 0) - (b.entry.cut_order || 0)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, unitId]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : !unit ? (
            <div className="py-10 text-center">
              <p className="text-sm text-destructive">Could not find this stock unit.</p>
              <div className="flex justify-center mt-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></div>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <Layers className="w-4 h-4 text-primary" />
                  <span>{unit.unit_number}</span>
                  <StatusBadge status={unit.status} label={(unit.status || '').replace(/_/g, ' ')} />
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-1.5 text-sm">
                {[
                  ['Material', run?.material_group_key?.replace('::', ' — ')],
                  ['Stock Length', run?.stock_length_used ? `${run.stock_length_used}"` : null],
                  ['Heat Number', unit.heat_number],
                  ['Received', formatDate(unit.received_date)],
                  ['PO Line', unit.purchase_order_line_id ? 'Linked' : null],
                ].filter(([, v]) => v !== undefined && v !== null && v !== '').map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-b border-border/50 py-1 last:border-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium text-right">{value}</span>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Pieces Cut From This Bar {siblingPieces.length > 0 ? `(${siblingPieces.length})` : ''}
                </p>
                {siblingPieces.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No pieces recorded against this stock unit.</p>
                ) : (
                  <div className="space-y-1">
                    {siblingPieces.map(({ entry, pieceMark }) => (
                      <button
                        key={pieceMark.id}
                        type="button"
                        onClick={() => setViewingPieceMarkId(pieceMark.id)}
                        className="w-full flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm text-left hover:bg-muted/50 transition-colors"
                      >
                        <span className="font-mono font-medium">{pieceMark.piece_mark}</span>
                        <span className="text-xs text-muted-foreground">Cut #{entry.cut_order}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {unit && (
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <PieceDetailModal
        open={!!viewingPieceMarkId}
        onOpenChange={(o) => !o && setViewingPieceMarkId(null)}
        pieceMarkId={viewingPieceMarkId}
      />
    </>
  );
}
