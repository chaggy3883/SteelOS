// IRONSIGHT view math — zoom, pan and view rotation for the drawing canvas.
//
// Two coordinate systems, and only two:
//   PDF space      — the page at zoom 1 with its own /Rotate applied (pdf.js
//                    viewport at scale 1): { pdfX, pdfY } in PDF points, y
//                    down. Every stored measurement and markup lives here.
//   viewport space — CSS pixels inside the canvas viewport element.
//
// The view is { scale, pan: { x, y }, rotation, pageWidth, pageHeight }.
// A PDF point goes to the screen in two steps:
//   1. page-local pixels:   u = pdfX * scale, v = pdfY * scale   (the old
//      "pdfX * scale" every draw routine already uses)
//   2. view rotation (0/90/180/270, clockwise like pdf.js), then + pan.
// Step 2 is applied ONCE — as a canvas context transform for drawing and as a
// CSS matrix for the DOM text layer — so draw code keeps writing pdfX * scale
// and never adds pan itself. The inverse (clientToPdf below) is the only place
// a click is turned back into PDF space: un-pan, un-rotate, divide by scale.
// With rotation 0 it is exactly offsetX / scale, offsetX measured from the
// page's own top-left corner.
//
// Pure functions only — no React, no DOM — so the math can be checked by hand.

export const ZOOM_MIN = 0.05; //   5%
export const ZOOM_MAX = 64; // 6400%
export const ZOOM_STEP = 1.25;
// Wheel: one standard notch (deltaY 100 px) zooms by e^0.15 ≈ 1.1618.
export const WHEEL_ZOOM_RATE = 0.0015;

export const ZOOM_PRESETS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8, 16, 32, 64];

export const clampZoom = (s) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(s) || 1));

export const normRotation = (r) => ((Math.round((Number(r) || 0) / 90) * 90) % 360 + 360) % 360;

/** Wheel event delta → multiplicative zoom factor (deltaMode 1 = lines, 2 = pages). */
export function wheelZoomFactor(deltaY, deltaMode = 0) {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  // A single runaway event (some trackpads report thousands) is capped.
  const capped = Math.max(-600, Math.min(600, px));
  return Math.exp(-capped * WHEEL_ZOOM_RATE);
}

/**
 * New pan so the point under `anchor` (viewport px) stays put while the
 * scale changes from `scale` to `nextScale` (clamped). Rotation doesn't
 * matter: everything between the PDF point and the screen is linear in
 * scale, so the anchor's offset from the pan origin just scales.
 *   pan' = anchor - (anchor - pan) * (s' / s)
 */
export function zoomAt({ scale, pan }, nextScale, anchor) {
  const s1 = clampZoom(nextScale);
  if (!anchor) return { scale: s1, pan: { ...pan } };
  const k = s1 / scale;
  return { scale: s1, pan: { x: anchor.x - (anchor.x - pan.x) * k, y: anchor.y - (anchor.y - pan.y) * k } };
}

/** Displayed (rotated) page size in px at `scale`. */
export function displaySize(pageWidth, pageHeight, scale, rotation = 0) {
  const r = normRotation(rotation);
  const w = pageWidth * scale;
  const h = pageHeight * scale;
  return r === 90 || r === 270 ? { width: h, height: w } : { width: w, height: h };
}

/**
 * Affine [a, b, c, d, e, f] from page-local pixels (u, v) to displayed-page
 * pixels (before pan): x = a·u + c·v + e, y = b·u + d·v + f. W/H are the
 * UNrotated page size at the current scale.
 *   0°:   ( u,      v )
 *   90°:  ( H - v,  u )      clockwise — the old top-left lands top-right
 *   180°: ( W - u,  H - v )
 *   270°: ( v,      W - u )
 */
