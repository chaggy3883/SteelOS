// Every PieceMark gets a serial number and a QR code the moment it's added
// to a project — however it was added (drawing drag-drop, Tekla/detailer
// import, Add Pieces form, or anything added later). localData.js calls
// assignPieceIdentity inside PieceMark create/bulkCreate, so no add path
// can skip it.
//
// Serial number: company-scoped and sequential, e.g. "HAN-000042" — the
// company code's first three letters, then a 6-digit running number. It
// never changes or gets reused (a label may already be printed with it).
// The next number is the highest already issued for the company + 1, the
// same "derive from the records" rule as qrSequence.js / bid numbers (no
// separate counter row to drift out of step).
//
// QR code: the piece's qr_payload_string (generatePiecePayload — unique
// across projects even when piece marks repeat). A piece created with one
// already (an inventory remnant carrying its existing label forward) keeps
// it. The scannable image is drawn from that string by labelQr.js.
import { generatePiecePayload } from '@/lib/qrSerialization';

export function pieceSerialPrefix(companyCode) {
  const letters = String(companyCode || '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 3);
  return letters || 'SN';
}

export function formatPieceSerial(prefix, seq) {
  return `${prefix}-${String(seq).padStart(6, '0')}`;
}

// Highest serial_seq this company has issued so far (0 when none).
export function maxPieceSerialSeq(existing, companyId) {
  return (existing || []).reduce((max, p) => {
    if (companyId && p.company_id && p.company_id !== companyId) return max;
    const n = Number(p.serial_seq);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
}

// Returns the record with serial_number / serial_seq / qr_payload_string
// filled in where missing. `nextSeq` is the number to use if a serial is
// needed; the caller advances it for a batch. Existing values are kept.
export function assignPieceIdentity(record, { nextSeq, companyCode, projectLabel }) {
  const out = { ...record };
  let used = false;
  if (!out.serial_number) {
    out.serial_seq = nextSeq;
    out.serial_number = formatPieceSerial(pieceSerialPrefix(companyCode), nextSeq);
    used = true;
  }
  if (!out.qr_payload_string) {
    out.qr_payload_string = generatePiecePayload(projectLabel || out.project_id, out.piece_mark || out.part_number);
  }
  return { record: out, usedSerial: used };
}
