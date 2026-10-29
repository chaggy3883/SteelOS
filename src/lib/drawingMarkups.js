// IRONSIGHT general markups — pen, highlight, lines, shapes, clouds, text,
// callouts, sticky notes and stamps drawn on a drawing. These are NOT takeoff
// rows: they live in blueprint_takeoffs.drawing_markups, never in
// accepted_items, so nothing here can reach Push to Estimate or a tonnage
// total. They show in the Markups List as type "Markup" and go out with the
// marked-up PDF export.
//
// Every point is PDF space ({ pdfX, pdfY }, PDF points, y down — see
// ironsightView.js). Box-like markups (rect, ellipse, cloud, text box,
// callout box, stamp) store two corners in `points`: [top-left, bottom-right].
//
// Pure functions only — no React, no DOM.

export const MARKUP_TYPES = {
  pen: { label: 'Pen', shape: 'stroke' },
  highlight: { label: 'Highlight', shape: 'stroke' },
  line: { label: 'Line', shape: 'line' },
  arrow: { label: 'Arrow', shape: 'line' },
  polyline: { label: 'Polyline', shape: 'poly' },
  polygon: { label: 'Polygon', shape: 'poly', closed: true },
  rect: { label: 'Rectangle', shape: 'box' },
  ellipse: { label: 'Ellipse', shape: 'box' },
  cloud: { label: 'Cloud', shape: 'box' },
  textbox: { label: 'Text Box', shape: 'box', text: true },
  typewriter: { label: 'Typewriter', shape: 'point', text: true },
  callout: { label: 'Callout', shape: 'box', text: true, leader: true },
  note: { label: 'Note', shape: 'point' },
  stamp: { label: 'Stamp', shape: 'box' },
};

export const MARKUP_TYPE_IDS = Object.keys(MARKUP_TYPES);
export const isTextMarkup = (m) => Boolean(MARKUP_TYPES[m?.type]?.text);
export const markupTypeLabel = (type) => MARKUP_TYPES[type]?.label || 'Markup';

// Our own stamp set — plain shop wording, drawn as a framed IRONSIGHT block.
export const STAMPS = [
  { id: 'approved', label: 'APPROVED', color: '#15803d' },
  { id: 'reviewed', label: 'REVIEWED', color: '#1d4ed8' },
  { id: 'for_takeoff', label: 'FOR TAKEOFF', color: '#7c3aed' },
  { id: 'not_in_scope', label: 'NOT IN SCOPE', color: '#b91c1c' },
  { id: 'revised', label: 'REVISED', color: '#c2410c' },
  { id: 'hold', label: 'HOLD', color: '#b45309' },
];
export const findStamp = (id) => STAMPS.find((s) => s.id === id) || STAMPS[0];

export const FONT_FAMILIES = [
  { id: 'Helvetica', label: 'Sans (Helvetica/Arial)', css: 'Helvetica, Arial, sans-serif' },
  { id: 'Times', label: 'Serif (Times)', css: '"Times New Roman", Times, serif' },
  { id: 'Courier', label: 'Mono (Courier)', css: '"Courier New", Courier, monospace' },
];
export const fontCss = (family) => (FONT_FAMILIES.find((f) => f.id === family) || FONT_FAMILIES[0]).css;

export const BASE_STYLE = {
  color: '#dc2626',
  fill_color: '',
  opacity: 1,
  fill_opacity: 0.25,
  line_width: 2,
  line_style: 'solid',
  font_family: 'Helvetica',
  font_size: 12,
  bold: false,
  italic: false,
  underline: false,
  align: 'left',
  text_color: '#111827',
  border: true,
};