export function rotationMatrix(rotation, W, H) {
  switch (normRotation(rotation)) {
    case 90: return [0, 1, -1, 0, H, 0];
    case 180: return [-1, 0, 0, -1, W, H];
    case 270: return [0, -1, 1, 0, 0, W];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

/** Page-local px → viewport px matrix for the whole view (rotation, then pan). */
export function viewMatrix(view) {
  const { scale, pan, rotation = 0, pageWidth = 0, pageHeight = 0 } = view;
  const m = rotationMatrix(rotation, pageWidth * scale, pageHeight * scale);
  return [m[0], m[1], m[2], m[3], m[4] + pan.x, m[5] + pan.y];
}

/**
 * Viewport px (x, y) → PDF space. The inverse of viewMatrix followed by
 * dividing by scale; with rotation 0 this is ((x - pan.x) / scale,
 * (y - pan.y) / scale), i.e. the page-relative offset over scale.
 */
export function viewportToPdf(view, x, y) {
  const { scale, pan, rotation = 0, pageWidth = 0, pageHeight = 0 } = view;
  const W = pageWidth * scale;
  const H = pageHeight * scale;
  const dx = x - pan.x;
  const dy = y - pan.y;
  let u; let v;
  switch (normRotation(rotation)) {
    case 90: u = dy; v = H - dx; break;
    case 180: u = W - dx; v = H - dy; break;
    case 270: u = W - dy; v = dx; break;
    default: u = dx; v = dy;
  }
  return { pdfX: u / scale, pdfY: v / scale };
}

/** Center of a PDF-space point in viewport px (used for zoom-to and anchors, never for click math). */
export function pdfToViewport(view, pt) {
  const m = viewMatrix(view);
  const u = pt.pdfX * view.scale;
  const v = pt.pdfY * view.scale;
  return { x: m[0] * u + m[2] * v + m[4], y: m[1] * u + m[3] * v + m[5] };
}

/** Scale that fits the whole displayed page in a viewport, with a margin. */
export function fitPageScale(pageWidth, pageHeight, vw, vh, rotation = 0, margin = 16) {
  const d = displaySize(pageWidth, pageHeight, 1, rotation);
  if (!(d.width > 0 && d.height > 0 && vw > 0 && vh > 0)) return 1;
  return clampZoom(Math.min((vw - margin * 2) / d.width, (vh - margin * 2) / d.height));
}

export function fitWidthScale(pageWidth, pageHeight, vw, rotation = 0, margin = 16) {
  const d = displaySize(pageWidth, pageHeight, 1, rotation);
  if (!(d.width > 0 && vw > 0)) return 1;
  return clampZoom((vw - margin * 2) / d.width);
}

/** Pan that centers the displayed page in the viewport at `scale` (top-aligned when it's taller than the viewport). */
export function centeredPan(pageWidth, pageHeight, vw, vh, scale, rotation = 0, margin = 16) {
  const d = displaySize(pageWidth, pageHeight, scale, rotation);
  return {
    x: d.width <= vw ? (vw - d.width) / 2 : margin,
    y: d.height <= vh ? (vh - d.height) / 2 : margin,
  };
}

/**
 * View that frames a PDF-space rectangle { x, y, width, height } in the
 * viewport, with `pad` viewport px around it, never past maxScale.
 */
export function viewForRect(rect, { pageWidth, pageHeight, rotation = 0 }, vw, vh, { pad = 40, maxScale = 8 } = {}) {
  const r = normRotation(rotation);
  const sideways = r === 90 || r === 270;
  const rw = Math.max(1, sideways ? rect.height : rect.width);
  const rh = Math.max(1, sideways ? rect.width : rect.height);
  const scale = clampZoom(Math.min(maxScale, (vw - pad * 2) / rw, (vh - pad * 2) / rh));
  const center = { pdfX: rect.x + rect.width / 2, pdfY: rect.y + rect.height / 2 };
  const at = pdfToViewport({ scale, pan: { x: 0, y: 0 }, rotation, pageWidth, pageHeight }, center);
  return { scale, pan: { x: vw / 2 - at.x, y: vh / 2 - at.y } };
}

/** The page-local pixel rectangle that's visible, in displayed (rotated) page px. */
export function visibleDisplayRect(view, vw, vh) {
  const d = displaySize(view.pageWidth, view.pageHeight, view.scale, view.rotation);
  const x0 = Math.max(0, -view.pan.x);
  const y0 = Math.max(0, -view.pan.y);
  const x1 = Math.min(d.width, vw - view.pan.x);
  const y1 = Math.min(d.height, vh - view.pan.y);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Ortho: keep `pt` on the horizontal or vertical line through `from`
 * (whichever is closer). Used for Shift-held picks and the Ortho toggle.
 */
export function orthoPoint(from, pt) {
  if (!from || !pt) return pt;
  const dx = Math.abs(pt.pdfX - from.pdfX);
  const dy = Math.abs(pt.pdfY - from.pdfY);
  return dx >= dy ? { pdfX: pt.pdfX, pdfY: from.pdfY } : { pdfX: from.pdfX, pdfY: pt.pdfY };
}
