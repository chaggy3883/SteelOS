// Catalog-driven material entry math for the Full Takeoff manual grid —
// pure functions only (relative imports, no db/React), so it can be checked
// in Node the same way takeoffFormula.js / takeoffRowHelpers.js are.
//
// A row picks a master-catalog shape (MaterialShapeType.shape_code), one of
// that shape's MaterialSizeOption.size_value strings and a grade. From that
// this file decides:
//   - the entry family: 'linear' (length x qty), 'plate' (thickness from the
//     size, width x length x qty) or 'each' (qty only);
//   - the weight, in this order: steel_catalog weight_per_ft for the size ->
//     the AISC Shapes Database v16.0 (aiscShapes.js, exact for standard
//     shapes) -> a weight computed from the size's own dimensions -> the old
//     estimator (steelShapeSelector.js estimateWeightPerFt) -> nothing, in
//     which case the row says "weight needed" and never quietly uses 0. A
//     typed override on the row beats all of them;
//   - weight (lb), tons (lb / 2000), plate area sq in (plate rows) and
//     surface sq in (AISC perimeter first, then a perimeter formula), each
//     with the lines of math the UI shows when a number is clicked.
// Rows saved before this existed (shape_class one of the 5 old classes, no
// shape_code) go through calcLegacyRow, the old FullTakeoff rowCalc. Its
// estimateWeightPerFt / steelShapeMath now read the AISC table first, so old
// HSS and angle rows move to their true weight; W, C and plate rows don't.
import { estimateWeightPerFt, getShapeClass } from '../data/steelShapeSelector.js';
import { calculateSteelSurfaceArea } from './steelShapeMath.js';
import { findAiscPipe, findAiscShapeForCatalog } from './aiscShapes.js';
import { parseStructuralLength } from './structuralLength.js';

// lb per cubic foot. 490 is the usual carbon-steel figure (490 / 1728 =
// 0.28356 lb/cu in — the "0.2836" shop number); stainless and aluminum are
// typical 300-series / 6061 values.
export const DENSITY_LB_PER_CU_FT = { carbon: 490, stainless: 501, aluminum: 169 };
export const lbPerCuIn = (material) => (DENSITY_LB_PER_CU_FT[material] || 0) / 1728;

// Old 5-class rows -> the master catalog code they always meant (same map
// FullTakeoff used for its Grade dropdown before this file existed).
export const LEGACY_SHAPE_CLASS_TO_CODE = {
  'W-Beam': 'W',
  'HSS Tube': 'HSS',
  'C-Channel': 'C',
  'L-Angle': 'L',
  'PL-Plate': 'PL',
};

// The reverse bridge, written onto new rows as shape_class so code that
// still keys on the 5-class enum (IRONSIGHT, project carry-over) sees them.
// Codes without a counterpart leave shape_class unset.
export const CODE_TO_LEGACY_SHAPE_CLASS = { W: 'W-Beam', HSS: 'HSS Tube', C: 'C-Channel', L: 'L-Angle', PL: 'PL-Plate', PLGA: 'PL-Plate' };

// Bolts, nuts, washers, anchors, studs, screws, standard clips and misc
// hardware: quantity only. RD/ROD/TRD/ATRD sit under Bolts/Fasteners in the
// catalog but are bought by length, so they are linear (below).
const EACH_CODES = new Set(['AB', 'BO', 'HS', 'MB', 'TC', 'EXB', 'LB', 'NU', 'WA', 'BW', 'WS', 'STD', 'SCR', 'EA', 'EAC', 'HA', 'CB', 'MS', 'BA', 'ELB', 'A', 'AW', 'B', 'BB', 'SP', 'SCT']);
// Plate, sheet, checker/floor plate, grating, decking, expanded metal.
const PLATE_CODES = new Set(['PL', 'PLGA', 'ARPL', 'UM', 'DPL', 'SSPL', 'SSGP', 'ALPL', 'ALGP', 'ALSH', 'ALCP', 'CP', 'FP', 'GR', 'GRX', 'DK', 'X', 'PLGC']);
// Plate-family codes whose weight is NOT solid thickness x density
// (open grating, formed deck, expanded mesh, copper) — weight needed unless
// the estimator types a lb/sq ft.
const PLATE_NOT_SOLID = new Set(['GR', 'GRX', 'DK', 'X', 'PLGC']);
// Sheet codes where a bare whole number in the size is a gauge, not inches.
const GAUGE_SHEET_CODES = new Set(['PLGA', 'SSGP', 'ALGP', 'ALSH']);

export function entryFamily(shapeCode, category) {
  const code = String(shapeCode || '').toUpperCase();
  if (PLATE_CODES.has(code)) return 'plate';
  if (EACH_CODES.has(code)) return 'each';
  if (['RD', 'ROD', 'TRD', 'ATRD'].includes(code)) return 'linear';
  if (category === 'Bolts/Fasteners') return 'each';
  return 'linear';
}

export function materialFor(shapeType) {
  if (String(shapeType?.shape_code || '').toUpperCase() === 'PLGC') return null; // copper
  if (shapeType?.category === 'Stainless') return 'stainless';
  if (shapeType?.category === 'Aluminum') return 'aluminum';
  return 'carbon';
}

