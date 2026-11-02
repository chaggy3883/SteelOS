// "Combine for ordering": turns a takeoff's piece list (Full Takeoff manual
// rows or IRONSIGHT markups — both callers build the same piece shape) into
// the stock to buy. Pure functions only, deterministic, Node-checkable.
//
//   Mult (linear): pieces of one shape + size + grade packed into stock
//   lengths with materialOptimizer.js's first-fit-decreasing optimizeCutPlan.
//   Each bar loses a squaring cut at the lead end, and the clamp allowance
//   at the tail can't hold a piece, so pieces pack into
//   usable = stock − squaring − clamp. Kerf is charged between pieces on a
//   bar, the same rule optimizeCutPlan has always used.
//   Drop = stock − squaring − (pieces + kerfs): the physical bar end left
//   over (it includes the clamp end). Drop at or above the usable-drop
//   threshold can go back to inventory; below it, it's scrap. Kerf and
//   squaring are always scrap.
//
//   Nest (plate): parts of one shape + thickness + grade laid out on sheets
//   with plateNester.js.
//
// % drop = (ordered − used) ÷ ordered, i.e. everything bought that doesn't
// leave as a piece (usable drop + scrap + kerf + squaring). Nothing here
// touches the takeoff rows — a run is a separate result the estimator
// reviews before exporting or ordering.
import { optimizeCutPlan } from './materialOptimizer.js';
import { nestPlates } from './plateNester.js';
import { formatFtIn, formatInches, profileKey } from './materialEntryMath.js';

export const DEFAULT_COMBINE_SETTINGS = {
  stock_lengths_ft: [20, 30, 40, 50, 60],
  forced_stock_length_ft: null,
  kerf_in: 0.125,
  squaring_in: 0,
  clamp_in: 0,
  usable_drop_in: 24,
  sheets: [
    { width_in: 48, length_in: 96 },
    { width_in: 60, length_in: 120 },
    { width_in: 72, length_in: 144 },
    { width_in: 96, length_in: 240 },
    { width_in: 96, length_in: 288 },
    { width_in: 120, length_in: 240 },
  ],
  forced_sheet: null,
  plate_kerf_in: 0,
  edge_trim_in: 0,
  allow_rotate: true,
  usable_plate_drop_in: 12,
  within_sequence: false,
  price_per_cwt: null,
  // Per-group overrides keyed by group key: { stock_length_ft } or { sheet }.
  group_overrides: {},
};

const EPS = 1e-9;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const gradeKey = (g) => String(g ?? '').replace(/^\*/, '').trim().toUpperCase().replace(/[\s.\-_]+/g, '');

/**
 * Piece shape both callers build:
 * { id, source_label, family: 'linear'|'plate', shape_code, profile, grade,
 *   sequence_key, sequence_label, length_in, width_in, thickness_in,
 *   quantity, weight_per_ft (linear), lb_per_sq_in (plate),
 *   stock_costs: { [stockLengthIn]: $ per bar } (optional) }
 */
export function combineGroupKey(piece, withinSequence) {
  const base = piece.family === 'plate'
    ? `plate::${String(piece.shape_code || '').toUpperCase()}::${round4(piece.thickness_in)}::${gradeKey(piece.grade)}`
    : `linear::${profileKey(piece.profile)}::${gradeKey(piece.grade)}`;
  return withinSequence ? `${base}::${piece.sequence_key || ''}` : base;
}

export function groupForCombining(pieces, { withinSequence = false } = {}) {
  const map = new Map();
  (pieces || []).forEach((p) => {
    const key = combineGroupKey(p, withinSequence);
    if (!map.has(key)) {
      const thickness = p.family === 'plate' ? formatInches(Number(p.thickness_in) || 0) : '';
      map.set(key, {
        key,
        family: p.family,
        shape_code: p.shape_code,
        profile: p.family === 'plate' ? `${p.shape_code} ${thickness}` : p.profile,
        grade: String(p.grade || '').replace(/^\*/, '').trim(),
        thickness_in: p.family === 'plate' ? Number(p.thickness_in) || 0 : null,
        sequence_key: withinSequence ? (p.sequence_key || '') : null,
        sequence_label: withinSequence ? (p.sequence_label || 'Unassigned') : null,
        pieces: [],
      });
    }
    map.get(key).pieces.push(p);
  });
  return Array.from(map.values());
}

