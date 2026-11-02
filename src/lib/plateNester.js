// Plate nesting for the takeoff "Combine for ordering" step — pure functions
// only (no db/React), deterministic: the same parts, sheets and settings
// always give the same layout. Checked in Node alongside stockCombiner.js.
//
// Heuristic: shelf packing, first-fit-decreasing by area. Parts are sorted
// biggest area first; each one goes into the first shelf (on the first
// sheet) with room, else starts a new shelf on the first sheet with length
// left, else starts a new sheet. A shelf runs across the sheet's width and
// is as tall (along the sheet's length) as the first part placed in it.
// That's a simple guillotine layout a burn table or shear can actually
// follow, not an optimal nest — good enough to price drop on a takeoff.
//
// Sheet axes: width_in runs across (x), length_in runs along (y). A part's
// width_in lies along x and length_in along y unless it's rotated.

const EPS = 1e-9;

// Expands { id, width_in, length_in, quantity } rows into one unit per
// physical part. Rows with a missing/zero dimension are returned apart so
// the caller can list them rather than lose them.
export function expandPlateUnits(parts) {
  const units = [];
  const invalid = [];
  (parts || []).forEach((p) => {
    const w = Number(p.width_in) || 0;
    const l = Number(p.length_in) || 0;
    const qty = Math.round(Number(p.quantity) || 0);
    if (!(w > 0) || !(l > 0) || qty <= 0) {
      invalid.push({ part_id: p.id, width_in: w, length_in: l, quantity: qty, reason: !(qty > 0) ? 'Zero quantity' : 'Missing width or length' });
      return;
    }
    for (let i = 0; i < qty; i++) units.push({ part_id: p.id, width_in: w, length_in: l, area: w * l });
  });
  return { units, invalid };
}

// The orientations to try for a part, in preference order. 'flat' puts the
// part's short side along the sheet length (shorter shelves), 'upright' the
// long side. Without rotation the part keeps its entered orientation.
function orientationsFor(unit, allowRotate, preference) {
  const asEntered = { w: unit.width_in, h: unit.length_in, rotated: false };
  if (!allowRotate) return [asEntered];
  const turned = { w: unit.length_in, h: unit.width_in, rotated: true };
  if (Math.abs(unit.width_in - unit.length_in) < EPS) return [asEntered];
  const flatFirst = asEntered.h <= turned.h ? [asEntered, turned] : [turned, asEntered];
  return preference === 'upright' ? [flatFirst[1], flatFirst[0]] : flatFirst;
}

export function fitsOnSheet(unit, sheet, { edgeTrimIn = 0, allowRotate = true } = {}) {
  const W = sheet.width_in - 2 * edgeTrimIn;
  const L = sheet.length_in - 2 * edgeTrimIn;
  return orientationsFor(unit, allowRotate, 'flat').some((o) => o.w <= W + EPS && o.h <= L + EPS);
}

/**
 * Nests every unit onto as many copies of ONE sheet size as needed.
 * settings: { kerfIn, edgeTrimIn, allowRotate, preference: 'flat'|'upright',
 * usableDropMinIn } — kerf is the gap between neighbouring parts and between
 * shelves; edge trim comes off all four sides of every sheet.
 */