// How a linear code's weight/perimeter is worked out when no catalog weight
// exists. 'designation' = the lb/ft is the last number of the size
// (W 12 x 26, C 15 x 50, WT 22 x 167.5) and the existing estimator reads it.
const LINEAR_KIND = {
  W: 'designation_w', WT: 'designation_tee', HP: 'designation_w', S: 'designation_w', M: 'designation_w', MT: 'designation_tee', ST: 'designation_tee',
  C: 'designation_c', MC: 'designation_c',
  L: 'angle_estimator', LG: 'angle_estimator',
  SSL: 'angle', ALL: 'angle', LS: 'angle', BP: 'angle',
  HSS: 'rect_tube_estimator', DTS: 'rect_tube', SSTS: 'rect_tube',
  HSSR: 'round_tube',
  P40: 'pipe', 'P40 GALV': 'pipe', P60: 'pipe', P80: 'pipe', P120: 'pipe', PIPE: 'pipe', PS: 'pipe', PX: 'pipe', PXX: 'pipe', XS: 'pipe', XXS: 'pipe', ALPS: 'pipe', SSPS: 'pipe',
  FB: 'flat', BAR: 'flat', ALBR: 'flat', ALFB: 'flat', SSFB: 'flat',
  RD: 'round', ROD: 'round', SSRD: 'round', ALRD: 'round', CRRD: 'round', ATRD: 'round', TRD: 'round', REB: 'rebar',
  SQ: 'square', SQBR: 'square',
  CR: 'crane_rail',
};

// Shop hours per ton for a new-style row, read from the 5 SHAPE_CLASSES so
// the rates stay single-sourced: beams/tees/piles like W, tube and pipe like
// HSS, channels like C, angles/bars/rods like L, plate-family like PL,
// hardware 0 (it isn't fabricated by the ton).
const HOURS_CLASS_BY_KIND = {
  designation_w: 'W-Beam', designation_tee: 'W-Beam', crane_rail: 'W-Beam',
  designation_c: 'C-Channel',
  angle_estimator: 'L-Angle', angle: 'L-Angle', flat: 'L-Angle', round: 'L-Angle', rebar: 'L-Angle', square: 'L-Angle',
  rect_tube_estimator: 'HSS Tube', rect_tube: 'HSS Tube', round_tube: 'HSS Tube', pipe: 'HSS Tube',
};
export function hoursClassFor(shapeCode, family) {
  if (family === 'each') return null;
  if (family === 'plate') return 'PL-Plate';
  const code = String(shapeCode || '').toUpperCase();
  if (code === 'GDR') return 'W-Beam';
  if (code === 'CBAR' || code === 'BC') return 'C-Channel';
  return HOURS_CLASS_BY_KIND[LINEAR_KIND[code]] || 'W-Beam';
}
export function hoursPerTonFor(shapeCode, family) {
  const cls = hoursClassFor(shapeCode, family);
  return cls ? (getShapeClass(cls).hoursPerTon || 0) : 0;
}

// --------------------------------------------------------------- parsing

// Manufacturers' standard gauge for sheet steel, inches. Used for every
// "NNga" size (steel, stainless and aluminum alike — close enough for a
// takeoff weight, and the row shows the thickness it used).
export const SHEET_GAUGE_IN = {
  3: 0.2391, 4: 0.2242, 5: 0.2092, 6: 0.1943, 7: 0.1793, 8: 0.1644, 9: 0.1495, 10: 0.1345,
  11: 0.1196, 12: 0.1046, 13: 0.0897, 14: 0.0747, 15: 0.0673, 16: 0.0598, 17: 0.0538, 18: 0.0478,
  19: 0.0418, 20: 0.0359, 21: 0.0329, 22: 0.0299, 23: 0.0269, 24: 0.0239, 25: 0.0209, 26: 0.0179,
  27: 0.0164, 28: 0.0149,
};

