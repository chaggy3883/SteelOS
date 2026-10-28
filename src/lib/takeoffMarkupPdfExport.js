// Marked-up PDF export for IRONSIGHT takeoffs (pdf-lib).
//
// Two modes, same input:
//   mode: 'burn'        — markups become vector drawing in each page's content
//                         stream. Every viewer shows them; nobody can edit them.
//   mode: 'annotations' — markups become standard PDF annotations (Line,
//                         PolyLine, Polygon, Square, Circle, FreeText, Stamp)
//                         with their own appearance streams, so other PDF
//                         viewers (including Revu/Acrobat) can see, move and
//                         edit them. Original page content is untouched.
//
// COORDINATES. IRONSIGHT's "PDF space" is pdf.js's viewport at scale 1 with
// the page's own /Rotate applied: origin at the top-left of the *displayed*
// page, y growing DOWN (BlueprintCanvas: pdfX = offsetX / scale on a canvas
// rendered from page.getViewport({ scale })). Real PDF user space has y
// growing UP from the bottom-left of the (unrotated) crop box. viewportToUser()
// inverts pdf.js's PageViewport transform exactly — including crop-box
// offsets and 90/180/270 rotation — so for an unrotated page it reduces to
// userX = cropX0 + pdfX, userY = cropY1 - pdfY (i.e. y flipped with page height).
//
// Normalized markup shape (see markupsFromAcceptedItems for the adapter from
// blueprint_takeoffs.accepted_items):
//   { page_number, type: 'line'|'polyline'|'polygon'|'count'|'rect'|'ellipse'|'text',
//     points: [{ pdfX, pdfY }], cutouts?: [[{ pdfX, pdfY }]],
//     color, fill_color?, fill_opacity?, opacity?, line_width?, line_style?: 'solid'|'dashed'|'dotted',
//     cloud?: boolean (rect only — revision cloud), symbol?, symbol_size?, show_numbers?, number_start?,
//     text?, font_size?, text_color?, label?, subject?, contents?, author?, id? }
// Legends: { page_number, legend (takeoffLegend.buildLegendData), font_size?, and either pdfX/pdfY (top-left)
//   or anchor: 'bottom-right'|'bottom-left'|'top-right'|'top-left' (+ margin, default 18pt) }

import { PDFDocument, PDFName, PDFString, PDFHexString, StandardFonts } from 'pdf-lib';
import { getPdf } from './pdfBlobStore.js';
import { layoutLegendTable, symbolPolygon, formatFeetInches } from './takeoffLegend.js';

// ------------------------------------------------------------------ geometry

const normRotation = (r) => (((Math.round(Number(r) / 90) * 90) % 360) + 360) % 360;

/**
 * Same "view" pdf.js uses: crop box clipped to the media box, normalized.
 * @param {import('pdf-lib').PDFPage} page
 */
export function getPageGeometry(page) {
  const mb = page.getMediaBox();
  const cb = page.getCropBox();
  const norm = (b) => [Math.min(b.x, b.x + b.width), Math.min(b.y, b.y + b.height), Math.max(b.x, b.x + b.width), Math.max(b.y, b.y + b.height)];
  const m = norm(mb);
  const c = norm(cb);
  let view = [Math.max(m[0], c[0]), Math.max(m[1], c[1]), Math.min(m[2], c[2]), Math.min(m[3], c[3])];
  if (view[2] <= view[0] || view[3] <= view[1]) view = m;
  return geometryFromView(view, page.getRotation().angle);
}

/** Build a geometry object from a pdf.js-style view box [x0,y0,x1,y1] and /Rotate. */
export function geometryFromView(view, rotate = 0) {
  const rotation = normRotation(rotate);
  const [x0, y0, x1, y1] = view;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let A; let B; let C; let D;
  switch (rotation) {
    case 90: A = 0; B = 1; C = 1; D = 0; break;
    case 180: A = -1; B = 0; C = 0; D = 1; break;
    case 270: A = 0; B = -1; C = -1; D = 0; break;
    default: A = 1; B = 0; C = 0; D = -1;
  }
  let offX; let offY; let width; let height;
  if (A === 0) { offX = Math.abs(cy - y0); offY = Math.abs(cx - x0); width = y1 - y0; height = x1 - x0; } else { offX = Math.abs(cx - x0); offY = Math.abs(cy - y0); width = x1 - x0; height = y1 - y0; }
  // pdf.js PageViewport.transform at scale 1: viewport = M · user
  const m = [A, B, C, D, offX - A * cx - C * cy, offY - B * cx - D * cy];
  const det = m[0] * m[3] - m[1] * m[2];
  const inv = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  return { view, rotation, width, height, toViewport: m, toUser: inv };
}

/** IRONSIGHT pdf-space (top-down viewport) point → PDF user space (bottom-up). */
export function viewportToUser(geom, x, y) {
  const t = geom.toUser;
  return { x: t[0] * x + t[2] * y + t[4], y: t[1] * x + t[3] * y + t[5] };
}