const groupLabel = (g) => `${g.profile}${g.grade ? ` ${g.grade}` : ''}`;

function unitCost(group, settings) {
  const cwt = Number(settings.price_per_cwt);
  return Number.isFinite(cwt) && cwt > 0 ? cwt / 100 : null;
}

// ---------------------------------------------------------------- Mult

function packLinear(pieces, stockLengthIn, s) {
  const usable = stockLengthIn - s.squaring_in - s.clamp_in;
  const plan = optimizeCutPlan(
    pieces.map((p) => ({ id: p.id, quantity: p.quantity, cut_length_in: p.length_in })),
    [usable],
    s.kerf_in,
  );
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const bars = plan.bins.map((bin, i) => {
    let pos = s.squaring_in;
    const cuts = bin.cuts.map((c, ci) => {
      if (ci > 0) pos += s.kerf_in;
      const cut = { piece_id: c.piece_id, label: byId.get(c.piece_id)?.source_label || '', length_in: c.length_in, start_in: pos, end_in: pos + c.length_in };
      pos += c.length_in;
      return cut;
    });
    const kerfIn = Math.max(0, cuts.length - 1) * s.kerf_in;
    const dropIn = stockLengthIn - s.squaring_in - bin.used_in;
    return {
      index: i + 1,
      stock_length_in: stockLengthIn,
      squaring_in: s.squaring_in,
      clamp_in: s.clamp_in,
      cuts,
      piece_in: cuts.reduce((sum, c) => sum + c.length_in, 0),
      kerf_in: kerfIn,
      drop_in: dropIn,
      drop_kind: dropIn + EPS >= s.usable_drop_in ? 'usable' : 'scrap',
    };
  });
  const ordered = bars.length * stockLengthIn;
  const pieceIn = bars.reduce((sum, b) => sum + b.piece_in, 0);
  return { stock_length_in: stockLengthIn, usable_in: usable, bars, ordered_in: ordered, piece_in: pieceIn, drop_pct: ordered > 0 ? ((ordered - pieceIn) / ordered) * 100 : 0, unpacked: plan.unpackablePieces };
}

