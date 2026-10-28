// Snap-to-drawing for IRONSIGHT: pulls the line work out of a PDF page's
// own vector paths (pdf.js operator list) so a click can land exactly on a
// line end, a line's midpoint, or anywhere along a line — the way a CAD-made
// drawing was actually drawn — instead of wherever the mouse happened to be.
//
// Coordinates: the operator list's path points are in PDF user space under
// whatever transform (CTM) is active at that moment. We track the CTM through
// save/restore/transform and form XObjects, then finish with the page
// viewport's own transform at zoom 1 — which is exactly IRONSIGHT's PDF space
// (top-left origin, y down, page rotation applied, 72 points per inch). The
// result lines up 1:1 with every stored pdfX/pdfY.
//
// Pure helpers, no pdf.js import: the caller passes the operator list, the
// zoom-1 viewport transform, and pdf.js's OPS table.

// pdf.js DrawOPS codes inside a constructPath's packed path buffer (v5+).
const DRAW_MOVE = 0;
const DRAW_LINE = 1;
const DRAW_CURVE = 2;
const DRAW_QUAD = 3;
const DRAW_CLOSE = 4;

const MAX_SEGMENTS = 150000;
const CELL = 24; // grid cell size for the lookup index, PDF points

// Same composition rule as pdf.js Util.transform: result(p) = m1(m2(p)).
export function multiplyTransform(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// Walks one packed path buffer, pushing straight segments (curves become
// their chord — good enough for snapping to their ends) into `out`.
function collectPathSegments(buf, ctm, out) {
  let cx = 0; let cy = 0; let sx = 0; let sy = 0;
  const push = (x1, y1, x2, y2) => {
    if (out.length >= MAX_SEGMENTS * 4) return;
    const [ax, ay] = apply(ctm, x1, y1);
    const [bx, by] = apply(ctm, x2, y2);
    if (Math.abs(ax - bx) < 0.01 && Math.abs(ay - by) < 0.01) return;
    out.push(ax, ay, bx, by);
  };
  for (let i = 0; i < buf.length;) {
    switch (buf[i++]) {
      case DRAW_MOVE:
        cx = sx = buf[i++]; cy = sy = buf[i++];
        break;
      case DRAW_LINE: {
        const x = buf[i++]; const y = buf[i++];
        push(cx, cy, x, y); cx = x; cy = y;
        break;
      }
      case DRAW_CURVE: {
        i += 4;
        const x = buf[i++]; const y = buf[i++];
        push(cx, cy, x, y); cx = x; cy = y;
        break;
      }
      case DRAW_QUAD: {
        i += 2;
        const x = buf[i++]; const y = buf[i++];
        push(cx, cy, x, y); cx = x; cy = y;
        break;
      }
      case DRAW_CLOSE:
        push(cx, cy, sx, sy); cx = sx; cy = sy;
        break;
      default:
        return; // unknown op — stop rather than misread the rest of the buffer
    }
  }
}

// operatorList: page.getOperatorList() result ({ fnArray, argsArray })
// viewportTransform: page.getViewport({ scale: 1 }).transform
// OPS: pdfjsLib.OPS
// Returns a flat Float32Array [x1, y1, x2, y2, ...] in IRONSIGHT PDF space.
export function extractSegments(operatorList, viewportTransform, OPS) {
  const { fnArray, argsArray } = operatorList || {};
  if (!fnArray || !OPS) return new Float32Array(0);
  const out = [];
  const stack = [];
  let ctm = viewportTransform.slice();
  for (let i = 0; i < fnArray.length && out.length < MAX_SEGMENTS * 4; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() || ctm;
    } else if (fn === OPS.transform) {
      ctm = multiplyTransform(ctm, args);
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = multiplyTransform(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() || ctm;
    } else if (fn === OPS.constructPath) {
      // [paintOp, [pathBuffer], minMax] — endPath is a clip-only path, not
      // visible line work, so it's skipped.
      const paintOp = args?.[0];
      const buf = args?.[1]?.[0];
      if (paintOp === OPS.endPath || !buf || typeof buf.length !== 'number') continue;
      collectPathSegments(buf, ctm, out);
    }
  }
  return Float32Array.from(out);
}

// Grid index so a snap lookup only checks the handful of segments near the
// cursor instead of every line on the sheet.
export function buildSnapIndex(segments) {
  const cells = new Map();
  const add = (cx, cy, idx) => {
    const key = `${cx},${cy}`;
    let list = cells.get(key);
    if (!list) { list = []; cells.set(key, list); }
    if (list[list.length - 1] !== idx) list.push(idx);
  };
  const count = segments.length / 4;
  for (let s = 0; s < count; s++) {
    const x1 = segments[s * 4]; const y1 = segments[s * 4 + 1];
    const x2 = segments[s * 4 + 2]; const y2 = segments[s * 4 + 3];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(len / (CELL / 2)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      add(Math.floor((x1 + (x2 - x1) * t) / CELL), Math.floor((y1 + (y2 - y1) * t) / CELL), s);
    }
  }
  return { segments, cells, count };
}

// Nearest snap target within `tolPdf` (PDF points — the caller converts its
// on-screen tolerance by dividing by the current zoom). Line ends win over
// midpoints, which win over "somewhere on the line", so a near-miss on a
// corner always lands on the corner.
export function findSnap(index, pt, tolPdf) {
  if (!index || !index.count || !(tolPdf > 0)) return null;
  const { segments, cells } = index;
  const minCx = Math.floor((pt.pdfX - tolPdf) / CELL) - 1;
  const maxCx = Math.floor((pt.pdfX + tolPdf) / CELL) + 1;
  const minCy = Math.floor((pt.pdfY - tolPdf) / CELL) - 1;
  const maxCy = Math.floor((pt.pdfY + tolPdf) / CELL) + 1;
  const seen = new Set();
  let end = null; let mid = null; let on = null;
  const consider = (best, type, x, y, d) => (d <= tolPdf && (!best || d < best.d) ? { type, pdfX: x, pdfY: y, d } : best);

  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      const list = cells.get(`${cx},${cy}`);
      if (!list) continue;
      for (const s of list) {
        if (seen.has(s)) continue;
        seen.add(s);
        const x1 = segments[s * 4]; const y1 = segments[s * 4 + 1];
        const x2 = segments[s * 4 + 2]; const y2 = segments[s * 4 + 3];
        end = consider(end, 'endpoint', x1, y1, Math.hypot(pt.pdfX - x1, pt.pdfY - y1));
        end = consider(end, 'endpoint', x2, y2, Math.hypot(pt.pdfX - x2, pt.pdfY - y2));
        const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2;
        mid = consider(mid, 'midpoint', mx, my, Math.hypot(pt.pdfX - mx, pt.pdfY - my));
        const dx = x2 - x1; const dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((pt.pdfX - x1) * dx + (pt.pdfY - y1) * dy) / len2)) : 0;
        const px = x1 + dx * t; const py = y1 + dy * t;
        on = consider(on, 'on line', px, py, Math.hypot(pt.pdfX - px, pt.pdfY - py));
      }
    }
  }
  const hit = end || mid || on;
  return hit ? { type: hit.type, pdfX: hit.pdfX, pdfY: hit.pdfY } : null;
}

// Screen-space snap reach, converted to PDF points at the current zoom.
export const SNAP_TOLERANCE_PX = 10;
export const snapTolerancePdf = (zoomScale) => SNAP_TOLERANCE_PX / (zoomScale || 1);