// One dimension token -> inches. Handles 3/8, 1 1/2, 1-1/2, 0.375, 2", and
// 16ga / 16 GA (gauge). Returns null when it isn't a plain dimension.
export function parseDimToken(token, { bareIntegerIsGauge = false } = {}) {
  const t = String(token ?? '').trim().replace(/["']/g, '').trim();
  if (!t) return null;
  const ga = t.match(/^(\d+)\s*ga\b/i);
  if (ga) return SHEET_GAUGE_IN[Number(ga[1])] ?? null;
  const mixed = t.match(/^(\d+(?:\.\d+)?)[\s-]+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  if (/^\d+(?:\.\d+)?$/.test(t)) {
    if (bareIntegerIsGauge && /^\d+$/.test(t) && SHEET_GAUGE_IN[Number(t)] != null) return SHEET_GAUGE_IN[Number(t)];
    return Number(t);
  }
  return null;
}

// "12 x 26" -> ['12', '26']; "1/4\"x 25\"" -> ['1/4"', '25"']; trailing
// "1/2 x" (plate thickness-only sizes) -> ['1/2'].
export function splitSizeTokens(size) {
  return String(size ?? '').split(/\s*[xX×]\s*/).map((s) => s.trim()).filter(Boolean);
}

const isGaugeToken = (tok) => /^\d+\s*ga\b/i.test(String(tok || '').trim());

// Mixed numbers to decimals ("2 1/2" -> "2.5", "3-1/2" -> "3.5"), simple
// fractions kept ("3/8"). Used for the compact AISC-style profile string.
function compactToken(tok) {
  const t = String(tok || '').replace(/["']/g, '').trim();
  const mixed = t.match(/^(\d+(?:\.\d+)?)[\s-]+(\d+)\/(\d+)$/);
  if (mixed) return String(Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]));
  return t.replace(/\s+/g, '');
}

// Compact profile ("W12X26", "HSS6X6X3/8", "L2.5X2.5X1/4", "PL1/2X24") —
// steel_catalog's size_designation convention and what the old grid saved
// as material_size. Plate gets its width appended when known.
export function compactProfile(shapeCode, sizeValue, { widthIn } = {}) {
  const code = String(shapeCode || '').toUpperCase().replace(/\s+/g, '');
  const tokens = splitSizeTokens(sizeValue).map(compactToken);
  if (PLATE_CODES.has(String(shapeCode || '').toUpperCase())) {
    const thickness = tokens[0] || '';
    return widthIn > 0 ? `${code}${thickness}X${round4(widthIn)}`.toUpperCase() : `${code}${thickness}`.toUpperCase();
  }
  // Pipe sizes are nominal ("4", "8STD") — keep a space so "P40 4" doesn't read as "P404".
  if (LINEAR_KIND[String(shapeCode || '').toUpperCase()] === 'pipe') return `${code} ${String(sizeValue || '').trim()}`.toUpperCase();
  return `${code}${tokens.join('X')}`.toUpperCase();
}

// Comparison key for a profile string: upper case, no spaces/quotes, every
// fraction and mixed number turned into a decimal — so "L3-1/2X3-1/2X1/4",
// "L3 1/2 x 3 1/2 x 1/4" and "L3.5X3.5X0.25" all compare equal.
export function profileKey(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/["']/g, '')
    .replace(/(\d+(?:\.\d+)?)[\s-]+(\d+)\/(\d+)/g, (_, w, n, d) => String(round4(Number(w) + Number(n) / Number(d))))
    .replace(/(\d+)\/(\d+)/g, (_, n, d) => String(round4(Number(n) / Number(d))))
    .replace(/\s+/g, '')
    .replace(/×/g, 'X');
}

const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

// Length typed as ft-in-fraction (20'-6 1/2", 20' 6-1/2", 6 1/2", 246.5")
// or a bare number (decimal feet, the old grid's entry) -> inches, or null.
export function parseLengthToInches(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // Bare inches with a quote and no foot mark: 246.5" -> 246.5
  if (!s.includes("'") && /"$/.test(s)) {
    const v = parseDimToken(s.replace(/"$/, ''));
    return v == null ? null : v;
  }
  const ft = parseStructuralLength(s);
  return ft == null ? null : ft * 12;
}

// Inches -> 20'-6 1/2" (rounded to the nearest 1/16").
export function formatFtIn(inches) {
  if (!Number.isFinite(inches)) return '';
  const sixteenths = Math.round(inches * 16);
  const sign = sixteenths < 0 ? '-' : '';
  const abs = Math.abs(sixteenths);
  const feet = Math.floor(abs / (12 * 16));
  const remSix = abs - feet * 12 * 16;
  const wholeIn = Math.floor(remSix / 16);
  let num = remSix - wholeIn * 16;
  let den = 16;
  while (num > 0 && num % 2 === 0) { num /= 2; den /= 2; }
  const frac = num > 0 ? ` ${num}/${den}` : '';
  return `${sign}${feet}'-${wholeIn}${frac}"`;
}

// Inches -> 6 1/2" (no feet) for widths and plate sizes.
export function formatInches(inches) {
  if (!Number.isFinite(inches)) return '';
  const sixteenths = Math.round(inches * 16);
  const whole = Math.floor(sixteenths / 16);
  let num = sixteenths - whole * 16;
  let den = 16;
  while (num > 0 && num % 2 === 0) { num /= 2; den /= 2; }
  if (whole === 0 && num > 0) return `${num}/${den}"`;
  return `${whole}${num > 0 ? ` ${num}/${den}` : ''}"`;
}

// --------------------------------------------------------------- pipe sizes

// Nominal pipe size -> OD and wall (in) for standard / extra strong /
// double extra strong and schedules 40/60/80/120 (ASME B36.10 dimensions).
// STD = Sch 40 and XS = Sch 80 through 8"; 10" and 12" differ, listed apart.
const PIPE_TABLE = {
  0.125: { od: 0.405, std: 0.068, xs: 0.095 },
  0.25: { od: 0.540, std: 0.088, xs: 0.119 },
  0.375: { od: 0.675, std: 0.091, xs: 0.126 },
  0.5: { od: 0.840, std: 0.109, xs: 0.147, xxs: 0.294 },
  0.75: { od: 1.050, std: 0.113, xs: 0.154, xxs: 0.308 },
  1: { od: 1.315, std: 0.133, xs: 0.179, xxs: 0.358 },
  1.25: { od: 1.660, std: 0.140, xs: 0.191, xxs: 0.382 },
  1.5: { od: 1.900, std: 0.145, xs: 0.200, xxs: 0.400 },
  2: { od: 2.375, std: 0.154, xs: 0.218, xxs: 0.436 },
  2.5: { od: 2.875, std: 0.203, xs: 0.276, xxs: 0.552 },
  3: { od: 3.500, std: 0.216, xs: 0.300, xxs: 0.600 },
  3.5: { od: 4.000, std: 0.226, xs: 0.318 },
  4: { od: 4.500, std: 0.237, xs: 0.337, xxs: 0.674 },
  5: { od: 5.563, std: 0.258, xs: 0.375, xxs: 0.750 },
  6: { od: 6.625, std: 0.280, xs: 0.432, xxs: 0.864 },
  8: { od: 8.625, std: 0.322, xs: 0.500, xxs: 0.875, s60: 0.406, s120: 0.719 },
  10: { od: 10.750, std: 0.365, xs: 0.500, xxs: 1.000, s40: 0.365, s60: 0.500, s80: 0.594, s120: 0.844 },
  12: { od: 12.750, std: 0.375, xs: 0.500, xxs: 1.000, s40: 0.406, s60: 0.562, s80: 0.688, s120: 1.000 },
};

const PIPE_SCHEDULE_BY_CODE = {
  P40: 's40', 'P40 GALV': 's40', PS: 'std', ALPS: 's40', SSPS: 'std',
  P60: 's60', P80: 's80', PX: 'xs', XS: 'xs', P120: 's120', PXX: 'xxs', XXS: 'xxs',
};

function pipeWall(entry, schedule) {
  if (!entry) return null;
  if (schedule === 's40') return entry.s40 ?? entry.std;
  if (schedule === 's80') return entry.s80 ?? entry.xs;
  return entry[schedule] ?? null;
}

// "1 1/4", "6.0", "1/2STD", "3/4SCH40", "1/8schedule 40", "8STD" -> { nps, schedule }.
export function parsePipeSize(shapeCode, sizeValue) {
  const code = String(shapeCode || '').toUpperCase();
  const raw = String(sizeValue || '').trim();
  const m = raw.match(/^([\d./\s-]+?)\s*(STD|XXS|XS|SCH(?:EDULE)?\s*(\d+))?$/i);
  if (!m) return null;
  const nps = parseDimToken(m[1].trim());
  if (nps == null) return null;
  let schedule = PIPE_SCHEDULE_BY_CODE[code] || 'std';
  if (m[2]) {
    const tag = m[2].toUpperCase();
    schedule = tag === 'STD' ? 'std' : tag === 'XS' ? 'xs' : tag === 'XXS' ? 'xxs' : `s${m[3]}`;
  }
  const entry = PIPE_TABLE[round4(nps)];
  const wall = pipeWall(entry, schedule);
  if (!entry || wall == null) return { nps, schedule, od: null, wall: null };
  return { nps, schedule, od: entry.od, wall };
}

// --------------------------------------------------------------- weights

const fmt = (n, d = 3) => (Number.isFinite(n) ? Number(n.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d }) : '—');

// Computed lb/ft (linear) from the size's own dimensions, or null.
// Returns { perFt, formula } — formula is the text shown on drill-down.
function computedLinearWeight(code, sizeValue, material) {
  const kind = LINEAR_KIND[code];
  const rho = lbPerCuIn(material);
  if (!rho && kind !== 'crane_rail') return null;
  const tokens = splitSizeTokens(sizeValue);
  const dims = tokens.map((t) => parseDimToken(t));
  const per = (areaSqIn) => areaSqIn * 12 * rho;
  const rhoText = `${DENSITY_LB_PER_CU_FT[material]} lb/cu ft ÷ 1728 = ${fmt(rho, 5)} lb/cu in`;
  switch (kind) {
    case 'flat': {
      if (dims.length < 2 || dims[0] == null || dims[1] == null) return null;
      const a = dims[0] * dims[1];
      return { perFt: per(a), formula: `${fmt(dims[0], 4)} × ${fmt(dims[1], 4)} in = ${fmt(a, 4)} sq in × 12 in/ft × ${rhoText}`, perimeterIn: 2 * (dims[0] + dims[1]), perimeterText: `2 × (${fmt(dims[0], 4)} + ${fmt(dims[1], 4)}) in` };
    }
    case 'round':
    case 'rebar': {
      let d = dims[0];
      if (d == null) return null;
      // Rebar is listed by bar number above 1 (#3 = 3/8", #10 = 10/8").
      if (kind === 'rebar' && Number.isInteger(d) && d >= 3) d /= 8;
      if (d > 24) return null; // not a believable bar diameter
      const a = Math.PI * d * d / 4;
      return { perFt: per(a), formula: `π × ${fmt(d, 4)}² ÷ 4 = ${fmt(a, 4)} sq in × 12 in/ft × ${rhoText}${kind === 'rebar' ? ' (bar number ÷ 8 = diameter)' : ''}`, perimeterIn: Math.PI * d, perimeterText: `π × ${fmt(d, 4)} in` };
    }
    case 'square': {
      const s = dims[0];
      if (s == null) return null;
      return { perFt: per(s * s), formula: `${fmt(s, 4)}² = ${fmt(s * s, 4)} sq in × 12 in/ft × ${rhoText}`, perimeterIn: 4 * s, perimeterText: `4 × ${fmt(s, 4)} in` };
    }
    case 'rect_tube':
    case 'rect_tube_estimator': {
      if (dims.length < 3 || dims.some((v) => v == null)) return null;
      const [a, b, t] = dims;
      const area = 2 * t * (a + b) - 4 * t * t;
      return { perFt: per(area), formula: `2 × ${fmt(t, 4)} × (${fmt(a, 4)} + ${fmt(b, 4)}) − 4 × ${fmt(t, 4)}² = ${fmt(area, 4)} sq in × 12 in/ft × ${rhoText}`, perimeterIn: 2 * (a + b), perimeterText: `2 × (${fmt(a, 4)} + ${fmt(b, 4)}) in` };
    }
    case 'round_tube': {
      if (dims.length < 2 || dims[0] == null || dims[1] == null) return null;
      const [od, t] = dims;
      const area = Math.PI * (od - t) * t;
      return { perFt: per(area), formula: `π × (${fmt(od, 4)} − ${fmt(t, 4)}) × ${fmt(t, 4)} = ${fmt(area, 4)} sq in × 12 in/ft × ${rhoText}`, perimeterIn: Math.PI * od, perimeterText: `π × ${fmt(od, 4)} in OD` };
    }
    case 'pipe': {
      const p = parsePipeSize(code, sizeValue);
      if (!p || p.od == null) return null;
      const area = Math.PI * (p.od - p.wall) * p.wall;
      return { perFt: per(area), formula: `NPS ${fmt(p.nps, 3)} ${p.schedule.toUpperCase()}: OD ${p.od}, wall ${p.wall} → π × (${p.od} − ${p.wall}) × ${p.wall} = ${fmt(area, 4)} sq in × 12 in/ft × ${rhoText}`, perimeterIn: Math.PI * p.od, perimeterText: `π × ${p.od} in OD` };
    }
    case 'angle': {
      if (dims.length < 3 || dims.some((v) => v == null)) return null;
      const [a, b, t] = dims;
      const area = (a + b - t) * t;
      return { perFt: per(area), formula: `(${fmt(a, 4)} + ${fmt(b, 4)} − ${fmt(t, 4)}) × ${fmt(t, 4)} = ${fmt(area, 4)} sq in × 12 in/ft × ${rhoText}` };
    }
    case 'crane_rail': {
      const lbPerYd = dims[0];
      if (lbPerYd == null) return null;
      return { perFt: lbPerYd / 3, formula: `${fmt(lbPerYd, 2)} lb/yd ÷ 3 ft/yd` };
    }
    default:
      return null;
  }
}

// The existing estimator (steelShapeSelector.js), fed a 5-class shape and a
// compact profile. Only for codes whose size it can actually read: W-like
// and channel designations carry their lb/ft; L and HSS use its girth x
// thickness approximation. Gauge thicknesses are skipped (it would read
// "16ga" as 16 inches).
function estimatorWeight(code, sizeValue) {
  const kind = LINEAR_KIND[code];
  const tokens = splitSizeTokens(sizeValue);
  if (tokens.some(isGaugeToken)) return null;
  // Every token but the last becomes a decimal so the estimator's
  // digits-only regex can read it (3/4 -> 0.75); the last (thickness or
  // lb/ft) stays as typed — its fraction parser handles 3/8.
  const decimalized = tokens.map((t, i) => {
    if (i === tokens.length - 1) return compactToken(t);
    const v = parseDimToken(t);
    return v == null ? compactToken(t) : String(round4(v));
  });
  let cls = null;
  let prefix = code;
  if (kind === 'designation_w' || kind === 'designation_tee') { cls = 'W-Beam'; prefix = 'W'; }
  else if (kind === 'designation_c') { cls = 'C-Channel'; prefix = 'C'; }
  else if (kind === 'angle_estimator') { cls = 'L-Angle'; prefix = 'L'; }
  else if (kind === 'rect_tube_estimator') { cls = 'HSS Tube'; prefix = 'HSS'; }
  if (!cls) return null;
  const profile = `${prefix}${decimalized.join('X')}`.toUpperCase();
  const perFt = estimateWeightPerFt(cls, profile);
  if (!(perFt > 0)) return null;
  const how = cls === 'W-Beam' || cls === 'C-Channel'
    ? `lb/ft read from the designation (${profile})`
    : cls === 'L-Angle' ? `(leg + leg) × thickness × 3.4 for ${profile}` : `(2 × width + 2 × height) × wall × 3.4 for ${profile}`;
  return { perFt, formula: `AISC estimator: ${how}` };
}

// AISC Shapes Database v16.0 row for a master-catalog size, or null. Pipe
// codes go through their nominal size + schedule.
function aiscShapeFor(code, sizeValue) {
  if (LINEAR_KIND[code] === 'pipe') {
    const p = parsePipeSize(code, sizeValue);
    return p ? findAiscPipe(p.nps, p.schedule) : null;
  }
  return findAiscShapeForCatalog(code, sizeValue);
}

function aiscWeight(shape) {
  return shape?.weightPerFt > 0 ? { perFt: shape.weightPerFt, formula: `${shape.source} ${shape.label}: ${shape.weightPerFt} lb/ft` } : null;
}

function catalogWeight(profile, catalogRows) {
  const key = profileKey(profile);
  const match = (catalogRows || []).find((c) => c.weight_per_ft != null && Number(c.weight_per_ft) > 0 && profileKey(c.size_designation) === key);
  return match ? { perFt: Number(match.weight_per_ft), formula: `steel_catalog ${match.size_designation}: ${match.weight_per_ft} lb/ft`, catalogId: match.id } : null;
}

// Surface perimeter (in) for a linear row: steelShapeMath where it has a
// formula (W, C, L, HSS — fed a synthesized profile), otherwise the
// computed-family perimeter. null when nothing applies.
function linearSurface(code, sizeValue, lengthFt, qty, catalogRows, computed, aisc) {
  const kind = LINEAR_KIND[code];
  if (aisc?.perimeterIn > 0) {
    return { sqIn: aisc.perimeterIn * lengthFt * 12 * qty, perimeterIn: aisc.perimeterIn, text: `${aisc.source} ${aisc.label} perimeter (${aisc.perimeterBasis})` };
  }
  const dims = splitSizeTokens(sizeValue).map((t) => parseDimToken(t));
  // calculateSteelSurfaceArea(profile, 1/12 ft, 1 pc) = that profile's
  // perimeter in inches (perimeter × 1 in × 1).
  const shapeMath = (profile, factor = 1, note = '') => {
    const perimeterIn = calculateSteelSurfaceArea(profile, 1 / 12, 1, catalogRows) * factor;
    return { sqIn: perimeterIn * lengthFt * 12 * qty, perimeterIn, text: `steelShapeMath perimeter for ${profile}${note}` };
  };
  if (kind === 'designation_w' && dims[0] != null) return shapeMath(`W${dims[0]}X${dims[1] ?? 0}`);
  if (kind === 'designation_tee' && dims[0] != null) return shapeMath(`W${dims[0] * 2}X1`, 0.5, ' (half of a W twice as deep)');
  if (kind === 'designation_c' && dims[0] != null) return shapeMath(`C${dims[0]}X${dims[1] ?? 0}`);
  if ((kind === 'angle_estimator' || kind === 'angle') && dims[0] != null && dims[1] != null) return shapeMath(`L${round4(dims[0])}X${round4(dims[1])}`);
  if (kind === 'rect_tube_estimator' && dims[0] != null && dims[1] != null) return shapeMath(`HSS${round4(dims[0])}X${round4(dims[1])}`);
  if (computed?.perimeterIn) {
    const sq = computed.perimeterIn * lengthFt * 12 * qty;
    return { sqIn: sq, perimeterIn: computed.perimeterIn, text: computed.perimeterText };
  }
  return null;
}

/**
 * Resolves one catalog row. `row` fields: shape_code, size_value, grade,
 * length_in, width_in, thickness_in (plate, defaults from the size),
 * quantity, coating_type, weight_override (+ unit implied by family).
 * `shapeType` is the MaterialShapeType record (category drives density).
 */
export function calcCatalogRow(row, { shapeType, catalogRows = [] } = {}) {
  const code = String(row?.shape_code || shapeType?.shape_code || '').toUpperCase();
  const family = entryFamily(code, shapeType?.category);
  const material = materialFor(shapeType || { shape_code: code });
  const qty = Number(row?.quantity) || 0;
  const sizeValue = row?.size_value || '';
  const override = Number(row?.weight_override);
  const hasOverride = row?.weight_override !== '' && row?.weight_override != null && Number.isFinite(override) && override > 0;
  const hoursPerTon = hoursPerTonFor(code, family);
  const result = {
    family, code, material, qty, hoursPerTon, hoursClass: hoursClassFor(code, family),
    lengthIn: 0, lengthFt: 0, widthIn: 0, thicknessIn: null,
    weightUnit: family === 'linear' ? 'lb/ft' : family === 'plate' ? 'lb/sq ft' : 'lb/ea',
    unitWeight: null, weightSource: 'missing', weightFormula: '', needsWeight: false,
    totalLbs: 0, tons: 0, plateAreaSqIn: 0, surfaceSqIn: null, surfaceText: '', paintAreaSqIn: 0,
    profile: '', steps: {},
  };

  if (family === 'each') {
    result.profile = `${code} ${sizeValue}`.trim();
    if (hasOverride) {
      result.unitWeight = override;
      result.weightSource = 'override';
      result.weightFormula = `Typed on the row: ${override} lb/ea`;
    } else {
      result.needsWeight = true;
      result.weightFormula = 'No weight per each on file — type one on the row.';
    }
    result.totalLbs = (result.unitWeight || 0) * qty;
    result.tons = result.totalLbs / 2000;
    result.steps = {
      weight: [result.weightFormula, `${fmt(result.unitWeight || 0, 3)} lb/ea × ${qty} ea = ${fmt(result.totalLbs, 2)} lb`],
      tons: [`${fmt(result.totalLbs, 2)} lb ÷ 2000 = ${fmt(result.tons, 4)} tons`],
    };
    return result;
  }

  if (family === 'plate') {
    const sizeTokens = splitSizeTokens(sizeValue);
    const gaugeAware = { bareIntegerIsGauge: GAUGE_SHEET_CODES.has(code) };
    const sizeThickness = parseDimToken(sizeTokens[0], gaugeAware);
    const thickness = Number(row?.thickness_in) > 0 ? Number(row.thickness_in) : sizeThickness;
    const widthIn = Number(row?.width_in) || 0;
    const lengthIn = Number(row?.length_in) || 0;
    result.thicknessIn = thickness ?? null;
    result.widthIn = widthIn;
    result.lengthIn = lengthIn;
    result.lengthFt = lengthIn / 12;
    result.profile = compactProfile(code, sizeValue, { widthIn });
    const pieceArea = widthIn * lengthIn;
    result.plateAreaSqIn = pieceArea * qty;
    const solid = !PLATE_NOT_SOLID.has(code) && material && thickness > 0;
    if (hasOverride) {
      result.unitWeight = override;
      result.weightSource = 'override';
      result.weightFormula = `Typed on the row: ${override} lb/sq ft`;
      result.totalLbs = override * (result.plateAreaSqIn / 144);
    } else if (solid) {
      const rho = lbPerCuIn(material);
      result.unitWeight = thickness * rho * 144;
      result.weightSource = 'computed';
      result.weightFormula = `${fmt(thickness, 4)} in thick × ${DENSITY_LB_PER_CU_FT[material]} lb/cu ft ÷ 1728 = ${fmt(thickness * rho, 5)} lb/sq in (${fmt(result.unitWeight, 3)} lb/sq ft)${code === 'CP' || code === 'FP' || code === 'ALCP' ? ' — base thickness, raised pattern not counted' : ''}`;
      result.totalLbs = result.plateAreaSqIn * thickness * rho;
    } else {
      result.needsWeight = true;
      result.weightFormula = PLATE_NOT_SOLID.has(code)
        ? 'Grating / deck / expanded metal / copper isn\'t solid steel plate — type its lb/sq ft on the row.'
        : 'No thickness could be read from the size — type a thickness or a lb/sq ft on the row.';
    }
    result.tons = result.totalLbs / 2000;
    const edges = thickness > 0 ? 2 * (widthIn + lengthIn) * thickness : 0;
    result.surfaceSqIn = (2 * pieceArea + edges) * qty;
    result.surfaceText = `(2 faces × ${fmt(widthIn, 4)} × ${fmt(lengthIn, 4)} + edges 2 × (${fmt(widthIn, 4)} + ${fmt(lengthIn, 4)}) × ${fmt(thickness || 0, 4)}) × ${qty} pcs`;
    result.steps = {
      plateArea: [`${fmt(widthIn, 4)} in wide × ${fmt(lengthIn, 4)} in long = ${fmt(pieceArea, 2)} sq in each`, `${fmt(pieceArea, 2)} × ${qty} pcs = ${fmt(result.plateAreaSqIn, 2)} sq in`],
      weight: [result.weightFormula, result.needsWeight ? 'Weight needed — not counted in tons.' : `${fmt(result.plateAreaSqIn, 2)} sq in × ${result.weightSource === 'override' ? `${override} lb/sq ft ÷ 144` : `${fmt(thickness, 4)} in × ${fmt(lbPerCuIn(material), 5)} lb/cu in`} = ${fmt(result.totalLbs, 3)} lb`],
      tons: [`${fmt(result.totalLbs, 3)} lb ÷ 2000 = ${fmt(result.tons, 4)} tons`],
      surface: [result.surfaceText, `= ${fmt(result.surfaceSqIn, 1)} sq in`],
    };
    result.paintAreaSqIn = row?.coating_type === 'Paint' ? result.surfaceSqIn : 0;
    return result;
  }

  // linear
  const lengthIn = Number(row?.length_in) || 0;
  result.lengthIn = lengthIn;
  result.lengthFt = lengthIn / 12;
  result.profile = compactProfile(code, sizeValue);
  const computed = material ? computedLinearWeight(code, sizeValue, material) : null;
  // Aluminum / stainless angles and pipe share sizes with carbon shapes but
  // not their weights, so the AISC table is carbon steel only.
  const aisc = material === 'carbon' ? aiscShapeFor(code, sizeValue) : null;
  let w = null;
  if (hasOverride) {
    w = { perFt: override, formula: `Typed on the row: ${override} lb/ft`, source: 'override' };
  } else {
    // Order: a company's own steel_catalog weight, then the AISC table
    // (exact), then the size's own dimensions, then the rough estimator.
    const fromCatalog = catalogWeight(result.profile, catalogRows);
    const fromAisc = fromCatalog ? null : aiscWeight(aisc);
    const fromEstimator = fromCatalog || fromAisc || computed ? null : estimatorWeight(code, sizeValue);
    if (fromCatalog) w = { ...fromCatalog, source: 'catalog' };
    else if (fromAisc) w = { ...fromAisc, source: 'aisc' };
    else if (computed) w = { perFt: computed.perFt, formula: computed.formula, source: 'computed' };
    else if (fromEstimator) w = { ...fromEstimator, source: 'aisc_estimate' };
  }
  if (w) {
    result.unitWeight = w.perFt;
    result.weightSource = w.source;
    result.weightFormula = w.formula;
    if (w.catalogId) result.catalogId = w.catalogId;
  } else {
    result.needsWeight = true;
    result.weightFormula = 'No catalog weight, estimator or dimension formula for this size — type its lb/ft on the row.';
  }
  result.totalLbs = (result.unitWeight || 0) * result.lengthFt * qty;
  result.tons = result.totalLbs / 2000;
  const surface = linearSurface(code, sizeValue, result.lengthFt, qty, catalogRows, computed, aisc);
  if (surface) {
    result.surfaceSqIn = surface.sqIn;
    result.surfaceText = `${surface.text}: ${fmt(surface.perimeterIn, 3)} in × ${fmt(lengthIn, 4)} in long × ${qty} pcs`;
  } else {
    result.surfaceText = 'No perimeter formula for this shape.';
  }
  result.paintAreaSqIn = row?.coating_type === 'Paint' ? (result.surfaceSqIn || 0) : 0;
  result.steps = {
    weight: [result.weightFormula, result.needsWeight ? 'Weight needed — not counted in tons.' : `${fmt(result.unitWeight, 3)} lb/ft × ${fmt(result.lengthFt, 4)} ft × ${qty} pcs = ${fmt(result.totalLbs, 3)} lb`],
    tons: [`${fmt(result.totalLbs, 3)} lb ÷ 2000 = ${fmt(result.tons, 4)} tons`],
    surface: [result.surfaceText, result.surfaceSqIn == null ? '—' : `= ${fmt(result.surfaceSqIn, 1)} sq in`],
  };
  return result;
}

// The old FullTakeoff rowCalc, unchanged (estimateWeightPerFt on the 5-class
// shape + material_size; paint area only when coated Paint), plus the
// display-only lb / surface / plate-strip area this grid now shows. Tons
// and paintAreaSqIn are exactly what the old grid saved.
export function calcLegacyRow(row, catalogRows = []) {
  const lengthFt = Number(row?.length_ft) || 0;
  const weightPerFt = estimateWeightPerFt(row?.shape_class, row?.material_size);
  const qty = Number(row?.quantity) || 0;
  const tonsPerPiece = lengthFt && weightPerFt ? (lengthFt * weightPerFt) / 2000 : 0;
  const totalTons = tonsPerPiece * qty;
  const surfaceSqIn = calculateSteelSurfaceArea(row?.material_size, lengthFt, qty, catalogRows);
  const paintAreaSqIn = row?.coating_type === 'Paint' ? surfaceSqIn : 0;
  let plateAreaSqIn = 0;
  if (row?.shape_class === 'PL-Plate') {
    const m = String(row?.material_size || '').toUpperCase().match(/^PL[\d./-]*X(\d+(?:\.\d+)?)/);
    plateAreaSqIn = m ? Number(m[1]) * lengthFt * 12 * qty : 0;
  }
  const totalLbs = totalTons * 2000;
  return {
    legacy: true, family: 'linear', lengthFt, lengthIn: lengthFt * 12, weightPerFt, unitWeight: weightPerFt, weightUnit: 'lb/ft',
    weightSource: weightPerFt > 0 ? 'aisc_estimate' : 'missing', needsWeight: !(weightPerFt > 0),
    tonsPerPiece, totalTons, tons: totalTons, totalLbs, paintAreaSqIn, surfaceSqIn, plateAreaSqIn, qty,
    hoursPerTon: getShapeClass(row?.shape_class).hoursPerTon || 0,
    steps: {
      weight: [`AISC estimator on ${row?.shape_class} ${row?.material_size}: ${fmt(weightPerFt, 3)} lb/ft`, `${fmt(weightPerFt, 3)} lb/ft × ${fmt(lengthFt, 4)} ft × ${qty} pcs = ${fmt(totalLbs, 3)} lb`],
      tons: [`${fmt(lengthFt, 4)} ft × ${fmt(weightPerFt, 3)} lb/ft ÷ 2000 = ${fmt(tonsPerPiece, 4)} tons/pc`, `× ${qty} pcs = ${fmt(totalTons, 4)} tons`],
      surface: [`steelShapeMath perimeter for ${row?.material_size} × ${fmt(lengthFt * 12, 2)} in × ${qty} pcs`, `= ${fmt(surfaceSqIn, 1)} sq in${row?.coating_type === 'Paint' ? ' (counted as paint area)' : ''}`],
      plateArea: row?.shape_class === 'PL-Plate' ? [`strip width from ${row?.material_size} × ${fmt(lengthFt * 12, 2)} in × ${qty} pcs = ${fmt(plateAreaSqIn, 1)} sq in`] : undefined,
    },
  };
}

// Default grade per family, then matched (ignoring case, spaces, dashes,
// dots and a leading "*") against the shape's own catalog grades so the
// catalog's spelling is used when it has the grade. Falls back to the
// catalog's starred default, else blank.
const DEFAULT_GRADE_BY_CODE = {
  W: 'A992', WT: 'A992', HP: 'A992',
  L: 'A36', LG: 'A36', C: 'A36', MC: 'A36', PL: 'A36', FB: 'A36', BAR: 'A36', RD: 'A36', SQ: 'A36', SQBR: 'A36', ROD: 'A36', CP: 'A36', FP: 'A36', PLGA: 'A36', UM: 'A36', S: 'A36', M: 'A36', MT: 'A36', ST: 'A36',
  HSS: 'A500 Gr C', HSSR: 'A500 Gr C', DTS: 'A500 Gr C',
  P40: 'A53 Gr B', 'P40 GALV': 'A53 Gr B', P60: 'A53 Gr B', P80: 'A53 Gr B', P120: 'A53 Gr B', PIPE: 'A53 Gr B', PS: 'A53 Gr B', PX: 'A53 Gr B', PXX: 'A53 Gr B', XS: 'A53 Gr B', XXS: 'A53 Gr B',
};
export const cleanGrade = (g) => String(g ?? '').replace(/^\*/, '').trim();
const gradeKey = (g) => cleanGrade(g).toUpperCase().replace(/[\s.\-_]+/g, '');

export function defaultGradeFor(shapeCode, catalogGrades = []) {
  const wanted = DEFAULT_GRADE_BY_CODE[String(shapeCode || '').toUpperCase()];
  if (wanted) {
    const hit = catalogGrades.find((g) => gradeKey(g) === gradeKey(wanted));
    return hit ? cleanGrade(hit) : wanted;
  }
  const starred = catalogGrades.find((g) => String(g).startsWith('*'));
  return starred ? cleanGrade(starred) : '';
}

export const WEIGHT_SOURCE_LABELS = {
  catalog: 'Steel catalog',
  aisc: 'AISC v16.0',
  aisc_estimate: 'AISC estimate',
  computed: 'Computed',
  override: 'Typed',
  missing: 'Weight needed',
};
