// Rules for adding a size to a material catalog from a takeoff and for
// saving a typed weight back to it — pure (relative imports, no db/React) so
// it can be checked in Node. The writes themselves are in
// materialCatalogWrites.js; the role rule is materialCatalogRoles.js.
//
// Two tables hold sizes:
//   - the master catalog (MaterialShapeType -> MaterialSizeOption), read by
//     Full Takeoff's Size picker and IRONSIGHT's Count setup. Sizes look
//     like "12 x 26", "3 1/2 x 3 1/2 x 1/4", "1/2 x";
//   - steel_catalog (5 shape classes, size_designation like "W12X26"),
//     merged into IRONSIGHT's measurement Size picker and read for lb/ft.
// A standard AISC shape added to one is mirrored into the other where the
// shape maps (W, HSS, C, L), so both takeoffs see it.
import {
  calcCatalogRow, compactProfile, profileKey, entryFamily, splitSizeTokens, parseDimToken, parsePipeSize, linearKindFor,
  LEGACY_SHAPE_CLASS_TO_CODE, savedSizeWeight, formatSetDate,
} from './materialEntryMath.js';
import { aiscKey, findAiscShape, findAiscShapeForCatalog } from './aiscShapes.js';

export const WEIGHT_FIELD_BY_FAMILY = { linear: 'weight_per_ft', plate: 'weight_per_sq_ft', each: 'weight_per_each' };
export const WEIGHT_UNIT_BY_FAMILY = { linear: 'lb/ft', plate: 'lb/sq ft', each: 'lb/ea' };

// --------------------------------------------------------------- keys

// One key per master-catalog size, whatever the spelling: "3 1/2 x 3 1/2 x
// 1/4", "3-1/2 x 3-1/2 x 1/4" and "3.5 x 3.5 x .25" under L all match.
export const sizeKey = (shapeCode, sizeValue) => profileKey(compactProfile(shapeCode, sizeValue));

const sameSize = (aCompact, bCompact) => {
  if (!aCompact || !bCompact) return false;
  if (profileKey(aCompact) === profileKey(bCompact)) return true;
  const a = aiscKey(aCompact);
  return !!a && a === aiscKey(bCompact);
};

// Existing value (string) that is the same size as sizeValue under this
// shape, or null.
export function findDuplicateSize(shapeCode, sizeValue, existingValues = []) {
  const mine = compactProfile(shapeCode, sizeValue);
  return existingValues.find((v) => sameSize(mine, compactProfile(shapeCode, v))) || null;
}

// Same for steel_catalog / IRONSIGHT designations ("L3-1/2X3-1/2X1/4").
export function findDuplicateDesignation(designation, existing = []) {
  return existing.find((v) => sameSize(String(designation || '').toUpperCase(), String(v || '').toUpperCase())) || null;
}

// --------------------------------------------------------------- parsing