// Starting style per tool (the properties strip changes it; the last used
// style per tool is remembered by the workspace).
export const DEFAULT_STYLES = {
  pen: { color: '#dc2626', line_width: 2 },
  highlight: { color: '#facc15', line_width: 12, opacity: 0.4 },
  line: { color: '#dc2626', line_width: 2 },
  arrow: { color: '#dc2626', line_width: 2 },
  polyline: { color: '#dc2626', line_width: 2 },
  polygon: { color: '#dc2626', line_width: 2, fill_color: '#fecaca', fill_opacity: 0.3 },
  rect: { color: '#dc2626', line_width: 2 },
  ellipse: { color: '#dc2626', line_width: 2 },
  cloud: { color: '#dc2626', line_width: 2 },
  textbox: { color: '#dc2626', line_width: 1, text_color: '#111827', fill_color: '#ffffff', fill_opacity: 0.9, border: true },
  typewriter: { color: '#111827', line_width: 0, text_color: '#111827', border: false },
  callout: { color: '#dc2626', line_width: 1, text_color: '#111827', fill_color: '#ffffff', fill_opacity: 0.9, border: true },
  note: { color: '#f59e0b' },
  stamp: { color: '#15803d', line_width: 2 },
};

export const styleFor = (type, overrides = {}) => ({ ...BASE_STYLE, ...(DEFAULT_STYLES[type] || {}), ...overrides });

export const TEXT_PAD = 4; // PDF points of padding inside a text box
export const LINE_HEIGHT = 1.2;
export const NOTE_SIZE = 16; // PDF points, sticky note icon
export const DEFAULT_STAMP_SIZE = { width: 150, height: 44 };
export const DEFAULT_TEXTBOX_SIZE = { width: 140, height: 40 };

const isPt = (p) => p && Number.isFinite(Number(p.pdfX)) && Number.isFinite(Number(p.pdfY));

export function createMarkup(type, { page_number = 1, points = [], style = {}, text = '', leader = null, stamp = null, author = '', subject = '' } = {}) {
  const now = new Date().toISOString();
  return {
    id: (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    type,
    page_number,
    points: points.map((p) => ({ pdfX: Number(p.pdfX), pdfY: Number(p.pdfY) })),
    leader: leader ? { pdfX: leader.pdfX, pdfY: leader.pdfY } : null,
    text: text || '',
    comment: '',
    stamp: type === 'stamp' ? (stamp || 'approved') : null,
    style: styleFor(type, style),
    subject: subject || markupTypeLabel(type),
    author,
    locked: false,
    created_at: now,
    updated_at: now,
  };
}

/** Two corners → normalized top-left / bottom-right pair. */
export function normalizeBox(a, b) {
  return [
    { pdfX: Math.min(a.pdfX, b.pdfX), pdfY: Math.min(a.pdfY, b.pdfY) },
    { pdfX: Math.max(a.pdfX, b.pdfX), pdfY: Math.max(a.pdfY, b.pdfY) },
  ];
}

export const boxOf = (m) => {
  const [a, b] = m.points || [];
  if (!isPt(a)) return null;
  if (!isPt(b)) return { x: a.pdfX, y: a.pdfY, width: 0, height: 0 };
  return { x: Math.min(a.pdfX, b.pdfX), y: Math.min(a.pdfY, b.pdfY), width: Math.abs(b.pdfX - a.pdfX), height: Math.abs(b.pdfY - a.pdfY) };
};

// ------------------------------------------------------------- text layout

/**
 * Word-wrap `text` to `maxWidth` using `measure(str) → width` (same units).
 * Explicit newlines always break; a single word longer than the line is
 * broken by character. maxWidth <= 0 means no wrapping (typewriter).
 */
export function wrapTextLines(text, maxWidth, measure) {
  const out = [];
  String(text ?? '').split(/\r?\n/).forEach((para) => {
    if (!(maxWidth > 0)) { out.push(para); return; }
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let line = '';
    const pushWord = (word) => {
      // Break an over-long word across lines.
      let rest = word;
      while (measure(rest) > maxWidth && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n)) > maxWidth) n -= 1;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    };
    words.forEach((w) => {
      const candidate = line + w;
      if (!line || measure(candidate) <= maxWidth) {
        if (!line && /^\s+$/.test(w)) return; // no leading spaces on a wrapped line
        if (!line && measure(w) > maxWidth) { pushWord(w); return; }
        line = candidate;
      } else if (/^\s+$/.test(w)) {
        out.push(line);
        line = '';
      } else {
        out.push(line.replace(/\s+$/, ''));
        line = '';
        if (measure(w) > maxWidth) pushWord(w); else line = w;
      }
    });
    out.push(line.replace(/\s+$/, ''));
  });
  return out;
}

