// IRONSIGHT takeoff rows on the master Material Catalog — the same shapes,
// sizes, grades and weight math the manual Full Takeoff uses
// (MaterialShapeType / MaterialSizeOption / MaterialGradeOption,
// materialEntryMath.calcCatalogRow), instead of the old 5 hardcoded classes.
//
// IRONSIGHT keeps its row model (quantity × unit_weight_lbs_per_ft ×
// length_ft is the weight everywhere it's totalled, exported and pushed to
// the estimate), so a catalog pick is turned into those fields:
//   linear (W, HSS, L, C, pipe, bar …)  lb/ft from the catalog as usual;
//   plate family                        lb per foot of a strip width_in wide
//                                       (thickness from the size, width typed);
//   each family (bolts, anchors …)      weight_basis 'each': lb/ea in the
//                                       weight field, length fixed at 1.
// Rows also carry shape_code / size_value / grade so they reopen on the
// same picks; shape_class stays set for the 5 legacy classes.

import {
  calcCatalogRow, entryFamily, parseLengthToInches, formatFtIn,
  LEGACY_SHAPE_CLASS_TO_CODE, CODE_TO_LEGACY_SHAPE_CLASS,
} from '@/lib/materialEntryMath';
import { designationFromMaster, masterFromDesignation } from '@/lib/catalogSizeRules';

// What a typed length means, in feet: 20'-6 1/2", 20' 6-1/2", 6 1/2" (inches),
// 246.5" (inches), 20.5 (feet), 20 (feet). null when it can't be read.
export function parseLengthFeet(text) {
  let s = String(text ?? '').trim();
  // Typed without marks: "20-6", "20-6 1/2", "20 6 1/2" -> 20'-6 1/2".
  const dashed = s.match(/^(\d+)\s*-\s*(\d+)(?:\s+(\d+\/\d+))?$/);
  const spaced = s.match(/^(\d+)\s+(\d+)\s+(\d+\/\d+)$/);
  const m = dashed || spaced;
  if (m) s = `${m[1]}'-${m[2]}${m[3] ? ` ${m[3]}` : ''}"`;
  const inches = parseLengthToInches(s);
  return inches == null || !Number.isFinite(inches) || inches < 0 ? null : inches / 12;
}

// Decimal feet -> 20'-6 1/2" (nearest 1/16").
export const formatLengthFeet = (ft) => formatFtIn((Number(ft) || 0) * 12);

// Which master-catalog shape/size a row is, for its pickers: its own picks,
// or the master equivalent of an older 5-class row ("W-Beam" + "W14x90").
export function catalogPickForRow(row) {
  if (row?.shape_code) return { code: String(row.shape_code).toUpperCase(), sizeValue: row.size_value || '' };
  const cls = row?.shape_class || row?.shape_type || '';
  const code = LEGACY_SHAPE_CLASS_TO_CODE[cls] || '';
  if (!code) return { code: '', sizeValue: '' };
  const master = masterFromDesignation(cls, row?.size_designation);
  return { code, sizeValue: master?.sizeValue || '' };
}

// The weight fields for a pick. -> { family, unit_weight_lbs_per_ft,
// weight_basis, needsWeight, source, formula }
export function catalogWeightFor({ code, sizeValue, shapeType, sizeOption = null, catalogRows = [], widthIn = 0, typedWeight = null }) {
  const family = entryFamily(code, shapeType?.category);
  const base = { shape_code: code, size_value: sizeValue, quantity: 1, weight_override: typedWeight ?? '' };
  if (family === 'each') {
    const r = calcCatalogRow({ ...base }, { shapeType, catalogRows, sizeOption });
    return { family, weight_basis: 'each', unit_weight_lbs_per_ft: r.unitWeight || 0, needsWeight: r.needsWeight, source: r.weightSource, formula: r.weightFormula };
  }
  if (family === 'plate') {
    const r = calcCatalogRow({ ...base, width_in: Number(widthIn) || 0, length_in: 12 }, { shapeType, catalogRows, sizeOption });
    return { family, weight_basis: 'ft', unit_weight_lbs_per_ft: r.totalLbs || 0, needsWeight: r.needsWeight || !(Number(widthIn) > 0), source: r.weightSource, formula: Number(widthIn) > 0 ? r.weightFormula : 'Type the plate width (inches).' };
  }
  const r = calcCatalogRow({ ...base, length_in: 12 }, { shapeType, catalogRows, sizeOption });
  return { family, weight_basis: 'ft', unit_weight_lbs_per_ft: r.unitWeight || 0, needsWeight: r.needsWeight, source: r.weightSource, formula: r.weightFormula };
}

// Row fields to set when the estimator picks a shape/size (or changes a
// plate width): designation, class, weight and basis.
export function rowPatchForPick({ row, shapeType, sizeValue, sizeOption, catalogRows, widthIn }) {
  const code = String(shapeType?.shape_code || row?.shape_code || '').toUpperCase();
  const width = widthIn ?? row?.width_in ?? 0;
  const w = catalogWeightFor({ code, sizeValue, shapeType, sizeOption, catalogRows, widthIn: width, typedWeight: row?.typed_weight ?? null });
  const designation = sizeValue ? designationFromMaster(code, sizeValue) : '';
  const patch = {
    shape_code: code,
    size_value: sizeValue || '',
    shape_type: shapeType?.description || row?.shape_type || code,
    shape_class: CODE_TO_LEGACY_SHAPE_CLASS[code] || shapeType?.description || code,
    size_designation: w.family === 'plate' && Number(width) > 0 ? `${designation}x${width}` : designation,
    weight_basis: w.weight_basis,
    unit_weight_lbs_per_ft: Math.round((w.unit_weight_lbs_per_ft || 0) * 1000) / 1000,
    weight_needed: !!w.needsWeight,
  };
  if (w.family === 'plate') patch.width_in = Number(width) || 0;
  if (w.weight_basis === 'each') patch.length_ft = 1;
  return patch;
}
