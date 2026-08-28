// Batch-wide review pass for staged DetailerImportedPiece rows, run when the
// review screen opens (never at parse time, since duplicate-within-batch and
// catalog-shape checks need every row in the batch at once). Splits findings
// into blocking errors (excluded from commit) and non-blocking warnings
// (commit normally, just flagged) — see DetailerImportedPiece.jsonc's
// validation_status description for the exact error/warning split.
import { normalizeScanValue } from '@/lib/pieceScan';
import { normalizeMaterialProfile as normalizeProfile } from '@/lib/materialProfileMatch';

const isZeroLength = (value) => {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits.length > 0 && /^0+$/.test(digits);
};

// catalogSizeDesignations: steel_catalog.size_designation values for the
// batch's company. Skipped entirely (no warning) when the catalog is empty —
// an empty catalog means nothing has been set up yet, not that every piece
// is wrong.
export const validateBatchRows = (rows, catalogSizeDesignations = []) => {
  const catalogSet = new Set(catalogSizeDesignations.map(normalizeProfile).filter(Boolean));
  const checkCatalog = catalogSet.size > 0;

  const countsByPieceMark = new Map();
  rows.forEach((row) => {
    const key = normalizeScanValue(row.piece_mark);
    if (!key) return;
    countsByPieceMark.set(key, (countsByPieceMark.get(key) || 0) + 1);
  });

  return rows.map((row) => {
    const errors = [];
    const warnings = [];

    if (!row.piece_mark) {
      errors.push('Missing piece mark');
    } else if (countsByPieceMark.get(normalizeScanValue(row.piece_mark)) > 1) {
      errors.push('Duplicate piece mark within this import batch');
    }

    // Parse-time flagged these as hard errors already (non-numeric
    // quantity/weight) — carry them forward rather than re-deriving.
    (row.validation_errors || []).forEach((message) => {
      if (/^Invalid (quantity|weight)/.test(message) && !errors.includes(message)) errors.push(message);
    });

    if (!row.material_profile) warnings.push('Missing material profile');
    if (!row.material_grade) warnings.push('Missing material grade');
    if (!row.finished_length) {
      warnings.push('Missing finished length');
    } else if (isZeroLength(row.finished_length)) {
      warnings.push('Finished length is zero');
    }

    if (checkCatalog && row.material_profile && !catalogSet.has(normalizeProfile(row.material_profile))) {
      warnings.push(`Material profile "${row.material_profile}" does not match any known steel catalog shape`);
    }

    const validation_status = errors.length > 0 ? 'error' : (warnings.length > 0 ? 'warning' : 'valid');
    return { ...row, validation_status, validation_errors: errors, validation_warnings: warnings };
  });
};