/**
 * Lines + size of a text markup in PDF points. `measure(str, style)` returns
 * the width of str at style.font_size (points). Text box / callout wrap to
 * their box; typewriter never wraps and sizes to its longest line.
 */
export function layoutTextMarkup(m, measure) {
  const style = m.style || BASE_STYLE;
  const fs = Number(style.font_size) > 0 ? Number(style.font_size) : 12;
  const lineHeight = fs * LINE_HEIGHT;
  const box = boxOf(m) || { x: 0, y: 0, width: 0, height: 0 };
  const m1 = (s) => measure(s, style);
  if (m.type === 'typewriter') {
    const lines = String(m.text || '').split(/\r?\n/);
    const width = Math.max(fs, ...lines.map((l) => m1(l))) + TEXT_PAD * 2;
    return { lines, lineHeight, fontSize: fs, pad: TEXT_PAD, x: box.x, y: box.y, width, height: lines.length * lineHeight + TEXT_PAD * 2 };
  }
  const inner = Math.max(fs, box.width - TEXT_PAD * 2);
  const lines = wrapTextLines(m.text || '', inner, m1);
  const needed = lines.length * lineHeight + TEXT_PAD * 2;
  return { lines, lineHeight, fontSize: fs, pad: TEXT_PAD, x: box.x, y: box.y, width: box.width, height: Math.max(box.height, needed), neededHeight: needed };
}

/** Text box/callout grown (never shrunk) to fit its text — applied when editing ends. */
export function fitTextBoxHeight(m, measure) {
  if (m.type !== 'textbox' && m.type !== 'callout') return m;
  const lay = layoutTextMarkup(m, measure);
  const box = boxOf(m);
  if (!box || lay.neededHeight <= box.height + 0.5) return m;
  return { ...m, points: [{ pdfX: box.x, pdfY: box.y }, { pdfX: box.x + box.width, pdfY: box.y + lay.neededHeight }] };
}

/** Where a callout's leader leaves its box: the middle of the box side nearest the tip. */
export function calloutKnee(box, tip) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = tip.pdfX - cx;
  const dy = tip.pdfY - cy;
  if (Math.abs(dx) * box.height >= Math.abs(dy) * box.width) {
    return { pdfX: dx >= 0 ? box.x + box.width : box.x, pdfY: cy };
  }
  return { pdfX: cx, pdfY: dy >= 0 ? box.y + box.height : box.y };
}

// --------------------------------------------------------------- geometry

export function distToSegment(p, a, b) {
  const vx = b.pdfX - a.pdfX;
  const vy = b.pdfY - a.pdfY;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.pdfX - a.pdfX) * vx + (p.pdfY - a.pdfY) * vy) / len2)) : 0;
  return Math.hypot(p.pdfX - (a.pdfX + t * vx), p.pdfY - (a.pdfY + t * vy));
}

const distToPolyline = (p, pts, closed) => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i += 1) best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]));
  if (closed && pts.length > 2) best = Math.min(best, distToSegment(p, pts[pts.length - 1], pts[0]));
  return best;
};

const inPolygon = (pt, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]; const b = poly[j];
    if ((a.pdfY > pt.pdfY) !== (b.pdfY > pt.pdfY)
      && pt.pdfX < ((b.pdfX - a.pdfX) * (pt.pdfY - a.pdfY)) / (b.pdfY - a.pdfY) + a.pdfX) inside = !inside;
  }
  return inside;
};

/**
 * PDF-space bounds { x, y, width, height } of a markup. Typewriter text and
 * notes need `measure` / fixed sizes since they're stored as a single point.
 */