export function nestOnSheetSize(units, sheet, settings = {}) {
  const kerf = Number(settings.kerfIn) || 0;
  const trim = Number(settings.edgeTrimIn) || 0;
  const allowRotate = settings.allowRotate !== false;
  const preference = settings.preference || 'flat';
  const usableMin = Number(settings.usableDropMinIn) || 0;
  const W = sheet.width_in - 2 * trim;
  const L = sheet.length_in - 2 * trim;

  const sorted = [...units].sort((a, b) => (b.area - a.area) || (Math.max(b.width_in, b.length_in) - Math.max(a.width_in, a.length_in)));
  const sheets = [];
  const unplaced = [];

  const placeIn = (sh, unit) => {
    const options = orientationsFor(unit, allowRotate, preference);
    for (const shelf of sh.shelves) {
      for (const o of options) {
        const x = shelf.x_used + (shelf.placements.length > 0 ? kerf : 0);
        if (o.h <= shelf.h + EPS && x + o.w <= W + EPS) {
          shelf.placements.push({ part_id: unit.part_id, x: trim + x, y: trim + shelf.y, w: o.w, h: o.h, rotated: o.rotated });
          shelf.x_used = x + o.w;
          return true;
        }
      }
    }
    for (const o of options) {
      const y = sh.y_used + (sh.shelves.length > 0 ? kerf : 0);
      if (o.w <= W + EPS && y + o.h <= L + EPS) {
        sh.shelves.push({ y, h: o.h, x_used: o.w, placements: [{ part_id: unit.part_id, x: trim, y: trim + y, w: o.w, h: o.h, rotated: o.rotated }] });
        sh.y_used = y + o.h;
        return true;
      }
    }
    return false;
  };

  sorted.forEach((unit) => {
    if (!fitsOnSheet(unit, sheet, { edgeTrimIn: trim, allowRotate })) {
      unplaced.push({ part_id: unit.part_id, width_in: unit.width_in, length_in: unit.length_in, reason: 'Too big for this sheet' });
      return;
    }
    for (const sh of sheets) {
      if (placeIn(sh, unit)) return;
    }
    const sh = { shelves: [], y_used: 0 };
    sheets.push(sh);
    placeIn(sh, unit);
  });

  const sheetArea = sheet.width_in * sheet.length_in;
  const laidOut = sheets.map((sh, i) => {
    const placements = sh.shelves.flatMap((s) => s.placements);
    const partArea = placements.reduce((s, p) => s + p.w * p.h, 0);
    // The strip left past the last shelf, full usable width. It's usable
    // drop when both of its sides reach the usable-drop minimum.
    const stripLen = Math.max(0, L - sh.y_used - (sh.shelves.length > 0 ? kerf : 0));
    const remnant = stripLen > EPS ? { x: trim, y: trim + L - stripLen, w: W, h: stripLen, area: W * stripLen } : null;
    const remnantUsable = !!remnant && Math.min(remnant.w, remnant.h) + EPS >= usableMin;
    const dropArea = sheetArea - partArea;
    return {
      index: i + 1,
      width_in: sheet.width_in,
      length_in: sheet.length_in,
      placements,
      part_area: partArea,
      drop_area: dropArea,
      remnant,
      usable_drop_area: remnantUsable ? remnant.area : 0,
      scrap_area: dropArea - (remnantUsable ? remnant.area : 0),
    };
  });

  const partArea = laidOut.reduce((s, x) => s + x.part_area, 0);
  const orderedArea = laidOut.length * sheetArea;
  return {
    sheet: { width_in: sheet.width_in, length_in: sheet.length_in },
    preference,
    sheets: laidOut,
    unplaced,
    totals: {
      sheet_qty: laidOut.length,
      ordered_area: orderedArea,
      part_area: partArea,
      drop_area: orderedArea - partArea,
      usable_drop_area: laidOut.reduce((s, x) => s + x.usable_drop_area, 0),
      scrap_area: laidOut.reduce((s, x) => s + x.scrap_area, 0),
      drop_pct: orderedArea > 0 ? ((orderedArea - partArea) / orderedArea) * 100 : 0,
    },
  };
}

/**
 * Picks the sheet size for a group: every offered size (or only the forced
 * one) x both orientation preferences, keeping the layout with the least
 * ordered area (= least drop), then the fewest sheets, then the earlier
 * size in the list. Parts too big for every offered sheet are returned in
 * `oversize` (special order) and left out of the comparison; a size that
 * can't hold every remaining part isn't a candidate.
 */
export function nestPlates(parts, settings = {}) {
  const sheets = (settings.sheets || []).filter((s) => Number(s.width_in) > 0 && Number(s.length_in) > 0);
  const allowRotate = settings.allowRotate !== false;
  const trim = Number(settings.edgeTrimIn) || 0;
  const { units, invalid } = expandPlateUnits(parts);
  const offered = settings.forcedSheet ? [settings.forcedSheet] : sheets;

  const oversize = [];
  const placeable = [];
  units.forEach((u) => {
    if (offered.some((s) => fitsOnSheet(u, s, { edgeTrimIn: trim, allowRotate }))) placeable.push(u);
    else oversize.push({ part_id: u.part_id, width_in: u.width_in, length_in: u.length_in, reason: offered.length === 0 ? 'No sheet sizes offered' : 'Bigger than every sheet offered — special order or splice' });
  });

  const preferences = allowRotate ? ['flat', 'upright'] : ['flat'];
  const alternatives = [];
  offered.forEach((sheet) => {
    preferences.forEach((preference) => {
      const result = nestOnSheetSize(placeable, sheet, { ...settings, preference });
      alternatives.push({ ...result, feasible: result.unplaced.length === 0 });
    });
  });

  const feasible = alternatives.filter((a) => a.feasible);
  let best = null;
  feasible.forEach((a) => {
    if (!best
      || a.totals.ordered_area < best.totals.ordered_area - EPS
      || (Math.abs(a.totals.ordered_area - best.totals.ordered_area) <= EPS && a.totals.sheet_qty < best.totals.sheet_qty)) {
      best = a;
    }
  });

  return { best, alternatives, oversize, invalid, placeableCount: placeable.length };
}
