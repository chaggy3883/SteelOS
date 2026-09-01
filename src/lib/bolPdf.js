import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';

// Generates a single-page Bill of Lading PDF for a load at Call Inspection
// time. Mirrors delayNoticePdf.js's plain-text jsPDF layout (no autotable
// dependency is installed in this project) but returns the PDF as a data
// URI instead of triggering a download, since the BOL is attached to
// loads.bol_pdf_data_uri for later viewing/printing from the Shipping List,
// Load Detail, and Yard Scanning rather than downloaded immediately.
//
// Drawn with fixed mm coordinates (not html2canvas/exportNodeToPdf's DOM
// rasterization) so row heights stay tight enough to guarantee one Letter
// page for any load a single trailer can realistically carry.

const PAGE_WIDTH = 215.9; // Letter, mm
const PAGE_HEIGHT = 279.4;
const MARGIN = PDF_MARGIN_MM; // app-wide standard — see src/lib/pdfLayout.js
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN;
const MAX_LOGO_WIDTH = 26;
const MAX_LOGO_HEIGHT = 15;
const TABLE_BOTTOM_LIMIT = PAGE_HEIGHT - 46; // leaves room for totals + signatures

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Re-rasterizes the loaded logo through a canvas so jsPDF's addImage always
// gets a data URI, whether logo_url was already one or an http(s) link.
// Cross-origin images without CORS headers taint the canvas and throw on
// toDataURL — caught so a bad/unreachable logo just gets skipped rather
// than failing the whole BOL.
function imageToDataUrl(img) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (e) {
    return null;
  }
}

const addressLines = (addr) => [addr?.address, [addr?.city, addr?.state, addr?.zip].filter(Boolean).join(', ')].filter(Boolean);

