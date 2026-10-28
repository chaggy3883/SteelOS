// Small pure helpers shared by IRONSIGHT's wiring of company tool sets into a
// takeoff session (BlueprintTakeoff.jsx, MarkupsList.jsx, the legend/export
// dialogs):
//
//   presetRowFields(preset)   the fields a confirmed row copies from the
//                             Tool Chest preset that was loaded when it was
//                             measured (tool_set_tool_id, subject, color,
//                             symbol, marker_size, show_numbers, slope, shape)
//   inferShapeClass(size)     'W18X35' → 'W-Beam', 'HSS6X6X3/8' → 'HSS Tube' …
//   makeRowWeightLookup(est)  weight-per-foot resolver for takeoffColumns /
//                             takeoffLegend: the tool's typed lb/ft, else the
//                             AISC estimate for the tool's or the row's size
//   toolForRow(row, toolSet)  the tool-set tool a row came from
//
// Pure module (relative imports only) so node can run the self-check.

import { makeToolWeightLookup } from './takeoffToolSets.js';

// Same 5-class taxonomy as steelShapeSelector.js SHAPE_CLASSES. Longest
// prefixes first so 'HSS' wins over 'H…' and 'MC' over 'M…'.
const SIZE_PREFIX_CLASSES = [
  [/^HSS/i, 'HSS Tube'],
  [/^PL/i, 'PL-Plate'],
  [/^(MC|C)\d/i, 'C-Channel'],
  [/^L\d/i, 'L-Angle'],
  [/^(W|S|M|HP)\d/i, 'W-Beam'],
];

/** Shape class from a size designation, or '' when the size doesn't say. */
export function inferShapeClass(size) {
  const s = String(size || '').trim().replace(/\s+/g, '');
  const hit = SIZE_PREFIX_CLASSES.find(([re]) => re.test(s));
  return hit ? hit[1] : '';
}

/**
 * Weight-per-foot lookup for computeColumnValues / buildLegendData.
 * Order: the tool's typed unit weight → AISC estimate on the tool's own
 * shape/size → AISC estimate on the row's size (class read from the size
 * itself before the row's shape_class, since rows restored by openSession
 * default shape_class to 'W-Beam' even when they're an HSS or a plate).
 * @param {(shapeClass: string, size: string) => number} estimate steelShapeSelector.estimateWeightPerFt
 */
export function makeRowWeightLookup(estimate) {
  const byTool = makeToolWeightLookup(estimate);
  return (item = {}, tool = {}) => {
    const fromTool = byTool({}, tool || {});
    if (fromTool > 0) return fromTool;
    const size = item.size_designation || '';
    const shapeClass = inferShapeClass(size) || item.shape_class || '';
    if (!shapeClass || !size || typeof estimate !== 'function') return 0;
    return Number(estimate(shapeClass, size)) || 0;
  };
}

/** The tool-set tool a markup row was measured with (by id, else tool + label). */
export function toolForRow(row, toolSet) {
  const tools = toolSet?.tools || [];
  if (!row || !tools.length) return null;
  if (row.tool_set_tool_id) {
    const byId = tools.find((t) => t.id === row.tool_set_tool_id);
    if (byId) return byId;
  }
  const label = String(row.label || '').trim().toLowerCase();
  return tools.find((t) => (t.tool === row.tool || t.tool === row.measurement_type) && t.label.toLowerCase() === label) || null;
}

/**
 * Fields a confirmed row copies from the Tool Chest preset it was measured
 * with. Older hand-made presets ({ id, tool, label, shapeClass,
 * sizeDesignation, color }) only contribute label/color/shape; tool-set
 * presets (takeoffToolSets.toToolChestPreset) also carry subject, symbol,
 * marker size, numbering and slope.
 * @param {object|null} preset
 * @returns {object} fields to spread onto the row (empty when no preset)
 */