/** PDF user space → IRONSIGHT pdf-space. */
export function userToViewport(geom, x, y) {
  const t = geom.toViewport;
  return { x: t[0] * x + t[2] * y + t[4], y: t[1] * x + t[3] * y + t[5] };
}

// ------------------------------------------------------------- op writer

const hexToRgb = (hex, fallback = [0.94, 0.27, 0.27]) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const f = (n) => (Math.abs(n) < 1e-6 ? '0' : Number(n.toFixed(3)).toString());
const KAPPA = 0.5522847498;

/**
 * Accumulates PDF content-stream operators while taking IRONSIGHT
 * pdf-space coordinates, and tracks the user-space bounding box drawn.
 */
class OpWriter {
  constructor(geom, ctx) {
    this.geom = geom;
    this.ctx = ctx; // { font, fontKey, gsKey(fillA, strokeA) => name }
    this.ops = [];
    this.bounds = [Infinity, Infinity, -Infinity, -Infinity];
  }

  u(x, y) {
    const p = viewportToUser(this.geom, x, y);
    if (p.x < this.bounds[0]) this.bounds[0] = p.x;
    if (p.y < this.bounds[1]) this.bounds[1] = p.y;
    if (p.x > this.bounds[2]) this.bounds[2] = p.x;
    if (p.y > this.bounds[3]) this.bounds[3] = p.y;
    return p;
  }

  push(s) { this.ops.push(s); return this; }
  save() { return this.push('q'); }
  restore() { return this.push('Q'); }
  stroke(hex) { const [r, g, b] = hexToRgb(hex); return this.push(`${f(r)} ${f(g)} ${f(b)} RG`); }
  fill(hex) { const [r, g, b] = hexToRgb(hex); return this.push(`${f(r)} ${f(g)} ${f(b)} rg`); }
  width(w) { return this.push(`${f(w)} w 1 j 1 J`); }
  dash(style, w) {
    if (style === 'dashed') return this.push(`[${f(w * 4)} ${f(w * 2.5)}] 0 d`);
    if (style === 'dotted') return this.push(`[0 ${f(w * 2.5)}] 0 d`);
    return this.push('[] 0 d');
  }
  alpha(fillA = 1, strokeA = 1) {
    if (fillA >= 1 && strokeA >= 1) return this;
    return this.push(`/${this.ctx.gsKey(fillA, strokeA)} gs`);
  }
  path(points, close) {
    points.forEach((p, i) => { const q = this.u(p.pdfX ?? p.x ?? p[0], p.pdfY ?? p.y ?? p[1]); this.push(`${f(q.x)} ${f(q.y)} ${i ? 'l' : 'm'}`); });
    if (close) this.push('h');
    return this;
  }
  circle(cx, cy, r) {
    const k = r * KAPPA;
    const segs = [
      [[cx + r, cy], [cx + r, cy + k], [cx + k, cy + r], [cx, cy + r]],
      [null, [cx - k, cy + r], [cx - r, cy + k], [cx - r, cy]],
      [null, [cx - r, cy - k], [cx - k, cy - r], [cx, cy - r]],
      [null, [cx + k, cy - r], [cx + r, cy - k], [cx + r, cy]],
    ];
    segs.forEach((s, i) => {
      if (i === 0) { const p = this.u(...s[0]); this.push(`${f(p.x)} ${f(p.y)} m`); }
      const [a, b, c] = [this.u(...s[1]), this.u(...s[2]), this.u(...s[3])];
      this.push(`${f(a.x)} ${f(a.y)} ${f(b.x)} ${f(b.y)} ${f(c.x)} ${f(c.y)} c`);
    });
    return this.push('h');
  }
  ellipse(x0, y0, x1, y1) {
    const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
    const rx = Math.abs(x1 - x0) / 2; const ry = Math.abs(y1 - y0) / 2;
    const kx = rx * KAPPA; const ky = ry * KAPPA;
    const pts = [
      [[cx + rx, cy], [cx + rx, cy + ky], [cx + kx, cy + ry], [cx, cy + ry]],
      [null, [cx - kx, cy + ry], [cx - rx, cy + ky], [cx - rx, cy]],
      [null, [cx - rx, cy - ky], [cx - kx, cy - ry], [cx, cy - ry]],
      [null, [cx + kx, cy - ry], [cx + rx, cy - ky], [cx + rx, cy]],
    ];
    pts.forEach((s, i) => {
      if (i === 0) { const p = this.u(...s[0]); this.push(`${f(p.x)} ${f(p.y)} m`); }
      const [a, b, c] = [this.u(...s[1]), this.u(...s[2]), this.u(...s[3])];
      this.push(`${f(a.x)} ${f(a.y)} ${f(b.x)} ${f(b.y)} ${f(c.x)} ${f(c.y)} c`);
    });
    return this.push('h');
  }
  /** Scalloped revision-cloud outline around a viewport rectangle. */
  cloud(x0, y0, x1, y1, arc = 10) {
    const pts = cloudPoints(x0, y0, x1, y1, arc);
    return this.path(pts, true);
  }
  /** Upright text whose top-left is at viewport (x, yTop). */
  text(str, x, yTop, size, hex = '#0f172a') {
    const { font, fontKey } = this.ctx;
    const safe = sanitizeText(font, str);
    if (!safe) return this;
    const base = this.u(x, yTop + size * 0.8);
    const right = viewportToUser(this.geom, x + 1, yTop + size * 0.8);
    const dx = right.x - base.x; const dy = right.y - base.y;
    const w = font.widthOfTextAtSize(safe, size);
    this.u(x + w, yTop); this.u(x, yTop + size);
    const [r, g, b] = hexToRgb(hex);
    return this.push(`BT /${fontKey} ${f(size)} Tf ${f(r)} ${f(g)} ${f(b)} rg ${f(dx)} ${f(dy)} ${f(-dy)} ${f(dx)} ${f(base.x)} ${f(base.y)} Tm ${font.encodeText(safe).toString()} Tj ET`);
  }
  textWidth(str, size) { return this.ctx.font.widthOfTextAtSize(sanitizeText(this.ctx.font, str), size); }
  toString() { return this.ops.join('\n'); }
  rect(pad = 0) {
    const [a, b, c, d] = this.bounds;
    if (!Number.isFinite(a)) return [0, 0, 0, 0];
    return [a - pad, b - pad, c + pad, d + pad];
  }
}

