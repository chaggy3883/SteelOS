// IRONSIGHT measuring math — every tool's geometry and quantity, in one pure
// module so it can be checked by hand against a concrete example.
//
// All points are PDF-space { pdfX, pdfY } (zoom 1, PDF points). Distances
// come out in PDF points; dividing by the drawing scale's pts_per_ft (see
// takeoffScale.js) turns them into real feet, and areas divide by
// pts_per_ft squared. Screen pixels never enter into any of this.

// What each measuring tool is, how its clicks are collected, and what kind
// of quantity it produces. `kind` is what the Markups List and Push to
// Estimate key off: length -> length_ft (AISC weight per ft applies),
// area -> sq ft (optional lbs per sq ft), volume/angle -> carried as a
// plain quantity with a unit, never weighed.
//   input: 'two'     two clicks, done
//          'poly'    open run, finish with double-click or Enter
//          'polygon' closed shape, finish with double-click or Enter
//          'three'   three clicks, done (angle)
//          'circle'  center + edge (2 clicks) or 3 points on the edge
export const MEASURE_TOOLS = {
  length: { label: 'Length', kind: 'length', input: 'two', slope: true, hint: 'Click both ends of the run' },
  polylength: { label: 'Polylength', kind: 'length', input: 'poly', minPoints: 2, slope: true, hint: 'Click each point along the run' },
  perimeter: { label: 'Perimeter', kind: 'length', input: 'polygon', minPoints: 3, slope: true, hint: 'Click each corner — measures all the way around' },
  area: { label: 'Area', kind: 'area', input: 'polygon', minPoints: 3, slope: true, cutouts: true, hint: 'Click each corner of the area' },
  volume: { label: 'Volume', kind: 'volume', input: 'polygon', minPoints: 3, cutouts: true, needsDepth: true, hint: 'Click each corner of the footprint — depth comes next' },
  wall_area: { label: 'Wall Area', kind: 'area', input: 'poly', minPoints: 2, needsHeight: true, hint: 'Click along the wall run — height comes next' },
  angle: { label: 'Angle', kind: 'angle', input: 'three', hint: 'Click one end, then the corner, then the other end' },
  radius: { label: 'Radius', kind: 'length', input: 'circle', hint: 'Circle by center + edge, or 3 points on the edge' },
  diameter: { label: 'Diameter', kind: 'length', input: 'circle', hint: 'Circle by center + edge, or 3 points on the edge' },
};

export const MEASURE_TOOL_IDS = Object.keys(MEASURE_TOOLS);

// Count/Bolt Count are tally tools (click-to-mark), not drawn measurements —
// listed here so every place that switches on tool can ask one function.
export const toolKind = (tool) => (tool === 'count' || tool === 'bolt_count' ? 'count' : MEASURE_TOOLS[tool]?.kind || null);

export const toolLabel = (tool) => (tool === 'count' ? 'Count' : tool === 'bolt_count' ? 'Bolt Count' : MEASURE_TOOLS[tool]?.label || 'Measurement');

export const dist = (a, b) => Math.hypot(b.pdfX - a.pdfX, b.pdfY - a.pdfY);

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < (points?.length || 0); i++) total += dist(points[i - 1], points[i]);
  return total;
}

export function polygonPerimeter(points) {
  if (!points || points.length < 2) return 0;
  return polylineLength(points) + dist(points[points.length - 1], points[0]);
}

// Shoelace formula, absolute value — winding direction doesn't matter.
export function polygonArea(points) {
  if (!points || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += p1.pdfX * p2.pdfY - p2.pdfX * p1.pdfY;
  }
  return Math.abs(sum) / 2;
}

export const polygonCentroid = (points) => ({
  pdfX: points.reduce((s, p) => s + p.pdfX, 0) / points.length,
  pdfY: points.reduce((s, p) => s + p.pdfY, 0) / points.length,
});

// Ray-cast point-in-polygon.
export function pointInPolygon(pt, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.pdfY > pt.pdfY) !== (b.pdfY > pt.pdfY)
      && pt.pdfX < ((b.pdfX - a.pdfX) * (pt.pdfY - a.pdfY)) / (b.pdfY - a.pdfY) + a.pdfX) {
      inside = !inside;
    }
  }
  return inside;
}

// A cutout only counts when every one of its corners sits inside the
// outer shape — a hole that hangs outside can't be subtracted honestly.
export const cutoutFitsInside = (cutout, outer) => cutout.length >= 3 && cutout.every((p) => pointInPolygon(p, outer));

// Outer area minus every cutout, never below zero (overlapping cutouts
// would otherwise double-subtract).
export function netPolygonArea(outer, cutouts = []) {
  const gross = polygonArea(outer);
  const holes = cutouts.reduce((s, c) => s + polygonArea(c), 0);
  return Math.max(0, gross - holes);
}

