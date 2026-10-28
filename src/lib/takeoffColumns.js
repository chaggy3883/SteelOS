// Custom takeoff columns for IRONSIGHT — the column model a tool set
// (takeoff_tool_sets.columns) and a takeoff session can both carry, plus the
// math that turns one markup row into column values.
//
// Column shape:
//   { id, name, alias, type, choices, decimals, formula, default, unit }
//   type: 'text' | 'number' | 'date' | 'choice' | 'checkbox' | 'formula'
//   alias: the identifier formulas use (e.g. WtPerFt) — unique per column
//          list, case-insensitive, and never a built-in field name.
//
// Per-markup values for non-formula columns are expected on the markup row
// as `column_values: { [column.id]: value }` (alias keys are accepted as a
// fallback for imported data). Formula columns are never stored — they're
// recomputed from built-in fields + other columns every time.
//
// Pure module: no React, no '@/' imports, so it runs under plain node for
// the self-check at the bottom.

import { evaluateFormula, getFormulaReferences, parseFormula, RESERVED_WORDS } from './takeoffFormula.js';

export const COLUMN_TYPES = [
  { value: 'text', label: 'Text', help: 'Free typing — a note, a mark number, a drawing reference.' },
  { value: 'number', label: 'Number', help: 'A number you type in, e.g. a connection count or a waste factor.' },
  { value: 'date', label: 'Date', help: 'A calendar date, e.g. when the item was field-verified.' },
  { value: 'choice', label: 'Pick list', help: 'One value picked from a list you define, e.g. Galv / Painted / Bare.' },
  { value: 'checkbox', label: 'Checkbox', help: 'Yes/no. Counts as 1 or 0 inside a formula.' },
  { value: 'formula', label: 'Formula', help: 'Calculated from other columns, e.g. Length * WtPerFt * Qty / 2000.' },
];

// Values every markup exposes to formulas without anyone creating a column.
export const BUILT_IN_FIELDS = [
  { alias: 'Length', label: 'Length', unit: 'ft', help: 'Measured length (plan length for sloped items). For a count, the per-piece length set on the tool.' },
  { alias: 'TrueLength', label: 'True length', unit: 'ft', help: 'Length corrected for Slope (Length ÷ cos(Slope)). Same as Length when Slope is 0.' },
  { alias: 'Area', label: 'Area', unit: 'sq ft', help: 'Measured area, with cutouts already subtracted.' },
  { alias: 'Perimeter', label: 'Perimeter', unit: 'ft', help: 'Outline length of an area markup.' },
  { alias: 'Depth', label: 'Depth', unit: 'ft', help: 'Depth/thickness set on the tool (used for volume).' },
  { alias: 'Volume', label: 'Volume', unit: 'cu ft', help: 'Volume of a volume markup (Area × Depth).' },
  { alias: 'CuYd', label: 'Cubic yards', unit: 'cu yd', help: 'Volume ÷ 27.' },
  { alias: 'Count', label: 'Count', unit: 'ea', help: 'Number of count marks (1 for a length or area markup).' },
  { alias: 'Qty', label: 'Quantity', unit: 'ea', help: 'Pieces this markup stands for (Count for count markups).' },
  { alias: 'Slope', label: 'Slope', unit: '°', help: 'Slope angle in degrees from horizontal, e.g. a stair stringer.' },
  { alias: 'WtPerFt', label: 'Weight per foot', unit: 'lb/ft', help: 'From the AISC catalog for the tool\'s shape/size, or typed in.' },
  { alias: 'Weight', label: 'Weight', unit: 'lb', help: 'TrueLength × WtPerFt × Qty unless the markup carries its own weight.' },
  { alias: 'Tons', label: 'Tons', unit: 'tn', help: 'Weight ÷ 2000.' },
];

export const BUILT_IN_ALIASES = BUILT_IN_FIELDS.map((f) => f.alias);