// Number of dimension tokens each linear method reads.
const TOKENS_BY_KIND = {
  designation_w: 2, designation_tee: 2, designation_c: 2, angle_estimator: 3, angle: 3,
  rect_tube_estimator: 3, rect_tube: 3, round_tube: 2, flat: 2, round: 1, rebar: 1, square: 1, crane_rail: 1,
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// { ok, message } — ok false is a warning, never a block: the size can
// still be added, it just won't get a computed weight.
export function checkMasterSizeParses(shapeCode, category, sizeValue) {
  const code = String(shapeCode || '').toUpperCase();
  const size = String(sizeValue || '').trim();
  if (!size) return { ok: false, message: 'Size is blank.' };
  const family = entryFamily(code, category);
  const tokens = splitSizeTokens(size);
  if (family === 'plate') {
    const t = parseDimToken(tokens[0], { bareIntegerIsGauge: ['PLGA', 'SSGP', 'ALGP', 'ALSH'].includes(code) });
    return t > 0 ? { ok: true, message: `Plate ${t} in thick` } : { ok: false, message: `Can't read a thickness from "${tokens[0] || size}" — plate sizes start with the thickness (1/2 x, 3/8, 16ga).` };
  }
  if (family === 'each') {
    const d = parseDimToken(tokens[0]);
    return d > 0 ? { ok: true, message: `Diameter / size ${d} in` } : { ok: false, message: `Can't read a size from "${tokens[0] || size}" — it will still list, priced by count.` };
  }
  if (findAiscShapeForCatalog(code, size)) return { ok: true, message: 'Standard AISC shape' };
  const kind = linearKindFor(code);
  if (kind === 'pipe') {
    const p = parsePipeSize(code, size);
    return p?.od ? { ok: true, message: `Pipe NPS ${p.nps} ${p.schedule.toUpperCase()}` } : { ok: false, message: `Can't read a nominal pipe size from "${size}" (e.g. 4, 1 1/4, 6 XS).` };
  }
  const dims = tokens.map((t) => parseDimToken(t));
  const want = TOKENS_BY_KIND[kind];
  if (dims.some((d) => d == null)) return { ok: false, message: `Can't read every dimension in "${size}" — use numbers, fractions or 1 1/2 separated by x.` };
  if (want && dims.length !== want) return { ok: false, message: `${code} sizes have ${plural(want, 'dimension')} (got ${dims.length}).` };
  return { ok: true, message: `${plural(dims.length, 'dimension')} read` };
}

const DESIGNATION_PATTERN = {
  'W-Beam': /^W\d+(\.\d+)?X\d+(\.\d+)?$/,
  'C-Channel': /^C\d+(\.\d+)?X\d+(\.\d+)?$/,
  'HSS Tube': /^HSS\d+(\.\d+)?X\d+(\.\d+)?X\d*\.?\d+$/,
  'L-Angle': /^L\d+(\.\d+)?X\d+(\.\d+)?X\d*\.?\d+$/,
  'PL-Plate': /^PL\d*\.?\d+(X\d+(\.\d+)?)?$/,
  Pipe: /^PIPE\d*\.?\d+(X\d*\.?\d+|STD|XS|XXS)?$/,
};
const DESIGNATION_EXAMPLE = { 'W-Beam': 'W12X40', 'C-Channel': 'C10X30', 'HSS Tube': 'HSS6X6X3/8', 'L-Angle': 'L3-1/2X3-1/2X1/4', 'PL-Plate': 'PL1/2X12', Pipe: 'PIPE4STD' };

export function checkDesignationParses(shapeClass, designation) {
  const d = String(designation || '').trim();
  if (!d) return { ok: false, message: 'Size is blank.' };
  if (findAiscShape(d)) return { ok: true, message: 'Standard AISC shape' };
  const pattern = DESIGNATION_PATTERN[shapeClass];
  if (!pattern) return { ok: true, message: '' };
  return pattern.test(profileKey(d)) ? { ok: true, message: 'Reads as a size' } : { ok: false, message: `Doesn't read as a ${shapeClass} size (e.g. ${DESIGNATION_EXAMPLE[shapeClass]}).` };
}

// --------------------------------------------------------------- mapping

// Master codes that IRONSIGHT's 5-class measurement picker also lists.
const STEEL_CLASS_BY_CODE = { W: 'W-Beam', HSS: 'HSS Tube', C: 'C-Channel', L: 'L-Angle' };
export const steelClassForCode = (shapeCode) => STEEL_CLASS_BY_CODE[String(shapeCode || '').toUpperCase()] || null;

// "W", "12 x 40" -> "W12X40" (steel_catalog's convention).
export const designationFromMaster = (shapeCode, sizeValue) => compactProfile(shapeCode, sizeValue);

// "L-Angle", "L3-1/2X3-1/2X1/4" -> { shapeCode: 'L', sizeValue: '3 1/2 x 3 1/2 x 1/4' }
// (the master catalog's spaced spelling), or null for classes with no
// master counterpart here.
export function masterFromDesignation(shapeClass, designation) {
  const shapeCode = LEGACY_SHAPE_CLASS_TO_CODE[shapeClass];
  if (!shapeCode || !STEEL_CLASS_BY_CODE[shapeCode]) return null;
  const body = String(designation || '').toUpperCase().replace(/\s+/g, '').replace(new RegExp(`^${shapeCode}`), '');
  const tokens = body.split('X').filter(Boolean).map((t) => t.replace(/^(\d+)-(\d+\/\d+)$/, '$1 $2'));
  if (tokens.length === 0) return null;
  return { shapeCode, sizeValue: tokens.join(' x ') };
}

// The other table's record for a standard AISC size, or null when the size
// isn't AISC or the shape doesn't map. Used by the add-size dialog.
export function mirrorForMasterSize(shapeCode, sizeValue) {
  const shapeClass = steelClassForCode(shapeCode);
  if (!shapeClass || !findAiscShapeForCatalog(shapeCode, sizeValue)) return null;
  return { shape_class: shapeClass, size_designation: designationFromMaster(shapeCode, sizeValue) };
}
export function mirrorForDesignation(shapeClass, designation) {
  if (!findAiscShape(designation)) return null;
  return masterFromDesignation(shapeClass, designation);
}

// IRONSIGHT's measurement picker ({ shapeClass: [sizes] }, from the Steel
// sizes workbook) plus every steel_catalog size for a class it already
// lists, skipping spellings it already has.
export function mergeSteelCatalogIntoPicker(pickerMap, steelRows = []) {
  if (!pickerMap || !steelRows.length) return pickerMap;
  let changed = false;
  const next = { ...pickerMap };
  steelRows.forEach((row) => {
    const list = next[row.shape_class];
    if (!list || !row.size_designation) return;
    if (findDuplicateDesignation(row.size_designation, list)) return;
    next[row.shape_class] = [...list, row.size_designation];
    changed = true;
  });
  return changed ? next : pickerMap;
}

// --------------------------------------------------------------- weights

export const savedWeightFor = savedSizeWeight;
export const savedByText = (record) => {
  if (!record) return '';
  const on = formatSetDate(record.weight_set_date);
  return `Saved by ${record.weight_set_by || 'unknown'}${on ? ` on ${on}` : ''}`;
};

// Should a weight typed on a Full Takeoff row be written to the size?
// Only when, without the typed value, the row would say "Weight needed":
// no saved weight, steel_catalog, AISC, computed or estimator weight. Any
// other source keeps the typed value as that row's own override.
// -> { save, reason, value, unit, field, baseSource }
export function typedWeightDecision({ row, shapeType, catalogRows = [], sizeOption = null }) {
  const value = Number(row?.weight_override);
  const base = calcCatalogRow({ ...row, weight_override: '' }, { shapeType, catalogRows, sizeOption });
  const out = { value, unit: base.weightUnit, field: WEIGHT_FIELD_BY_FAMILY[base.family], baseSource: base.weightSource, family: base.family };
  if (!(value > 0)) return { ...out, save: false, reason: 'nothing_typed' };
  if (!base.needsWeight) return { ...out, save: false, reason: 'has_weight' };
  if (!sizeOption?.id) return { ...out, save: false, reason: 'not_in_catalog' };
  return { ...out, save: true, reason: 'weight_needed' };
}

// steel_catalog / AISC lb/ft for an IRONSIGHT 5-class size:
// a steel_catalog row's weight (shown "Saved weight" when a takeoff or an
// admin set it) -> AISC -> null.
export function resolveSteelWeight(designation, steelRows = []) {
  const key = profileKey(designation);
  const row = steelRows.find((r) => Number(r.weight_per_ft) > 0 && profileKey(r.size_designation) === key);
  if (row) {
    const saved = row.weight_source === 'typed' || row.weight_source === 'admin';
    return { perFt: Number(row.weight_per_ft), source: saved ? 'saved' : 'catalog', row, text: `steel_catalog ${row.size_designation}: ${row.weight_per_ft} lb/ft${saved ? ` — ${savedByText(row)}` : ''}` };
  }
  const aisc = findAiscShape(designation);
  if (aisc?.weightPerFt > 0) return { perFt: aisc.weightPerFt, source: 'aisc', text: `${aisc.source} ${aisc.label}: ${aisc.weightPerFt} lb/ft` };
  return null;
}

// Admin filter: 'saved' (the size has its own weight), 'other' (AISC,
// steel_catalog, computed or estimator covers it), 'needed'.
export function sizeWeightStatus(sizeOption, shapeType, catalogRows = []) {
  const family = entryFamily(shapeType?.shape_code, shapeType?.category);
  if (savedSizeWeight(sizeOption, family)) return 'saved';
  const calc = calcCatalogRow({ shape_code: shapeType?.shape_code, size_value: sizeOption?.size_value, quantity: 1, length_in: 12 }, { shapeType, catalogRows });
  return calc.needsWeight ? 'needed' : 'other';
}

// --------------------------------------------------------------- usage

const cleanGradeKey = (g) => String(g ?? '').replace(/^\*/, '').trim().toUpperCase().replace(/[\s.\-_]+/g, '');

// MaterialTakeoffLine rows that use this master size: catalog rows by
// shape_code + size key, older 5-class rows by shape_class + material_size.
export function linesUsingSize(lines = [], shapeCode, sizeValue) {
  const code = String(shapeCode || '').toUpperCase();
  const key = sizeKey(code, sizeValue);
  const legacyClass = Object.entries(LEGACY_SHAPE_CLASS_TO_CODE).find(([, c]) => c === code)?.[0];
  const legacyKey = profileKey(designationFromMaster(code, sizeValue));
  return lines.filter((l) => {
    if (l.shape_code) return String(l.shape_code).toUpperCase() === code && sizeKey(code, l.size_value) === key;
    return legacyClass && l.shape_class === legacyClass && profileKey(l.material_size) === legacyKey;
  });
}

export function linesUsingGrade(lines = [], shapeCode, gradeValue) {
  const code = String(shapeCode || '').toUpperCase();
  const g = cleanGradeKey(gradeValue);
  const legacyClass = Object.entries(LEGACY_SHAPE_CLASS_TO_CODE).find(([, c]) => c === code)?.[0];
  return lines.filter((l) => cleanGradeKey(l.grade) === g && (l.shape_code ? String(l.shape_code).toUpperCase() === code : (legacyClass && l.shape_class === legacyClass)));
}
