// Canvas drawing for IRONSIGHT general markups (drawingMarkups.js): pen,
// highlight, lines, arrows, shapes, clouds, text boxes, typewriter text,
// callouts, notes and stamps — plus selection boxes, grab handles, the grid
// and text-search hits.
//
// Same convention as measureOverlayDraw.js: stored points are PDF space and
// are drawn at pdfX * scale. The canvas context already carries the view
// rotation and pan (BlueprintCanvas sets it once per frame), so nothing here
// adds pan. Sizes stored in PDF points (line width, font size) scale with
// the zoom, the way they do on paper.
import {
  MARKUP_TYPES, layoutTextMarkup, calloutKnee, boxOf, fontCss, findStamp, NOTE_SIZE, markupHandles,
} from '@/lib/drawingMarkups';

const SELECT_COLOR = '#2563eb';

// Text measuring in PDF points (font size in px == points at zoom 1) — one
// shared offscreen context, so the wrap is the same at every zoom.
let measureCtx = null;
export function measureText(str, style = {}) {
  if (!measureCtx) {
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    measureCtx = c ? c.getContext('2d') : null;
  }
  const fs = Number(style.font_size) > 0 ? Number(style.font_size) : 12;
  if (!measureCtx) return String(str || '').length * fs * 0.55;
  measureCtx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${fs}px ${fontCss(style.font_family)}`;
  return measureCtx.measureText(String(str || '')).width;
}

const P = (p, s) => ({ x: p.pdfX * s, y: p.pdfY * s });

function applyStroke(ctx, style, scale) {
  const w = Math.max(0.75, (Number(style.line_width) || 0) * scale);
  ctx.lineWidth = w;
  ctx.strokeStyle = style.color || '#dc2626';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (style.line_style === 'dashed') ctx.setLineDash([w * 4, w * 2.5]);
  else if (style.line_style === 'dotted') ctx.setLineDash([0.01, w * 2.5]);
  else ctx.setLineDash([]);
  return w;
}

function tracePts(ctx, pts, scale, close = false) {
  ctx.beginPath();
  pts.forEach((p, i) => { const q = P(p, scale); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
  if (close) ctx.closePath();
}

function arrowHead(ctx, from, tip, size, color) {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (!(len > 0)) return;
  const ux = (tip.x - from.x) / len; const uy = (tip.y - from.y) / len;
  const bx = tip.x - ux * size; const by = tip.y - uy * size;
  const half = size * 0.45;
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(bx - uy * half, by + ux * half);
  ctx.lineTo(bx + uy * half, by - ux * half);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Scalloped outline around a box; `arc` is the bump size in PDF points.
function traceCloud(ctx, box, scale, arc = 10) {
  const x0 = box.x * scale; const y0 = box.y * scale;
  const x1 = (box.x + box.width) * scale; const y1 = (box.y + box.height) * scale;
  const a = Math.max(3, arc * scale);
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  ctx.beginPath();
  corners.forEach(([ax, ay], i) => {
    const [bx, by] = corners[(i + 1) % 4];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / a));
    const nx = len ? (by - ay) / len : 0;
    const ny = len ? -(bx - ax) / len : 0;
    for (let k = 0; k < n; k += 1) {
      const sx = ax + ((bx - ax) * k) / n; const sy = ay + ((by - ay) * k) / n;
      const ex = ax + ((bx - ax) * (k + 1)) / n; const ey = ay + ((by - ay) * (k + 1)) / n;
      const r = Math.hypot(ex - sx, ey - sy) / 2;
      if (k === 0 && i === 0) ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo((sx + ex) / 2 - nx * r * 1.3, (sy + ey) / 2 - ny * r * 1.3, ex, ey);
    }
  });
  ctx.closePath();
}

function fillAndStroke(ctx, style, scale) {
  if (style.fill_color) {
    ctx.save();
    ctx.globalAlpha = (style.opacity ?? 1) * (style.fill_opacity ?? 0.25);
    ctx.fillStyle = style.fill_color;
    ctx.fill();
    ctx.restore();
  }
  if ((Number(style.line_width) || 0) > 0) {
    applyStroke(ctx, style, scale);
    ctx.stroke();
  }
}

function drawTextBlock(ctx, m, scale) {
  const st = m.style || {};
  const lay = layoutTextMarkup(m, measureText);
  const x = lay.x * scale; const y = lay.y * scale;
  const w = lay.width * scale; const h = lay.height * scale;
  if (m.type !== 'typewriter') {
    if (m.type === 'callout' && m.leader) {
      const knee = calloutKnee({ x: lay.x, y: lay.y, width: lay.width, height: lay.height }, m.leader);
      const k = P(knee, scale); const t = P(m.leader, scale);
      ctx.save();
      const lw = applyStroke(ctx, { ...st, line_style: 'solid', line_width: Math.max(0.75, Number(st.line_width) || 1) }, scale);
      ctx.beginPath(); ctx.moveTo(k.x, k.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      arrowHead(ctx, k, t, Math.max(6, lw * 4), st.color || '#dc2626');
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    if (st.fill_color) {
      ctx.globalAlpha = (st.opacity ?? 1) * (st.fill_opacity ?? 1);
      ctx.fillStyle = st.fill_color;
      ctx.fill();
      ctx.globalAlpha = st.opacity ?? 1;
    }
    if (st.border !== false && (Number(st.line_width) || 0) > 0) { applyStroke(ctx, st, scale); ctx.stroke(); }
    ctx.restore();
  }
  const fsPx = lay.fontSize * scale;
  if (fsPx < 1.5) return; // too small to read — skip the glyph work
  ctx.save();
  ctx.font = `${st.italic ? 'italic ' : ''}${st.bold ? 'bold ' : ''}${fsPx}px ${fontCss(st.font_family)}`;
  ctx.fillStyle = st.text_color || '#111827';
  ctx.textBaseline = 'top';
  lay.lines.forEach((line, i) => {
    if (!line) return;
    const tw = measureText(line, st) * scale;
    const pad = lay.pad * scale;
    const tx = st.align === 'center' ? x + (w - tw) / 2 : st.align === 'right' ? x + w - pad - tw : x + pad;
    const ty = y + pad + i * lay.lineHeight * scale + ((lay.lineHeight - lay.fontSize) * scale) / 2;
    ctx.fillText(line, tx, ty);
    if (st.underline) {
      ctx.fillRect(tx, ty + fsPx * 0.95, tw, Math.max(0.5, fsPx / 16));
    }
  });
  ctx.restore();
}

function drawNote(ctx, m, scale) {
  const p = m.points[0];
  const s = NOTE_SIZE * scale; const x = p.pdfX * scale; const y = p.pdfY * scale; const fold = s * 0.3;
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = m.style?.color || '#f59e0b';
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = Math.max(0.75, 0.75 * scale);
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + s - fold, y); ctx.lineTo(x + s, y + fold); ctx.lineTo(x + s, y + s); ctx.lineTo(x, y + s); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.lineWidth = Math.max(0.5, 0.6 * scale);
  [0.42, 0.6, 0.78].forEach((t) => { ctx.beginPath(); ctx.moveTo(x + s * 0.18, y + s * t); ctx.lineTo(x + s * 0.82, y + s * t); ctx.stroke(); });
  ctx.restore();
}

function drawStampBlock(ctx, m, scale) {
  const box = boxOf(m);
  if (!box) return;
  const def = findStamp(m.stamp);
  const color = m.style?.color || def.color;
  const x = box.x * scale; const y = box.y * scale; const w = box.width * scale; const h = box.height * scale;
  const lw = Math.max(1, (Number(m.style?.line_width) || 2)) * scale;
  ctx.save();
  ctx.globalAlpha = m.style?.opacity ?? 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(x, y, w, h);
  const inset = lw * 2;
  ctx.lineWidth = Math.max(0.5, lw / 2);
  ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  let fs = Math.max(4, h * 0.42);
  ctx.font = `bold ${fs}px Helvetica, Arial, sans-serif`;
  const maxW = w - inset * 4;
  let tw = ctx.measureText(def.label).width;
  if (tw > maxW && tw > 0) { fs *= maxW / tw; ctx.font = `bold ${fs}px Helvetica, Arial, sans-serif`; tw = ctx.measureText(def.label).width; }
  ctx.textBaseline = 'top';
  ctx.fillText(def.label, x + (w - tw) / 2, y + h * 0.14);
  const when = m.created_at ? new Date(m.created_at).toLocaleDateString('en-US') : '';
  const sub = ['IRONSIGHT', when, m.author].filter(Boolean).join(' | ');
  const ss = Math.max(3, Math.min(h * 0.18, fs * 0.45));
  ctx.font = `${ss}px Helvetica, Arial, sans-serif`;
  const sw = Math.min(ctx.measureText(sub).width, maxW);
  ctx.fillText(sub, x + (w - sw) / 2, y + h - inset - ss * 1.4, maxW);
  ctx.restore();
}

/** Draw one general markup. `offset` ({ dx, dy } PDF points) previews a move. */
export function drawDrawingMarkup(ctx, markup, scale, { offset = null, hideText = false } = {}) {
  const m = offset ? { ...markup, points: markup.points.map((p) => ({ pdfX: p.pdfX + offset.dx, pdfY: p.pdfY + offset.dy })), leader: markup.leader ? { pdfX: markup.leader.pdfX + offset.dx, pdfY: markup.leader.pdfY + offset.dy } : null } : markup;
  const st = m.style || {};
  const pts = m.points || [];
  if (!pts.length) return;
  ctx.save();
  ctx.globalAlpha = st.opacity ?? 1;
  switch (m.type) {
    case 'pen':
    case 'highlight':
    case 'polyline':
    case 'line':
    case 'arrow': {
      if (pts.length < 2) break;
      if (m.type === 'highlight') ctx.globalCompositeOperation = 'multiply';
      const w = applyStroke(ctx, st, scale);
      tracePts(ctx, pts, scale, false);
      ctx.stroke();
      if (m.type === 'arrow') arrowHead(ctx, P(pts[pts.length - 2], scale), P(pts[pts.length - 1], scale), Math.max(6, w * 4), st.color);
      break;
    }
    case 'polygon':
      if (pts.length < 2) break;
      tracePts(ctx, pts, scale, pts.length > 2);
      fillAndStroke(ctx, st, scale);
      break;
    case 'rect':
    case 'ellipse':
    case 'cloud': {
      const box = boxOf(m);
      if (!box) break;
      if (m.type === 'cloud') traceCloud(ctx, box, scale);
      else if (m.type === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse((box.x + box.width / 2) * scale, (box.y + box.height / 2) * scale, (box.width / 2) * scale, (box.height / 2) * scale, 0, 0, Math.PI * 2);
      } else {
        ctx.beginPath();
        ctx.rect(box.x * scale, box.y * scale, box.width * scale, box.height * scale);
      }
      fillAndStroke(ctx, { ...st, line_style: m.type === 'cloud' ? 'solid' : st.line_style }, scale);
      break;
    }
    case 'textbox':
    case 'typewriter':
    case 'callout':
      if (hideText) {
        // Being edited in place — the text editor draws the words.
        if (m.type === 'callout' && m.leader) drawTextBlock(ctx, { ...m, text: '' }, scale);
      } else drawTextBlock(ctx, m, scale);
      break;
    case 'note':
      drawNote(ctx, m, scale);
      break;
    case 'stamp':
      drawStampBlock(ctx, m, scale);
      break;
    default:
  }
  ctx.restore();
}

/** Dashed box around a selected item's PDF-space bounds, plus its grab handles. */
export function drawSelectionBox(ctx, bounds, scale, { handles = [], locked = false } = {}) {
  if (!bounds) return;
  const pad = 4;
  ctx.save();
  ctx.strokeStyle = locked ? '#64748b' : SELECT_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(bounds.x * scale - pad, bounds.y * scale - pad, bounds.width * scale + pad * 2, bounds.height * scale + pad * 2);
  ctx.setLineDash([]);
  handles.forEach((h) => {
    const x = h.pdfX * scale; const y = h.pdfY * scale;
    ctx.fillStyle = h.id === 'leader' ? '#f59e0b' : '#ffffff';
    ctx.strokeStyle = SELECT_COLOR;
    ctx.fillRect(x - 4, y - 4, 8, 8);
    ctx.strokeRect(x - 4, y - 4, 8, 8);
  });
  ctx.restore();
}

export const handlesFor = (m) => markupHandles(m, measureText);

/** In-progress markup while it's being drawn (the cursor canvas). */
export function drawMarkupDraft(ctx, draft, scale) {
  if (!draft?.type) return;
  const { type, points = [], cursor } = draft;
  const shape = MARKUP_TYPES[type]?.shape;
  const style = draft.style || {};
  let pts = points;
  if ((shape === 'poly' || shape === 'line') && cursor && points.length) pts = [...points, cursor];
  if (shape === 'box' && points.length === 1 && cursor) pts = [points[0], cursor];
  if (!pts.length) return;
  if (shape === 'box' || type === 'stamp') {
    const a = pts[0]; const b = pts[1] || pts[0];
    const box = { x: Math.min(a.pdfX, b.pdfX), y: Math.min(a.pdfY, b.pdfY), width: Math.abs(b.pdfX - a.pdfX), height: Math.abs(b.pdfY - a.pdfY) };
    ctx.save();
    ctx.strokeStyle = style.color || SELECT_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    if (type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse((box.x + box.width / 2) * scale, (box.y + box.height / 2) * scale, (box.width / 2) * scale, (box.height / 2) * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else ctx.strokeRect(box.x * scale, box.y * scale, box.width * scale, box.height * scale);
    if (type === 'callout' && draft.leader) {
      const t = P(draft.leader, scale);
      ctx.beginPath(); ctx.moveTo(box.x * scale, box.y * scale); ctx.lineTo(t.x, t.y); ctx.stroke();
    }
    ctx.restore();
    return;
  }
  drawDrawingMarkup(ctx, { type, points: pts, style }, scale);
}

/** Light paper grid every `step` PDF points (½" = 36 pt by default). */
export function drawGrid(ctx, pageW, pageH, scale, step = 36) {
  let s = step;
  while (s * scale < 8) s *= 2; // never denser than 8 px
  ctx.save();
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.16)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let x = 0; x <= pageW; x += s) { ctx.moveTo(x * scale, 0); ctx.lineTo(x * scale, pageH * scale); }
  for (let y = 0; y <= pageH; y += s) { ctx.moveTo(0, y * scale); ctx.lineTo(pageW * scale, y * scale); }
  ctx.stroke();
  ctx.restore();
}

/** Text-search hits on this page; the active one gets a stronger outline. */
export function drawSearchHits(ctx, hits, activeId, scale) {
  if (!hits?.length) return;
  ctx.save();
  hits.forEach((h) => {
    const active = h.id === activeId;
    ctx.fillStyle = active ? 'rgba(249, 115, 22, 0.35)' : 'rgba(250, 204, 21, 0.35)';
    ctx.fillRect(h.x * scale, h.y * scale, h.width * scale, h.height * scale);
    if (active) {
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 2;
      ctx.strokeRect(h.x * scale - 1, h.y * scale - 1, h.width * scale + 2, h.height * scale + 2);
    }
  });
  ctx.restore();
}

/** Rubber-band box for select / zoom tools. */
export function drawMarquee(ctx, a, b, scale, color = SELECT_COLOR) {
  if (!a || !b) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  const x = Math.min(a.pdfX, b.pdfX) * scale; const y = Math.min(a.pdfY, b.pdfY) * scale;
  const w = Math.abs(b.pdfX - a.pdfX) * scale; const h = Math.abs(b.pdfY - a.pdfY) * scale;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}