// Angle at `vertex` between the arms to `a` and `c`, 0..180 degrees.
export function angleDegrees(a, vertex, c) {
  const v1x = a.pdfX - vertex.pdfX;
  const v1y = a.pdfY - vertex.pdfY;
  const v2x = c.pdfX - vertex.pdfX;
  const v2y = c.pdfY - vertex.pdfY;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (m === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / m));
  return (Math.acos(cos) * 180) / Math.PI;
}

export const circleFromCenterEdge = (center, edge) => ({ cx: center.pdfX, cy: center.pdfY, r: dist(center, edge) });

// Circumscribed circle through three points; null when they're in a line.
export function circleFrom3Points(a, b, c) {
  const d = 2 * (a.pdfX * (b.pdfY - c.pdfY) + b.pdfX * (c.pdfY - a.pdfY) + c.pdfX * (a.pdfY - b.pdfY));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.pdfX ** 2 + a.pdfY ** 2;
  const b2 = b.pdfX ** 2 + b.pdfY ** 2;
  const c2 = c.pdfX ** 2 + c.pdfY ** 2;
  const cx = (a2 * (b.pdfY - c.pdfY) + b2 * (c.pdfY - a.pdfY) + c2 * (a.pdfY - b.pdfY)) / d;
  const cy = (a2 * (c.pdfX - b.pdfX) + b2 * (a.pdfX - c.pdfX) + c2 * (b.pdfX - a.pdfX)) / d;
  return { cx, cy, r: Math.hypot(a.pdfX - cx, a.pdfY - cy) };
}

export const circlePointsNeeded = (circleMode) => (circleMode === 'three' ? 3 : 2);

export function circleFromDraft(points, circleMode) {
  if (circleMode === 'three') return points.length >= 3 ? circleFrom3Points(points[0], points[1], points[2]) : null;
  return points.length >= 2 ? circleFromCenterEdge(points[0], points[1]) : null;
}

// Slope turns a plan (flat, as-drawn) length or area into the true sloped
// one. Pitch is rise:run in the same units (6:12 = 6 in of rise per 12 in);
// an angle is degrees up from flat.
//   6:12 -> sqrt(1 + (6/12)^2) = sqrt(1.25) = 1.1180
//   30 deg -> 1 / cos(30) = 1.1547
// Returns 1 for no slope / blank / invalid input.
export function slopeFactor(slope) {
  if (!slope) return 1;
  if (slope.mode === 'pitch') {
    const rise = Number(slope.rise);
    const run = Number(slope.run);
    if (!(run > 0) || !(rise >= 0)) return 1;
    return Math.sqrt(1 + (rise / run) ** 2);
  }
  if (slope.mode === 'degrees') {
    const deg = Number(slope.degrees);
    if (!(deg > 0) || deg >= 89) return 1;
    return 1 / Math.cos((deg * Math.PI) / 180);
  }
  return 1;
}

export const slopeLabel = (slope) => {
  if (!slope || slopeFactor(slope) === 1) return '';
  return slope.mode === 'pitch' ? `${slope.rise}:${slope.run} pitch` : `${slope.degrees}° slope`;
};

const round = (v, places = 2) => Math.round(v * 10 ** places) / 10 ** places;

// The "where is this measurement" point used for its status marker, the
// hover tooltip, and same-spot duplicate checks.
export function measurementAnchor(tool, geom) {
  if (tool === 'length' && geom.points?.length >= 2) {
    return { pdfX: (geom.points[0].pdfX + geom.points[1].pdfX) / 2, pdfY: (geom.points[0].pdfY + geom.points[1].pdfY) / 2 };
  }
  if (geom.outer?.length) return polygonCentroid(geom.outer);
  if (geom.circle) return { pdfX: geom.circle.cx, pdfY: geom.circle.cy };
  if (tool === 'angle' && geom.points?.length >= 2) return geom.points[1];
  const pts = geom.points || [];
  if (pts.length === 0) return null;
  // Middle of the run for an open polyline, so the marker sits on the work.
  const mid = Math.floor((pts.length - 1) / 2);
  const a = pts[mid];
  const b = pts[Math.min(pts.length - 1, mid + 1)];
  return { pdfX: (a.pdfX + b.pdfX) / 2, pdfY: (a.pdfY + b.pdfY) / 2 };
}

