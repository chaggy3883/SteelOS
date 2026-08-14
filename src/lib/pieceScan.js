// Single source of truth for "does a scanned code match this record" — the
// case-insensitive comparison originally built for JobsiteReceiving.jsx's
// per-phase QR/piece-mark check-in flow. Every scan surface in the app
// should import from here rather than re-deriving its own match logic
// (ShopFabrication.jsx's scan box and ShopFloorCommandCenter.jsx's
// station-scan both do).
export const normalizeScanValue = (value) => String(value || '').trim().toLowerCase();

// True if any candidate string case-insensitively equals the scanned value.
export const scanValueMatches = (candidates, scanValue) => {
  const norm = normalizeScanValue(scanValue);
  if (!norm) return false;
  return candidates.some((c) => c != null && String(c).toLowerCase() === norm);
};

// Resolves a scanned code directly to a `pieces` row via its own
// qr_payload_string/piece_mark columns — an explicit match against the
// target record's own fields, not a cross-entity string join.
export function matchPieceByScan(pieces, scanValue) {
  const norm = normalizeScanValue(scanValue);
  if (!norm) return null;
  return pieces.find((p) => scanValueMatches([p.qr_payload_string, p.piece_mark], norm)) || null;
}