export function multGroup(group, settings = DEFAULT_COMBINE_SETTINGS) {
  const s = {
    kerf_in: Number(settings.kerf_in) || 0,
    squaring_in: Number(settings.squaring_in) || 0,
    clamp_in: Number(settings.clamp_in) || 0,
    usable_drop_in: Number(settings.usable_drop_in) || 0,
  };
  const override = settings.group_overrides?.[group.key];
  const forcedFt = Number(override?.stock_length_ft) || Number(settings.forced_stock_length_ft) || null;
  const offeredIn = forcedFt ? [forcedFt * 12] : [...new Set((settings.stock_lengths_ft || []).map((f) => Number(f) * 12).filter((v) => v > 0))].sort((a, b) => a - b);
  const maxUsable = offeredIn.length ? Math.max(...offeredIn) - s.squaring_in - s.clamp_in : 0;

  const flagged = [];
  const placeable = [];
  const invalid = [];
  group.pieces.forEach((p) => {
    const qty = Math.round(Number(p.quantity) || 0);
    const len = Number(p.length_in) || 0;
    if (qty <= 0 || len <= 0) {
      invalid.push({ piece_id: p.id, label: p.source_label, length_in: len, quantity: qty, reason: qty <= 0 ? 'Zero quantity' : 'No length entered' });
      return;
    }
    if (len > maxUsable + EPS) {
      flagged.push({ piece_id: p.id, label: p.source_label, length_in: len, quantity: qty, reason: offeredIn.length === 0 ? 'No stock lengths offered' : `Longer than ${formatFtIn(maxUsable)} usable on the longest stock — needs splice / special order` });
      return;
    }
    placeable.push({ ...p, quantity: qty });
  });

  const longest = placeable.reduce((m, p) => Math.max(m, p.length_in), 0);
  const alternatives = offeredIn.map((L) => {
    const feasible = L - s.squaring_in - s.clamp_in + EPS >= longest;
    if (!feasible) return { stock_length_in: L, feasible: false, bars: 0, ordered_in: 0, drop_pct: null };
    const r = packLinear(placeable, L, s);
    return { stock_length_in: L, feasible: true, bars: r.bars.length, ordered_in: r.ordered_in, drop_pct: r.drop_pct, plan: r };
  });
  // Least ordered length (= least drop), then fewest bars, then shorter stock.
  let best = null;
  alternatives.filter((a) => a.feasible).forEach((a) => {
    if (!best || a.ordered_in < best.ordered_in - EPS || (Math.abs(a.ordered_in - best.ordered_in) <= EPS && a.bars < best.bars)) best = a;
  });

  const plan = best?.plan || { bars: [], ordered_in: 0, piece_in: 0, stock_length_in: null };
  const wpf = Number(group.pieces.find((p) => Number(p.weight_per_ft) > 0)?.weight_per_ft) || 0;
  const kerfTotal = plan.bars.reduce((sum, b) => sum + b.kerf_in, 0);
  const squaringTotal = plan.bars.length * s.squaring_in;
  const usableDropIn = plan.bars.filter((b) => b.drop_kind === 'usable').reduce((sum, b) => sum + b.drop_in, 0);
  const scrapDropIn = plan.bars.filter((b) => b.drop_kind === 'scrap').reduce((sum, b) => sum + b.drop_in, 0);
  const lbs = (inches) => (inches / 12) * wpf;
  const qtyTotal = group.pieces.reduce((sum, p) => sum + Math.max(0, Math.round(Number(p.quantity) || 0)), 0);
  const qtyCombined = plan.bars.reduce((sum, b) => sum + b.cuts.length, 0);
  const rate = unitCost(group, settings);
  const perBarCost = plan.stock_length_in ? group.pieces.find((p) => p.stock_costs?.[plan.stock_length_in] > 0)?.stock_costs?.[plan.stock_length_in] : null;
  const orderedLbs = lbs(plan.ordered_in);
  let cost = null;
  let costBasis = 'No price — set a $/cwt rate or a stock length cost';
  if (perBarCost) {
    cost = plan.bars.length * perBarCost;
    costBasis = `${plan.bars.length} bars × $${perBarCost.toFixed(2)} per ${formatFtIn(plan.stock_length_in)} (stock length cost on file)`;
  } else if (rate && wpf > 0) {
    cost = orderedLbs * rate;
    costBasis = `${orderedLbs.toFixed(1)} lb × $${(rate * 100).toFixed(2)}/cwt ÷ 100`;
  }

  return {
    key: group.key,
    family: 'linear',
    label: groupLabel(group),
    profile: group.profile,
    grade: group.grade,
    shape_code: group.shape_code,
    sequence_label: group.sequence_label,
    forced: !!forcedFt,
    stock_length_in: plan.stock_length_in,
    order_line: plan.bars.length ? `${plan.bars.length} × ${groupLabel(group)} @ ${formatFtIn(plan.stock_length_in)}` : '',
    bars: plan.bars,
    alternatives: alternatives.map(({ plan: _p, ...a }) => a),
    flagged,
    invalid,
    weight_per_ft: wpf,
    needs_weight: !(wpf > 0),
    settings_used: { ...s },
    totals: {
      stock_qty: plan.bars.length,
      ordered_in: plan.ordered_in,
      piece_in: plan.piece_in,
      kerf_in: kerfTotal,
      squaring_in: squaringTotal,
      usable_drop_in: usableDropIn,
      scrap_drop_in: scrapDropIn,
      drop_pct: plan.ordered_in > 0 ? ((plan.ordered_in - plan.piece_in) / plan.ordered_in) * 100 : 0,
      ordered_lbs: orderedLbs,
      used_lbs: lbs(plan.piece_in),
      usable_drop_lbs: lbs(usableDropIn),
      scrap_lbs: lbs(scrapDropIn + kerfTotal + squaringTotal),
      ordered_tons: orderedLbs / 2000,
      scrap_tons: lbs(scrapDropIn + kerfTotal + squaringTotal) / 2000,
      qty_total: qtyTotal,
      qty_combined: qtyCombined,
      pct_combined: qtyTotal > 0 ? (qtyCombined / qtyTotal) * 100 : 0,
      cost,
      cost_basis: costBasis,
    },
  };
}