const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_ALIAS_LENGTH = 40;

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** "weight per foot" → "WeightPerFoot"; "2nd coat" → "C2ndCoat". */
export function aliasFromName(name, takenAliases = []) {
  const words = String(name || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let base = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Column';
  if (/^[0-9]/.test(base)) base = `C${base}`;
  base = base.slice(0, MAX_ALIAS_LENGTH - 3);
  const taken = new Set([...takenAliases, ...BUILT_IN_ALIASES, ...RESERVED_WORDS].map((a) => String(a).toLowerCase()));
  let alias = base;
  let n = 2;
  while (taken.has(alias.toLowerCase())) { alias = `${base}${n}`; n += 1; }
  return alias;
}

/** New column with every field present. `partial.alias` is derived from the name when omitted. */
export function createColumn(partial = {}, existingColumns = []) {
  const type = COLUMN_TYPES.some((t) => t.value === partial.type) ? partial.type : 'text';
  const name = String(partial.name ?? '').trim() || 'New column';
  return {
    id: partial.id || newId(),
    name,
    alias: partial.alias ? String(partial.alias).trim() : aliasFromName(name, existingColumns.map((c) => c.alias)),
    type,
    choices: Array.isArray(partial.choices) ? partial.choices.map((c) => String(c).trim()).filter(Boolean) : [],
    decimals: Number.isInteger(partial.decimals) ? Math.min(Math.max(partial.decimals, 0), 6) : (type === 'number' || type === 'formula' ? 2 : 0),
    formula: type === 'formula' ? String(partial.formula ?? '') : '',
    default: partial.default ?? (type === 'checkbox' ? false : null),
    unit: partial.unit ? String(partial.unit) : '',
  };
}

/** Normalizes possibly-incomplete column objects (imported JSON, older rows). */
export function normalizeColumns(columns = []) {
  const out = [];
  (Array.isArray(columns) ? columns : []).forEach((c) => {
    if (c && typeof c === 'object') out.push(createColumn(c, out));
  });
  return out;
}

/** Coerce a raw stored/typed value into the column's type. */
export function coerceColumnValue(column, raw) {
  if (!column) return raw ?? null;
  switch (column.type) {
    case 'number': {
      if (raw === '' || raw == null) return null;
      const n = Number(String(raw).replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    case 'checkbox':
      if (typeof raw === 'string') return ['true', 'yes', 'y', '1', 'x'].includes(raw.trim().toLowerCase());
      return Boolean(raw);
    case 'date': {
      if (!raw) return null;
      const s = String(raw);
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
    }
    case 'choice':
      return raw == null || raw === '' ? null : String(raw);
    case 'formula':
      return null;
    default:
      return raw == null ? '' : String(raw);
  }
}

/**
 * Built-in field values for one markup row (accepted_items shape:
 * tool, quantity, points, length_ft, area_sq_ft, unit_weight_lbs_per_ft ...).
 * Also reads the measurement engine's fields (takeoffGeometry.js): plan_length_ft,
 * slope / slope_factor (length_ft already slope-corrected), volume_cu_ft/_yd,
 * depth_ft — plus optional slope_deg, perimeter_ft, weight_lbs.
 * @param {object} item
 * @param {{ weightLookup?: (item) => number|null, tool?: object }} [opts]
 *   weightLookup resolves AISC weight/ft when the row has none (e.g. wrap
 *   steelShapeSelector's estimateWeightPerFt); `tool` is the tool-set tool the
 *   row came from, used for defaults (slope_deg, depth_ft, typical_length_ft).
 */
// Drawn-measurement kinds (matches takeoffGeometry.js MEASURE_TOOLS): only
// count and length-kind rows carry steel weight; area/volume/angle never do.
export const LENGTH_KINDS = ['length', 'polylength', 'perimeter', 'radius', 'diameter'];
export const AREA_KINDS = ['area', 'wall_area'];

/** Slope in degrees from a row's `slope` object ({ mode: 'pitch', rise, run } | { mode: 'degrees', degrees }). */
export function slopeToDegrees(slope) {
  if (!slope) return 0;
  if (slope.mode === 'degrees') return num(slope.degrees, 0);
  if (slope.mode === 'pitch' && num(slope.run, 0) > 0) return (Math.atan(num(slope.rise, 0) / num(slope.run, 1)) * 180) / Math.PI;
  return 0;
}

export function getBuiltInFieldValues(item = {}, opts = {}) {
  const tool = opts.tool || {};
  const kind = item.tool || tool.tool;
  const isCount = kind === 'count' || kind === 'bolt_count';
  const countMarks = Array.isArray(item.points) && item.points.length ? item.points.length : num(item.quantity, 0);
  const Count = isCount ? countMarks : 1;
  const Qty = isCount ? countMarks : (num(item.quantity, 1) || 1);
  let Length;
  let TrueLength;
  let Slope;
  if (!isCount && (item.slope_factor != null || item.slope != null || item.plan_length_ft != null)) {
    // Measurement-engine rows: length_ft is ALREADY slope-corrected
    // (length_ft = plan_length_ft × slope_factor), so don't apply slope twice.
    TrueLength = num(item.length_ft, 0);
    Length = item.plan_length_ft != null ? num(item.plan_length_ft, 0) : TrueLength / (num(item.slope_factor, 1) || 1);
    Slope = slopeToDegrees(item.slope);
  } else {
    Length = num(item.length_ft, 0) || (isCount ? num(tool.typical_length_ft, 0) : 0);
    Slope = isCount ? 0 : num(item.slope_deg ?? tool.slope_deg, 0);
    const cos = Math.cos((Slope * Math.PI) / 180);
    TrueLength = Slope && Math.abs(cos) > 1e-9 ? Length / cos : Length;
  }
  const Area = num(item.area_sq_ft, 0);
  const Perimeter = item.perimeter_ft != null ? num(item.perimeter_ft, 0) : (kind === 'perimeter' ? TrueLength : 0);
  const Depth = num(item.depth_ft ?? tool.depth_ft, 0);
  const Volume = item.volume_cu_ft != null ? num(item.volume_cu_ft, 0) : item.volume_cu_yd != null ? num(item.volume_cu_yd, 0) * 27 : Area * Depth;
  let WtPerFt = num(item.unit_weight_lbs_per_ft, 0);
  if (!WtPerFt && typeof opts.weightLookup === 'function') WtPerFt = num(opts.weightLookup(item, tool), 0);
  const weighable = isCount || LENGTH_KINDS.includes(kind) || !kind;
  const Weight = item.weight_lbs != null && Number.isFinite(Number(item.weight_lbs)) ? Number(item.weight_lbs) : (weighable ? TrueLength * WtPerFt * Qty : 0);
  return { Length, TrueLength, Area, Perimeter, Depth, Volume, CuYd: Volume / 27, Count, Qty, Slope, WtPerFt, Weight, Tons: Weight / 2000 };
}

const formulaColumnOrder = (columns) => {
  // Kahn topological sort over formula → formula dependencies. Anything left
  // over is part of (or depends on) a cycle.
  const formulas = columns.filter((c) => c.type === 'formula');
  const byAlias = new Map(formulas.map((c) => [c.alias.toLowerCase(), c]));
  const deps = new Map(formulas.map((c) => [c.id, getFormulaReferences(c.formula).map((r) => byAlias.get(r.toLowerCase())).filter(Boolean)]));
  const ordered = [];
  const done = new Set();
  let progressed = true;
  while (progressed) {
    progressed = false;
    formulas.forEach((c) => {
      if (done.has(c.id)) return;
      if (deps.get(c.id).every((d) => done.has(d.id))) {
        ordered.push(c);
        done.add(c.id);
        progressed = true;
      }
    });
  }
  return { ordered, cyclic: formulas.filter((c) => !done.has(c.id)) };
};

/**
 * Validate a column list (a tool set's, or a session's merged list).
 * @returns {{ ok: boolean, errors: Array<{ columnId, field, message }> }}
 */
export function validateColumns(columns = []) {
  const errors = [];
  const seen = new Map();
  const builtIns = new Set(BUILT_IN_ALIASES.map((a) => a.toLowerCase()));
  const reserved = new Set(RESERVED_WORDS.map((a) => a.toLowerCase()));
  columns.forEach((c) => {
    const alias = String(c.alias || '');
    const key = alias.toLowerCase();
    if (!String(c.name || '').trim()) errors.push({ columnId: c.id, field: 'name', message: 'Give the column a name.' });
    if (!alias) errors.push({ columnId: c.id, field: 'alias', message: 'The formula name can\'t be blank.' });
    else if (!ALIAS_PATTERN.test(alias)) errors.push({ columnId: c.id, field: 'alias', message: `"${alias}" can only use letters, numbers and _ and can't start with a number.` });
    else if (alias.length > MAX_ALIAS_LENGTH) errors.push({ columnId: c.id, field: 'alias', message: `Keep the formula name under ${MAX_ALIAS_LENGTH} characters.` });
    else if (builtIns.has(key)) errors.push({ columnId: c.id, field: 'alias', message: `"${alias}" is already a built-in value — pick another name.` });
    else if (reserved.has(key)) errors.push({ columnId: c.id, field: 'alias', message: `"${alias}" is a formula function name — pick another name.` });
    else if (seen.has(key)) errors.push({ columnId: c.id, field: 'alias', message: `"${alias}" is used by another column ("${seen.get(key).name}").` });
    if (alias) seen.set(key, c);
    if (c.type === 'choice' && !(c.choices || []).length) errors.push({ columnId: c.id, field: 'choices', message: 'Add at least one choice to the pick list.' });
    if (c.type === 'choice' && new Set((c.choices || []).map((x) => x.toLowerCase())).size !== (c.choices || []).length) {
      errors.push({ columnId: c.id, field: 'choices', message: 'The pick list has the same choice twice.' });
    }
  });
  const available = [...BUILT_IN_ALIASES, ...columns.map((c) => c.alias).filter(Boolean)];
  const availableSet = new Set(available.map((a) => a.toLowerCase()));
  columns.filter((c) => c.type === 'formula').forEach((c) => {
    if (!String(c.formula || '').trim()) { errors.push({ columnId: c.id, field: 'formula', message: 'Enter a formula, e.g. Length * WtPerFt * Qty.' }); return; }
    const parsed = parseFormula(c.formula);
    if (parsed.error) { errors.push({ columnId: c.id, field: 'formula', message: parsed.error }); return; }
    const refs = getFormulaReferences(c.formula);
    const unknown = refs.filter((r) => !availableSet.has(r.toLowerCase()));
    if (unknown.length) errors.push({ columnId: c.id, field: 'formula', message: `Unknown name${unknown.length > 1 ? 's' : ''} ${unknown.map((u) => `"${u}"`).join(', ')}. You can use: ${available.join(', ')}.` });
    if (refs.some((r) => r.toLowerCase() === String(c.alias).toLowerCase())) errors.push({ columnId: c.id, field: 'formula', message: 'A formula can\'t use its own column.' });
  });
  const { cyclic } = formulaColumnOrder(columns);
  cyclic.forEach((c) => {
    if (!errors.some((e) => e.columnId === c.id && e.field === 'formula')) {
      errors.push({ columnId: c.id, field: 'formula', message: `"${c.name}" is part of a loop — two formulas use each other.` });
    }
  });
  return { ok: errors.length === 0, errors };
}

/**
 * All column values for one markup row.
 * @param {object} item markup row (accepted_items shape + column_values)
 * @param {Array} columns column definitions
 * @param {{ builtIns?: object, weightLookup?: Function, tool?: object }} [opts]
 *   tool.default_values ({ [columnId]: value }) fills columns the row hasn't set.
 * @returns {{ values: Record<string, any>, errors: Record<string, string>, builtIns: object }}
 *   values/errors keyed by column alias; values also include the built-ins.
 */
export function computeColumnValues(item = {}, columns = [], opts = {}) {
  const builtIns = opts.builtIns || getBuiltInFieldValues(item, opts);
  const stored = item.column_values || {};
  const toolDefaults = opts.tool?.default_values || {};
  const scope = { ...builtIns };
  const values = { ...builtIns };
  const errors = {};
  columns.forEach((c) => {
    if (c.type === 'formula') return;
    let raw = stored[c.id];
    if (raw === undefined) raw = stored[c.alias];
    if (raw === undefined) raw = toolDefaults[c.id] ?? toolDefaults[c.alias];
    if (raw === undefined) raw = c.default;
    const v = coerceColumnValue(c, raw);
    values[c.alias] = v;
    scope[c.alias] = c.type === 'checkbox' ? (v ? 1 : 0) : (c.type === 'number' ? (v ?? 0) : (v ?? ''));
  });
  const { ordered, cyclic } = formulaColumnOrder(columns);
  ordered.forEach((c) => {
    const { value, error } = evaluateFormula(c.formula, scope);
    values[c.alias] = error ? null : value;
    if (error) errors[c.alias] = error;
    scope[c.alias] = error ? { value: null, error } : value;
  });
  cyclic.forEach((c) => {
    values[c.alias] = null;
    errors[c.alias] = `"${c.name}" is part of a loop — two formulas use each other.`;
  });
  return { values, errors, builtIns };
}

/** Sum a numeric/formula/checkbox column (by alias) across already-computed rows. */
export function sumColumn(computedRows, alias) {
  return computedRows.reduce((s, r) => {
    const v = r?.values?.[alias];
    return s + (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? Number(v) : 0);
  }, 0);
}

/** Display text for a value in a column (decimals applied to numbers). */
export function formatColumnValue(column, value) {
  if (value == null || value === '') return '';
  if (column?.type === 'checkbox') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    const d = Number.isInteger(column?.decimals) ? column.decimals : 2;
    const s = value.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    return column?.unit ? `${s} ${column.unit}` : s;
  }
  return String(value);
}

/**
 * A session's effective columns: the tool set's columns, then the session's
 * own. A session column with the same id or alias replaces the set's one
 * (so an estimator can tweak a company formula for one job).
 */
export function mergeColumns(toolSetColumns = [], sessionColumns = []) {
  const out = [...normalizeColumns(toolSetColumns)];
  normalizeColumns(sessionColumns).forEach((sc) => {
    const idx = out.findIndex((c) => c.id === sc.id || c.alias.toLowerCase() === sc.alias.toLowerCase());
    if (idx >= 0) out[idx] = sc; else out.push(sc);
  });
  return out;
}

/** The starter Weight/Tons columns used by the built-in Structural Steel tool set. */
export function createSteelWeightColumns() {
  return [
    createColumn({ id: 'col-wt-per-ft', name: 'Wt / Ft', alias: 'UnitWt', type: 'formula', formula: 'WtPerFt', decimals: 2, unit: 'lb/ft' }),
    createColumn({ id: 'col-waste', name: 'Waste %', alias: 'WastePct', type: 'number', decimals: 1, default: 0 }),
    createColumn({ id: 'col-total-wt', name: 'Total Weight', alias: 'TotalWt', type: 'formula', formula: 'Weight * (1 + WastePct / 100)', decimals: 0, unit: 'lb' }),
    createColumn({ id: 'col-total-tons', name: 'Total Tons', alias: 'TotalTons', type: 'formula', formula: 'ROUND(TotalWt / 2000, 3)', decimals: 3, unit: 'tn' }),
  ];
}

// --------------------------------------------------------------- self-check

export function runColumnsSelfCheck() {
  const failures = [];
  let passed = 0;
  const check = (label, cond) => { if (cond) passed += 1; else failures.push(label); };
  const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-6;

  // Hand trace: W18X35 beam, 20 ft, qty 1 → 20*35*1 = 700 lb = 0.35 tn.
  const beam = { tool: 'length', length_ft: 20, quantity: 1, unit_weight_lbs_per_ft: 35 };
  const b = getBuiltInFieldValues(beam);
  check('beam weight 700', near(b.Weight, 700));
  check('beam tons 0.35', near(b.Tons, 0.35));
  check('beam Count 1', b.Count === 1);

  // Count of 6 columns, typical length 14 ft from the tool, W10X49 via lookup:
  // 14 * 49 * 6 = 4116 lb.
  const cols = { tool: 'count', points: new Array(6).fill({ pdfX: 0, pdfY: 0 }) };
  const c = getBuiltInFieldValues(cols, { tool: { typical_length_ft: 14 }, weightLookup: () => 49 });
  check('count qty 6', c.Qty === 6 && c.Count === 6);
  check('count weight 4116', near(c.Weight, 4116));

  // Stair stringer: plan 12 ft at 30° → true length 12 / cos30 = 13.8564 ft;
  // C12X20.7 → 13.8564 * 20.7 = 286.83 lb.
  const s = getBuiltInFieldValues({ tool: 'length', length_ft: 12, slope_deg: 30, unit_weight_lbs_per_ft: 20.7 });
  check('slope true length', near(s.TrueLength, 12 / Math.cos(Math.PI / 6)));
  check('slope weight', near(s.Weight, (12 / Math.cos(Math.PI / 6)) * 20.7));

  // Engine row: 6:12 pitch, plan 10 ft → length_ft 11.1803 already corrected;
  // weight must use 11.1803 (not divide by cos again): 11.1803 * 20.7 = 231.43 lb.
  const e = getBuiltInFieldValues({ tool: 'polylength', plan_length_ft: 10, length_ft: 10 * Math.sqrt(1.25), slope: { mode: 'pitch', rise: 6, run: 12 }, slope_factor: Math.sqrt(1.25), unit_weight_lbs_per_ft: 20.7 });
  check('engine slope not doubled', near(e.TrueLength, 10 * Math.sqrt(1.25)) && near(e.Length, 10) && near(e.Weight, 10 * Math.sqrt(1.25) * 20.7));
  check('pitch degrees', near(e.Slope, (Math.atan(0.5) * 180) / Math.PI));
  check('area not weighed', getBuiltInFieldValues({ tool: 'wall_area', length_ft: 30, area_sq_ft: 300, unit_weight_lbs_per_ft: 10 }).Weight === 0);
  check('volume cy', near(getBuiltInFieldValues({ tool: 'volume', volume_cu_yd: 2 }).CuYd, 2));

  // Columns: 5% waste on the 700 lb beam → 735 lb → ROUND(735/2000,3) = 0.368 (0.3675 rounds up).
  const steel = createSteelWeightColumns();
  check('steel columns valid', validateColumns(steel).ok);
  const r = computeColumnValues({ ...beam, column_values: { 'col-waste': 5 } }, steel);
  check('TotalWt 735', near(r.values.TotalWt, 735));
  check('TotalTons 0.368', near(r.values.TotalTons, 0.368));
  check('UnitWt 35', near(r.values.UnitWt, 35));
  check('no errors', Object.keys(r.errors).length === 0);

  // Tool default values fill in when the row has none: 10% → 770 lb.
  const r2 = computeColumnValues(beam, steel, { tool: { default_values: { 'col-waste': 10 } } });
  check('tool default waste', near(r2.values.TotalWt, 770));

  // Validation catches duplicates (case-insensitive), built-in clashes, loops, unknown names, empty pick lists.
  const bad = [
    createColumn({ id: 'a', name: 'A', alias: 'Paint', type: 'text' }),
    createColumn({ id: 'b', name: 'B', alias: 'PAINT', type: 'number' }),
    createColumn({ id: 'c', name: 'C', alias: 'Length', type: 'number' }),
    createColumn({ id: 'd', name: 'D', alias: 'X1', type: 'formula', formula: 'X2 + 1' }),
    createColumn({ id: 'e', name: 'E', alias: 'X2', type: 'formula', formula: 'X1 + 1' }),
    createColumn({ id: 'f', name: 'F', alias: 'Y', type: 'formula', formula: 'Nope * 2' }),
    createColumn({ id: 'g', name: 'G', alias: 'Finish', type: 'choice', choices: [] }),
  ];
  const v = validateColumns(bad);
  const has = (id, field) => v.errors.some((e) => e.columnId === id && e.field === field);
  check('dup alias', has('b', 'alias'));
  check('builtin clash', has('c', 'alias'));
  check('cycle d', has('d', 'formula') && has('e', 'formula'));
  check('unknown ref', has('f', 'formula'));
  check('empty choices', has('g', 'choices'));

  // Cycles at compute time don't throw.
  const cyc = computeColumnValues(beam, bad.slice(3, 5));
  check('cycle compute error', !!cyc.errors.X1 && cyc.values.X1 === null);

  // Error propagates to dependents with a readable message.
  const chain = [
    createColumn({ id: 'p', name: 'Per', alias: 'Per', type: 'formula', formula: 'Weight / Qty2' }),
    createColumn({ id: 'q', name: 'Qty2', alias: 'Qty2', type: 'number', default: 0 }),
    createColumn({ id: 'r', name: 'Dbl', alias: 'Dbl', type: 'formula', formula: 'Per * 2' }),
  ];
  const ch = computeColumnValues(beam, chain);
  check('div0 error', /Division by zero/.test(ch.errors.Per || ''));
  check('propagated error', /Per has its own error/.test(ch.errors.Dbl || ''));

  check('aliasFromName', aliasFromName('weight per foot') === 'WeightPerFoot' && aliasFromName('length') === 'Length2' && aliasFromName('2nd coat') === 'C2ndCoat');
  check('merge override', mergeColumns(steel, [{ id: 'x', name: 'Waste', alias: 'wastepct', type: 'number', default: 3 }]).length === 4);
  check('format', formatColumnValue({ type: 'number', decimals: 1, unit: 'lb' }, 1234.56) === '1,234.6 lb');
  return { passed, failed: failures.length, failures };
}
