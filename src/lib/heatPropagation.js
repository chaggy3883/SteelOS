// Stage 10: the propagation logic Stage 6-7's StockMaterialUnit.heat_number
// field was documented as needing but never got wired to any write path —
// this is that first write path's shared core. Two call sites: setting a
// heat number on a StockMaterialUnit (StockMaterialUnitDetailModal.jsx,
// once the bar is actually received) and consuming a remnant_inventory row
// (materialOptimizationCommit.js), whose heat is already known from when it
// was logged. Both push the same physical-steel heat number onto every
// PieceMark cut from that bar/remnant. PieceMark.update() already triggers
// the app-wide automatic AuditLog (see localData.js's buildAuditLogEntries)
// on its own, so no separate audit write happens here.
import { db } from '@/api/apiClient';
import { logStatusChange } from '@/lib/statusHistory';

// pieceMarkIds: PieceMark.id list (from MaterialOptimizationRun.pieces_assigned
// entries sharing one stock_material_unit_id or remnant_inventory_id).
// source: { type: 'stock_unit' | 'remnant', label } — feeds the history note.
export async function propagateHeatNumberToPieces(pieceMarkIds, heatNumber, { changedBy = 'Material Optimization', source } = {}) {
  const trimmed = String(heatNumber || '').trim();
  if (!trimmed || !pieceMarkIds || pieceMarkIds.length === 0) return [];

  const uniqueIds = [...new Set(pieceMarkIds.filter(Boolean))];
  const note = source?.label ? `Heat number propagated from ${source.label}` : 'Heat number propagated from its source stock';

  const updated = await Promise.all(uniqueIds.map(async (pieceMarkId) => {
    const existing = await db.entities.PieceMark.get(pieceMarkId).catch(() => null);
    if (!existing || existing.heat_number === trimmed) return existing;
    const previousHeat = existing.heat_number || null;
    const updatedPieceMark = await db.entities.PieceMark.update(pieceMarkId, { heat_number: trimmed });
    await logStatusChange({
      entityType: 'PieceMark',
      entityId: pieceMarkId,
      fieldName: 'heat_number',
      fromValue: previousHeat,
      toValue: trimmed,
      changedBy,
      note,
    });
    return updatedPieceMark;
  }));

  return updated.filter(Boolean);
}
