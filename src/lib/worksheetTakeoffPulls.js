// "Pull from takeoff" for the Bid Worksheet (TakeoffEngine.jsx): the
// quantities the Full Takeoff and IRONSIGHT already hold for a line, shown
// to the estimator by source (and by size for fasteners) with the math, and
// only written to the line when the estimator clicks "Use". Nothing here
// changes a line on its own.
//
// Pure: relative imports only, no db/React, so it can be checked in Node.
// Inputs are plain records the worksheet loads for the bid:
//   - materialLines: MaterialTakeoffLine rows (Full Takeoff grid rows, and
//     rows pushed from IRONSIGHT's Markups List, source 'ironsight');
//   - sessions: blueprint_takeoffs (IRONSIGHT sessions) linked to the bid,
//     each with accepted_items (the session's rows);
//   - shapeTypes: MaterialShapeType records (to read a pushed Bolt Count's
//     type when its session row is gone);
//   - steelRows: steel_catalog rows (IRONSIGHT's paint-area math reads them).
import { calculateSteelSurfaceArea } from './steelShapeMath.js';
import { shopPrimingHours } from './bidWorksheetCalc.js';

// Bolts / Fasteners counts: bolts, nuts, washers, screws and expansion/lag
// bolts — every each-item in the catalog's Bolts/Fasteners group that is a
// fastener, without anchors.
export const BOLT_PULL_CODES = ['BO', 'HS', 'TC', 'MB', 'NU', 'WA', 'BW', 'LB', 'SCR', 'EXB'];
// Anchor Bolts counts: anchor bolts, epoxy anchors, Heckman anchors.
export const ANCHOR_PULL_CODES = ['AB', 'EA', 'HA'];
// Threaded rod is bought by length (a Full Takeoff linear row), so it is
// listed for the estimator but never added into a count.
export const BY_LENGTH_FASTENER_CODES = ['ATRD', 'TRD'];

export const PULL_SOURCE_LABELS = { full_takeoff: 'Full Takeoff', ironsight: 'IRONSIGHT' };