export function markupBounds(m, measure) {
  const pts = (m.points || []).filter(isPt);
  if (!pts.length) return null;
  if (m.type === 'note') return { x: pts[0].pdfX, y: pts[0].pdfY, width: NOTE_SIZE, height: NOTE_SIZE };
  if (m.type === 'typewriter') {
    const lay = measure ? layoutTextMarkup(m, measure) : null;
    return { x: pts[0].pdfX, y: pts[0].pdfY, width: lay?.width || 60, height: lay?.height || 16 };
  }
  let all = pts;
  if ((m.type === 'textbox' || m.type === 'callout') && measure) {
    const lay = layoutTextMarkup(m, measure);
    const box = boxOf(m);
    all = [{ pdfX: box.x, pdfY: box.y }, { pdfX: box.x + box.width, pdfY: box.y + lay.height }];
  }
  if (m.type === 'callout' && isPt(m.leader)) all = [...all, m.leader];
  const xs = all.map((p) => p.pdfX);
  const ys = all.map((p) => p.pdfY);
  const pad = MARKUP_TYPES[m.type]?.shape === 'stroke' || MARKUP_TYPES[m.type]?.shape === 'line' || MARKUP_TYPES[m.type]?.shape === 'poly'
    ? (Number(m.style?.line_width) || 0) / 2 : 0;
  const x0 = Math.min(...xs) - pad; const y0 = Math.min(...ys) - pad;
  return { x: x0, y: y0, width: Math.max(...xs) + pad - x0, height: Math.max(...ys) + pad - y0 };
}

/** Is PDF point `pt` on markup `m`? `tol` is in PDF points (screen tolerance / zoom). */
export function hitTestMarkup(m, pt, tol, measure) {
  const pts = (m.points || []).filter(isPt);
  if (!pts.length) return false;
  const lw = (Number(m.style?.line_width) || 0) / 2;
  const shape = MARKUP_TYPES[m.type]?.shape;
  if (shape === 'stroke' || shape === 'line') return distToPolyline(pt, pts, false) <= tol + lw;
  if (m.type === 'polyline') return distToPolyline(pt, pts, false) <= tol + lw;
  if (m.type === 'polygon') return (m.style?.fill_color && inPolygon(pt, pts)) || distToPolyline(pt, pts, true) <= tol + lw;
  const b = markupBounds(m, measure);
  if (!b) return false;
  const inBox = pt.pdfX >= b.x - tol && pt.pdfX <= b.x + b.width + tol && pt.pdfY >= b.y - tol && pt.pdfY <= b.y + b.height + tol;
  if (m.type === 'note' || m.type === 'typewriter' || m.type === 'stamp') return inBox;
  if (m.type === 'textbox' || m.type === 'callout') {
    const box = boxOf(m);
    const lay = measure ? layoutTextMarkup(m, measure) : null;
    const h = lay?.height || box.height;
    const inText = pt.pdfX >= box.x - tol && pt.pdfX <= box.x + box.width + tol && pt.pdfY >= box.y - tol && pt.pdfY <= box.y + h + tol;
    if (inText) return true;
    if (m.type === 'callout' && isPt(m.leader)) return distToSegment(pt, calloutKnee({ ...box, height: h }, m.leader), m.leader) <= tol + lw;
    return false;
  }
  // rect / ellipse / cloud: filled → inside counts; otherwise the outline.
  if (m.style?.fill_color && inBox) return true;
  const box = boxOf(m);
  if (m.type === 'ellipse') {
    const rx = box.width / 2; const ry = box.height / 2;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (pt.pdfX - (box.x + rx)) / rx; const ny = (pt.pdfY - (box.y + ry)) / ry;
    const r = Math.hypot(nx, ny);
    return Math.abs(r - 1) * Math.min(rx, ry) <= tol + lw + (m.type === 'cloud' ? 6 : 0);
  }
  const corners = [{ pdfX: box.x, pdfY: box.y }, { pdfX: box.x + box.width, pdfY: box.y }, { pdfX: box.x + box.width, pdfY: box.y + box.height }, { pdfX: box.x, pdfY: box.y + box.height }];
  return distToPolyline(pt, corners, true) <= tol + lw + (m.type === 'cloud' ? 6 : 0);
}

