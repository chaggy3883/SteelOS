// Material grouping + cut-plan optimization math — pure functions only. No
// db/api imports, no React, no AI: every function here takes plain data in
// and returns plain data out, matching the discipline in payrollEngine.js
// (this codebase has no depreciationEngine.js despite that name sometimes
// being used as a second reference point — payrollEngine.js is the real
// precedent followed here). Given a fixed set of pieces/stock
// lengths/kerf, every function below always returns the exact same result.
//
// This is a first-fit-decreasing (FFD) bin-packing HEURISTIC, not a
// brute-force optimal solver — for a real shop's piece counts, FFD gets
// close to optimal in linear-ish time and stays predictable/debuggable,
// which matters more here than squeezing out the last percent of yield.
import { parseStructuralLength } from '@/lib/structuralLength';
import { normalizeScanValue } from '@/lib/pieceScan';

// PieceMark.finished_length is free text (see PieceMark.jsonc) — this is the
// one place it gets turned into a number, and only in memory for planning;
// nothing here writes finished_length back as a parsed value. Returns null
// (never 0) when the text can't be confidently parsed, so callers never
// mistake "unparseable" for "zero-length."
export function getPieceLengthInches(piece) {
  const feet = parseStructuralLength(piece?.finished_length);
  return feet == null ? null : feet * 12;
}

export const materialGroupKey = (piece) => `${normalizeScanValue(piece.material_profile)}::${normalizeScanValue(piece.material_grade)}`;

// Groups by shape + grade TOGETHER, never shape alone — a W12x26 in A992 and
// a W12x26 in A572-50 are not interchangeable stock, even though they'd
// collide under a shape-only key. Pieces missing a profile and/or grade
// still get a group (key uses '' for the missing side) rather than being
// silently dropped — the UI can flag that group as not optimizable instead
// of losing the pieces entirely.
export function groupPiecesByMaterial(pieces) {
  const groups = new Map();
  (pieces || []).forEach((piece) => {
    const key = materialGroupKey(piece);
    if (!groups.has(key)) {
      groups.set(key, {
        group_key: key,
        material_profile: piece.material_profile || '',
        material_grade: piece.material_grade || '',
        pieces: [],
      });
    }
    groups.get(key).pieces.push(piece);
  });
  return Array.from(groups.values());
}

// Expands { id, quantity, finished_length } piece rows into one packing unit
// per physical instance (a quantity of 3 becomes 3 units) — a cut plan
// tracks individual bars/pieces, not piece-mark rows. Units with an
// unparseable length are returned separately so the caller can surface them
// rather than have them silently vanish from the plan.
function expandUnits(piecesInGroup) {
  const units = [];
  const unpackablePieces = [];
  (piecesInGroup || []).forEach((piece) => {
    const lengthIn = getPieceLengthInches(piece);
    const quantity = Math.max(1, Number(piece.quantity) || 1);
    if (lengthIn == null || lengthIn <= 0) {
      unpackablePieces.push({ piece_id: piece.id, length_in: lengthIn, reason: lengthIn == null ? 'Unparseable finished_length' : 'Zero or negative length' });
      return;
    }
    for (let i = 0; i < quantity; i++) {
      units.push({ piece_id: piece.id, length_in: lengthIn });
    }
  });
  return { units, unpackablePieces };
}