const charSetCache = new WeakMap();
function sanitizeText(font, str) {
  if (str == null) return '';
  let set = charSetCache.get(font);
  if (!set) { set = new Set(font.getCharacterSet()); charSetCache.set(font, set); }
  const swaps = { '–': '-', '—': '-', '−': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '×': 'x' };
  return [...String(str)].map((ch) => swaps[ch] || ch).map((ch) => (set.has(ch.codePointAt(0)) ? ch : '?')).join('').replace(/[\r\n\t]+/g, ' ');
}

/** Scallop points (viewport space) for a revision cloud around a rectangle. */
export function cloudPoints(x0, y0, x1, y1, arc = 10) {
  const left = Math.min(x0, x1); const right = Math.max(x0, x1);
  const top = Math.min(y0, y1); const bottom = Math.max(y0, y1);
  const corners = [[left, top], [right, top], [right, bottom], [left, bottom]];
  const out = [];
  for (let e = 0; e < 4; e++) {
    const [ax, ay] = corners[e]; const [bx, by] = corners[(e + 1) % 4];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / arc));
    const ux = (bx - ax) / len || 0; const uy = (by - ay) / len || 0;
    // outward normal for a clockwise (in y-down) rectangle
    const nx = uy; const ny = -ux;
    const seg = len / n;
    for (let i = 0; i < n; i++) {
      const sx = ax + ux * seg * i; const sy = ay + uy * seg * i;
      const r = seg / 2;
      const mx = sx + ux * r; const my = sy + uy * r;
      for (let k = 0; k <= 6; k++) {
        const t = Math.PI - (k * Math.PI) / 6; // half circle bulging outward
        const cx = Math.cos(t); const sn = Math.sin(t);
        out.push([mx + ux * r * cx + nx * r * sn, my + uy * r * cx + ny * r * sn]);
      }
    }
  }
  return out;
}

// --------------------------------------------------------- markup drawing

const lineOpts = (m) => ({
  color: m.color || '#ef4444',
  width: Number(m.line_width) > 0 ? Number(m.line_width) : 2,
  style: m.line_style || 'solid',
  opacity: m.opacity ?? 1,
});

const centroid = (pts) => {
  const n = pts.length || 1;
  return { x: pts.reduce((s, p) => s + p.pdfX, 0) / n, y: pts.reduce((s, p) => s + p.pdfY, 0) / n };
};

