import { jsPDF } from 'jspdf';
import { generateLabelQrDataUrl } from '@/lib/labelQr';
import { normalizePieceLabelSettings } from '@/lib/pieceLabelSettings';

// Piece labels for the label printer: one label per PDF page, the page cut
// to the company's label stock (Company.piece_label_settings, set in
// Admin → Piece Labels), so it prints straight to a 2" x 4" (or any size)
// sticker roll with nothing to scale. Layout follows the shop's sticker
// template: QR code on the left with the serial number under it; project,
// part #, and sequence / area stacked beside it; shape, size, and weight
// across the bottom. Every box shrinks its text to fit, so long project
// names or sizes never run off the label.

const PT_PER_IN = 72;

const fmtWeight = (lbs) => {
  const n = Number(lbs);
  return n > 0 ? `${Math.round(n).toLocaleString()} LBS` : '';
};

// 20.5 -> 20'-6"
const feetInches = (ft) => {
  const n = Number(ft);
  if (!(n > 0)) return '';
  let feet = Math.floor(n);
  let inches = Math.round((n - feet) * 12 * 16) / 16;
  if (inches >= 12) { feet += 1; inches -= 12; }
  return `${feet}'-${inches}"`;
};

// What prints in each box for one piece. Exported for the preview and tests.
export function pieceLabelValues(piece, { project, sequenceAreas = [] } = {}) {
  const area = sequenceAreas.find((a) => a.id === piece.sequence_area_id);
  // "JOB# 24-0017", but a number that already reads "JOB-26-008" isn't
  // prefixed twice.
  const jobNo = String(project?.project_number || '').trim();
  const jobText = jobNo ? (/^job/i.test(jobNo) ? jobNo : `JOB# ${jobNo}`) : '';
  const projectText = [project?.name, jobText].filter(Boolean).join(' / ');
  // Detailer imports fill material_profile / finished_length; older and
  // hand-made pieces may carry material_shape / length_ft instead.
  const profile = String(piece.material_profile || piece.material_shape || '').trim();
  const length = String(piece.finished_length || '').trim() || feetInches(piece.length_ft);
  return {
    project: projectText,
    part: piece.piece_mark || piece.part_number || '',
    sequence: area?.name || piece.sequence || piece.phase || '',
    shape: profile,
    size: profile && length ? `${profile} x ${length}` : (length || profile),
    weight: fmtWeight(piece.weight_lbs),
    serial: piece.serial_number || '',
    qr: piece.qr_payload_string || '',
  };
}

const CAPTIONS = {
  project: 'PROJECT NAME & NO.',
  part: 'PART #',
  sequence: 'SEQUENCE / AREA',
  shape: 'SHAPE',
  size: 'SIZE',
  weight: 'WEIGHT',
};

// Largest font (pt) <= startPt at which `text` fits in widthIn.
function fitFont(doc, text, startPt, widthIn, minPt = 5) {
  let pt = startPt;
  doc.setFontSize(pt);
  while (pt > minPt && doc.getTextWidth(text) > widthIn) {
    pt -= 0.5;
    doc.setFontSize(pt);
  }
  return pt;
}

function drawBox(doc, { x, y, w, h, caption, value, align = 'left', upper }) {
  const pad = Math.min(0.06, h * 0.08);
  const capPt = Math.max(4.5, Math.min(8, h * PT_PER_IN * 0.17));
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(capPt);
  doc.text(caption, x + pad, y + pad, { baseline: 'top' });
  const capH = capPt / PT_PER_IN;
  const text = upper ? String(value || '—').toUpperCase() : String(value || '—');
  const room = h - pad * 2 - capH;
  doc.setFont('helvetica', 'bold');
  const pt = fitFont(doc, text, Math.max(6, room * PT_PER_IN * 0.8), w - pad * 2);
  const textH = pt / PT_PER_IN;
  const ty = y + pad + capH + Math.max(0, (room - textH) / 2);
  if (align === 'center') doc.text(text, x + w / 2, ty, { baseline: 'top', align: 'center' });
  else doc.text(text, x + pad, ty, { baseline: 'top' });
}

