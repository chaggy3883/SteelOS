import { jsPDF } from 'jspdf';

// Generates a Bill of Lading PDF for a load at Call Inspection time. Mirrors
// delayNoticePdf.js's plain-text jsPDF layout (no autotable dependency is
// installed in this project) but returns the PDF as a data URI instead of
// triggering a download, since the BOL is attached to loads.bol_pdf_data_uri
// for later viewing/printing from the Shipping List rather than downloaded
// immediately.
export function generateBolPdf({ load, project, carrierLabel, trailerNumber, items }) {
  const doc = new jsPDF();
  const today = new Date().toISOString().slice(0, 10);

  doc.setFontSize(16);
  doc.text('BILL OF LADING', 15, 18);

  doc.setFontSize(11);
  let y = 32;
  const line = (label, value) => {
    doc.text(`${label}: ${value ?? '—'}`, 15, y);
    y += 8;
  };

  line('Date', today);
  line('Load Number', load.load_number_id);
  line('Project / Destination', project?.name || load.project_id);
  line('Trailer Number', trailerNumber || '—');
  line('Carrier', carrierLabel || '—');

  y += 4;
  doc.setFontSize(11);
  doc.text('Pieces', 15, y);
  y += 7;
  doc.setFontSize(9);
  doc.text('Seq', 15, y);
  doc.text('Piece Mark', 35, y);
  doc.text('Weight (lbs)', 160, y);
  y += 2;
  doc.line(15, y, 195, y);
  y += 6;

  let totalWeight = 0;
  items.forEach((item) => {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    const weight = item.piece?.weight || 0;
    totalWeight += weight;
    doc.text(String(item.sequence_number ?? ''), 15, y);
    doc.text(item.piece?.piece_mark || '—', 35, y);
    doc.text(weight.toLocaleString(), 160, y, { align: 'right' });
    y += 6;
  });

  y += 2;
  doc.line(15, y, 195, y);
  y += 8;
  doc.setFontSize(10);
  doc.text(`Total Weight: ${totalWeight.toLocaleString()} lbs`, 15, y);
  doc.text(`Piece Count: ${items.length}`, 100, y);

  y += 20;
  doc.setFontSize(9);
  doc.text('Shipper Signature: _______________________________', 15, y);
  y += 15;
  doc.text('Carrier Signature: _______________________________', 15, y);

  const dataUri = doc.output('datauristring');
  const filename = `BOL-${load.load_number_id || load.id}.pdf`;

  return { dataUri, filename };
}
