// Company-wide IRONSIGHT tool sets (entity: takeoff_tool_sets).
//
// A tool set is a named, shareable collection of measurement tools plus the
// custom columns (takeoffColumns.js) those tools' markups fill in. Each tool
// is a superset of BlueprintTakeoff's per-session tool_chest preset
// ({ id, tool, label, shapeClass, sizeDesignation, color }) — so a tool can be
// dropped into a session's tool_chest unchanged via toToolChestPreset().
//
// Also owns the JSON export/import format (our own format, versioned) and the
// built-in "Structural Steel" starter set. The starter is NOT seeded into
// localStorage — it's a read-only virtual entry the library panel always
// shows; "Duplicate" turns it into a real, editable company tool set. That
// avoids seeding tenant-scoped rows before any tenant is known.
//
// Pure module (relative imports only) so node can run the self-checks.

import { createColumn, normalizeColumns, validateColumns } from './takeoffColumns.js';

export const TOOL_SET_EXPORT_FORMAT = 'steelos.ironsight.toolset';
export const TOOL_SET_EXPORT_VERSION = 1;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_TOOLS_PER_SET = 500;
export const MAX_COLUMNS_PER_SET = 100;

export const STRUCTURAL_STEEL_STARTER_ID = 'builtin-structural-steel';

// Same tool ids as the measurement engine (takeoffGeometry.js MEASURE_TOOLS)
// plus the two tally tools. `baseTool` is the fallback for a canvas that only
// understands the original count/length/area trio.
export const MEASUREMENT_TYPES = [
  { value: 'count', label: 'Count', help: 'Click once per piece — base plates, embeds, connections.', baseTool: 'count' },
  { value: 'bolt_count', label: 'Bolt count', help: 'Click once per bolt or anchor rod; asks for size/type/grade.', baseTool: 'count' },
  { value: 'length', label: 'Length', help: 'Two clicks — a straight run like a beam, column or brace.', baseTool: 'length' },
  { value: 'polylength', label: 'Polylength', help: 'Many clicks along a path — handrail, edge angle, embed plate runs.', baseTool: 'length' },
  { value: 'perimeter', label: 'Perimeter', help: 'Click around an outline and keep its edge length — edge angle, pour stop.', baseTool: 'length' },
  { value: 'area', label: 'Area', help: 'Click around an outline — plate, deck, grating. Cutouts are subtracted.', baseTool: 'area' },
  { value: 'wall_area', label: 'Wall area', help: 'Click along a wall run, then give its height — siding, liner panel.', baseTool: 'area' },
  { value: 'volume', label: 'Volume', help: 'An area times a depth you set — fill, grout, concrete.', baseTool: 'area' },
  { value: 'radius', label: 'Radius', help: 'Circle by center + edge — curved members, tank shells.', baseTool: 'length' },
  { value: 'diameter', label: 'Diameter', help: 'Circle by center + edge — round openings, pipe sleeves.', baseTool: 'length' },
  { value: 'angle', label: 'Angle', help: 'Three clicks — check a skew or a brace angle. No quantity.', baseTool: 'length' },
];

const MEASUREMENT_VALUES = MEASUREMENT_TYPES.map((m) => m.value);

// Same names the canvas's count-marker drawing understands (countMarkerShapes.js),
// plus 'circle' for the default filled dot.
export const COUNT_SYMBOLS = ['circle', 'square', 'triangle', 'diamond', 'star', 'pentagon', 'hexagon', 'cross'];
export const LINE_STYLES = ['solid', 'dashed', 'dotted'];