export async function generateBolPdf({ company, load, project, carrierLabel, trailerNumber, items }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: PDF_PAGE_FORMAT });
  const today = new Date().toISOString().slice(0, 10);

  // Letterhead — company logo (if configured) + name/address/phone on the
  // left, the BOL title/load number/ship date on the right.
  let logoWidth = 0;
  const logoImg = await loadImage(company?.logo_url);
  if (logoImg && logoImg.naturalWidth && logoImg.naturalHeight) {
    const dataUrl = imageToDataUrl(logoImg);
    if (dataUrl) {
      const scale = Math.min(MAX_LOGO_WIDTH / logoImg.naturalWidth, MAX_LOGO_HEIGHT / logoImg.naturalHeight, 1);
      logoWidth = logoImg.naturalWidth * scale;
      doc.addImage(dataUrl, 'PNG', MARGIN, 9, logoWidth, logoImg.naturalHeight * scale);
    }
  }

  const textX = MARGIN + (logoWidth ? logoWidth + 4 : 0);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(13);
  doc.text(company?.name || 'Company', textX, 15);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  addressLines(company).forEach((l, i) => doc.text(l, textX, 20 + i * 4.5));
  if (company?.phone) doc.text(`Phone: ${company.phone}`, textX, 20 + addressLines(company).length * 4.5);

  doc.setFont(undefined, 'bold');
  doc.setFontSize(16);
  doc.text('BILL OF LADING', CONTENT_RIGHT, 15, { align: 'right' });
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.text(`Load #: ${load?.load_number_id || '—'}`, CONTENT_RIGHT, 21, { align: 'right' });
  doc.text(`Ship Date: ${today}`, CONTENT_RIGHT, 25.5, { align: 'right' });

  doc.setDrawColor(40);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, 29, CONTENT_RIGHT, 29);

  // Carrier / trailer strip — the load/trailer info the old layout omitted.
  let y = 36;
  doc.setFontSize(7.5);
  doc.setTextColor(110);
  doc.text('CARRIER', MARGIN, y);
  doc.text('TRAILER #', MARGIN + 95, y);
  doc.setTextColor(20);
  doc.setFontSize(10.5);
  doc.setFont(undefined, 'bold');
  doc.text(carrierLabel || '—', MARGIN, y + 5.5);
  doc.text(trailerNumber || '—', MARGIN + 95, y + 5.5);
  doc.setFont(undefined, 'normal');

  y += 13;
  doc.setDrawColor(190);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y, CONTENT_RIGHT, y);
  y += 6;

  // Ship From / Ship To
  const colGap = 10;
  const colWidth = (CONTENT_RIGHT - MARGIN - colGap) / 2;
  const shipFromX = MARGIN;
  const shipToX = MARGIN + colWidth + colGap;
  const fromLines = addressLines(company);
  const toLines = addressLines(project);

  doc.setFontSize(7.5);
  doc.setTextColor(110);
  doc.text('SHIP FROM', shipFromX, y);
  doc.text('SHIP TO', shipToX, y);
  doc.setTextColor(20);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(9.5);
  doc.text(company?.name || '—', shipFromX, y + 5);
  doc.text(project?.name || load?.project_id || '—', shipToX, y + 5);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  fromLines.forEach((l, i) => doc.text(l, shipFromX, y + 9.5 + i * 4));
  toLines.forEach((l, i) => doc.text(l, shipToX, y + 9.5 + i * 4));

  y += 9.5 + Math.max(fromLines.length, toLines.length, 1) * 4 + 4;
  doc.setDrawColor(40);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, CONTENT_RIGHT, y);
  y += 6;

  // Items table — full piece list: mark, description, quantity, weight.
  const colSeqX = MARGIN;
  const colMarkX = MARGIN + 12;
  const colDescX = MARGIN + 42;
  const colQtyRightX = CONTENT_RIGHT - 28;
  const colWeightRightX = CONTENT_RIGHT;

  const drawTableHeader = () => {
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.setFont(undefined, 'bold');
    doc.text('SEQ', colSeqX, y);
    doc.text('PIECE MARK', colMarkX, y);
    doc.text('DESCRIPTION', colDescX, y);
    doc.text('QTY', colQtyRightX, y, { align: 'right' });
    doc.text('WEIGHT (LBS)', colWeightRightX, y, { align: 'right' });
    doc.setFont(undefined, 'normal');
    doc.setTextColor(20);
    y += 2;
    doc.setDrawColor(190);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, CONTENT_RIGHT, y);
    y += 4.5;
  };
  drawTableHeader();

  doc.setFontSize(8.5);
  let totalWeight = 0;
  (items || []).forEach((item) => {
    if (y > TABLE_BOTTOM_LIMIT) {
      doc.addPage();
      y = 20;
      drawTableHeader();
      doc.setFontSize(8.5);
    }
    const weight = item.piece?.weight || 0;
    totalWeight += weight;
    const description = [item.piece?.material_shape, item.piece?.dimensions].filter(Boolean).join(' — ') || '—';
    doc.text(String(item.sequence_number ?? ''), colSeqX, y);
    doc.text(item.piece?.piece_mark || '—', colMarkX, y);
    doc.text(doc.splitTextToSize(description, colQtyRightX - colDescX - 4)[0] || '—', colDescX, y);
    doc.text('1', colQtyRightX, y, { align: 'right' });
    doc.text(weight.toLocaleString(), colWeightRightX, y, { align: 'right' });
    y += 5.2;
  });

  doc.setDrawColor(40);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, CONTENT_RIGHT, y);
  y += 6;
  doc.setFontSize(9.5);
  doc.setFont(undefined, 'bold');
  doc.text(`Total Pieces: ${(items || []).length}`, MARGIN, y);
  doc.text(`Total Weight: ${totalWeight.toLocaleString()} lbs`, CONTENT_RIGHT, y, { align: 'right' });
  doc.setFont(undefined, 'normal');

  // Signature lines — pinned near the bottom so short loads don't leave the
  // page looking half-empty, but always at least 18mm below the table so a
  // full load's item list can never collide with them.
  const sigY = Math.max(y + 18, PAGE_HEIGHT - 32);
  doc.setFontSize(9);
  doc.setDrawColor(20);
  doc.setLineWidth(0.3);
  const sigColWidth = (CONTENT_RIGHT - MARGIN - colGap) / 2;
  const driverLineX2 = MARGIN + sigColWidth;
  const receiverX1 = MARGIN + sigColWidth + colGap;
  const receiverLineX2 = CONTENT_RIGHT;

  doc.line(MARGIN, sigY, driverLineX2, sigY);
  doc.line(receiverX1, sigY, receiverLineX2, sigY);
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text('Driver Signature / Date', MARGIN, sigY + 4.5);
  doc.text('Receiver Signature / Date', receiverX1, sigY + 4.5);

  const dataUri = doc.output('datauristring');
  const filename = `BOL-${load?.load_number_id || load?.id || 'load'}.pdf`;

  return { dataUri, filename };
}
