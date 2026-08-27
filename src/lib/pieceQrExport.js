// CSV export for the Received-pieces QR export queue. Mirrors
// payrollExport.js's downloadCSV pattern — no live API/print-driver
// integration exists, this is the hand-off file fed into external
// label-printing software.
function downloadCSV(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// `pieces` here must already carry their final qr_sequence_number/
// qr_payload_string (post-assignQrSequenceNumbers) — the exported sheet
// always contains the real assigned numbers, never the "Received" placeholder.
export function exportReceivedPiecesCSV(pieces, projectsById) {
  const header = ['Piece Mark', 'Project', 'Material Shape', 'Dimensions', 'Weight', 'QR Sequence #', 'QR Code'];
  const rows = (pieces || []).map((p) => [
    p.piece_mark || '',
    projectsById?.[p.project_id]?.name || p.project_id || '',
    p.material_shape || '',
    p.dimensions || '',
    p.weight || 0,
    p.qr_sequence_number ?? '',
    p.qr_payload_string || '',
  ]);
  downloadCSV(`piece_qr_export_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
}
