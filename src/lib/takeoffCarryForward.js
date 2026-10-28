// Carry confirmed IRONSIGHT markups forward from an older revision's takeoff
// session to a newer one (blueprint_takeoffs.previous_takeoff_id).
//
// Nothing here writes anything. planCarryForward() lists, for every
// confirmed row in the old session, the row it WOULD become on the new
// sheet — geometry moved through that page's alignment transform (old pdf
// space → new pdf space, from pdfRevisionOverlay.computeAlignmentTransform),
// flagged "Check — area changed" when it lands in one of the new sheet's
// change clouds, and marked as already brought over when the new session
// already holds a copy of it. The dialog shows that list; only rows the
// estimator ticks are appended (never replacing an existing row).
//
// Measured values (length_ft, area_sq_ft …) are real-world quantities and
// are copied as-is — only the drawing geometry moves.
//
// Pure module (relative imports only) so node can run the self-check.

import { applyTransform, IDENTITY } from './pdfRevisionOverlay.js';

export const REVIEW_FLAG_AREA_CHANGED = 'area_changed';
export const REVIEW_FLAG_TEXT = 'Check — area changed';

const POINT_LIST_FIELDS = ['points', 'polyline_points', 'polygon_points', 'angle_points', 'circle_points'];
const SINGLE_POINT_FIELDS = ['point1', 'point2'];

const isPt = (p) => p && Number.isFinite(Number(p.pdfX)) && Number.isFinite(Number(p.pdfY));

const movePt = (t, p) => {
  const q = applyTransform(t, { x: Number(p.pdfX), y: Number(p.pdfY) });
  return { ...p, pdfX: q.x, pdfY: q.y };
};

/** Uniform scale of a similarity transform (1 for a pure shift). */
export const transformScale = (t) => Math.hypot(t?.a ?? 1, t?.b ?? 0);

/**
 * A copy of `row` with every piece of drawing geometry moved by `t`
 * ({ a, b, c, d, e, f }, old pdf space → new pdf space).
 */
export function transformRowGeometry(row, t = IDENTITY) {
  const out = { ...row };
  SINGLE_POINT_FIELDS.forEach((k) => { if (isPt(row[k])) out[k] = movePt(t, row[k]); });
  POINT_LIST_FIELDS.forEach((k) => {
    if (Array.isArray(row[k])) out[k] = row[k].map((p) => (isPt(p) ? movePt(t, p) : p));
  });
  if (Array.isArray(row.cutouts)) out.cutouts = row.cutouts.map((hole) => (Array.isArray(hole) ? hole.map((p) => (isPt(p) ? movePt(t, p) : p)) : hole));
  if (row.pdfX != null && row.pdfY != null && Number.isFinite(Number(row.pdfX))) {
    const q = movePt(t, row);
    out.pdfX = q.pdfX;
    out.pdfY = q.pdfY;
  }
  if (row.circle && Number.isFinite(Number(row.circle.cx))) {
    const c = applyTransform(t, { x: Number(row.circle.cx), y: Number(row.circle.cy) });
    out.circle = { ...row.circle, cx: c.x, cy: c.y, r: Number(row.circle.r) * transformScale(t) };
  }
  return out;
}

/** Bounding box of a row's drawing geometry in pdf space, or null when it has none. */
export function rowBounds(row) {
  const pts = [];
  SINGLE_POINT_FIELDS.forEach((k) => { if (isPt(row?.[k])) pts.push(row[k]); });
  POINT_LIST_FIELDS.forEach((k) => (Array.isArray(row?.[k]) ? row[k] : []).forEach((p) => { if (isPt(p)) pts.push(p); }));
  if (row?.circle && Number.isFinite(Number(row.circle.cx))) {
    const { cx, cy, r } = row.circle;
    pts.push({ pdfX: cx - r, pdfY: cy - r }, { pdfX: cx + r, pdfY: cy + r });
  }
  if (!pts.length && row?.pdfX != null && row?.pdfY != null) pts.push(row);
  if (!pts.length) return null;
  const xs = pts.map((p) => Number(p.pdfX));
  const ys = pts.map((p) => Number(p.pdfY));
  const x0 = Math.min(...xs); const y0 = Math.min(...ys);
  return { x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 };
}