// Turns a finished draft into a pending measurement — plan (flat) values
// only; slope/depth/height are applied afterward from the confirmation
// panel via applyMeasureExtras. `geom` is { points, outer, cutouts,
// circleMode } straight from the drawing engine; `ptsPerFt` is the scale
// that applied at the measurement's first click.
export function buildPendingMeasurement(tool, geom, ptsPerFt) {
  const def = MEASURE_TOOLS[tool];
  if (!def || !(ptsPerFt > 0)) return null;
  const ftPer = 1 / ptsPerFt;
  const sqFtPer = ftPer * ftPer;
  const pending = { tool, scale_pts_per_ft: ptsPerFt };

  if (tool === 'length') {
    const [p1, p2] = geom.points;
    pending.point1 = p1;
    pending.point2 = p2;
    pending.plan_length_ft = dist(p1, p2) * ftPer;
  } else if (tool === 'polylength' || tool === 'wall_area') {
    pending.polyline_points = geom.points;
    pending.plan_length_ft = polylineLength(geom.points) * ftPer;
  } else if (tool === 'perimeter') {
    pending.polygon_points = geom.points;
    pending.plan_length_ft = polygonPerimeter(geom.points) * ftPer;
  } else if (tool === 'area' || tool === 'volume') {
    const outer = geom.outer || geom.points;
    const cutouts = geom.cutouts || [];
    pending.polygon_points = outer;
    pending.cutouts = cutouts;
    pending.gross_area_sq_ft = polygonArea(outer) * sqFtPer;
    pending.cutout_area_sq_ft = cutouts.reduce((s, c) => s + polygonArea(c), 0) * sqFtPer;
    pending.plan_area_sq_ft = netPolygonArea(outer, cutouts) * sqFtPer;
  } else if (tool === 'angle') {
    pending.angle_points = geom.points;
    pending.angle_deg = round(angleDegrees(geom.points[0], geom.points[1], geom.points[2]), 1);
  } else if (tool === 'radius' || tool === 'diameter') {
    const circle = circleFromDraft(geom.points, geom.circleMode);
    if (!circle) return null;
    pending.circle = circle;
    pending.circle_mode = geom.circleMode || 'center';
    pending.circle_points = geom.points;
    pending.radius_ft = circle.r * ftPer;
    pending.diameter_ft = 2 * circle.r * ftPer;
    // A circle's length quantity is the ring around it (rolled angle/channel
    // ring, edge plate around a round opening) so AISC weight per foot
    // still applies; radius/diameter ride along for the label.
    pending.plan_length_ft = 2 * Math.PI * circle.r * ftPer;
  }

  pending.centroid = measurementAnchor(tool, { points: geom.points, outer: pending.polygon_points || null, circle: pending.circle || null });
  return applyMeasureExtras(pending, {});
}

// Applies the confirmation panel's slope / depth / wall height on top of a
// pending measurement's plan values, producing the final quantities a
// takeoff row stores. Safe to call repeatedly (always starts from plan_*).
export function applyMeasureExtras(pending, extras = {}) {
  const def = MEASURE_TOOLS[pending.tool];
  const out = { ...pending };
  const slope = def?.slope && extras.slope && slopeFactor(extras.slope) !== 1 ? extras.slope : null;
  const factor = slope ? slopeFactor(slope) : 1;
  out.slope = slope;
  out.slope_factor = round(factor, 4);

  if (pending.plan_length_ft != null && def?.kind === 'length') {
    out.length_ft = round(pending.plan_length_ft * factor);
  }
  if (pending.tool === 'area') {
    out.area_sq_ft = round(pending.plan_area_sq_ft * factor);
  }
  if (pending.tool === 'wall_area') {
    const h = Number(extras.height_ft) || 0;
    out.height_ft = h;
    out.length_ft = round(pending.plan_length_ft);
    out.area_sq_ft = round(pending.plan_length_ft * h);
  }
  if (pending.tool === 'volume') {
    const d = Number(extras.depth_ft) || 0;
    out.depth_ft = d;
    out.area_sq_ft = round(pending.plan_area_sq_ft);
    out.volume_cu_ft = round(pending.plan_area_sq_ft * d);
    out.volume_cu_yd = round((pending.plan_area_sq_ft * d) / 27);
  }
  return out;
}

// Whether the confirmation panel has everything this tool needs.
export function extrasComplete(tool, extras = {}) {
  const def = MEASURE_TOOLS[tool];
  if (def?.needsDepth && !(Number(extras.depth_ft) > 0)) return false;
  if (def?.needsHeight && !(Number(extras.height_ft) > 0)) return false;
  return true;
}