/** Draw one markup into a writer. Returns false when the markup has no usable geometry. */
function drawMarkup(w, m) {
  const pts = (m.points || []).filter((p) => Number.isFinite(p?.pdfX) && Number.isFinite(p?.pdfY));
  const { color, width, style, opacity } = lineOpts(m);
  const fontSize = Number(m.font_size) > 0 ? Number(m.font_size) : 8;
  switch (m.type) {
    case 'line':
    case 'polyline': {
      if (pts.length < 2) return false;
      w.save().alpha(1, opacity).stroke(color).width(width).dash(style, width).path(pts, false).push('S').restore();
      if (m.text) {
        const mid = Math.floor((pts.length - 1) / 2);
        const a = pts[mid]; const b = pts[mid + 1];
        w.text(m.text, (a.pdfX + b.pdfX) / 2 + 3, (a.pdfY + b.pdfY) / 2 - fontSize - 3, fontSize, m.text_color || color);
      }
      return true;
    }
    case 'polygon': {
      if (pts.length < 3) return false;
      const fillA = m.fill_color ? (m.fill_opacity ?? 0.25) : 0;
      w.save();
      if (fillA > 0) {
        w.alpha(fillA, 1).fill(m.fill_color).path(pts, true);
        (m.cutouts || []).forEach((hole) => { if (hole?.length >= 3) w.path(hole, true); });
        w.push('f*');
        w.restore().save();
      }
      w.alpha(1, opacity).stroke(color).width(width).dash(style, width).path(pts, true).push('S');
      (m.cutouts || []).forEach((hole) => { if (hole?.length >= 3) w.dash('dashed', width).path(hole, true).push('S'); });
      w.restore();
      if (m.text) { const c = centroid(pts); w.text(m.text, c.x - w.textWidth(m.text, fontSize) / 2, c.y - fontSize / 2, fontSize, m.text_color || color); }
      return true;
    }
    case 'rect':
    case 'ellipse': {
      if (pts.length < 2) return false;
      const [a, b] = pts;
      w.save();
      const fillA = m.fill_color ? (m.fill_opacity ?? 0.25) : 0;
      const shape = () => {
        if (m.type === 'ellipse') w.ellipse(a.pdfX, a.pdfY, b.pdfX, b.pdfY);
        else if (m.cloud) w.cloud(a.pdfX, a.pdfY, b.pdfX, b.pdfY, Number(m.cloud_arc) || 10);
        else w.path([a, { pdfX: b.pdfX, pdfY: a.pdfY }, b, { pdfX: a.pdfX, pdfY: b.pdfY }], true);
      };
      if (fillA > 0) { w.alpha(fillA, 1).fill(m.fill_color); shape(); w.push('f').restore().save(); }
      w.alpha(1, opacity).stroke(color).width(width).dash(m.cloud ? 'solid' : style, width);
      shape();
      w.push('S').restore();
      if (m.text) w.text(m.text, Math.min(a.pdfX, b.pdfX), Math.min(a.pdfY, b.pdfY) - fontSize - 2, fontSize, m.text_color || color);
      return true;
    }
    case 'count': {
      if (!pts.length) return false;
      const r = Number(m.symbol_size) > 0 ? Number(m.symbol_size) : 7;
      const start = Number.isFinite(m.number_start) ? m.number_start : 1;
      pts.forEach((p, i) => {
        const poly = symbolPolygon(m.symbol || 'circle', p.pdfX, p.pdfY, r);
        w.save().alpha(m.fill_opacity ?? 0.85, 1).fill(color).stroke('#ffffff').width(Math.max(0.75, r / 5));
        if (poly) w.path(poly.map(([x, y]) => ({ pdfX: x, pdfY: y })), true); else w.circle(p.pdfX, p.pdfY, r);
        w.push('B').restore();
        if (m.show_numbers) w.text(String(start + i), p.pdfX + r + 1, p.pdfY - r - fontSize * 0.6, fontSize, m.text_color || '#0f172a');
      });
      return true;
    }
    case 'text': {
      if (!pts.length || !m.text) return false;
      const lines = String(m.text).split(/\r?\n/);
      lines.forEach((line, i) => w.text(line, pts[0].pdfX, pts[0].pdfY + i * fontSize * 1.2, fontSize, m.text_color || color));
      return true;
    }
    default:
      return false;
  }
}