export function presetRowFields(preset) {
  if (!preset) return {};
  const out = {};
  if (preset.tool_set_id) out.tool_set_id = preset.tool_set_id;
  if (preset.tool_set_tool_id) out.tool_set_tool_id = preset.tool_set_tool_id;
  if (preset.subject) out.subject = preset.subject;
  if (preset.color) out.color = preset.color;
  if (preset.symbol) out.symbol = preset.symbol;
  if (Number(preset.marker_size) > 0) out.marker_size = Number(preset.marker_size);
  if (preset.show_numbers != null) out.show_numbers = Boolean(preset.show_numbers);
  if (preset.shapeClass) out.shape_class = preset.shapeClass;
  if (preset.grade) out.grade = preset.grade;
  if (Number(preset.unit_weight_lbs_per_ft) > 0) out.unit_weight_lbs_per_ft = Number(preset.unit_weight_lbs_per_ft);
  if (preset.measurement_type && preset.measurement_type !== preset.tool) out.measurement_type = preset.measurement_type;
  return out;
}

/** Engine-shaped slope a preset defaults the confirmation panel to, or null. */
export function presetSlope(preset) {
  if (preset?.slope?.mode === 'degrees' && Number(preset.slope.degrees) > 0) return { mode: 'degrees', degrees: Number(preset.slope.degrees) };
  if (preset?.slope?.mode === 'pitch' && Number(preset.slope.run) > 0) return { mode: 'pitch', rise: Number(preset.slope.rise) || 0, run: Number(preset.slope.run) };
  return null;
}

// --------------------------------------------------------------- self-check

export function runRowHelpersSelfCheck() {
  const failures = [];
  let passed = 0;
  const check = (label, cond) => { if (cond) passed += 1; else failures.push(label); };
  const estimate = (cls, size) => (cls === 'W-Beam' ? Number((/X(\d+(?:\.\d+)?)/i.exec(size) || [])[1] || 0) : cls === 'HSS Tube' ? 27.48 : 0);
  check('W18X35 → W-Beam', inferShapeClass('W18X35') === 'W-Beam');
  check('HSS6X6X3/8 → HSS Tube', inferShapeClass('HSS6X6X3/8') === 'HSS Tube');
  check('MC12X10.6 → C-Channel', inferShapeClass('MC12X10.6') === 'C-Channel');
  check('PL1/2X12 → PL-Plate', inferShapeClass('PL1/2X12') === 'PL-Plate');
  check('L4X4X1/4 → L-Angle', inferShapeClass('L4X4X1/4') === 'L-Angle');
  check('free text → empty', inferShapeClass('Grating') === '');
  const lookup = makeRowWeightLookup(estimate);
  check('row W18X35 → 35 lb/ft', lookup({ size_designation: 'W18X35' }, {}) === 35);
  check('HSS row with stale W-Beam class still reads as HSS', lookup({ size_designation: 'HSS6X6X3/8', shape_class: 'W-Beam' }, {}) === 27.48);
  check('typed tool weight wins', lookup({ size_designation: 'W18X35' }, { unit_weight_lbs_per_ft: 2.72 }) === 2.72);
  const preset = { id: 'p', tool: 'length', tool_set_id: 'set1', tool_set_tool_id: 't1', subject: 'Framing', color: '#ef4444', symbol: 'circle', marker_size: 7, show_numbers: false, shapeClass: 'W-Beam', slope: { mode: 'degrees', degrees: 32 } };
  const f = presetRowFields(preset);
  check('preset copies tool_set_tool_id/subject/color/shape', f.tool_set_tool_id === 't1' && f.subject === 'Framing' && f.color === '#ef4444' && f.shape_class === 'W-Beam');
  check('preset slope', presetSlope(preset)?.degrees === 32);
  check('no preset → no fields', Object.keys(presetRowFields(null)).length === 0);
  check('toolForRow by id', toolForRow({ tool_set_tool_id: 't1' }, { tools: [{ id: 't1', tool: 'length', label: 'Beams' }] })?.label === 'Beams');
  check('toolForRow by tool + label', toolForRow({ tool: 'length', label: 'beams' }, { tools: [{ id: 't1', tool: 'length', label: 'Beams' }] })?.id === 't1');
  return { passed, failed: failures.length, failures };
}