// The geometry + quantity fields a takeoff row (blueprint_takeoffs.
// accepted_items[]) stores for a drawn measurement. Count rows are built
// by the tally engine instead and never pass through here.
export function measurementRowFields(m) {
  const fields = {
    length_ft: m.length_ft || 0,
    scale_pts_per_ft: m.scale_pts_per_ft,
  };
  if (m.tool === 'length') {
    Object.assign(fields, { point1: m.point1, point2: m.point2 });
  } else if (m.centroid) {
    Object.assign(fields, { pdfX: m.centroid.pdfX, pdfY: m.centroid.pdfY });
  }
  const copy = [
    'polyline_points', 'polygon_points', 'cutouts', 'angle_points', 'circle', 'circle_mode', 'circle_points',
    'plan_length_ft', 'plan_area_sq_ft', 'gross_area_sq_ft', 'cutout_area_sq_ft', 'area_sq_ft', 'volume_cu_ft', 'volume_cu_yd',
    'angle_deg', 'radius_ft', 'diameter_ft', 'depth_ft', 'height_ft', 'slope', 'slope_factor',
  ];
  copy.forEach((k) => { if (m[k] != null) fields[k] = m[k]; });
  return fields;
}

// One-line plain-shop-language readout of a measured row/pending value,
// e.g. "24'-6 1/2" (plan 21'-11 3/8", 6:12 pitch)". `fmtFt` formats decimal
// feet (fractionInches.formatFeetInchesFraction) — passed in so this module
// stays free of display imports.
export function measurementSummary(m, fmtFt) {
  const n = (v, d = 2) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: d });
  const slope = slopeLabel(m.slope);
  switch (m.tool) {
    case 'length':
    case 'polylength':
    case 'perimeter':
      return `${fmtFt(m.length_ft || 0)}${slope ? ` (plan ${fmtFt(m.plan_length_ft || 0)}, ${slope})` : ''}`;
    case 'area':
      return `${n(m.area_sq_ft)} sq ft${m.cutouts?.length ? ` (${m.cutouts.length} cutout${m.cutouts.length === 1 ? '' : 's'} taken out)` : ''}${slope ? ` (${slope})` : ''}`;
    case 'wall_area':
      return `${n(m.area_sq_ft)} sq ft (${fmtFt(m.length_ft || 0)} long × ${fmtFt(m.height_ft || 0)} high)`;
    case 'volume':
      return `${n(m.volume_cu_yd)} cu yd (${n(m.volume_cu_ft, 1)} cu ft = ${n(m.area_sq_ft)} sq ft × ${fmtFt(m.depth_ft || 0)} deep)`;
    case 'angle':
      return `${n(m.angle_deg, 1)}°`;
    case 'radius':
      return `R ${fmtFt(m.radius_ft || 0)} (around ${fmtFt(m.length_ft || 0)})`;
    case 'diameter':
      return `Ø ${fmtFt(m.diameter_ft || 0)} (around ${fmtFt(m.length_ft || 0)})`;
    default:
      return '';
  }
}

// Short on-drawing label (no plan/slope detail) for the overlay.
export function measurementShortLabel(m, fmtFt) {
  const n = (v, d = 1) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: d });
  switch (m.tool) {
    case 'length':
    case 'polylength':
    case 'perimeter':
      return fmtFt(m.length_ft || 0);
    case 'area':
    case 'wall_area':
      return `${n(m.area_sq_ft)} sf`;
    case 'volume':
      return `${n(m.volume_cu_yd, 2)} cy`;
    case 'angle':
      return `${n(m.angle_deg)}°`;
    case 'radius':
      return `R ${fmtFt(m.radius_ft || 0)}`;
    case 'diameter':
      return `Ø ${fmtFt(m.diameter_ft || 0)}`;
    default:
      return '';
  }
}

// Live readout while a measurement is still being drawn — plan values
// only, from the points placed so far plus the cursor.
export function liveDraftReadout(tool, points, cursor, ptsPerFt, fmtFt, circleMode) {
  if (!(ptsPerFt > 0) || !cursor) return '';
  const pts = [...points, cursor];
  const ft = (pdfLen) => fmtFt(pdfLen / ptsPerFt);
  const def = MEASURE_TOOLS[tool];
  if (!def) return '';
  if (def.input === 'two' || def.input === 'poly') return pts.length >= 2 ? ft(polylineLength(pts)) : '';
  if (tool === 'perimeter') return pts.length >= 2 ? ft(polygonPerimeter(pts)) : '';
  if (def.input === 'polygon') {
    return pts.length >= 3 ? `${(polygonArea(pts) / (ptsPerFt * ptsPerFt)).toLocaleString(undefined, { maximumFractionDigits: 1 })} sf` : (pts.length === 2 ? ft(dist(pts[0], pts[1])) : '');
  }
  if (tool === 'angle') return pts.length === 3 ? `${angleDegrees(pts[0], pts[1], pts[2]).toFixed(1)}°` : (pts.length === 2 ? ft(dist(pts[0], pts[1])) : '');
  if (def.input === 'circle') {
    const c = circleFromDraft(pts, circleMode);
    if (!c) return '';
    return tool === 'diameter' ? `Ø ${ft(2 * c.r)}` : `R ${ft(c.r)}`;
  }
  return '';
}
