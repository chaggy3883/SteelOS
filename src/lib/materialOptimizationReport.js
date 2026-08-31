// Material Optimization report aggregation — pure functions only, same
// discipline as materialOptimizer.js (no db/React imports). Summarizes
// already-COMMITTED MaterialOptimizationRun rows for a project; this is a
// reporting rollup over history, not a re-run of the optimizer itself.
//
// "Material required" is split into two sources per run rather than derived
// from a single stored total, because the two sources are tracked
// differently on MaterialOptimizationRun:
//   - Purchased-stock material is exactly (quantity_of_stock_required *
//     stock_length_used) - waste_in, all already stored on the run — no
//     extra lookups needed.
//   - Remnant-sourced material has no stored total (a committed run only
//     records remnant_inventory_id per pieces_assigned entry, not the length
//     cut from it), so it's recovered by summing each such entry's own
//     PieceMark.finished_length via getPieceLengthInches — the same parser
//     the optimizer itself uses, so a piece that's unparseable today is
//     excluded here exactly as it would be excluded from a fresh plan.
import { getPieceLengthInches } from '@/lib/materialOptimizer';
import { formatStructuralLength } from '@/lib/structuralLength';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function groupRowsByKey(rows, key) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const k = row[key];
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  });
  return map;
}

// Purchased-stock length actually turned into finished piece material for one
// run — derived, never re-read from pieces_assigned, since it's exactly what
// materialOptimizer.js's computeTotals already charged waste_in against.
function purchasedStockPieceLengthIn(run) {
  const totalStockIn = (Number(run.quantity_of_stock_required) || 0) * (Number(run.stock_length_used) || 0);
  return Math.max(0, totalStockIn - (Number(run.waste_in) || 0));
}

function remnantSourcedPieceLengthIn(run, pieceMarksById) {
  return (run.pieces_assigned || [])
    .filter((entry) => entry.remnant_inventory_id)
    .reduce((sum, entry) => {
      const lengthIn = getPieceLengthInches(pieceMarksById.get(entry.piece_id));
      return lengthIn == null ? sum : sum + lengthIn;
    }, 0);
}

