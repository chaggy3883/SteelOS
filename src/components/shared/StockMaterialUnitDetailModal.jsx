import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import StatusBadge from '@/components/ui/StatusBadge';
import PieceDetailModal from '@/components/shipping/PieceDetailModal';
import { propagateHeatNumberToPieces } from '@/lib/heatPropagation';
import { Loader2, Layers, Save, Recycle } from 'lucide-react';

const formatDate = (d) => (d ? new Date(d).toLocaleDateString() : null);

// "4ft-2.50in remainder" — same free-text style the existing remnant_inventory
// demo row uses (src/api/localData.js), so a Stage 10-logged remnant reads
// consistently next to a manually-entered one in ShopOperations.jsx's list.
const formatRemnantDimensions = (lengthIn) => {
  const feet = Math.floor(lengthIn / 12);
  const inches = Math.round((lengthIn - feet * 12) * 100) / 100;
  return `${feet}ft-${inches}in remainder`;
};

// Drill-down for a single physical stock bar (StockMaterialUnit) — reads the
// owning MaterialOptimizationRun back and filters its pieces_assigned array
// for every entry sharing this unit's id, the "queryable both directions"
// link documented on MaterialOptimizationRun.pieces_assigned. Each sibling
// piece resolves to a PieceMark row and opens the existing PieceDetailModal
// on click, rather than duplicating piece detail rendering here.
//
// Stage 10: this is also the first write path for StockMaterialUnit.heat_number
// (Stage 6-7 documented the field but never wired one) — setting it here
// immediately propagates onto every sibling piece via heatPropagation.js, and
// unlocks "Log Remnant" once this bar's own leftover (remnant_length_in) is
// at or above the caller-supplied threshold, carrying the now-known heat
// number forward onto the new remnant_inventory record.
export default function StockMaterialUnitDetailModal({ open, onOpenChange, unitId, onUnitUpdated, remnantThresholdIn = 24 }) {
  const [loading, setLoading] = useState(false);
  const [unit, setUnit] = useState(null);
  const [run, setRun] = useState(null);
  const [siblingPieces, setSiblingPieces] = useState([]); // [{ entry, pieceMark }]
  const [viewingPieceMarkId, setViewingPieceMarkId] = useState(null);
  const [heatInput, setHeatInput] = useState('');
  const [savingHeat, setSavingHeat] = useState(false);
  const [loggingRemnant, setLoggingRemnant] = useState(false);

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
        setHeatInput(unitRecord?.heat_number || '');
        setSiblingPieces(resolved.filter((r) => r.pieceMark).sort((a, b) => (a.entry.cut_order || 0) - (b.entry.cut_order || 0)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, unitId]);

  const handleSaveHeatNumber = async () => {
    if (!unit) return;
    const trimmed = heatInput.trim();
    if (!trimmed) return;
    setSavingHeat(true);
    try {
      const updates = { heat_number: trimmed };
      if (!unit.received_date) updates.received_date = new Date().toISOString();
      if (unit.status === 'planned' || unit.status === 'ordered') updates.status = 'received';
      const updatedUnit = await db.entities.StockMaterialUnit.update(unit.id, updates);
      setUnit(updatedUnit);
      onUnitUpdated?.(updatedUnit);

      if (siblingPieces.length > 0) {
        await propagateHeatNumberToPieces(
          siblingPieces.map(({ pieceMark }) => pieceMark.id),
          trimmed,
          { source: { label: `stock unit ${updatedUnit.unit_number}` } }
        );
      }
    } finally {
      setSavingHeat(false);
    }
  };

  const canLogRemnant = unit && !unit.remnant_logged && (unit.remnant_length_in || 0) >= remnantThresholdIn && unit.heat_number;

  const handleLogRemnant = async () => {
    if (!unit || !run || !canLogRemnant) return;
    setLoggingRemnant(true);
    try {
      const companyId = unit.company_id;
      await db.entities.remnant_inventory.create({
        company_id: companyId,
        material_shape: run.material_profile || '',
        material_grade: run.material_grade || '',
        dimensions: formatRemnantDimensions(unit.remnant_length_in),
        length_in: unit.remnant_length_in,
        heat_number_string: unit.heat_number,
        source_project_id: run.project_id,
        source_material_optimization_run_id: run.id,
        source_stock_material_unit_id: unit.id,
        status: 'available',
      });
      const updatedUnit = await db.entities.StockMaterialUnit.update(unit.id, { remnant_logged: true });
      setUnit(updatedUnit);
      onUnitUpdated?.(updatedUnit);
    } finally {
      setLoggingRemnant(false);
    }
  };

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
                  ['Material', run?.material_profile ? `${run.material_profile} — ${run.material_grade || 'no grade'}` : run?.material_group_key?.replace('::', ' — ')],
                  ['Stock Length', run?.stock_length_used ? `${run.stock_length_used}"` : null],
                  ['Received', formatDate(unit.received_date)],
                  ['PO Line', unit.purchase_order_line_id ? 'Linked' : null],
                  ['Remnant Left', unit.remnant_length_in ? `${unit.remnant_length_in}"${unit.remnant_logged ? ' (logged)' : ''}` : null],
                ].filter(([, v]) => v !== undefined && v !== null && v !== '').map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-b border-border/50 py-1 last:border-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium text-right">{value}</span>
                  </div>
                ))}
              </div>

              <div>
                <Label className="text-xs">Heat Number</Label>
                <p className="text-[11px] text-muted-foreground mb-1">
                  Set once this bar is physically received — saving pushes it onto every piece cut from this bar below.
                </p>
                <div className="flex gap-1.5">
                  <Input value={heatInput} onChange={(e) => setHeatInput(e.target.value)} placeholder="HT-4412" className="flex-1" />
                  <Button size="sm" variant="outline" disabled={savingHeat || !heatInput.trim() || heatInput.trim() === unit.heat_number} onClick={handleSaveHeatNumber}>
                    {savingHeat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              {(unit.remnant_length_in || 0) >= remnantThresholdIn && (
                <div className="rounded-lg border border-border p-3 text-xs space-y-2">
                  <p className="font-medium flex items-center gap-1.5"><Recycle className="w-3.5 h-3.5 text-primary" />{unit.remnant_length_in}" leftover on this bar — at or above the {remnantThresholdIn}" reuse threshold.</p>
                  {unit.remnant_logged ? (
                    <p className="text-muted-foreground">Already logged to Remnant Inventory.</p>
                  ) : !unit.heat_number ? (
                    <p className="text-muted-foreground">Set this bar's heat number above before logging its remnant — a remnant carries its source bar's heat forward.</p>
                  ) : (
                    <Button size="sm" variant="outline" disabled={loggingRemnant} onClick={handleLogRemnant} className="gap-2">
                      {loggingRemnant ? <Loader2 className="w-4 h-4 animate-spin" /> : <Recycle className="w-4 h-4" />}
                      Log Remnant ({unit.remnant_length_in}", heat {unit.heat_number})
                    </Button>
                  )}
                </div>
              )}

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
