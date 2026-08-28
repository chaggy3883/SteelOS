// Shared case/whitespace-insensitive comparison for a free-text shape/size
// designation (e.g. "W12x26" vs "W12 X 26") against steel_catalog rows.
// Used by both DetailerImportedPiece review (Stage 3, does this piece match
// a known catalog shape?) and material optimization (Stage 5, which
// steel_catalog item does this piece group's material_profile correspond
// to, so its StockLengthOption rows can be found?).
import { normalizeScanValue } from '@/lib/pieceScan';

export const normalizeMaterialProfile = (value) => normalizeScanValue(value).replace(/\s+/g, '');