const movePt = (p, dx, dy) => ({ pdfX: p.pdfX + dx, pdfY: p.pdfY + dy });

export function translateMarkup(m, dx, dy) {
  return {
    ...m,
    points: (m.points || []).map((p) => movePt(p, dx, dy)),
    leader: isPt(m.leader) ? movePt(m.leader, dx, dy) : m.leader,
    updated_at: new Date().toISOString(),
  };
}

/** Grab handles for a single selected markup: [{ id, pdfX, pdfY }]. */
export function markupHandles(m, measure) {
  const shape = MARKUP_TYPES[m.type]?.shape;
  if (m.locked) return [];
  if (shape === 'line' || shape === 'poly') return (m.points || []).map((p, i) => ({ id: `v${i}`, pdfX: p.pdfX, pdfY: p.pdfY }));
  if (shape !== 'box') return [];
  const box = boxOf(m);
  if (!box) return [];
  let h = box.height;
  if (isTextMarkup(m) && measure) h = layoutTextMarkup(m, measure).height;
  const { x, y, width: w } = box;
  const out = [
    { id: 'nw', pdfX: x, pdfY: y }, { id: 'n', pdfX: x + w / 2, pdfY: y }, { id: 'ne', pdfX: x + w, pdfY: y },
    { id: 'e', pdfX: x + w, pdfY: y + h / 2 }, { id: 'se', pdfX: x + w, pdfY: y + h }, { id: 's', pdfX: x + w / 2, pdfY: y + h },
    { id: 'sw', pdfX: x, pdfY: y + h }, { id: 'w', pdfX: x, pdfY: y + h / 2 },
  ];
  if (m.type === 'callout' && isPt(m.leader)) out.push({ id: 'leader', pdfX: m.leader.pdfX, pdfY: m.leader.pdfY });
  return out;
}

/** Markup with handle `handleId` dragged to PDF point `pt`. */
export function applyHandleDrag(m, handleId, pt) {
  const now = new Date().toISOString();
  if (handleId === 'leader') return { ...m, leader: { pdfX: pt.pdfX, pdfY: pt.pdfY }, updated_at: now };
  if (handleId.startsWith('v')) {
    const i = Number(handleId.slice(1));
    return { ...m, points: m.points.map((p, j) => (j === i ? { pdfX: pt.pdfX, pdfY: pt.pdfY } : p)), updated_at: now };
  }
  const box = boxOf(m);
  if (!box) return m;
  let x0 = box.x; let y0 = box.y; let x1 = box.x + box.width; let y1 = box.y + box.height;
  if (handleId.includes('w')) x0 = pt.pdfX;
  if (handleId.includes('e')) x1 = pt.pdfX;
  if (handleId.includes('n')) y0 = pt.pdfY;
  if (handleId.includes('s')) y1 = pt.pdfY;
  const [a, b] = normalizeBox({ pdfX: x0, pdfY: y0 }, { pdfX: x1, pdfY: y1 });
  // Never collapse a box to nothing.
  if (b.pdfX - a.pdfX < 4) b.pdfX = a.pdfX + 4;
  if (b.pdfY - a.pdfY < 4) b.pdfY = a.pdfY + 4;
  return { ...m, points: [a, b], updated_at: now };
}

export const boxesIntersect = (a, b) => a && b && a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

// ------------------------------------------------------------- page lists

/** "1-3, 5" → [1, 2, 3, 5] within 1..max; null when the text isn't a page list. */
export function parsePageList(text, max) {
  const out = new Set();
  const parts = String(text || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let p = Math.min(a, b); p <= Math.max(a, b); p += 1) if (p >= 1 && p <= max) out.add(p);
  }
  return [...out].sort((x, y) => x - y);
}

// ------------------------------------------------------------- list rows

/** Short "what it is" text for the Markups List. */
export function markupSummary(m) {
  if (isTextMarkup(m)) return String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '(empty)';
  if (m.type === 'note') return String(m.comment || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '(no comment)';
  if (m.type === 'stamp') return findStamp(m.stamp).label;
  return m.comment ? String(m.comment).slice(0, 80) : '';
}