async function drawLabel(doc, piece, ctx, s) {
  const W = s.width_in;
  const H = s.height_in;
  const on = new Set(s.fields);
  const v = pieceLabelValues(piece, ctx);
  const m = Math.min(0.08, Math.min(W, H) * 0.04);
  const x0 = m;
  const y0 = m;
  const w = W - m * 2;
  const h = H - m * 2;

  const side = ['project', 'part', 'sequence'].filter((k) => on.has(k));
  const bottom = ['shape', 'size', 'weight'].filter((k) => on.has(k));
  const bottomH = bottom.length ? h * 0.3 : 0;
  const topH = h - bottomH;
  const qrCellW = side.length ? Math.min(topH, w * 0.42) : w;

  doc.setDrawColor(0);
  doc.setLineWidth(0.02);
  doc.rect(x0, y0, w, h);
  doc.setLineWidth(0.012);
  if (side.length) doc.line(x0 + qrCellW, y0, x0 + qrCellW, y0 + topH);
  if (bottom.length) doc.line(x0, y0 + topH, x0 + w, y0 + topH);

  // QR + serial
  const pad = Math.min(0.08, qrCellW * 0.06);
  const showSerial = on.has('serial') && v.serial;
  const serialPt = Math.max(5, Math.min(9, topH * PT_PER_IN * 0.08));
  const serialH = showSerial ? serialPt / PT_PER_IN + 0.03 : 0;
  const qrSize = Math.max(0.4, Math.min(qrCellW, topH) - pad * 2 - serialH);
  const qrX = x0 + (qrCellW - qrSize) / 2;
  const qrY = y0 + Math.max(pad, (topH - qrSize - serialH) / 2);
  if (v.qr) {
    const url = await generateLabelQrDataUrl(v.qr, { widthPx: Math.round(qrSize * 300) });
    // FAST = compressed; a QR is two colors, so this costs no sharpness.
    doc.addImage(url, 'PNG', qrX, qrY, qrSize, qrSize, undefined, 'FAST');
  }
  if (showSerial) {
    doc.setFont('helvetica', 'bold');
    const pt = fitFont(doc, v.serial, serialPt, qrCellW - pad * 2);
    doc.setFontSize(pt);
    doc.text(v.serial, x0 + qrCellW / 2, qrY + qrSize + 0.02, { baseline: 'top', align: 'center' });
  }

  // Project / part / sequence beside the QR
  if (side.length) {
    const rowH = topH / side.length;
    const sx = x0 + qrCellW;
    const sw = w - qrCellW;
    side.forEach((k, i) => {
      const ry = y0 + rowH * i;
      if (i > 0) doc.line(sx, ry, sx + sw, ry);
      drawBox(doc, { x: sx, y: ry, w: sw, h: rowH, caption: CAPTIONS[k], value: v[k], upper: s.uppercase });
    });
  }

  // Shape / size / weight along the bottom (size gets the most room)
  if (bottom.length) {
    const weights = bottom.map((k) => (k === 'size' ? 1.4 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let bx = x0;
    bottom.forEach((k, i) => {
      const bw = (w * weights[i]) / total;
      if (i > 0) doc.line(bx, y0 + topH, bx, y0 + h);
      drawBox(doc, { x: bx, y: y0 + topH, w: bw, h: bottomH, caption: CAPTIONS[k], value: v[k], align: 'center', upper: s.uppercase });
      bx += bw;
    });
  }
}

// One page per piece, in the order given. Returns { doc, blob, filename }.
export async function buildPieceLabelsPdf({ pieces, project, sequenceAreas, settings }) {
  const s = normalizePieceLabelSettings(settings);
  const orientation = s.width_in >= s.height_in ? 'l' : 'p';
  const doc = new jsPDF({ unit: 'in', format: [s.width_in, s.height_in], orientation });
  for (let i = 0; i < pieces.length; i += 1) {
    if (i > 0) doc.addPage([s.width_in, s.height_in], orientation);
    await drawLabel(doc, pieces[i], { project, sequenceAreas }, s);
  }
  const job = String(project?.project_number || 'labels').replace(/[^A-Za-z0-9_-]/g, '');
  const filename = `Piece-Labels-${job}-${pieces.length}.pdf`;
  return { doc, blob: doc.output('blob'), filename };
}
