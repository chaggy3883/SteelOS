// Shared letterhead lookup + drawing helpers for every PDF export in the
// app. See src/lib/letterheadDocumentTypes.js for the full list of document
// type keys this can be matched against.
//
// Design decision: when an active letterhead is assigned to a document
// type, it REPLACES that generator's own logo/company-name header entirely
// (for jsPDF documents) or is prepended as a full-width band above the
// captured screenshot (for html2canvas snapshot exports) — it never renders
// alongside the normal header. A letterhead image is pre-designed art that
// already carries the company name/logo/address/branding treatment, so
// drawing both would duplicate the company name and clash stylistically.
// Each document's own title/date/body content still renders normally,
// starting below the letterhead.
//
// No caching anywhere in this file — every call re-queries
// CompanyLetterhead fresh, so a letterhead saved in Admin takes effect on
// the very next export with no stale-until-refresh window.
import { db } from '@/api/apiClient';
import { loadImageAsDataUrl } from '@/lib/pdfImage';
import { fitDimensions, drawLetterheadImage } from '@/lib/letterheadDraw';

export { drawLetterheadImage };

// Finds the active, currently-effective letterhead for one document type
// (tenant-scoped the same as every other entity — see TENANT_SCOPED_ENTITIES
// in localData.js). Returns null if none is assigned, so every caller's
// fallback path (draw the normal header) is just "letterhead == null".
export async function getActiveLetterhead(documentTypeKey) {
  try {
    const rows = await db.entities.CompanyLetterhead.filter({ is_active: true }, '-created_date', 100);
    return rows.find((row) => Array.isArray(row.applies_to) && row.applies_to.includes(documentTypeKey)) || null;
  } catch (e) {
    return null;
  }
}

// Resolves the active letterhead's image (or null) for one document type in
// a single async call — for a generator whose header is drawn by a SEPARATE
// sync layout function (bidProposalPdfLayout.js's drawHeader, etc.): fetch
// this once in the outer async generate*Pdf wrapper, thread the result
// through as a plain data field (e.g. data.letterheadImage), and have the
// sync layout function call drawLetterheadImage (below) with it — the sync
// function itself never needs to become async just for this.
export async function loadLetterheadImage(documentTypeKey) {
  const letterhead = await getActiveLetterhead(documentTypeKey);
  if (!letterhead?.letterhead_image_url) return null;
  return loadImageAsDataUrl(letterhead.letterhead_image_url);
}

// Convenience one-shot for a generator that draws its own entire header
// inline (no separate sync layout helper to thread an image through) — does
// the async lookup AND the sync draw in one call. Call this FIRST, before
// drawing anything else in the header region: if it returns a y, skip your
// own logo/company-name header entirely and resume drawing content at that
// y; if it returns null, no active letterhead matched this document type —
// draw your normal header as before.
export async function drawLetterheadIfActive(doc, documentTypeKey, opts) {
  const image = await loadLetterheadImage(documentTypeKey);
  return drawLetterheadImage(doc, image, opts);
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// For html2canvas snapshot exports (exportNodeToPdf.js) — there's no drawn
// text header on this path to replace, so the letterhead is composited as
// its own full-width band above the captured screenshot, capped at 22% of
// the screenshot's width so a landscape letterhead can never dwarf the
// actual report. Returns the ORIGINAL canvas unchanged if no active
// letterhead matches, so callers can unconditionally do
// `canvas = await prependLetterheadBand(canvas, documentTypeKey)`.
export async function prependLetterheadBand(sourceCanvas, documentTypeKey) {
  const image = await loadLetterheadImage(documentTypeKey);
  if (!image?.dataUrl) return sourceCanvas;

  const { width, height } = fitDimensions(image.width, image.height, sourceCanvas.width, sourceCanvas.width * 0.22);
  let imgEl;
  try {
    imgEl = await loadImageElement(image.dataUrl);
  } catch (e) {
    return sourceCanvas;
  }

  const bandHeightPx = Math.round(height);
  const composite = document.createElement('canvas');
  composite.width = sourceCanvas.width;
  composite.height = bandHeightPx + sourceCanvas.height;
  const ctx = composite.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, composite.width, composite.height);
  ctx.drawImage(imgEl, (composite.width - width) / 2, 0, width, height);
  ctx.drawImage(sourceCanvas, 0, bandHeightPx);
  return composite;
}