// First-fit-decreasing: units sorted longest-first, each placed in the first
// already-open bin with room (kerf charged before every cut after a bin's
// first), otherwise a new bin is opened using the SMALLEST available stock
// length that's sufficient for that unit — this is what keeps a mixed
// availableStockLengths list from defaulting to "always use the longest
// stock," which would waste more material than necessary. A unit longer
// than every available stock length can never be placed; it's reported in
// unpackablePieces rather than forcing an oversized bin.
export function optimizeCutPlan(piecesInGroup, availableStockLengths, kerfAllowanceIn = 0) {
  const lengths = [...new Set((availableStockLengths || []).filter((l) => Number.isFinite(l) && l > 0))].sort((a, b) => a - b);
  const { units, unpackablePieces } = expandUnits(piecesInGroup);

  if (lengths.length === 0) {
    return { bins: [], unpackablePieces: [...unpackablePieces, ...units.map((u) => ({ piece_id: u.piece_id, length_in: u.length_in, reason: 'No available stock length' }))], totals: emptyTotals() };
  }

  const sortedUnits = [...units].sort((a, b) => b.length_in - a.length_in);
  const bins = [];

  sortedUnits.forEach((unit) => {
    const kerf = kerfAllowanceIn || 0;
    const targetBin = bins.find((bin) => (bin.stock_length_in - bin.used_in) >= unit.length_in + (bin.cuts.length > 0 ? kerf : 0));

    if (targetBin) {
      const kerfCharged = targetBin.cuts.length > 0 ? kerf : 0;
      targetBin.used_in += unit.length_in + kerfCharged;
      targetBin.cuts.push({ piece_id: unit.piece_id, length_in: unit.length_in, cut_order: targetBin.cuts.length + 1 });
      return;
    }

    const sufficientLength = lengths.find((l) => l >= unit.length_in);
    if (sufficientLength == null) {
      unpackablePieces.push({ piece_id: unit.piece_id, length_in: unit.length_in, reason: 'Longer than every available stock length' });
      return;
    }

    bins.push({
      stock_length_in: sufficientLength,
      used_in: unit.length_in,
      cuts: [{ piece_id: unit.piece_id, length_in: unit.length_in, cut_order: 1 }],
    });
  });

  return { bins, unpackablePieces, totals: computeTotals(bins, kerfAllowanceIn) };
}

const emptyTotals = () => ({ quantity_of_stock_required: 0, total_stock_in: 0, total_piece_in: 0, total_kerf_in: 0, remnant_length_in: 0, waste_in: 0, utilization_pct: 0 });