// ---------------------------------------------------------------- Nest

export function nestGroup(group, settings = DEFAULT_COMBINE_SETTINGS) {
  const override = settings.group_overrides?.[group.key];
  const forcedSheet = override?.sheet || settings.forced_sheet || null;
  const result = nestPlates(
    group.pieces.map((p) => ({ id: p.id, width_in: p.width_in, length_in: p.length_in, quantity: p.quantity })),
    {
      sheets: settings.sheets,
      forcedSheet,
      kerfIn: settings.plate_kerf_in,
      edgeTrimIn: settings.edge_trim_in,
      allowRotate: settings.allow_rotate !== false,
      usableDropMinIn: settings.usable_plate_drop_in,
    },
  );
  const byId = new Map(group.pieces.map((p) => [p.id, p]));
  const best = result.best;
  const sheets = (best?.sheets || []).map((sh) => ({ ...sh, placements: sh.placements.map((pl) => ({ ...pl, label: byId.get(pl.part_id)?.source_label || '' })) }));
  const t = best?.totals || { sheet_qty: 0, ordered_area: 0, part_area: 0, drop_area: 0, usable_drop_area: 0, scrap_area: 0, drop_pct: 0 };
  const lbPerSqIn = Number(group.pieces.find((p) => Number(p.lb_per_sq_in) > 0)?.lb_per_sq_in) || 0;
  const lbs = (area) => area * lbPerSqIn;
  const qtyTotal = group.pieces.reduce((sum, p) => sum + Math.max(0, Math.round(Number(p.quantity) || 0)), 0);
  const qtyCombined = sheets.reduce((sum, sh) => sum + sh.placements.length, 0);
  const rate = unitCost(group, settings);
  const orderedLbs = lbs(t.ordered_area);
  const cost = rate && lbPerSqIn > 0 ? orderedLbs * rate : null;
  const sheetText = best ? `${best.sheet.width_in}" × ${best.sheet.length_in}"` : '';
  return {
    key: group.key,
    family: 'plate',
    label: groupLabel(group),
    profile: group.profile,
    grade: group.grade,
    shape_code: group.shape_code,
    thickness_in: group.thickness_in,
    sequence_label: group.sequence_label,
    forced: !!forcedSheet,
    sheet: best?.sheet || null,
    preference: best?.preference || null,
    order_line: t.sheet_qty ? `${t.sheet_qty} × ${groupLabel(group)} sheet ${sheetText}` : '',
    sheets,
    alternatives: result.alternatives.map((a) => ({ sheet: a.sheet, preference: a.preference, feasible: a.feasible, sheet_qty: a.totals.sheet_qty, ordered_area: a.totals.ordered_area, drop_pct: a.totals.drop_pct })),
    flagged: result.oversize.map((o) => ({ piece_id: o.part_id, label: byId.get(o.part_id)?.source_label || '', width_in: o.width_in, length_in: o.length_in, quantity: 1, reason: o.reason })),
    invalid: result.invalid.map((o) => ({ piece_id: o.part_id, label: byId.get(o.part_id)?.source_label || '', reason: o.reason })),
    lb_per_sq_in: lbPerSqIn,
    needs_weight: !(lbPerSqIn > 0),
    totals: {
      stock_qty: t.sheet_qty,
      ordered_area: t.ordered_area,
      part_area: t.part_area,
      usable_drop_area: t.usable_drop_area,
      scrap_area: t.scrap_area,
      drop_pct: t.drop_pct,
      ordered_lbs: orderedLbs,
      used_lbs: lbs(t.part_area),
      usable_drop_lbs: lbs(t.usable_drop_area),
      scrap_lbs: lbs(t.scrap_area),
      ordered_tons: orderedLbs / 2000,
      scrap_tons: lbs(t.scrap_area) / 2000,
      qty_total: qtyTotal,
      qty_combined: qtyCombined,
      pct_combined: qtyTotal > 0 ? (qtyCombined / qtyTotal) * 100 : 0,
      cost,
      cost_basis: cost != null ? `${orderedLbs.toFixed(1)} lb × $${(rate * 100).toFixed(2)}/cwt ÷ 100` : 'No price — set a $/cwt rate',
    },
  };
}