function drawLegend(w, legendSpec, font) {
  const { legend } = legendSpec;
  if (!legend?.rows?.length) return false;
  const fontSize = legendSpec.font_size ?? 8;
  const layout = layoutLegendTable(legend, { fontSize, measureText: (t, fs) => font.widthOfTextAtSize(sanitizeText(font, t), fs) });
  let x0 = legendSpec.pdfX; let y0 = legendSpec.pdfY;
  if (legendSpec.anchor || !Number.isFinite(x0) || !Number.isFinite(y0)) {
    // Corner placement on the displayed page, `margin` points in from the edges.
    const margin = legendSpec.margin ?? 18;
    const anchor = legendSpec.anchor || 'bottom-right';
    x0 = anchor.endsWith('left') ? margin : w.geom.width - margin - layout.width;
    y0 = anchor.startsWith('top') ? margin : w.geom.height - margin - layout.height;
  }
  const { padding, rowHeight, columns } = layout;
  const rectPts = (x, y, wd, ht) => [{ pdfX: x, pdfY: y }, { pdfX: x + wd, pdfY: y }, { pdfX: x + wd, pdfY: y + ht }, { pdfX: x, pdfY: y + ht }];
  w.save().fill('#ffffff').stroke('#1e293b').width(0.75).dash('solid', 1).path(rectPts(x0, y0, layout.width, layout.height), true).push('B').restore();
  if (legend.title) w.text(legend.title, x0 + padding, y0 + padding, fontSize * 1.25);
  const rowLine = (y) => w.save().stroke('#cbd5e1').width(0.5).path([{ pdfX: x0, pdfY: y }, { pdfX: x0 + layout.width, pdfY: y }], false).push('S').restore();
  const drawRow = (texts, y, row) => {
    columns.forEach((c) => {
      if (c.key === 'symbol') {
        if (!row) return;
        const cx = x0 + c.x + c.width / 2; const cy = y + rowHeight / 2; const r = layout.symbolSize / 2;
        w.save();
        if (row.symbol) {
          const poly = symbolPolygon(row.symbol, cx, cy, r);
          w.fill(row.color);
          if (poly) w.path(poly.map(([px, py]) => ({ pdfX: px, pdfY: py })), true); else w.circle(cx, cy, r);
          w.push('f');
        } else if (['area', 'wall_area', 'volume'].includes(row.tool)) {
          w.alpha(0.35, 1).fill(row.fill_color || row.color).path(rectPts(cx - r, cy - r, r * 2, r * 2), true).push('f').restore().save();
          w.stroke(row.color).width(0.75).path(rectPts(cx - r, cy - r, r * 2, r * 2), true).push('S');
        } else {
          w.stroke(row.color).width(Math.max(1, r / 3)).dash(row.line_style, Math.max(1, r / 3)).path([{ pdfX: cx - r, pdfY: cy }, { pdfX: cx + r, pdfY: cy }], false).push('S');
        }
        w.restore();
        return;
      }
      const t = texts[c.key] || '';
      if (!t) return;
      const tw = font.widthOfTextAtSize(sanitizeText(font, t), fontSize);
      const tx = c.align === 'right' ? c.x + c.width - padding - tw : c.align === 'center' ? c.x + (c.width - tw) / 2 : c.x + padding;
      w.text(t, x0 + tx, y + padding, fontSize);
    });
    rowLine(y + rowHeight);
  };
  drawRow(Object.fromEntries(columns.map((c) => [c.key, c.label])), y0 + layout.headerY, null);
  legend.rows.forEach((r, i) => drawRow(r.text, y0 + layout.firstRowY + i * rowHeight, r));
  drawRow(legend.totals.text, y0 + layout.totalsY, null);
  return true;
}

// ------------------------------------------------------------ annotations

const annotSubtype = (m) => {
  switch (m.type) {
    case 'line': return (m.points || []).length === 2 ? 'Line' : 'PolyLine';
    case 'polyline': return 'PolyLine';
    case 'polygon': return 'Polygon';
    case 'rect': return 'Square';
    case 'ellipse': return 'Circle';
    case 'text': return 'FreeText';
    default: return null;
  }
};

const pdfDate = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

const textObj = (s) => PDFHexString.fromText(String(s ?? ''));

function buildAnnotation(doc, page, geom, shared, m, writer, extra = {}) {
  const ctx = doc.context;
  const subtype = extra.subtype || annotSubtype(m);
  if (!subtype) return null;
  const pad = (Number(m.line_width) || 2) + 2;
  const rect = writer.rect(pad);
  const [r, g, b] = hexToRgb(m.color || '#ef4444');
  const width = Number(m.line_width) > 0 ? Number(m.line_width) : 2;
  const userPts = (pts) => pts.flatMap((p) => { const u = viewportToUser(geom, p.pdfX, p.pdfY); return [u.x, u.y]; });
  const ap = ctx.flateStream(writer.toString(), {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: rect,
    Resources: shared.resources,
  });
  const dict = {
    Type: 'Annot',
    Subtype: subtype,
    Rect: rect,
    F: 4,
    C: [r, g, b],
    BS: { Type: 'Border', W: subtype === 'FreeText' || subtype === 'Stamp' ? 0 : width, S: m.line_style === 'dashed' || m.line_style === 'dotted' ? 'D' : 'S', ...(m.line_style === 'dashed' ? { D: [width * 4, width * 2.5] } : m.line_style === 'dotted' ? { D: [1, width * 2.5] } : {}) },
    M: PDFString.of(pdfDate()),
    AP: { N: ctx.register(ap) },
  };
  if (m.opacity != null && m.opacity < 1) dict.CA = m.opacity;
  if (subtype === 'Line') { dict.L = userPts(m.points.slice(0, 2)); dict.LE = ['None', 'None']; }
  if (subtype === 'PolyLine' || subtype === 'Polygon') dict.Vertices = userPts(extra.vertices || m.points);
  if ((subtype === 'Polygon' || subtype === 'Square' || subtype === 'Circle') && m.fill_color) dict.IC = hexToRgb(m.fill_color);
  if (subtype === 'Square' && m.cloud) dict.BE = { S: 'C', I: 1 };
  const obj = ctx.obj(dict);
  if (subtype === 'FreeText') {
    const fs = Number(m.font_size) > 0 ? Number(m.font_size) : 8;
    const [tr, tg, tb] = hexToRgb(m.text_color || m.color || '#0f172a');
    obj.set(PDFName.of('DA'), PDFString.of(`/${shared.fontKey} ${f(fs)} Tf ${f(tr)} ${f(tg)} ${f(tb)} rg`));
    obj.set(PDFName.of('DR'), shared.resources);
    obj.set(PDFName.of('IT'), PDFName.of('FreeTextTypeWriter'));
  }
  const contents = extra.contents ?? m.contents ?? [m.label, m.text].filter(Boolean).join(': ');
  if (contents) obj.set(PDFName.of('Contents'), textObj(contents));
  if (m.author) obj.set(PDFName.of('T'), textObj(m.author));
  if (m.subject || m.label) obj.set(PDFName.of('Subj'), textObj(m.subject || m.label));
  obj.set(PDFName.of('NM'), textObj(`ironsight-${extra.nm || m.id || Math.random().toString(36).slice(2)}`));
  if (extra.irt) { obj.set(PDFName.of('IRT'), extra.irt); obj.set(PDFName.of('RT'), PDFName.of('Group')); }
  if (extra.name) obj.set(PDFName.of('Name'), PDFName.of(extra.name));
  obj.set(PDFName.of('P'), page.ref);
  const ref = ctx.register(obj);
  page.node.addAnnot(ref);
  return ref;
}

