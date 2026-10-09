import { jsPDF } from 'jspdf';
import { generateLabelQrDataUrl } from '@/lib/labelQr';

// Generates a label PDF sized to exactly match the physical label stock
// (LABEL_STOCK_SIZES in zplLabels.js) — nothing but the label design on the
// page: a real QR (see labelQr.js), title, subtitle, and the raw payload
// text. No letterhead, no app chrome, zero margin beyond the design itself,
// unlike every other PDF in src/lib/*Pdf.js which targets a Letter page.
//
// jsPDF normalizes a [w,h] format array to keep width <= height whenever
// orientation is 'portrait', so a 4in-wide x 2in-tall stock needs explicit
// 'landscape' orientation to actually come out 4x2 instead of being swapped
// to 2x4.
const CONTENT_MARGIN_IN = 0.12;

export async function generateLabelPdf({ size, title, subtitle, qrPayload }) {
  const widthIn = size?.widthIn || 4;
  const heightIn = size?.heightIn || 2;
  const orientation = widthIn >= heightIn ? 'l' : 'p';
  const doc = new jsPDF({ unit: 'in', format: [widthIn, heightIn], orientation });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const centerX = pageWidth / 2;
  const maxTextWidth = pageWidth - CONTENT_MARGIN_IN * 2;

  // Only two physical stocks exist today (4x2 and 4x6) — the larger one gets
  // a bigger QR and larger type rather than leaving the extra stock blank.
  const roomy = Math.min(pageWidth, pageHeight) >= 4;
  const qrSizeIn = roomy ? 2.4 : 1.3; // both comfortably clear the 1.25in minimum
  const titleFontSize = roomy ? 16 : 10;
  const subtitleFontSize = roomy ? 10 : 6.5;
  const payloadFontSize = roomy ? 8 : 6;
  const titleLineH = roomy ? 0.26 : 0.16;
  const subtitleLineH = roomy ? 0.18 : 0.12;
  const payloadLineH = roomy ? 0.16 : 0.1;
  const gap = roomy ? 0.15 : 0.05;

  const payload = String(qrPayload ?? '');
  const qrDataUrl = await generateLabelQrDataUrl(payload, { widthPx: roomy ? 900 : 512 });

  doc.setFont(undefined, 'bold');
  doc.setFontSize(titleFontSize);
  const titleLine = doc.splitTextToSize(String(title ?? ''), maxTextWidth)[0] || '';

  doc.setFont(undefined, 'normal');
  doc.setFontSize(subtitleFontSize);
  const subtitleLine = subtitle ? (doc.splitTextToSize(String(subtitle), maxTextWidth)[0] || '') : '';
  const subtitleH = subtitleLine ? subtitleLineH : 0;

  const blockHeight = titleLineH + subtitleH + gap + qrSizeIn + gap + payloadLineH;
  let y = CONTENT_MARGIN_IN + Math.max(0, (pageHeight - CONTENT_MARGIN_IN * 2 - blockHeight) / 2) + titleLineH;

  doc.setFont(undefined, 'bold');
  doc.setFontSize(titleFontSize);
  doc.text(titleLine, centerX, y, { align: 'center' });

  if (subtitleLine) {
    y += subtitleLineH;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(subtitleFontSize);
    doc.text(subtitleLine, centerX, y, { align: 'center' });
  }

  y += gap;
  doc.addImage(qrDataUrl, 'PNG', centerX - qrSizeIn / 2, y, qrSizeIn, qrSizeIn);
  y += qrSizeIn + gap + payloadLineH;

  doc.setFont(undefined, 'normal');
  doc.setFontSize(payloadFontSize);
  doc.text(payload, centerX, Math.min(y, pageHeight - CONTENT_MARGIN_IN), { align: 'center', maxWidth: maxTextWidth });

  const blob = doc.output('blob');
  const safePayload = payload.replace(/[^A-Za-z0-9_-]/g, '') || 'label';
  const filename = `Label-${safePayload}.pdf`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { blob, filename };
}
