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
//
// piece_mark is only unique WITHIN a project — the same detailer part number
// legitimately repeats across jobs — so a piece_mark-only match must be
// scoped to a project whenever one is known. qr_payload_string is generated
// globally unique (see generatePiecePayload in qrSerialization.js) and is
// matched first, unscoped.
//
// Returns { piece, ambiguous }. `ambiguous` is true when the scanned value
// matched more than one piece's piece_mark across different projects and no
// projectId was given to disambiguate — callers must NOT silently fall back
// to picking one (that's the cross-project data-integrity bug this guards
// against); surface it to the operator and ask them to scan the QR code
// instead, which is unambiguous by construction.
export function matchPieceByScan(pieces, scanValue, projectId) {
  const norm = normalizeScanValue(scanValue);
  if (!norm) return { piece: null, ambiguous: false };

  const byQr = pieces.find((p) => scanValueMatches([p.qr_payload_string], norm));
  if (byQr) return { piece: byQr, ambiguous: false };

  const candidates = pieces.filter((p) => scanValueMatches([p.piece_mark], norm) && (!projectId || p.project_id === projectId));
  if (candidates.length === 1) return { piece: candidates[0], ambiguous: false };
  if (candidates.length > 1) return { piece: null, ambiguous: true };
  return { piece: null, ambiguous: false };
}