function addMarkupAnnotations(doc, page, geom, shared, m, idx) {
  const newWriter = () => new OpWriter(geom, shared.writerCtx);
  const nm = m.id || `${m.page_number}-${idx}`;
  if (m.type === 'count') {
    // One annotation per mark, grouped to the first (RT /Group) so a viewer
    // moves/deletes them together; numbers become FreeText in the same group.
    const pts = (m.points || []).filter((p) => Number.isFinite(p?.pdfX));
    let parent = null;
    const r = Number(m.symbol_size) > 0 ? Number(m.symbol_size) : 7;
    pts.forEach((p, i) => {
      const w = newWriter();
      drawMarkup(w, { ...m, points: [p], show_numbers: false });
      const symbol = m.symbol || 'circle';
      const poly = symbolPolygon(symbol, p.pdfX, p.pdfY, r);
      const subtype = symbol === 'circle' ? 'Circle' : symbol === 'square' ? 'Square' : 'Polygon';
      const ref = buildAnnotation(doc, page, geom, shared, { ...m, fill_color: m.color, line_style: 'solid' }, w, {
        subtype,
        vertices: poly ? poly.map(([x, y]) => ({ pdfX: x, pdfY: y })) : undefined,
        irt: parent,
        nm: `${nm}-${i + 1}`,
        contents: `${m.label || 'Count'} #${(m.number_start ?? 1) + i}`,
      });
      if (!parent) parent = ref;
      if (m.show_numbers) {
        const fs = Number(m.font_size) > 0 ? Number(m.font_size) : 8;
        const tw = newWriter();
        const label = String((m.number_start ?? 1) + i);
        tw.text(label, p.pdfX + r + 1, p.pdfY - r - fs * 0.6, fs, m.text_color || '#0f172a');
        buildAnnotation(doc, page, geom, shared, { ...m, text: label, contents: label }, tw, { subtype: 'FreeText', irt: parent, nm: `${nm}-${i + 1}-n`, contents: label });
      }
    });
    return pts.length;
  }
  const w = newWriter();
  const withoutText = { ...m, text: null };
  if (!drawMarkup(w, m.type === 'text' ? m : withoutText)) return 0;
  const parent = buildAnnotation(doc, page, geom, shared, m, w, { nm });
  let n = 1;
  if (m.type === 'polygon') {
    (m.cutouts || []).forEach((hole, i) => {
      if (!(hole?.length >= 3)) return;
      const hw = newWriter();
      hw.save().stroke(m.color).width(Number(m.line_width) || 2).dash('dashed', Number(m.line_width) || 2).path(hole, true).push('S').restore();
      buildAnnotation(doc, page, geom, shared, { ...m, fill_color: '', line_style: 'dashed', contents: `${m.label || 'Area'} cutout` }, hw, { subtype: 'Polygon', vertices: hole, irt: parent, nm: `${nm}-cut${i + 1}`, contents: `${m.label || 'Area'} cutout` });
      n += 1;
    });
  }
  if (m.text && m.type !== 'text') {
    // Measurement label as a FreeText grouped with its markup.
    const lw = newWriter();
    const fs = Number(m.font_size) > 0 ? Number(m.font_size) : 8;
    const pts = m.points || [];
    let at;
    if (m.type === 'polygon') { const c = centroid(pts); at = { x: c.x - lw.textWidth(m.text, fs) / 2, y: c.y - fs / 2 }; } else if (m.type === 'rect' || m.type === 'ellipse') at = { x: Math.min(pts[0].pdfX, pts[1].pdfX), y: Math.min(pts[0].pdfY, pts[1].pdfY) - fs - 2 }; else {
      const mid = Math.floor((pts.length - 1) / 2); const a = pts[mid]; const b = pts[mid + 1] || a;
      at = { x: (a.pdfX + b.pdfX) / 2 + 3, y: (a.pdfY + b.pdfY) / 2 - fs - 3 };
    }
    lw.text(m.text, at.x, at.y, fs, m.text_color || m.color);
    buildAnnotation(doc, page, geom, shared, { ...m, contents: m.text }, lw, { subtype: 'FreeText', irt: parent, nm: `${nm}-label`, contents: m.text });
    n += 1;
  }
  return n;
}