/** True when two { x, y, width, height } boxes overlap (touching counts). */
export function boxesTouch(a, b) {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/** Change clouds (pdf-space boxes) a row's geometry touches. */
export function cloudsHitByRow(row, clouds = []) {
  const box = rowBounds(row);
  if (!box) return [];
  // Count rows: test each mark, not the box around all of them — a tally
  // spread across the sheet would otherwise "touch" nearly every cloud.
  if (Array.isArray(row.points) && row.points.length > 1 && (row.tool === 'count' || row.tool === 'bolt_count')) {
    return clouds.filter((c) => row.points.some((p) => isPt(p) && boxesTouch({ x: Number(p.pdfX), y: Number(p.pdfY), width: 0, height: 0 }, c)));
  }
  return clouds.filter((c) => boxesTouch(box, c));
}

/**
 * What carrying `oldRows` into the new session would do. Writes nothing.
 * @param {Array} oldRows accepted_items of the older session
 * @param {object} opts
 * @param {string} opts.fromTakeoffId the older session's id
 * @param {Array} [opts.existingRows] the new session's current rows (to spot copies already brought over)
 * @param {Record<number, { newPage?: number, transform?: object, clouds?: Array, compared?: boolean }>} [opts.pageMap]
 *   keyed by OLD page number. transform is old→new pdf space; clouds are new-sheet pdf-space boxes.
 * @returns {Array<{ key, sourceRow, newRow, page, newPage, flagged, cloudCount, alreadyCarried, compared }>}
 */
export function planCarryForward(oldRows = [], opts = {}) {
  const { fromTakeoffId = null, existingRows = [], pageMap = {} } = opts;
  const carriedIds = new Set(existingRows.map((r) => r.carried_from_row_id).filter(Boolean));
  return oldRows
    .filter((r) => r && r.is_accepted !== false && r.source === 'measurement')
    .map((r, i) => {
      const page = Number(r.page_number || 1);
      const map = pageMap[page] || {};
      const newPage = Number(map.newPage || page);
      const t = map.transform || IDENTITY;
      const moved = transformRowGeometry(r, t);
      const hits = cloudsHitByRow(moved, map.clouds || []);
      const sourceId = r.id || r._key || `row-${i}`;
      return {
        key: sourceId,
        sourceRow: r,
        newRow: moved,
        page,
        newPage,
        flagged: hits.length > 0,
        cloudCount: hits.length,
        alreadyCarried: carriedIds.has(sourceId),
        compared: Boolean(map.compared),
      };
    });
}

/**
 * The row actually appended to the new session for one planned item. Fresh
 * id; push state reset (but the estimate line id is kept, so pushing the new
 * revision updates the SAME MaterialTakeoffLine instead of adding a second
 * copy of the steel); tagged with where it came from and, when flagged, a
 * review flag the estimator clears after checking it.
 */
export function buildCarriedRow(item, { fromTakeoffId, newId }) {
  const id = newId();
  const { _key, pushed_to_estimate: _pushed, review_flag: _oldFlag, review_note: _oldNote, ...rest } = item.newRow;
  return {
    ...rest,
    id,
    _key: id,
    page_number: item.newPage,
    pushed_to_estimate: false,
    carried_from_takeoff_id: fromTakeoffId || null,
    carried_from_row_id: item.key,
    ...(item.flagged ? { review_flag: REVIEW_FLAG_AREA_CHANGED, review_note: `${REVIEW_FLAG_TEXT} on the new revision (${item.cloudCount} change cloud${item.cloudCount === 1 ? '' : 's'})` } : {}),
  };
}

// --------------------------------------------------------------- self-check

export function runCarryForwardSelfCheck() {
  const failures = [];
  let passed = 0;
  const check = (label, cond) => { if (cond) passed += 1; else failures.push(label); };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  // Hand-trace: a +10, +5 pt shift (both sheet scale and rotation unchanged).
  const shift = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 5 };
  const len = { id: 'r1', source: 'measurement', tool: 'length', page_number: 2, point1: { pdfX: 100, pdfY: 200 }, point2: { pdfX: 340, pdfY: 200 }, length_ft: 20, is_accepted: true };
  const moved = transformRowGeometry(len, shift);
  check('length p1 shifted +10,+5', near(moved.point1.pdfX, 110) && near(moved.point1.pdfY, 205));
  check('length p2 shifted +10,+5', near(moved.point2.pdfX, 350) && near(moved.point2.pdfY, 205));
  check('measured length unchanged', moved.length_ft === 20);
  const area = { id: 'r2', source: 'measurement', tool: 'area', pdfX: 50, pdfY: 50, polygon_points: [{ pdfX: 0, pdfY: 0 }, { pdfX: 100, pdfY: 0 }, { pdfX: 100, pdfY: 100 }], cutouts: [[{ pdfX: 10, pdfY: 10 }, { pdfX: 20, pdfY: 10 }, { pdfX: 20, pdfY: 20 }]] };
  const ma = transformRowGeometry(area, shift);
  check('polygon + cutout + centroid shifted', near(ma.polygon_points[2].pdfX, 110) && near(ma.cutouts[0][1].pdfY, 15) && near(ma.pdfX, 60));
  const circ = transformRowGeometry({ circle: { cx: 10, cy: 10, r: 4 } }, { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
  check('circle radius scales with the sheet', near(circ.circle.r, 8) && near(circ.circle.cx, 20));
  const plan = planCarryForward([len, { ...area, page_number: 1 }], {
    fromTakeoffId: 'old',
    existingRows: [{ carried_from_row_id: 'r2' }],
    pageMap: { 2: { transform: shift, clouds: [{ x: 300, y: 190, width: 80, height: 40 }], compared: true } },
  });
  check('length lands in a change cloud → flagged', plan[0].flagged && plan[0].cloudCount === 1);
  check('area already brought over', plan[1].alreadyCarried && !plan[1].flagged);
  const row = buildCarriedRow(plan[0], { fromTakeoffId: 'old', newId: () => 'new-1' });
  check('carried row tagged + flagged + not pushed', row.id === 'new-1' && row.carried_from_row_id === 'r1' && row.review_flag === REVIEW_FLAG_AREA_CHANGED && row.pushed_to_estimate === false && row.page_number === 2);
  const counts = cloudsHitByRow({ tool: 'count', points: [{ pdfX: 0, pdfY: 0 }, { pdfX: 1000, pdfY: 1000 }] }, [{ x: 400, y: 400, width: 20, height: 20 }]);
  check('count marks tested one by one', counts.length === 0);
  return { passed, failed: failures.length, failures };
}