const num = (v) => Number(v) || 0;
const round = (v, d) => { const f = 10 ** d; return Math.round(num(v) * f) / f; };
const fmt = (v, d = 0) => num(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const upper = (s) => String(s || '').trim().toUpperCase();
const sourceOf = (line) => (line?.source === 'ironsight' ? 'ironsight' : 'full_takeoff');
const sessionName = (s) => s?.takeoff_name || s?.file_name || 'IRONSIGHT takeoff';
const acceptedRows = (session) => (session?.accepted_items || []).filter((r) => r && r.is_accepted !== false);

// MaterialTakeoffLine id -> { code, tool, sessionName } from the IRONSIGHT
// session rows that were pushed to it (MarkupsList.jsx's applyPushedFlag
// stamps pushed_material_line_id on every row of a pushed group).
export function buildIronsightLineIndex(sessions = []) {
  const map = new Map();
  (sessions || []).forEach((s) => {
    acceptedRows(s).forEach((r) => {
      if (!r.pushed_material_line_id) return;
      const prev = map.get(r.pushed_material_line_id);
      if (prev?.code) return;
      map.set(r.pushed_material_line_id, { code: upper(r.shape_code) || null, tool: r.tool || null, sessionName: sessionName(s) });
    });
  });
  return map;
}

// Description -> shape code for the catalog's Bolts/Fasteners types (a
// pushed Bolt Count's material_type is its type's description). Only
// descriptions that belong to one code are used.
export function buildFastenerDescriptionIndex(shapeTypes = []) {
  const counts = new Map();
  const map = new Map();
  (shapeTypes || []).filter((t) => t?.category === 'Bolts/Fasteners' && t.description).forEach((t) => {
    const key = upper(t.description);
    counts.set(key, (counts.get(key) || 0) + 1);
    map.set(key, upper(t.shape_code));
  });
  counts.forEach((n, key) => { if (n > 1) map.delete(key); });
  return map;
}

// A takeoff line's catalog shape code: its own shape_code (Full Takeoff
// catalog rows), else the IRONSIGHT session row it was pushed from, else
// its material_type read as a Bolts/Fasteners type description.
export function resolveLineShapeCode(line, { ironsightIndex, descriptionIndex } = {}) {
  if (line?.shape_code) return upper(line.shape_code);
  const fromSession = ironsightIndex?.get(line?.id)?.code;
  if (fromSession) return fromSession;
  return descriptionIndex?.get(upper(line?.material_type)) || null;
}

// Pieces on a line: an IRONSIGHT push carries its count in measure_quantity
// (count x multiplier); a Full Takeoff row in quantity.
const lineCount = (line) => (sourceOf(line) === 'ironsight' && line.measure_quantity != null ? num(line.measure_quantity) : num(line.quantity));
const lineSize = (line) => line?.size_value || line?.material_size || '';

/**
 * Counts for Bolts / Fasteners or Anchor Bolts, by source and size.
 * -> { total, sources: [{ key, label, total, groups: [{ code, size, grade, qty, lineIds }] }],
 *      byLength: [...], unknown: [...], lines: [math], applyNote }
 */
export function buildFastenerCountPull({ materialLines = [], sessions = [], shapeTypes = [], codes = BOLT_PULL_CODES, byLengthCodes = [] }) {
  const codeSet = new Set(codes.map(upper));
  const lengthSet = new Set(byLengthCodes.map(upper));
  const ironsightIndex = buildIronsightLineIndex(sessions);
  const descriptionIndex = buildFastenerDescriptionIndex(shapeTypes);
  const groups = new Map();
  const byLength = [];
  const unknown = [];
  (materialLines || []).forEach((line) => {
    const source = sourceOf(line);
    const code = resolveLineShapeCode(line, { ironsightIndex, descriptionIndex });
    if (!code) {
      // A pushed Bolt Count whose type can't be read — listed, not counted.
      if (source === 'ironsight' && ironsightIndex.get(line.id)?.tool === 'bolt_count') {
        unknown.push({ source, label: `${line.material_type || 'Bolt'} ${lineSize(line)}`.trim(), qty: lineCount(line), lineId: line.id });
      }
      return;
    }
    if (lengthSet.has(code)) {
      byLength.push({ source, code, size: lineSize(line), qty: lineCount(line), lengthFt: num(line.length_ft), lineId: line.id });
      return;
    }
    if (!codeSet.has(code)) return;
    const qty = lineCount(line);
    if (!(qty > 0)) return;
    const size = lineSize(line);
    const grade = line.grade || '';
    const key = `${source}|${code}|${size}|${grade}`;
    const g = groups.get(key) || { source, code, size, grade, qty: 0, lineIds: [] };
    g.qty += qty;
    g.lineIds.push(line.id);
    groups.set(key, g);
  });
  const sources = ['full_takeoff', 'ironsight'].map((key) => {
    const list = [...groups.values()].filter((g) => g.source === key)
      .sort((a, b) => a.code.localeCompare(b.code) || a.size.localeCompare(b.size, undefined, { numeric: true }));
    return { key, label: PULL_SOURCE_LABELS[key], total: list.reduce((s, g) => s + g.qty, 0), groups: list };
  });
  const total = sources.reduce((s, src) => s + src.total, 0);
  const lines = [
    ...sources.flatMap((src) => src.groups.map((g) => `${src.label}: ${g.code} ${g.size}${g.grade ? ` ${g.grade}` : ''} = ${fmt(g.qty)} ea`)),
    `${sources.map((src) => `${src.label} ${fmt(src.total)}`).join(' + ')} = ${fmt(total)} ea`,
  ];
  const applyNote = `Qty pulled from takeoff: ${sources.map((src) => `${src.label} ${fmt(src.total)}`).join(' + ')} = ${fmt(total)} ea`;
  return { total, sources, byLength, unknown, lines, applyNote, codes: [...codeSet] };
}

/**
 * Tons for Processing Steel. Every option is a separate number to pick
 * from — never added together, because the Full Takeoff's saved total
 * already includes the IRONSIGHT lines shown in its grid.
 */
export function buildTonsPull({ bid, materialLines = [] }) {
  const rows = (materialLines || []).filter((l) => num(l.total_tons) > 0)
    .map((l) => ({ source: sourceOf(l), label: l.material_size || l.material_type || 'Line', tons: num(l.total_tons), lineId: l.id }));
  const sum = (src) => rows.filter((r) => r.source === src).reduce((s, r) => s + r.tons, 0);
  const typed = sum('full_takeoff');
  const pushed = sum('ironsight');
  const saved = num(bid?.estimated_tons);
  const options = [
    {
      key: 'full_takeoff_total',
      label: 'Full Takeoff Total Tons (as last saved)',
      value: round(saved, 3),
      unit: 'tons',
      decimals: 3,
      sourceKind: 'full_takeoff',
      lines: [
        `Bid.estimated_tons = ${fmt(saved, 3)} tons — the Full Takeoff's Total Tons the last time it was saved.`,
        `Its lines now: typed in ${fmt(typed, 3)} t + pushed from IRONSIGHT ${fmt(pushed, 3)} t = ${fmt(typed + pushed, 3)} t.`,
        Math.abs(typed + pushed - saved) >= 0.0005 ? 'The lines differ from the saved total — open the Full Takeoff and save it to refresh.' : '',
      ],
      applyNote: `Tons pulled from takeoff: Full Takeoff Total Tons ${fmt(saved, 3)} t`,
    },
    {
      key: 'ironsight',
      label: 'IRONSIGHT pushed lines only',
      value: round(pushed, 3),
      unit: 'tons',
      decimals: 3,
      sourceKind: 'ironsight',
      lines: [...rows.filter((r) => r.source === 'ironsight').map((r) => `${r.label}: ${fmt(r.tons, 3)} t`), `Total ${fmt(pushed, 3)} t`],
      applyNote: `Tons pulled from takeoff: IRONSIGHT pushed lines ${fmt(pushed, 3)} t`,
    },
    {
      key: 'typed',
      label: 'Lines typed in the Full Takeoff only',
      value: round(typed, 3),
      unit: 'tons',
      decimals: 3,
      sourceKind: 'full_takeoff',
      lines: [...rows.filter((r) => r.source === 'full_takeoff').map((r) => `${r.label}: ${fmt(r.tons, 3)} t`), `Total ${fmt(typed, 3)} t`],
      applyNote: `Tons pulled from takeoff: Full Takeoff typed lines ${fmt(typed, 3)} t`,
    },
  ];
  return { options, rows, typed, pushed, saved };
}

// One IRONSIGHT row's paint area, exactly as IRONSIGHT's grid shows it
// (BlueprintTakeoff.jsx rowPaintAreaSqIn): rows coated Paint only.
export const ironsightRowPaintSqIn = (r, steelRows = []) => (r?.coating_type === 'Paint'
  ? calculateSteelSurfaceArea(r.size_designation, r.length_ft, r.quantity, steelRows)
  : 0);

/**
 * Painted sq ft for Primer (Paint), by source. The Full Takeoff number is
 * the same one the line already auto-fills from (Bid.estimated_paint_area_sqft);
 * IRONSIGHT's is its own sessions' Paint-coated rows (IRONSIGHT doesn't push
 * paint area to the estimate). "Both" adds them — only right when the two
 * cover different steel, which the option says.
 */
export function buildPaintAreaPull({ bid, materialLines = [], sessions = [], steelRows = [] }) {
  const ftRows = (materialLines || []).filter((l) => num(l.paint_area_sq_in) > 0)
    .map((l) => ({ source: 'full_takeoff', label: l.material_size || l.material_type || 'Line', sqft: num(l.paint_area_sq_in) / 144, lineId: l.id }));
  const irRows = [];
  (sessions || []).forEach((s) => {
    acceptedRows(s).forEach((r) => {
      const sqIn = ironsightRowPaintSqIn(r, steelRows);
      if (sqIn > 0) irRows.push({ source: 'ironsight', label: `${sessionName(s)} — ${r.label || r.size_designation || 'row'}`, sqft: sqIn / 144, sessionId: s.id });
    });
  });
  const ft = num(bid?.estimated_paint_area_sqft);
  const ir = irRows.reduce((s, r) => s + r.sqft, 0);
  const options = [
    {
      key: 'full_takeoff',
      label: 'Full Takeoff paint area (as last saved)',
      value: ft,
      unit: 'sq ft',
      decimals: 1,
      sourceKind: 'full_takeoff',
      follow: true,
      lines: [
        ...ftRows.map((r) => `${r.label}: ${fmt(r.sqft * 144)} sq in ÷ 144 = ${fmt(r.sqft, 1)} sq ft`),
        `Bid.estimated_paint_area_sqft = ${fmt(ft, 1)} sq ft (Paint-coated lines, the last time the Full Takeoff was saved)`,
      ],
      applyNote: `Sq ft pulled from takeoff: Full Takeoff paint area ${fmt(ft, 1)} sq ft`,
    },
    {
      key: 'ironsight',
      label: 'IRONSIGHT paint area (Paint-coated rows)',
      value: round(ir, 1),
      unit: 'sq ft',
      decimals: 1,
      sourceKind: 'ironsight',
      lines: [...irRows.map((r) => `${r.label}: ${fmt(r.sqft, 1)} sq ft`), `Total ${fmt(ir, 1)} sq ft`],
      applyNote: `Sq ft pulled from takeoff: IRONSIGHT paint area ${fmt(ir, 1)} sq ft`,
    },
    {
      key: 'both',
      label: 'Both added together',
      value: round(ft + ir, 1),
      unit: 'sq ft',
      decimals: 1,
      sourceKind: null,
      caution: 'Only if the Full Takeoff and IRONSIGHT cover different steel — otherwise the same members are counted twice.',
      lines: [`Full Takeoff ${fmt(ft, 1)} + IRONSIGHT ${fmt(ir, 1)} = ${fmt(ft + ir, 1)} sq ft`],
      applyNote: `Sq ft pulled from takeoff: Full Takeoff ${fmt(ft, 1)} + IRONSIGHT ${fmt(ir, 1)} = ${fmt(ft + ir, 1)} sq ft`,
    },
  ];
  return { options, ftRows, irRows, ft, ir };
}

/**
 * Shop Priming hours = painted sq ft ÷ the company's sq ft per hour,
 * rounded to 0.1 hr, for each painted-area source (the worksheet's own
 * Primer (Paint) sq ft first).
 */
export function buildPrimingHoursPull({ primerSqft, paintPull, sqftPerHour, rateIsDefault = false }) {
  const rate = num(sqftPerHour);
  const rateText = `${fmt(rate)} sq ft/hr${rateIsDefault ? ' (default — not set by an admin yet)' : ' (company rate)'}`;
  const hoursFor = (sqft) => shopPrimingHours(sqft, rate);
  const sources = [
    { key: 'primer_line', label: 'This worksheet\'s Primer (Paint) sq ft', sqft: num(primerSqft), sourceKind: 'worksheet' },
    ...(paintPull?.options || []).map((o) => ({ key: o.key, label: o.label, sqft: o.value, sourceKind: o.sourceKind, caution: o.caution })),
  ];
  const options = sources.map((s) => {
    const hours = hoursFor(s.sqft);
    return {
      key: s.key,
      label: s.label,
      value: hours,
      unit: 'hrs',
      decimals: 1,
      sourceKind: s.sourceKind,
      caution: s.caution,
      sqft: s.sqft,
      lines: [
        `${fmt(s.sqft, 1)} sq ft ÷ ${rateText}`,
        rate > 0 ? `= ${fmt(num(s.sqft) / rate, 3)} hrs -> ${fmt(hours, 1)} hrs (to 0.1)` : 'No sq ft per hour rate — set one at Bid Worksheet Default Rates.',
      ],
      applyNote: `Hours pulled from takeoff: ${s.label} ${fmt(s.sqft, 1)} sq ft ÷ ${fmt(rate)} sq ft/hr = ${fmt(hours, 1)} hrs`,
    };
  });
  return { options, rate, rateIsDefault };
}