// ---------------------------------------------------------------- public

/**
 * Burn markups into (or annotate) a PDF.
 * @param {ArrayBuffer|Uint8Array} pdfBytes original PDF
 * @param {{ markups?: Array, legends?: Array, mode?: 'burn'|'annotations', author?: string, title?: string }} opts
 * @returns {Promise<{ bytes: Uint8Array, drawn: number, skipped: number, pageCount: number }>}
 */
export async function exportMarkedUpPdf(pdfBytes, opts = {}) {
  const { markups = [], legends = [], mode = 'burn', author = '', title } = opts;
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false, updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  let drawn = 0;
  let skipped = 0;

  const byPage = new Map();
  const add = (pageNum, kind, item) => {
    if (!byPage.has(pageNum)) byPage.set(pageNum, { markups: [], legends: [] });
    byPage.get(pageNum)[kind].push(item);
  };
  markups.forEach((m) => add(Number(m.page_number ?? 1), 'markups', { author, ...m }));
  legends.forEach((l) => add(Number(l.page_number ?? 1), 'legends', l));

  for (const [pageNum, content] of byPage) {
    const page = pages[pageNum - 1];
    if (!page) { skipped += content.markups.length + content.legends.length; continue; }
    const geom = getPageGeometry(page);
    const ctx = doc.context;
    const stripSlash = (n) => n.asString().replace(/^\//, '');
    const gsCache = new Map();
    let fontKey;
    let gsKey;
    let shared = null;
    if (mode === 'annotations') {
      // One resources dict shared by every appearance stream on this page;
      // ExtGStates are added to it as markups need them.
      fontKey = 'Helv';
      const extG = ctx.obj({});
      const resources = ctx.register(ctx.obj({ Font: { Helv: font.ref }, ExtGState: extG }));
      gsKey = (fa, sa) => {
        const k = `${f(fa)}/${f(sa)}`;
        if (!gsCache.has(k)) {
          const name = `GS${gsCache.size + 1}`;
          extG.set(PDFName.of(name), ctx.register(ctx.obj({ Type: 'ExtGState', ca: fa, CA: sa })));
          gsCache.set(k, name);
        }
        return gsCache.get(k);
      };
      shared = { fontKey, resources, writerCtx: null };
    } else {
      fontKey = stripSlash(page.node.newFontDictionary('IrHelv', font.ref));
      gsKey = (fa, sa) => {
        const k = `${f(fa)}/${f(sa)}`;
        if (!gsCache.has(k)) gsCache.set(k, stripSlash(page.node.newExtGState('IrGS', ctx.register(ctx.obj({ Type: 'ExtGState', ca: fa, CA: sa })))));
        return gsCache.get(k);
      };
    }
    const writerCtx = { font, fontKey, gsKey };

    if (mode === 'annotations') {
      shared.writerCtx = writerCtx;
      content.markups.forEach((m, i) => {
        if (addMarkupAnnotations(doc, page, geom, shared, m, i)) drawn += 1; else skipped += 1;
      });
      content.legends.forEach((l, i) => {
        const w = new OpWriter(geom, writerCtx);
        if (!drawLegend(w, l, font)) { skipped += 1; return; }
        const rows = l.legend.rows.map((r) => [r.text.label, r.text.count, r.text.length, r.text.area, r.text.weight, r.text.tons, r.text.pages].filter(Boolean).join('\t')).join('\n');
        buildAnnotation(doc, page, geom, shared, { id: `legend-${pageNum}-${i}`, color: '#1e293b', line_width: 0.75, subject: 'Legend', author }, w, { subtype: 'Stamp', name: 'IronsightLegend', contents: `${l.legend.title || 'Legend'}\n${rows}` });
        drawn += 1;
      });
    } else {
      // Isolate the page's existing content in q/Q so any graphics state it
      // leaves behind (an unbalanced cm, a clip) can't skew our drawing, then
      // append our own content stream after it.
      page.translateContent(0, 0);
      page.resetPosition();
      const w = new OpWriter(geom, writerCtx);
      content.markups.forEach((m) => { if (drawMarkup(w, m)) drawn += 1; else skipped += 1; });
      content.legends.forEach((l) => { if (drawLegend(w, l, font)) drawn += 1; else skipped += 1; });
      const stream = doc.context.flateStream(`q\n${w.toString()}\nQ`);
      page.node.addContentStream(doc.context.register(stream));
    }
  }
  if (title) doc.setTitle(title);
  doc.setModificationDate(new Date());
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, drawn, skipped, pageCount: pages.length };
}