function computeTotals(bins, kerfAllowanceIn) {
  if (bins.length === 0) return emptyTotals();

  const total_stock_in = bins.reduce((sum, bin) => sum + bin.stock_length_in, 0);
  const total_piece_in = bins.reduce((sum, bin) => sum + bin.cuts.reduce((s, c) => s + c.length_in, 0), 0);
  const total_kerf_in = bins.reduce((sum, bin) => sum + Math.max(0, bin.cuts.length - 1) * (kerfAllowanceIn || 0), 0);
  const remnant_length_in = bins.reduce((sum, bin) => sum + Math.max(0, bin.stock_length_in - bin.used_in), 0);
  const waste_in = total_stock_in - total_piece_in;
  const utilization_pct = total_stock_in > 0 ? round2((total_piece_in / total_stock_in) * 100) : 0;

  return {
    quantity_of_stock_required: bins.length,
    total_stock_in,
    total_piece_in,
    total_kerf_in: round2(total_kerf_in),
    remnant_length_in: round2(remnant_length_in),
    waste_in: round2(waste_in),
    utilization_pct,
  };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Runs each candidate stock length ALONE (as if it were the only option
// available) and returns one comparison row per length, sorted best
// (lowest waste) first — this is the "40' vs 32'" comparison, distinct from
// optimizeCutPlan's own mixed-length packing. feasible is false when at
// least one piece in the group is longer than that single candidate length,
// since a real plan against that stock length would leave pieces uncut.
export function compareStockLengthOptions(piecesInGroup, stockLengthChoices, kerfAllowanceIn = 0) {
  return (stockLengthChoices || [])
    .filter((l) => Number.isFinite(l) && l > 0)
    .map((stockLengthIn) => {
      const plan = optimizeCutPlan(piecesInGroup, [stockLengthIn], kerfAllowanceIn);
      return {
        stock_length_in: stockLengthIn,
        feasible: plan.unpackablePieces.length === 0,
        unpackablePieces: plan.unpackablePieces,
        ...plan.totals,
      };
    })
    .sort((a, b) => a.waste_in - b.waste_in);
}

// Stage 10: which logged remnants are candidate stock for this group — same
// shape+grade key as groupPiecesByMaterial, never shape alone. Only
// 'available' remnants are offered; a group with no material_grade set on
// its remnant matches nothing, same as the piece side (materialGroupKey
// needs both sides present to agree).
export function findMatchingRemnants(remnants, group) {
  const targetKey = materialGroupKey({ material_profile: group.material_profile, material_grade: group.material_grade });
  return (remnants || []).filter((r) => (
    r.status !== 'consumed'
    && materialGroupKey({ material_profile: r.material_shape, material_grade: r.material_grade }) === targetKey
  ));
}

// Stage 10: use up existing remnants before recommending new stock — same
// first-fit-decreasing approach as optimizeCutPlan (units longest-first,
// each placed in an already-claimed remnant with room before claiming a new
// one), except "opening a new bin" here means claiming an unused remnant of
// sufficient length rather than choosing a length to buy. Smallest-first
// remnant ordering biases toward best-fit, so a long remnant isn't burned on
// a piece a short one would have covered. Returns remainingPieces — the
// group's piece list with each piece's quantity reduced by however many
// instances a remnant claimed — for the caller to feed into the normal
// optimizeCutPlan/compareStockLengthOptions new-stock flow unchanged; a
// remnant-consumed instance never reaches that pass.
export function packPiecesIntoRemnants(piecesInGroup, availableRemnants, kerfAllowanceIn = 0) {
  const remnants = [...(availableRemnants || [])]
    .filter((r) => Number(r.length_in) > 0)
    .sort((a, b) => a.length_in - b.length_in);
  const { units, unpackablePieces } = expandUnits(piecesInGroup);
  const sortedUnits = [...units].sort((a, b) => b.length_in - a.length_in);

  const bins = [];
  const usedRemnantIds = new Set();
  const consumedCountByPieceId = new Map();

  sortedUnits.forEach((unit) => {
    const kerf = kerfAllowanceIn || 0;
    const targetBin = bins.find((bin) => (bin.stock_length_in - bin.used_in) >= unit.length_in + (bin.cuts.length > 0 ? kerf : 0));

    let placedIn = null;
    if (targetBin) {
      const kerfCharged = targetBin.cuts.length > 0 ? kerf : 0;
      targetBin.used_in += unit.length_in + kerfCharged;
      targetBin.cuts.push({ piece_id: unit.piece_id, length_in: unit.length_in, cut_order: targetBin.cuts.length + 1 });
      placedIn = targetBin;
    } else {
      const remnant = remnants.find((r) => !usedRemnantIds.has(r.id) && r.length_in >= unit.length_in);
      if (remnant) {
        usedRemnantIds.add(remnant.id);
        const bin = {
          remnant_id: remnant.id,
          heat_number: remnant.heat_number_string || '',
          stock_length_in: remnant.length_in,
          used_in: unit.length_in,
          cuts: [{ piece_id: unit.piece_id, length_in: unit.length_in, cut_order: 1 }],
        };
        bins.push(bin);
        placedIn = bin;
      }
    }

    if (placedIn) {
      consumedCountByPieceId.set(unit.piece_id, (consumedCountByPieceId.get(unit.piece_id) || 0) + 1);
    }
  });

  const remainingPieces = piecesInGroup
    .map((piece) => {
      const consumed = consumedCountByPieceId.get(piece.id) || 0;
      const remainingQty = Math.max(0, (Number(piece.quantity) || 1) - consumed);
      return remainingQty > 0 ? { ...piece, quantity: remainingQty } : null;
    })
    .filter(Boolean);

  return { bins, unpackablePieces, remainingPieces, totals: computeTotals(bins, kerfAllowanceIn) };
}

// Flattens optimizeCutPlan's bins into the MaterialOptimizationRun.pieces_assigned
// shape: position_in_stock is the 1-based index of WHICH physical stock bar a
// piece is cut from (bar 2 of 5, etc.); cut_order restarts at 1 for each bar
// and gives the cutting sequence within that bar. See MaterialOptimizationRun.jsonc.
export function toPiecesAssigned(bins) {
  const assigned = [];
  (bins || []).forEach((bin, binIndex) => {
    bin.cuts.forEach((cut) => {
      assigned.push({ piece_id: cut.piece_id, position_in_stock: binIndex + 1, cut_order: cut.cut_order });
    });
  });
  return assigned;
}
