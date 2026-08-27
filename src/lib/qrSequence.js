// Sequential QR numbering for the "Received" pieces export queue — replaces
// the timestamp+random qr_payload_string generatePiecePayload() produces
// (see qrSerialization.js) for this flow specifically, so exported numbers
// are contiguous and safe to hand straight to label-printing software.
//
// Deliberately NOT a separate counter entity (e.g. CompanyQrCounter). This
// app has no backend — src/api/localData.js is a localStorage shim with no
// transactions and no cross-tab/cross-device locking (see nextLoadNumber in
// LoadBuilder.jsx and the bid-number logic in BidNew.jsx, the two existing
// sequential-number precedents in this codebase, both of which derive
// max+1 from the persisted records rather than maintaining a standalone
// counter row). A separate counter entity would need to be kept
// transactionally consistent with `pieces` — impossible to guarantee here —
// and would silently go stale if a piece were ever imported, deleted, or
// hand-edited outside this flow. Deriving the next number from the actual
// max already-issued qr_sequence_number self-heals from that class of drift
// and matches the established convention. True atomicity across two
// simultaneously-exporting tabs/devices isn't achievable in this
// architecture and isn't attempted anywhere else in the app either.
export function nextQrSequenceNumbers(existingPieces, count) {
  if (count <= 0) return [];
  const max = (existingPieces || []).reduce((m, p) => {
    const n = Number(p.qr_sequence_number);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return Array.from({ length: count }, (_, i) => max + i + 1);
}

// company_code (e.g. "HAN") keeps the payload short while still separating
// sequence ranges issued by different companies sharing the same browser
// profile (a super_admin impersonating multiple tenants) — a bare zero-padded
// number alone would collide across companies once both reach the same count.
export function buildSequentialQrPayload(companyCode, sequenceNumber) {
  const prefix = String(companyCode || 'CO').replace(/\s+/g, '').toUpperCase();
  return `QR-${prefix}-${String(sequenceNumber).padStart(6, '0')}`;
}

// Idempotent: a piece that already carries qr_sequence_number keeps it and
// its existing qr_payload_string untouched — re-exporting never issues a
// second number for the same piece (a physical label may already exist for
// the first one). Only pieces missing a number are assigned the next ones,
// computed once up front from `allPieces` so a multi-piece batch gets
// contiguous numbers rather than every piece racing for the same "next" value.
export function assignQrSequenceNumbers(selectedPieces, allPieces, companyCode) {
  const needing = selectedPieces.filter((p) => !p.qr_sequence_number);
  const freshNumbers = nextQrSequenceNumbers(allPieces, needing.length);
  const numberByPieceId = new Map(needing.map((p, i) => [p.id, freshNumbers[i]]));
  return selectedPieces.map((p) => {
    if (p.qr_sequence_number) {
      return { piece: p, qr_sequence_number: p.qr_sequence_number, qr_payload_string: p.qr_payload_string, alreadyAssigned: true };
    }
    const qr_sequence_number = numberByPieceId.get(p.id);
    return { piece: p, qr_sequence_number, qr_payload_string: buildSequentialQrPayload(companyCode, qr_sequence_number), alreadyAssigned: false };
  });
}