// runs: MaterialOptimizationRun[] for one project (any status — every
// committed run counts, there is no draft/pending state on this entity).
// pieceMarksById: Map<PieceMark.id, PieceMark> — the caller's already-loaded
// project piece list, keyed once, so this function never fetches its own.
// purchaseOrderLines: pre-filtered to rows whose material_optimization_run_id
// is one of these runs' ids — the caller does that filtering since it's the
// one making the db calls. Remnant-sourced material is free (already owned),
// so remnant_inventory rows themselves aren't needed for this report — only
// which pieces_assigned entries point at one, which the runs already carry.
export function buildMaterialOptimizationReport({ runs, pieceMarksById, purchaseOrderLines }) {
  const poLinesByRunId = groupRowsByKey(purchaseOrderLines, 'material_optimization_run_id');

  const groups = new Map();

  (runs || []).forEach((run) => {
    const key = run.material_group_key;
    if (!key) return;
    if (!groups.has(key)) {
      groups.set(key, {
        group_key: key,
        material_profile: run.material_profile || '',
        material_grade: run.material_grade || '',
        run_count: 0,
        purchased_in: 0,
        in_inventory_in: 0,
        waste_in: 0,
        remnant_in: 0,
        stockLengths: new Map(),
        estimated_cost: 0,
        estimated_cost_known: true,
        actual_cost: 0,
        any_received: false,
        fully_received: true,
      });
    }
    const g = groups.get(key);
    g.run_count += 1;
    g.purchased_in += purchasedStockPieceLengthIn(run);
    g.in_inventory_in += remnantSourcedPieceLengthIn(run, pieceMarksById);
    g.waste_in += Number(run.waste_in) || 0;
    g.remnant_in += Number(run.remnant_length_in) || 0;

    if (run.stock_length_used && run.quantity_of_stock_required) {
      g.stockLengths.set(run.stock_length_used, (g.stockLengths.get(run.stock_length_used) || 0) + Number(run.quantity_of_stock_required));
    }

    const lines = poLinesByRunId.get(run.id) || [];
    // A run that bought new stock but has no PO line means no vendor was
    // configured at commit time (materialOptimizationCommit.js skips PO
    // generation in that case) — cost for that stock is simply not on file
    // anywhere, not zero, so the group's cost is flagged unknown rather than
    // silently undercounted.
    if (lines.length === 0 && (run.quantity_of_stock_required || 0) > 0) {
      g.estimated_cost_known = false;
    }
    lines.forEach((line) => {
      g.estimated_cost += Number(line.line_total) || 0;
      const qtyReceived = Number(line.quantity_received) || 0;
      if (qtyReceived > 0) {
        g.any_received = true;
        g.actual_cost += qtyReceived * (Number(line.unit_cost) || 0);
      }
      if (!line.is_fully_received) g.fully_received = false;
    });
    if (lines.length === 0) g.fully_received = false;
  });

  const groupRows = Array.from(groups.values()).map((g) => {
    const requiredIn = g.purchased_in + g.in_inventory_in;
    return {
      group_key: g.group_key,
      material_profile: g.material_profile,
      material_grade: g.material_grade,
      run_count: g.run_count,
      required_in: round2(requiredIn),
      required_display: formatStructuralLength(requiredIn / 12),
      in_inventory_in: round2(g.in_inventory_in),
      in_inventory_display: formatStructuralLength(g.in_inventory_in / 12),
      purchased_in: round2(g.purchased_in),
      purchased_display: formatStructuralLength(g.purchased_in / 12),
      stock_lengths_required: Array.from(g.stockLengths.entries())
        .map(([length_in, quantity]) => ({ length_in, quantity }))
        .sort((a, b) => a.length_in - b.length_in),
      waste_in: round2(g.waste_in),
      remnant_in: round2(g.remnant_in),
      // g.purchased_in is already the NET piece material yielded from new
      // stock (purchasedStockPieceLengthIn = stock bought - waste), so the
      // gross stock bought is purchased_in + waste_in, not purchased_in
      // itself — utilization is piece material / stock bought.
      utilization_pct: (g.purchased_in + g.waste_in) > 0 ? round2((g.purchased_in / (g.purchased_in + g.waste_in)) * 100) : null,
      estimated_cost: g.estimated_cost_known ? round2(g.estimated_cost) : null,
      actual_cost: g.any_received ? round2(g.actual_cost) : null,
      actual_cost_complete: g.any_received && g.fully_received,
    };
  }).sort((a, b) => a.material_profile.localeCompare(b.material_profile) || a.material_grade.localeCompare(b.material_grade));

  const stockLengthMap = new Map();
  groupRows.forEach((g) => g.stock_lengths_required.forEach(({ length_in, quantity }) => {
    stockLengthMap.set(length_in, (stockLengthMap.get(length_in) || 0) + quantity);
  }));

  const totalRequiredIn = groupRows.reduce((s, g) => s + g.required_in, 0);
  const totalInInventoryIn = groupRows.reduce((s, g) => s + g.in_inventory_in, 0);
  const totalPurchasedIn = groupRows.reduce((s, g) => s + g.purchased_in, 0);
  const totalWasteIn = groupRows.reduce((s, g) => s + g.waste_in, 0);
  const totalRemnantIn = groupRows.reduce((s, g) => s + g.remnant_in, 0);
  const anyEstimateUnknown = groupRows.some((g) => g.estimated_cost === null);
  const anyReceived = groupRows.some((g) => g.actual_cost !== null);

  return {
    groups: groupRows,
    stockLengthSummary: Array.from(stockLengthMap.entries())
      .map(([length_in, quantity]) => ({ length_in, quantity }))
      .sort((a, b) => a.length_in - b.length_in),
    totals: {
      required_in: round2(totalRequiredIn),
      required_display: formatStructuralLength(totalRequiredIn / 12),
      in_inventory_in: round2(totalInInventoryIn),
      in_inventory_display: formatStructuralLength(totalInInventoryIn / 12),
      purchased_in: round2(totalPurchasedIn),
      purchased_display: formatStructuralLength(totalPurchasedIn / 12),
      waste_in: round2(totalWasteIn),
      remnant_in: round2(totalRemnantIn),
      // Same gross-vs-net correction as the per-group figure above.
      utilization_pct: (totalPurchasedIn + totalWasteIn) > 0 ? round2((totalPurchasedIn / (totalPurchasedIn + totalWasteIn)) * 100) : null,
      estimated_cost: anyEstimateUnknown ? null : round2(groupRows.reduce((s, g) => s + (g.estimated_cost || 0), 0)),
      estimated_cost_partial: anyEstimateUnknown ? round2(groupRows.reduce((s, g) => s + (g.estimated_cost || 0), 0)) : null,
      actual_cost: anyReceived ? round2(groupRows.reduce((s, g) => s + (g.actual_cost || 0), 0)) : null,
    },
  };
}