// ---------------------------------------------------------------- Run

export function combineRun(pieces, settings = DEFAULT_COMBINE_SETTINGS) {
  const s = { ...DEFAULT_COMBINE_SETTINGS, ...(settings || {}) };
  const groups = groupForCombining(pieces, { withinSequence: !!s.within_sequence })
    .map((g) => (g.family === 'plate' ? nestGroup(g, s) : multGroup(g, s)))
    .sort((a, b) => (a.family === b.family ? a.label.localeCompare(b.label, undefined, { numeric: true }) : a.family === 'linear' ? -1 : 1));
  return { groups, totals: runTotals(groups) };
}

export function runTotals(groups) {
  const sum = (f) => (groups || []).reduce((s, g) => s + (Number(g.totals?.[f]) || 0), 0);
  const linear = (groups || []).filter((g) => g.family === 'linear');
  const plate = (groups || []).filter((g) => g.family === 'plate');
  const orderedLbs = sum('ordered_lbs');
  const usedLbs = sum('used_lbs');
  const qtyTotal = sum('qty_total');
  const qtyCombined = sum('qty_combined');
  const costed = (groups || []).filter((g) => g.totals?.cost != null);
  return {
    group_count: (groups || []).length,
    bars: linear.reduce((s, g) => s + g.totals.stock_qty, 0),
    sheets: plate.reduce((s, g) => s + g.totals.stock_qty, 0),
    stock_qty: sum('stock_qty'),
    ordered_lbs: orderedLbs,
    used_lbs: usedLbs,
    usable_drop_lbs: sum('usable_drop_lbs'),
    scrap_lbs: sum('scrap_lbs'),
    ordered_tons: orderedLbs / 2000,
    scrap_tons: sum('scrap_lbs') / 2000,
    // Weight-based, so linear and plate groups add up on one basis.
    drop_pct: orderedLbs > 0 ? ((orderedLbs - usedLbs) / orderedLbs) * 100 : 0,
    qty_total: qtyTotal,
    qty_combined: qtyCombined,
    pct_combined: qtyTotal > 0 ? (qtyCombined / qtyTotal) * 100 : 0,
    flagged_count: (groups || []).reduce((s, g) => s + g.flagged.length, 0),
    needs_weight_groups: (groups || []).filter((g) => g.needs_weight).length,
    cost: costed.length ? costed.reduce((s, g) => s + g.totals.cost, 0) : null,
    cost_groups: costed.length,
  };
}

// Compact copy of a run for storage on combining_runs (keeps every number
// the review screen and exports show, drops nothing the compare view needs).
export function summarizeForCompare(run) {
  const t = run?.totals || {};
  return {
    stock_qty: t.stock_qty || 0,
    bars: t.bars || 0,
    sheets: t.sheets || 0,
    drop_pct: t.drop_pct || 0,
    ordered_tons: t.ordered_tons || 0,
    scrap_tons: t.scrap_tons || 0,
    cost: t.cost ?? null,
  };
}

// ---------------------------------------------------------------- Export