// pdf-space units are PDF points (1/72"), the same unit BlueprintTakeoff's
// px_per_ft calibration produces, so a drawing scale converts directly:
// points-per-foot = paper inches per real foot × 72.
export const SCALE_PRESETS = [
  { label: '1/16" = 1\'-0"', px_per_ft: 72 / 16 },
  { label: '3/32" = 1\'-0"', px_per_ft: (72 * 3) / 32 },
  { label: '1/8" = 1\'-0"', px_per_ft: 72 / 8 },
  { label: '3/16" = 1\'-0"', px_per_ft: (72 * 3) / 16 },
  { label: '1/4" = 1\'-0"', px_per_ft: 72 / 4 },
  { label: '3/8" = 1\'-0"', px_per_ft: (72 * 3) / 8 },
  { label: '1/2" = 1\'-0"', px_per_ft: 72 / 2 },
  { label: '3/4" = 1\'-0"', px_per_ft: (72 * 3) / 4 },
  { label: '1" = 1\'-0"', px_per_ft: 72 },
  { label: '1-1/2" = 1\'-0"', px_per_ft: 72 * 1.5 },
  { label: '3" = 1\'-0"', px_per_ft: 72 * 3 },
  { label: '1" = 10\'', px_per_ft: 72 / 10 },
  { label: '1" = 20\'', px_per_ft: 72 / 20 },
  { label: '1" = 30\'', px_per_ft: 72 / 30 },
  { label: '1" = 40\'', px_per_ft: 72 / 40 },
  { label: '1" = 50\'', px_per_ft: 72 / 50 },
  { label: '1" = 100\'', px_per_ft: 72 / 100 },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

const newId = (prefix) => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const optNum = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Tool with every field present. Unknown fields on `partial` are dropped. */
export function createTool(partial = {}) {
  const tool = MEASUREMENT_VALUES.includes(partial.tool) ? partial.tool : 'length';
  const scale = partial.scale_override && optNum(partial.scale_override.px_per_ft) > 0
    ? { scale_reference: String(partial.scale_override.scale_reference || ''), px_per_ft: Number(partial.scale_override.px_per_ft) }
    : null;
  return {
    id: partial.id || newId('tool'),
    tool,
    label: String(partial.label ?? '').trim() || 'New tool',
    subject: String(partial.subject ?? '').trim(),
    color: HEX.test(partial.color || '') ? partial.color : '#ef4444',
    fill_color: HEX.test(partial.fill_color || '') ? partial.fill_color : '',
    fill_opacity: Math.min(Math.max(optNum(partial.fill_opacity) ?? 0.25, 0), 1),
    symbol: COUNT_SYMBOLS.includes(partial.symbol) ? partial.symbol : 'circle',
    symbol_size: Math.min(Math.max(optNum(partial.symbol_size) ?? 7, 2), 48),
    show_numbers: Boolean(partial.show_numbers),
    line_width: Math.min(Math.max(optNum(partial.line_width) ?? 2, 0.25), 24),
    line_style: LINE_STYLES.includes(partial.line_style) ? partial.line_style : 'solid',
    scale_override: scale,
    default_values: partial.default_values && typeof partial.default_values === 'object' && !Array.isArray(partial.default_values) ? { ...partial.default_values } : {},
    shapeClass: String(partial.shapeClass ?? ''),
    sizeDesignation: String(partial.sizeDesignation ?? '').trim(),
    grade: String(partial.grade ?? '').trim(),
    unit_weight_lbs_per_ft: optNum(partial.unit_weight_lbs_per_ft),
    typical_length_ft: optNum(partial.typical_length_ft),
    slope_deg: optNum(partial.slope_deg),
    depth_ft: optNum(partial.depth_ft),
  };
}

/** Tool set with every field present (entity-managed id/company_id/created_date pass through). */
export function createToolSet(partial = {}) {
  const columns = normalizeColumns(partial.columns || []);
  return {
    ...(partial.id ? { id: partial.id } : {}),
    ...(partial.company_id ? { company_id: partial.company_id } : {}),
    name: String(partial.name ?? '').trim() || 'Untitled tool set',
    description: String(partial.description ?? ''),
    tools: (Array.isArray(partial.tools) ? partial.tools : []).map(createTool),
    columns,
    created_by: partial.created_by || '',
    is_shared: partial.is_shared !== false,
    version: Number.isInteger(partial.version) && partial.version > 0 ? partial.version : 1,
    ...(partial.is_builtin ? { is_builtin: true } : {}),
  };
}

/** Copy a set (or the built-in starter) as a new, unsaved set with fresh tool ids. */
export function duplicateToolSet(set, { name, createdBy } = {}) {
  const src = createToolSet(set);
  return {
    name: name || `${src.name} (copy)`,
    description: src.description,
    tools: src.tools.map((t) => ({ ...t, id: newId('tool') })),
    columns: src.columns.map((c) => ({ ...c })), // keep column ids — tools' default_values point at them
    created_by: createdBy || '',
    is_shared: src.is_shared,
    version: 1,
  };
}

/**
 * Check a tool set before saving/importing.
 * @returns {{ ok, errors: string[], warnings: string[], columnErrors }}
 */
export function validateToolSet(set) {
  const errors = [];
  const warnings = [];
  if (!set || typeof set !== 'object') return { ok: false, errors: ['That isn\'t a tool set.'], warnings, columnErrors: [] };
  if (!String(set.name || '').trim()) errors.push('Give the tool set a name.');
  const tools = Array.isArray(set.tools) ? set.tools : [];
  const columns = Array.isArray(set.columns) ? set.columns : [];
  if (tools.length > MAX_TOOLS_PER_SET) errors.push(`A tool set can hold up to ${MAX_TOOLS_PER_SET} tools (this one has ${tools.length}).`);
  if (columns.length > MAX_COLUMNS_PER_SET) errors.push(`A tool set can hold up to ${MAX_COLUMNS_PER_SET} columns (this one has ${columns.length}).`);
  const ids = new Set();
  const labels = new Map();
  tools.forEach((t, i) => {
    const name = t?.label ? `"${t.label}"` : `Tool #${i + 1}`;
    if (!t || typeof t !== 'object') { errors.push(`Tool #${i + 1} is empty.`); return; }
    if (!String(t.label || '').trim()) errors.push(`Tool #${i + 1} needs a label.`);
    if (!MEASUREMENT_VALUES.includes(t.tool)) errors.push(`${name} has an unknown measurement type "${t.tool}".`);
    if (t.color && !HEX.test(t.color)) errors.push(`${name} has a color that isn't a #RRGGBB value.`);
    if (t.id && ids.has(t.id)) errors.push(`${name} has the same id as another tool.`);
    if (t.id) ids.add(t.id);
    const key = `${t.tool}::${String(t.label || '').trim().toLowerCase()}`;
    if (labels.has(key)) warnings.push(`Two ${t.tool} tools are both called ${name} — their markups will be totaled together.`);
    labels.set(key, true);
    const colIds = new Set(columns.flatMap((c) => [c.id, c.alias]));
    Object.keys(t.default_values || {}).forEach((k) => {
      if (!colIds.has(k)) warnings.push(`${name} has a default for a column that no longer exists (it will be ignored).`);
    });
  });
  const colCheck = validateColumns(normalizeColumns(columns));
  colCheck.errors.forEach((e) => {
    const col = columns.find((c) => c.id === e.columnId);
    errors.push(`Column ${col?.name ? `"${col.name}"` : ''}: ${e.message}`.replace('Column : ', 'Column: '));
  });
  return { ok: errors.length === 0, errors, warnings, columnErrors: colCheck.errors };
}

/**
 * The tool as a BlueprintTakeoff tool_chest preset. `tool` is mapped down to a
 * tool the canvas already supports (count/length/area by default) and the
 * original type is kept in `measurement_type`; every extended field rides
 * along so the canvas/markups list can opt into them.
 */
export function toToolChestPreset(tool, { toolSetId, supportedTools = MEASUREMENT_VALUES } = {}) {
  const t = createTool(tool);
  const base = MEASUREMENT_TYPES.find((m) => m.value === t.tool)?.baseTool || 'length';
  return {
    ...t,
    tool: supportedTools.includes(t.tool) ? t.tool : base,
    measurement_type: t.tool,
    tool_set_id: toolSetId || null,
    tool_set_tool_id: t.id,
    // Engine-shaped aliases so a preset can seed a measurement directly:
    marker_size: t.symbol_size,
    slope: t.slope_deg ? { mode: 'degrees', degrees: t.slope_deg } : null,
    id: newId('preset'),
  };
}

/**
 * AISC-style weight lookup for takeoffColumns.getBuiltInFieldValues: a tool's
 * typed unit weight wins, else `estimate(shapeClass, size)` (pass
 * steelShapeSelector's estimateWeightPerFt) on the tool's or row's shape.
 */
export function makeToolWeightLookup(estimate) {
  return (item = {}, tool = {}) => {
    if (Number(tool.unit_weight_lbs_per_ft) > 0) return Number(tool.unit_weight_lbs_per_ft);
    const shapeClass = tool.shapeClass || item.shapeClass || item.shape_class;
    const size = tool.sizeDesignation || item.size_designation;
    if (!shapeClass || !size || typeof estimate !== 'function') return 0;
    return Number(estimate(shapeClass, size)) || 0;
  };
}

// ------------------------------------------------------------ starter set

/** The built-in, read-only Structural Steel starter set (fresh copy each call). */
export function buildStructuralSteelStarter() {
  const columns = [
    createColumn({ id: 'col-mark', name: 'Mark', alias: 'Mark', type: 'text' }),
    createColumn({ id: 'col-finish', name: 'Finish', alias: 'Finish', type: 'choice', choices: ['Bare', 'Shop primed', 'Galvanized', 'Painted'], default: 'Shop primed' }),
    createColumn({ id: 'col-unit-wt', name: 'Wt / Ft', alias: 'UnitWt', type: 'formula', formula: 'WtPerFt', decimals: 2, unit: 'lb/ft' }),
    createColumn({ id: 'col-psf', name: 'Lb / Sq Ft', alias: 'LbPerSqFt', type: 'number', decimals: 2, default: 0 }),
    createColumn({ id: 'col-waste', name: 'Waste %', alias: 'WastePct', type: 'number', decimals: 1, default: 0 }),
    // Length/count rows: Weight (TrueLength × WtPerFt × Qty). Area rows: Area × lb/sq ft.
    createColumn({ id: 'col-total-wt', name: 'Total Weight', alias: 'TotalWt', type: 'formula', formula: '(Weight + Area * LbPerSqFt) * (1 + WastePct / 100)', decimals: 0, unit: 'lb' }),
    createColumn({ id: 'col-total-tons', name: 'Total Tons', alias: 'TotalTons', type: 'formula', formula: 'ROUND(TotalWt / 2000, 3)', decimals: 3, unit: 'tn' }),
  ];
  const t = (p) => createTool({ ...p, id: `starter-${p.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` });
  const tools = [
    t({ tool: 'length', label: 'Beams', subject: 'Framing', color: '#ef4444', shapeClass: 'W-Beam', sizeDesignation: 'W18X35', grade: 'A992', line_width: 3 }),
    t({ tool: 'length', label: 'Columns', subject: 'Framing', color: '#2563eb', shapeClass: 'W-Beam', sizeDesignation: 'W10X49', grade: 'A992', line_width: 3 }),
    t({ tool: 'length', label: 'Braces', subject: 'Framing', color: '#7c3aed', shapeClass: 'HSS Tube', sizeDesignation: 'HSS6X6X3/8', grade: 'A500 Gr C', line_width: 2, line_style: 'dashed' }),
    t({ tool: 'count', label: 'Base plates', subject: 'Plates & embeds', color: '#f97316', symbol: 'square', symbol_size: 8, show_numbers: true, shapeClass: 'PL-Plate', sizeDesignation: 'PL3/4X12', grade: 'A36', typical_length_ft: 1 }),
    t({ tool: 'count', label: 'Embed plates', subject: 'Plates & embeds', color: '#0d9488', symbol: 'diamond', symbol_size: 8, show_numbers: true, shapeClass: 'PL-Plate', sizeDesignation: 'PL1/2X8', grade: 'A36', typical_length_ft: 0.75 }),
    t({ tool: 'bolt_count', label: 'Anchor bolts', subject: 'Anchors', color: '#64748b', symbol: 'cross', symbol_size: 6, grade: 'F1554 Gr 36' }),
    t({ tool: 'area', label: 'Plate', subject: 'Plates & embeds', color: '#ca8a04', fill_color: '#facc15', fill_opacity: 0.3, shapeClass: 'PL-Plate', sizeDesignation: 'PL3/8', grade: 'A36', default_values: { 'col-psf': 15.31 } }),
    t({ tool: 'area', label: 'Metal deck', subject: 'Deck', color: '#16a34a', fill_color: '#86efac', fill_opacity: 0.25, default_values: { 'col-psf': 2.14, 'col-finish': 'Galvanized' } }),
    t({ tool: 'length', label: 'Stair stringers', subject: 'Stairs', color: '#db2777', shapeClass: 'C-Channel', sizeDesignation: 'C12X20.7', grade: 'A36', slope_deg: 32, line_width: 3 }),
    t({ tool: 'polylength', label: 'Handrail', subject: 'Misc metals', color: '#0891b2', unit_weight_lbs_per_ft: 2.72, grade: 'A53 Gr B', line_width: 2, default_values: { 'col-finish': 'Galvanized' } }),
  ];
  return createToolSet({
    id: STRUCTURAL_STEEL_STARTER_ID,
    name: 'Structural Steel (starter)',
    description: 'Beams, columns and braces by length; base plates, embeds and anchor bolts by count; plate and deck by area; stair stringers with slope; handrail by polylength. Duplicate it to make your own.',
    tools,
    columns,
    created_by: 'SteelOS',
    is_shared: true,
    version: 1,
    is_builtin: true,
  });
}

// ------------------------------------------------------------ export / import

/** JSON text for a tool set file. Strips company/user-specific fields. */
export function exportToolSetJson(set) {
  const s = createToolSet(set);
  return JSON.stringify({
    format: TOOL_SET_EXPORT_FORMAT,
    format_version: TOOL_SET_EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    tool_set: { name: s.name, description: s.description, version: s.version, tools: s.tools, columns: s.columns },
  }, null, 2);
}

export const toolSetFileName = (set) => `${String(set?.name || 'tool-set').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_') || 'tool-set'}.ironsight-tools.json`;

/**
 * Parse + validate an exported tool set file. Never writes anything — the
 * caller shows `preview`, and only saves `toolSet` after the user confirms.
 * @param {string|object} input file text or already-parsed object
 * @returns {{ ok, errors: string[], warnings: string[], toolSet: object|null, preview: object|null }}
 */
export function parseToolSetImport(input) {
  const errors = [];
  const warnings = [];
  let data = input;
  if (typeof input === 'string') {
    if (input.length > MAX_IMPORT_BYTES) return { ok: false, errors: ['That file is too large to be a tool set (over 2 MB).'], warnings, toolSet: null, preview: null };
    try {
      data = JSON.parse(input);
    } catch {
      return { ok: false, errors: ['That file isn\'t valid JSON — pick a file exported from IRONSIGHT\'s tool set library.'], warnings, toolSet: null, preview: null };
    }
  }
  if (!data || typeof data !== 'object') return { ok: false, errors: ['That file is empty.'], warnings, toolSet: null, preview: null };
  if (data.format !== TOOL_SET_EXPORT_FORMAT) {
    return { ok: false, errors: ['That file isn\'t an IRONSIGHT tool set export (missing the format marker).'], warnings, toolSet: null, preview: null };
  }
  if (!Number.isInteger(data.format_version) || data.format_version < 1) errors.push('The file has no valid format_version.');
  if (data.format_version > TOOL_SET_EXPORT_VERSION) errors.push(`This file was made by a newer SteelOS (format ${data.format_version}); this version reads format ${TOOL_SET_EXPORT_VERSION}.`);
  const raw = data.tool_set;
  if (!raw || typeof raw !== 'object') errors.push('The file has no tool_set section.');
  if (errors.length) return { ok: false, errors, warnings, toolSet: null, preview: null };

  const rawTools = Array.isArray(raw.tools) ? raw.tools : [];
  rawTools.forEach((t, i) => {
    if (t && t.tool && !MEASUREMENT_VALUES.includes(t.tool)) errors.push(`Tool #${i + 1} ("${t.label || ''}") has unknown measurement type "${t.tool}".`);
    if (t && t.color && !HEX.test(t.color)) warnings.push(`Tool "${t.label || i + 1}" had an invalid color — it will use red.`);
  });
  const toolSet = createToolSet({ ...raw, is_builtin: false, id: undefined, company_id: undefined, created_by: '' });
  const check = validateToolSet(toolSet);
  errors.push(...check.errors);
  warnings.push(...check.warnings);
  const preview = {
    name: toolSet.name,
    description: toolSet.description,
    version: toolSet.version,
    toolCount: toolSet.tools.length,
    columnCount: toolSet.columns.length,
    tools: toolSet.tools.map((t) => ({ label: t.label, tool: t.tool, subject: t.subject, color: t.color, size: t.sizeDesignation })),
    columns: toolSet.columns.map((c) => ({ name: c.name, alias: c.alias, type: c.type, formula: c.formula })),
  };
  return { ok: errors.length === 0, errors, warnings, toolSet, preview };
}

// --------------------------------------------------------------- self-check

export function runToolSetsSelfCheck() {
  const failures = [];
  let passed = 0;
  const check = (label, cond) => { if (cond) passed += 1; else failures.push(label); };
  const starter = buildStructuralSteelStarter();
  const v = validateToolSet(starter);
  check(`starter valid: ${v.errors.join('; ')}`, v.ok);
  check('starter has 10 tools', starter.tools.length === 10);
  const json = exportToolSetJson(starter);
  const imp = parseToolSetImport(json);
  check(`roundtrip ok: ${imp.errors.join('; ')}`, imp.ok && imp.toolSet.tools.length === 10 && imp.toolSet.columns.length === starter.columns.length);
  check('roundtrip drops builtin flag', !imp.toolSet.is_builtin && !imp.toolSet.id);
  check('bad json', !parseToolSetImport('{nope').ok);
  check('wrong format', !parseToolSetImport({ format: 'x' }).ok);
  check('newer version', !parseToolSetImport({ format: TOOL_SET_EXPORT_FORMAT, format_version: 99, tool_set: {} }).ok);
  check('bad tool type', !parseToolSetImport({ format: TOOL_SET_EXPORT_FORMAT, format_version: 1, tool_set: { name: 'x', tools: [{ tool: 'laser', label: 'a' }] } }).ok);
  const preset = toToolChestPreset(starter.tools.find((t) => t.tool === 'polylength'), { toolSetId: 's1', supportedTools: ['count', 'length', 'area'] });
  check('preset maps polylength→length', preset.tool === 'length' && preset.measurement_type === 'polylength' && preset.tool_set_id === 's1');
  const stringer = toToolChestPreset(starter.tools.find((t) => t.label === 'Stair stringers'));
  check('preset keeps engine tool + slope', stringer.tool === 'length' && stringer.slope?.degrees === 32);
  const lookup = makeToolWeightLookup((cls, size) => (cls === 'W-Beam' && size === 'W18X35' ? 35 : 0));
  check('lookup shape', lookup({}, starter.tools[0]) === 35);
  check('lookup manual', lookup({}, starter.tools.find((t) => t.label === 'Handrail')) === 2.72);
  const dup = duplicateToolSet(starter);
  check('duplicate new ids', dup.tools[0].id !== starter.tools[0].id && !dup.is_builtin && dup.name.endsWith('(copy)'));
  return { passed, failed: failures.length, failures };
}
