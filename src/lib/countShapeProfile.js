// Bridges IRONSIGHT Count/Bolt Count's master-material-catalog fields
// (MaterialShapeType.shape_code + MaterialSizeOption.size_value, e.g. shape
// "W" + size "12 x 26") onto the compact AISC-style profile string
// ("W12X26") the rest of the app already keys on: steel_catalog's own
// size_designation convention, FullTakeoff.jsx's SHAPE_CLASSES.sizes list,
// and estimateWeightPerFt's regex parsing. One conversion, used both to
// resolve a Count row's own weight-per-ft in IRONSIGHT itself
// (BlueprintTakeoff.jsx) and to push a correct shape_class/material_size
// onto MaterialTakeoffLine (MarkupsList.jsx) — not two divergent ones.
import { SHAPE_CODE_TO_CATALOG_CLASS } from '@/lib/detailerImportWeight';

export { SHAPE_CODE_TO_CATALOG_CLASS };

// shape_code -> MaterialTakeoffLine's 5-value shape_class enum, or null when
// this master-catalog shape has no bridge (e.g. bolts/fasteners, or any
// "Other/Misc" category entry outside the 5 structural families).
export function shapeCodeToShapeClass(shapeCode) {
  return SHAPE_CODE_TO_CATALOG_CLASS[shapeCode] || null;
}

// Builds the compact AISC-style profile string for a captured shape_code +
// size_designation (+ widthFt for Plate, whose own catalog size option is
// thickness-only — see CountSetupModal.jsx's Width field). Returns '' when
// it can't be built (no shape_code, or a Plate with no width captured yet).
export function buildCompactShapeProfile({ shapeCode, sizeDesignation, widthFt }) {
  if (!shapeCode) return '';
  if (shapeCode === 'PL' || shapeCode === 'PLGA') {
    const thickness = String(sizeDesignation || '').replace(/x\s*$/i, '').trim().replace(/\s+/g, '');
    const widthIn = (Number(widthFt) || 0) * 12;
    if (!thickness || !(widthIn > 0)) return '';
    return `PL${thickness}X${widthIn}`;
  }
  const compactSize = String(sizeDesignation || '').replace(/\s+/g, '');
  if (!compactSize) return '';
  return `${shapeCode}${compactSize}`;
}