// Plain tables for the combined order list export (PDF and Excel build from
// these same rows): the order list, every bar's/sheet's cut list, the
// drop/scrap summary and anything flagged for splice / special order.
// Numbers stay numbers; the PDF formats them. Cost columns only when asked
// (the order list normally goes to suppliers).
export function buildOrderExportTables(run, { includeCost = false } = {}) {
  const groups = run?.groups || [];
  const stockText = (g) => (g.family === 'plate'
    ? (g.sheet ? `${g.sheet.width_in}" × ${g.sheet.length_in}" sheet` : '—')
    : (g.stock_length_in ? formatFtIn(g.stock_length_in) : '—'));
  const seq = (g) => g.sequence_label || '';

  const orderColumns = ['Sequence', 'Material', 'Grade', 'Stock', 'Qty to order', 'Ordered lb', 'Ordered tons', 'Used lb', 'Usable drop lb', 'Scrap lb', '% drop', 'Pieces combined'];
  if (includeCost) orderColumns.push('Cost', 'Cost basis');
  const orderRows = groups.map((g) => {
    const t = g.totals;
    const row = [seq(g), g.profile, g.grade, stockText(g), t.stock_qty, round2(t.ordered_lbs), round4(t.ordered_tons), round2(t.used_lbs), round2(t.usable_drop_lbs), round2(t.scrap_lbs), round2(t.drop_pct), `${t.qty_combined} of ${t.qty_total}`];
    if (includeCost) row.push(t.cost == null ? '' : round2(t.cost), t.cost_basis);
    return row;
  });
  const rt = run?.totals || runTotals(groups);
  const totalRow = ['', 'Run total', '', `${rt.bars} bars, ${rt.sheets} sheets`, rt.stock_qty, round2(rt.ordered_lbs), round4(rt.ordered_tons), round2(rt.used_lbs), round2(rt.usable_drop_lbs), round2(rt.scrap_lbs), round2(rt.drop_pct), `${rt.qty_combined} of ${rt.qty_total}`];
  if (includeCost) totalRow.push(rt.cost == null ? '' : round2(rt.cost), rt.cost_groups < rt.group_count ? `${rt.cost_groups} of ${rt.group_count} groups priced` : '');

  const cutColumns = ['Material', 'Grade', 'Bar / sheet', 'Stock', 'Cut', 'Piece', 'Size', 'Position'];
  const cutRows = [];
  const dropColumns = ['Material', 'Grade', 'Bar / sheet', 'Stock', 'Drop', 'Usable or scrap', 'Drop lb'];
  const dropRows = [];
  groups.forEach((g) => {
    if (g.family === 'linear') {
      g.bars.forEach((b) => {
        b.cuts.forEach((c, i) => cutRows.push([g.profile, g.grade, `Bar ${b.index}`, formatFtIn(b.stock_length_in), i + 1, c.label, formatFtIn(c.length_in), `${formatFtIn(c.start_in)} to ${formatFtIn(c.end_in)}`]));
        dropRows.push([g.profile, g.grade, `Bar ${b.index}`, formatFtIn(b.stock_length_in), formatFtIn(b.drop_in), b.drop_kind === 'usable' ? 'Usable drop' : 'Scrap', round2((b.drop_in / 12) * (g.weight_per_ft || 0))]);
      });
    } else {
      g.sheets.forEach((sh) => {
        sh.placements.forEach((p, i) => cutRows.push([g.profile, g.grade, `Sheet ${sh.index}`, `${sh.width_in}" × ${sh.length_in}"`, i + 1, p.label, `${formatInches(p.w)} × ${formatInches(p.h)}${p.rotated ? ' (turned)' : ''}`, `x ${formatInches(p.x)}, y ${formatInches(p.y)}`]));
        if (sh.usable_drop_area > 0) dropRows.push([g.profile, g.grade, `Sheet ${sh.index}`, `${sh.width_in}" × ${sh.length_in}"`, `${formatInches(sh.remnant.w)} × ${formatInches(sh.remnant.h)} (${round2(sh.remnant.area)} sq in)`, 'Usable drop', round2(sh.usable_drop_area * (g.lb_per_sq_in || 0))]);
        dropRows.push([g.profile, g.grade, `Sheet ${sh.index}`, `${sh.width_in}" × ${sh.length_in}"`, `${round2(sh.scrap_area)} sq in`, 'Scrap', round2(sh.scrap_area * (g.lb_per_sq_in || 0))]);
      });
    }
  });

  const flaggedColumns = ['Material', 'Grade', 'Piece', 'Size', 'Qty', 'Reason'];
  const flaggedRows = groups.flatMap((g) => g.flagged.map((f) => [g.profile, g.grade, f.label, g.family === 'plate' ? `${formatInches(f.width_in)} × ${formatInches(f.length_in)}` : formatFtIn(f.length_in), f.quantity, f.reason]));

  return {
    order: { columns: orderColumns, rows: orderRows, totalRow },
    cuts: { columns: cutColumns, rows: cutRows },
    drops: { columns: dropColumns, rows: dropRows },
    flagged: { columns: flaggedColumns, rows: flaggedRows },
  };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