const sf = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })} sf`;

/**
 * Turn blueprint_takeoffs.accepted_items rows into normalized markups.
 * Handles every measurement-engine kind (takeoffGeometry.js MEASURE_TOOLS):
 *   count/bolt_count → points (+ marker_size, show_numbers)
 *   length → point1/point2; polylength/wall_area → polyline_points
 *   perimeter/area/volume → polygon_points (+ cutouts)
 *   radius/diameter → circle { cx, cy, r }; angle → angle_points
 * A matching tool-set tool (by tool_set_tool_id, else tool + label) supplies
 * subject/line style/fill/symbol defaults.
 * @param {Array} items
 * @param {{ toolSet?: object, withMeasurementText?: boolean, author?: string }} [opts]
 */
export function markupsFromAcceptedItems(items = [], opts = {}) {
  const { toolSet, withMeasurementText = true, author = '' } = opts;
  const tools = toolSet?.tools || [];
  const out = [];
  items.forEach((item, idx) => {
    if (!item || item.is_accepted === false) return;
    const kind = item.tool;
    const tool = tools.find((t) => t.id === item.tool_set_tool_id)
      || tools.find((t) => t.tool === kind && t.label.toLowerCase() === String(item.label || '').toLowerCase())
      || {};
    const base = {
      id: item.id || `item-${idx}`,
      page_number: Number(item.page_number ?? 1),
      color: item.color || tool.color || '#ef4444',
      line_width: tool.line_width || 2,
      line_style: tool.line_style || 'solid',
      label: item.label || item.shape_type || '',
      subject: item.subject || tool.subject || item.label || '',
      author,
    };
    const lenText = withMeasurementText && item.length_ft ? formatFeetInches(Number(item.length_ft)) : null;
    if (kind === 'count' || kind === 'bolt_count') {
      const pts = item.points?.length ? item.points : (item.pdfX != null && item.pdfY != null ? [{ pdfX: item.pdfX, pdfY: item.pdfY }] : []);
      if (!pts.length) return;
      out.push({
        ...base,
        type: 'count',
        points: pts,
        symbol: item.symbol || (item.color ? 'circle' : tool.symbol || 'square'),
        color: item.color || tool.color || '#1e293b',
        symbol_size: item.marker_size || tool.symbol_size || 7,
        show_numbers: item.show_numbers ?? tool.show_numbers ?? false,
      });
      return;
    }
    if (kind === 'length' || kind === 'polylength' || kind === 'wall_area') {
      const pts = item.polyline_points?.length >= 2 ? item.polyline_points : (item.point1 && item.point2 ? [item.point1, item.point2] : []);
      if (pts.length < 2) return;
      const text = kind === 'wall_area' ? (withMeasurementText && item.area_sq_ft ? sf(item.area_sq_ft) : null) : lenText;
      out.push({ ...base, type: pts.length > 2 ? 'polyline' : 'line', points: pts, text });
      return;
    }
    if (kind === 'perimeter' || kind === 'area' || kind === 'volume') {
      const pts = item.polygon_points || [];
      if (pts.length < 3) return;
      let text = null;
      if (withMeasurementText) {
        if (kind === 'perimeter') text = lenText;
        else if (kind === 'volume' && item.volume_cu_yd) text = `${Number(item.volume_cu_yd).toFixed(2)} cy`;
        else if (item.area_sq_ft) text = sf(item.area_sq_ft);
      }
      out.push({
        ...base,
        type: 'polygon',
        points: pts,
        cutouts: item.cutouts || [],
        fill_color: kind === 'perimeter' ? '' : (tool.fill_color || base.color),
        fill_opacity: tool.fill_opacity ?? 0.2,
        text,
      });
      return;
    }
    if ((kind === 'radius' || kind === 'diameter') && item.circle && Number.isFinite(item.circle.r)) {
      const { cx, cy, r } = item.circle;
      const ft = kind === 'radius' ? item.radius_ft : item.diameter_ft;
      out.push({
        ...base,
        type: 'ellipse',
        points: [{ pdfX: cx - r, pdfY: cy - r }, { pdfX: cx + r, pdfY: cy + r }],
        text: withMeasurementText && ft ? `${kind === 'radius' ? 'R' : 'D'} ${formatFeetInches(Number(ft))}` : null,
      });
      return;
    }
    if (kind === 'angle' && item.angle_points?.length === 3) {
      out.push({ ...base, type: 'polyline', points: item.angle_points, text: withMeasurementText && item.angle_deg != null ? `${Number(item.angle_deg).toFixed(1)}°` : null });
    }
  });
  return out;
}

/** Original PDF bytes for a takeoff from the IRONSIGHT IndexedDB blob store (pdfBlobStore.getPdf), or null. */
export async function loadTakeoffPdfBytes(takeoffId) {
  const url = await getPdf(takeoffId);
  if (!url) return null;
  try {
    const res = await fetch(url);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Save bytes as a file download in the browser. */
export function downloadPdfBytes(bytes, fileName = 'takeoff-markup.pdf') {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

