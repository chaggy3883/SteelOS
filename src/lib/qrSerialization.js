// String-payload stub for down-stream routing. This produces a unique
// identifier string, not a rendered scannable barcode image — no QR-rendering
// library exists in this app, and none is being added at this stage.
export function generateQrPayload(receivingLog) {
  const poPart = (receivingLog?.po_number || 'PO').replace(/\s+/g, '');
  const heatPart = (receivingLog?.material_heat_number || 'NOHEAT').replace(/\s+/g, '');
  return `QR-${poPart}-${heatPart}-${Date.now()}`;
}

// pieces.qr_payload_string must be a globally unique scan target independent
// of piece_mark — piece_mark alone repeats legitimately across projects (see
// matchPieceByScan in pieceScan.js), so it can never be the payload on its
// own. `projectLabel` should be the caller's best available project
// identifier (project_number if on hand, else project_id) — combined with
// piece_mark plus a timestamp+random suffix, this is unique even when two
// projects share both a piece_mark and the same millisecond.
export function generatePiecePayload(projectLabel, pieceMark) {
  const projectPart = String(projectLabel || 'PROJ').replace(/\s+/g, '');
  const markPart = String(pieceMark || 'PM').replace(/\s+/g, '');
  const uniquePart = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `QR-${projectPart}-${markPart}-${uniquePart}`.toUpperCase();
}
