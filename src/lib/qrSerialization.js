// String-payload stub for down-stream routing. This produces a unique
// identifier string, not a rendered scannable barcode image — no QR-rendering
// library exists in this app, and none is being added at this stage.
export function generateQrPayload(receivingLog) {
  const poPart = (receivingLog?.po_number || 'PO').replace(/\s+/g, '');
  const heatPart = (receivingLog?.material_heat_number || 'NOHEAT').replace(/\s+/g, '');
  return `QR-${poPart}-${heatPart}-${Date.now()}`;
}
