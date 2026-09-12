// Shared case/whitespace-insensitive comparison for a free-text shape/size
// designation (e.g. "W12x26" vs "W12 X 26") against steel_catalog rows.
// Used by both DetailerImportedPiece review (Stage 3, does this piece match
// a known catalog shape?) and material optimization (Stage 5, which
// steel_catalog item does this piece group's material_profile correspond
// to, so its StockLengthOption rows can be found?).
import { normalizeScanValue } from '@/lib/pieceScan';

export const normalizeMaterialProfile = (value) => normalizeScanValue(value).replace(/\s+/g, '');

// Breaks the leading shape code out of a free-text profile/size designation
// (e.g. "W12X26" -> "W", "HSS6X6X3/8" -> "HSS", "L3X3X1/4" -> "L") for display
// as its own column and for grouping. Longer/more-specific prefixes are
// checked before their shorter substrings (WT before W, MC/MT before C, HSS
// before nothing-else-conflicts) so e.g. a WT section is never misread as a
// plain W. Order matches the prefix-branching convention already used by
// steelShapeMath.js's resolvePerimeterIn for the same shape strings, extended
// with the tee/miscellaneous-channel prefixes that math doesn't need but a
// real detailer file can still contain. Returns '' when nothing matches
// (custom/non-standard profile text) rather than guessing.
const SHAPE_PREFIX_PATTERNS = [
  { shape: 'HSS', pattern: /^HSS/ },
  { shape: 'WT', pattern: /^WT\d/ },
  { shape: 'MC', pattern: /^MC\d/ },
  { shape: 'MT', pattern: /^MT\d/ },
  { shape: 'ST', pattern: /^ST\d/ },
  { shape: 'PL', pattern: /^PL/ },
  { shape: 'W', pattern: /^W\d/ },
  { shape: 'C', pattern: /^C\d/ },
  { shape: 'L', pattern: /^L\d/ },
];

export const deriveShapeFromProfile = (materialProfile) => {
  const value = String(materialProfile || '').trim().toUpperCase();
  if (!value) return '';
  const match = SHAPE_PREFIX_PATTERNS.find(({ pattern }) => pattern.test(value));
  return match ? match.shape : '';
};
