// Canvas drawing for IRONSIGHT's newer measuring tools, the in-progress
// draft (rubber band + live readout), the snap marker, and scale viewports.
// Kept out of BlueprintCanvas.jsx so that file stays about events/layout.
//
// Every stored point is PDF space; multiplying by `scale` (the live zoom)
// gives canvas-local pixels. Never add pan here — the canvases already sit
// inside the pan-translated wrapper.
import { MEASURE_TOOLS, circleFromDraft, liveDraftReadout, measurementShortLabel } from '@/lib/takeoffGeometry';
import { formatFeetInchesFraction } from '@/lib/fractionInches';

const DRAFT_COLOR = '#3b82f6';
const CUTOUT_COLOR = '#f97316';

const toScreen = (p, scale) => ({ x: p.pdfX * scale, y: p.pdfY * scale });

export function drawLabel(ctx, text, x, y, { bg = 'rgba(0,0,0,0.75)', fg = '#ffffff' } = {}) {
  if (!text) return;
  ctx.save();
  ctx.font = 'bold 11px sans-serif';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = bg;
  ctx.fillRect(x - w / 2 - 4, y - 9, w + 8, 18);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

function tracePath(ctx, pts, scale, close) {
  pts.forEach((p, i) => {
    const s = toScreen(p, scale);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  if (close) ctx.closePath();
}

// Outer shape with its cutouts punched out (even-odd fill).
export function drawPolygonWithCutouts(ctx, outer, cutouts, scale, { stroke, fill, dashed = false }) {
  if (!outer || outer.length < 3) return;
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, outer, scale, true);
  (cutouts || []).forEach((c) => tracePath(ctx, c, scale, true));
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill('evenodd');
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.stroke();
  ctx.restore();
}

function drawPolyline(ctx, pts, scale, color, { close = false, dashed = false, width = 2 } = {}) {
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, pts, scale, close);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.stroke();
  ctx.restore();
}

function drawVertexDots(ctx, pts, scale, color) {
  ctx.save();
  ctx.fillStyle = color;
  pts.forEach((p) => {
    const s = toScreen(p, scale);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawAngleArms(ctx, pts, scale, color) {
  drawPolyline(ctx, pts, scale, color);
  if (pts.length < 3) return;
  const v = toScreen(pts[1], scale);
  const a = toScreen(pts[0], scale);
  const c = toScreen(pts[2], scale);
  const start = Math.atan2(a.y - v.y, a.x - v.x);
  let end = Math.atan2(c.y - v.y, c.x - v.x);
  let delta = end - start;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  end = start + delta;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(v.x, v.y, 22, start, end, delta < 0);
  ctx.stroke();
  ctx.restore();
}

function drawCircle(ctx, circle, scale, color, showRadius) {
  if (!circle) return;
  const cx = circle.cx * scale;
  const cy = circle.cy * scale;
  const r = circle.r * scale;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  if (showRadius) {
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r, cy);
  } else {
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
  }
  ctx.stroke();
  ctx.restore();
}

// A saved (or pending, blue) row from one of the newer tools. The status
// circle itself is drawn by the caller at the row's anchor.
export function drawMeasureRow(ctx, item, scale, color) {
  const fmt = formatFeetInchesFraction;
  switch (item.tool) {
    case 'polylength':
    case 'wall_area':
      drawPolyline(ctx, item.polyline_points, scale, color, { width: item.tool === 'wall_area' ? 4 : 2 });
      break;
    case 'perimeter':
      drawPolyline(ctx, item.polygon_points, scale, color, { close: true });
      break;
    case 'area':
      drawPolygonWithCutouts(ctx, item.polygon_points, item.cutouts, scale, { stroke: color });
      break;
    case 'volume':
      drawPolygonWithCutouts(ctx, item.polygon_points, item.cutouts, scale, { stroke: color, fill: 'rgba(168, 85, 247, 0.12)' });
      break;
    case 'angle':
      drawAngleArms(ctx, item.angle_points || [], scale, color);
      break;
    case 'radius':
    case 'diameter':
      drawCircle(ctx, item.circle, scale, color, item.tool === 'radius');
      break;
    default:
      return;
  }
  if (item.pdfX != null && item.pdfY != null) {
    drawLabel(ctx, measurementShortLabel(item, fmt), item.pdfX * scale, item.pdfY * scale);
  }
}

// In-progress drawing: points so far, a rubber band to the cursor, any
// closed outer shape and cutouts, and the live value next to the cursor.
export function drawDraft(ctx, { tool, draft, cursor, scale, circleMode, ptsPerFt }) {
  const def = MEASURE_TOOLS[tool];
  if (!def || !draft) return;
  const { points, outer, cutouts } = draft;

  if (outer) {
    drawPolygonWithCutouts(ctx, outer, cutouts, scale, { stroke: DRAFT_COLOR, fill: 'rgba(59, 130, 246, 0.12)' });
    (cutouts || []).forEach((c) => drawPolyline(ctx, c, scale, CUTOUT_COLOR, { close: true }));
  }

  const withCursor = cursor ? [...points, cursor] : points;
  const lineColor = outer ? CUTOUT_COLOR : DRAFT_COLOR;

  if (def.input === 'circle') {
    const c = circleFromDraft(withCursor, circleMode);
    if (c) drawCircle(ctx, c, scale, DRAFT_COLOR, tool === 'radius');
    drawVertexDots(ctx, points, scale, DRAFT_COLOR);
  } else if (tool === 'angle') {
    drawAngleArms(ctx, withCursor, scale, DRAFT_COLOR);
    drawVertexDots(ctx, points, scale, DRAFT_COLOR);
  } else if (points.length > 0) {
    drawPolyline(ctx, points, scale, lineColor);
    if (cursor) {
      drawPolyline(ctx, [points[points.length - 1], cursor], scale, lineColor, { dashed: true });
      // Closing edge preview for shapes, so the estimator sees the area
      // they'd get before double-clicking.
      if (def.input === 'polygon' && points.length >= 2) drawPolyline(ctx, [cursor, points[0]], scale, lineColor, { dashed: true, width: 1 });
    }
    drawVertexDots(ctx, points, scale, lineColor);
  }

  if (cursor && points.length > 0 && !outer) {
    const text = liveDraftReadout(tool, points, cursor, ptsPerFt, formatFeetInchesFraction, circleMode);
    if (text) drawLabel(ctx, text, cursor.pdfX * scale + 40, cursor.pdfY * scale - 18, { bg: 'rgba(37, 99, 235, 0.9)' });
  }
}

// Where the click will actually land: square = line end, triangle =
// midpoint, X = on the line.
export function drawSnapMarker(ctx, snap, scale) {
  if (!snap) return;
  const x = snap.pdfX * scale;
  const y = snap.pdfY * scale;
  const s = 6;
  ctx.save();
  ctx.strokeStyle = '#d946ef';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (snap.type === 'endpoint') {
    ctx.rect(x - s, y - s, s * 2, s * 2);
  } else if (snap.type === 'midpoint') {
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y + s);
    ctx.lineTo(x - s, y + s);
    ctx.closePath();
  } else {
    ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
  }
  ctx.stroke();
  ctx.restore();
  drawLabel(ctx, snap.type === 'endpoint' ? 'end' : snap.type === 'midpoint' ? 'mid' : 'on line', x, y + 18, { bg: 'rgba(134, 25, 143, 0.85)' });
}

// Scale viewports on the current page — dashed box with its name and scale.
export function drawViewports(ctx, viewports, scale) {
  (viewports || []).forEach((v) => {
    const x = v.x1 * scale;
    const y = v.y1 * scale;
    const w = (v.x2 - v.x1) * scale;
    const h = (v.y2 - v.y1) * scale;
    ctx.save();
    ctx.strokeStyle = v.pts_per_ft > 0 ? '#0891b2' : '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
    const text = `${v.name || 'Viewport'} — ${v.pts_per_ft > 0 ? v.label : 'scale not set'}`;
    ctx.save();
    ctx.font = 'bold 10px sans-serif';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = v.pts_per_ft > 0 ? 'rgba(8, 145, 178, 0.9)' : 'rgba(245, 158, 11, 0.95)';
    ctx.fillRect(x, y - 16, tw + 8, 16);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 4, y - 8);
    ctx.restore();
  });
}

// Viewport being dragged out (first corner placed, cursor is the second).
export function drawRectPreview(ctx, a, b, scale) {
  if (!a || !b) return;
  ctx.save();
  ctx.strokeStyle = '#0891b2';
  ctx.fillStyle = 'rgba(8, 145, 178, 0.08)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 4]);
  const x = Math.min(a.pdfX, b.pdfX) * scale;
  const y = Math.min(a.pdfY, b.pdfY) * scale;
  const w = Math.abs(b.pdfX - a.pdfX) * scale;
  const h = Math.abs(b.pdfY - a.pdfY) * scale;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

// Count marker running number — small bold figure up and to the right of
// the dot, with a white halo so it reads on any line work.
export function drawCountNumber(ctx, n, x, y, radius) {
  ctx.save();
  ctx.font = `bold ${Math.max(9, Math.round(radius * 1.3))}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  const tx = x + radius * 0.8;
  const ty = y - radius * 0.6;
  ctx.strokeText(String(n), tx, ty);
  ctx.fillStyle = '#111827';
  ctx.fillText(String(n), tx, ty);
  ctx.restore();
}

// Revision change cloud (RevisionCompareDialog's saved clouds) — a scalloped
// outline around a pdf-space box, arcs bulging outward, sized to the box.
export function drawRevisionCloud(ctx, box, scale, color = '#dc2626') {
  const x0 = box.x * scale;
  const y0 = box.y * scale;
  const x1 = (box.x + box.width) * scale;
  const y1 = (box.y + box.height) * scale;
  const arc = Math.max(5, Math.min(18, Math.min(x1 - x0, y1 - y0) / 5));
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  corners.forEach(([ax, ay], i) => {
    const [bx, by] = corners[(i + 1) % 4];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / (arc * 2)));
    // Outward normal for a clockwise (screen y-down) rectangle walk.
    const nx = (by - ay) / len;
    const ny = -(bx - ax) / len;
    for (let k = 0; k < n; k += 1) {
      const sx = ax + ((bx - ax) * k) / n;
      const sy = ay + ((by - ay) * k) / n;
      const ex = ax + ((bx - ax) * (k + 1)) / n;
      const ey = ay + ((by - ay) * (k + 1)) / n;
      const r = Math.hypot(ex - sx, ey - sy) / 2;
      if (k === 0 && i === 0) ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo((sx + ex) / 2 - nx * r * 1.3, (sy + ey) / 2 - ny * r * 1.3, ex, ey);
    }
  });
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// Visual Search candidate box — green once accepted, gray once rejected,
// amber while still waiting on the estimator; score shown above it.
export function drawSearchCandidate(ctx, c, scale) {
  const colors = { accepted: '#16a34a', rejected: '#94a3b8', pending: '#f59e0b' };
  const color = colors[c.status] || colors.pending;
  const x = c.pdfX * scale;
  const y = c.pdfY * scale;
  const w = c.pdfWidth * scale;
  const h = c.pdfHeight * scale;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = c.status === 'accepted' ? 2.5 : 1.5;
  ctx.setLineDash(c.status === 'rejected' ? [3, 3] : []);
  ctx.fillStyle = c.status === 'accepted' ? 'rgba(22, 163, 74, 0.12)' : 'rgba(245, 158, 11, 0.08)';
  if (c.status !== 'rejected') ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  if (c.score != null) {
    ctx.font = 'bold 9px sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = color;
    ctx.fillText(`${Math.round(c.score * 100)}%`, x, y - 2);
  }
  ctx.restore();
}
