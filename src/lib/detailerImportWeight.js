// Weight math for staged DetailerImportedPiece rows — pure functions only,
// same discipline as materialOptimizer.js (no db/react imports, deterministic
// given the same rows/catalog). Two layers:
//   1. Per-row unit weight: weight-per-ft (from the company's steel_catalog
//      when it has real data, otherwise estimateWeightPerFt's self-encoded/
//      geometric approximation) × the row's own finished_length.
//   2. Assembly total: the Tekla BOM parser's own structure (see
//      detailerImportParser.js) is "main piece's mark equals its assembly
//      mark; every other row sharing that assembly is a welded-on minor
//      part" — so a real assembly's true weight is every row in that group
//      summed, not the main member alone.
import { parseStructuralLength } from '@/lib/structuralLength';
import { normalizeMaterialProfile, deriveShapeFromProfile } from '@/lib/materialProfileMatch';
import { normalizeScanValue } from '@/lib/pieceScan';
import { estimateWeightPerFt } from '@/data/steelShapeSelector';

// Maps the short shape code derived/stored on a staged row (deriveShapeFromProfile)
// onto steel_catalog's own shape_class enum (schema/entities/steel_catalog.jsonc)
// so a matching catalog row can be looked up. WT/MC/MT/ST have no shape_class
// counterpart — the enum only covers the 5 SHAPE_CLASSES families — so those
// fall straight through to the estimate below instead of a catalog lookup.
const SHAPE_CODE_TO_CATALOG_CLASS = {
  W: 'W-Beam',
  HSS: 'HSS Tube',
  C: 'C-Channel',
  L: 'L-Angle',
  PL: 'PL-Plate',
};

// weight_per_ft is only ever populated on a steel_catalog row once a company
// admin has entered real mill/AISC data for it (SteelCatalogPanel.jsx) — the
// base seed rows (localData.js) carry none. Prefer that authoritative figure
// when it's there; otherwise fall back to estimateWeightPerFt's
// self-encoded/geometric approximation (steelShapeSelector.js — the same
// function Full Takeoff uses for the identical purpose), which works for any
// size string typed in a detailer file rather than only ones a company has
// gotten around to cataloging.
export function resolveWeightPerFt(row, catalogRows = []) {
  const profile = row?.material_profile;
  if (!profile) return null;

  const normalizedProfile = normalizeMaterialProfile(profile);
  const catalogMatch = (catalogRows || []).find((c) => (
    c.weight_per_ft != null && normalizeMaterialProfile(c.size_designation) === normalizedProfile
  ));
  if (catalogMatch) return Number(catalogMatch.weight_per_ft);

  const shapeClass = SHAPE_CODE_TO_CATALOG_CLASS[row?.shape || deriveShapeFromProfile(profile)];
  if (!shapeClass) return null;

  const estimated = estimateWeightPerFt(shapeClass, profile);
  return estimated > 0 ? estimated : null;
}

// Unit weight (lbs) of ONE instance of this row — weight-per-ft × its own
// finished_length. Quantity is deliberately not applied here (see
// calculateRowWeight) so this stays the same "per-piece" figure the
// pre-existing DetailerImportedPiece.weight field already documents itself
// as. Returns null (never 0) when either input can't be resolved, matching
// the getPieceLengthInches/materialOptimizer.js convention of never
// mistaking "unknown" for "weighs nothing."
export function calculateUnitWeight(row, catalogRows = []) {
  const weightPerFt = resolveWeightPerFt(row, catalogRows);
  const lengthFt = parseStructuralLength(row?.finished_length);
  if (weightPerFt == null || lengthFt == null || lengthFt <= 0) return null;
  return weightPerFt * lengthFt;
}

// The weight to show/use for this row: the detailer's own file-supplied
// weight when it provided one (real data always wins over an estimate),
// otherwise the calculated unit weight above.
export function resolveRowWeight(row, catalogRows = []) {
  if (row?.weight != null) return Number(row.weight);
  return calculateUnitWeight(row, catalogRows);
}

// Total weight (lbs) this staged row contributes on its own — resolved unit
// weight × however many instances its own quantity says it represents (a
// staged "2x W8X24" row already means two physical pieces).
export function calculateRowTotalWeight(row, catalogRows = []) {
  const unitWeight = resolveRowWeight(row, catalogRows);
  if (unitWeight == null) return null;
  const quantity = Math.max(1, Number(row?.quantity) || 1);
  return unitWeight * quantity;
}

// Groups rows by assembly, case/whitespace-insensitively (same normalization
// piece-mark matching uses elsewhere — detailerImportCommit.js/pieceScan.js).
// A row with no assembly value is its own single-row group rather than being
// lumped in with every other assembly-less row.
export function groupRowsByAssembly(rows) {
  const groups = new Map();
  (rows || []).forEach((row) => {
    const key = row.assembly ? normalizeScanValue(row.assembly) : `__row_${row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return Array.from(groups.values());
}

// True when this row is the main piece of its assembly (its own piece_mark
// equals the assembly mark) — the same convention the Tekla BOM parser's
// blocks are built on. A row with no assembly at all is trivially its own
// main piece (nothing to distinguish it from).
export function isAssemblyMainPiece(row) {
  if (!row?.assembly) return true;
  return normalizeScanValue(row.assembly) === normalizeScanValue(row.piece_mark);
}

// Total assembly weight (lbs), keyed by normalized assembly value, for every
// assembly with more than one staged row (a single-row "assembly" has
// nothing to sum beyond its own already-visible row weight, so it's left out
// rather than duplicating that same figure under a second label). A group
// with any row that can't be weighed yields no entry at all — an incomplete
// sum isn't shown as if it were the true total.
export function calculateAssemblyTotalWeights(rows, catalogRows = []) {
  const totals = new Map();
  groupRowsByAssembly(rows).forEach((group) => {
    if (group.length < 2) return;
    const weights = group.map((row) => calculateRowTotalWeight(row, catalogRows));
    if (weights.some((w) => w == null)) return;
    totals.set(normalizeScanValue(group[0].assembly), weights.reduce((sum, w) => sum + w, 0));
  });
  return totals;
}
