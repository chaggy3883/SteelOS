// Legend table data for IRONSIGHT takeoffs — one row per tool (or per
// subject) with its symbol/color and count / length / area / weight / tons
// totals, plus the pages it appears on. Shared by the on-canvas legend
// (drawLegendOnCanvas) and the marked-up PDF export (takeoffMarkupPdfExport.js),
// which both lay the table out through layoutLegendTable so they match.
//
// Input rows are blueprint_takeoffs.accepted_items-shaped markups
// (tool, label, color, symbol, points, length_ft, area_sq_ft, quantity,
// unit_weight_lbs_per_ft, page_number, is_accepted ...).
//
// Pure module (relative imports only) — runs under node for the self-check.

import { computeColumnValues, getBuiltInFieldValues } from './takeoffColumns.js';

export const LEGEND_COLUMNS = [
  { key: 'symbol', label: '', align: 'center' },
  { key: 'label', label: 'Item', align: 'left' },
  { key: 'count', label: 'Count', align: 'right' },
  { key: 'length', label: 'Length', align: 'right' },
  { key: 'area', label: 'Area', align: 'right' },
  { key: 'volume', label: 'Volume', align: 'right' },
  { key: 'weight', label: 'Weight', align: 'right' },
  { key: 'tons', label: 'Tons', align: 'right' },
  { key: 'pages', label: 'Pages', align: 'left' },
];

// Kinds match takeoffGeometry.js MEASURE_TOOLS (angle rows are listed but never totaled).
const COUNT_TOOLS = new Set(['count', 'bolt_count']);
const LENGTH_TOOLS = new Set(['length', 'polylength', 'perimeter', 'radius', 'diameter']);
const AREA_TOOLS = new Set(['area', 'wall_area']);
const VOLUME_TOOLS = new Set(['volume']);
const FILLED_TOOLS = new Set(['area', 'wall_area', 'volume']);

/** [1,2,3,5,7,8] → "1-3, 5, 7-8" */
export function formatPageRange(pages = []) {
  const sorted = [...new Set(pages.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) { end = sorted[i + 1]; i += 1; }
    parts.push(start === end ? `${start}` : `${start}-${end}`);
  }
  return parts.join(', ');
}

/** 12.5 → 12'-6"  (nearest inch; uses ASCII quotes so PDF standard fonts can draw it) */
export function formatFeetInches(ft) {
  if (!Number.isFinite(ft)) return '';
  const totalIn = Math.round(Math.abs(ft) * 12);
  const f = Math.floor(totalIn / 12);
  const i = totalIn % 12;
  return `${ft < 0 ? '-' : ''}${f.toLocaleString('en-US')}'-${i}"`;
}

const fmt = (n, d) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Build legend data.
 * @param {Array} items markup rows
 * @param {object} [opts]
 * @param {'tool'|'subject'} [opts.groupBy='tool'] one row per tool label, or per subject
 * @param {object} [opts.toolSet] tool set ({ tools, columns }) — supplies subject/symbol/color/defaults by matching tool+label (or row.tool_set_tool_id)
 * @param {Function} [opts.weightLookup] (item, tool) => lb/ft, see takeoffToolSets.makeToolWeightLookup
 * @param {string} [opts.weightAlias] a column alias (e.g. 'TotalWt') whose value is used as the row weight instead of built-in Weight
 * @param {number[]} [opts.pages] only include these page numbers
 * @param {boolean} [opts.includePages=true] add the Pages column
 * @param {string} [opts.title='Legend']
 * @returns {{ title, columns, rows, totals }}
 */
export function buildLegendData(items = [], opts = {}) {
  const { groupBy = 'tool', toolSet, weightLookup, weightAlias, pages, includePages = true, title = 'Legend' } = opts;
  const tools = toolSet?.tools || [];
  const columns = toolSet?.columns || [];
  const pageFilter = Array.isArray(pages) && pages.length ? new Set(pages.map(Number)) : null;
  const groups = new Map();

  items.forEach((item) => {
    if (!item || item.is_accepted === false) return;
    const page = Number(item.page_number ?? 1);
    if (pageFilter && !pageFilter.has(page)) return;
    const label = String(item.label || item.shape_type || 'Untitled').trim();
    const toolDef = tools.find((t) => t.id === item.tool_set_tool_id)
      || tools.find((t) => (t.tool === item.tool || t.tool === item.measurement_type) && t.label.toLowerCase() === label.toLowerCase())
      || null;
    const subject = item.subject || toolDef?.subject || '';
    const kind = item.measurement_type || toolDef?.tool || item.tool || 'length';
    const key = groupBy === 'subject' && subject ? `subject::${subject.toLowerCase()}` : `${kind}::${label.toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: groupBy === 'subject' && subject ? subject : label,
        subject,
        tool: kind,
        color: item.color || toolDef?.color || '#ef4444',
        fill_color: toolDef?.fill_color || '',
        symbol: item.symbol || toolDef?.symbol || (COUNT_TOOLS.has(kind) ? 'circle' : null),
        line_style: toolDef?.line_style || 'solid',
        markups: 0,
        count: 0,
        length_ft: 0,
        area_sq_ft: 0,
        volume_cu_yd: 0,
        weight_lbs: 0,
        pages: new Set(),
        kinds: new Set(),
      });
    }
    const g = groups.get(key);
    const b = getBuiltInFieldValues(item, { tool: toolDef || undefined, weightLookup });
    let weight = b.Weight;
    if (weightAlias && columns.length) {
      const r = computeColumnValues(item, columns, { builtIns: b, tool: toolDef || undefined });
      if (typeof r.values[weightAlias] === 'number') weight = r.values[weightAlias];
    }
    g.markups += 1;
    g.kinds.add(kind);
    if (COUNT_TOOLS.has(kind)) g.count += b.Count;
    else if (LENGTH_TOOLS.has(kind)) g.length_ft += b.TrueLength * b.Qty;
    else if (AREA_TOOLS.has(kind)) g.area_sq_ft += b.Area;
    else if (VOLUME_TOOLS.has(kind)) { g.volume_cu_yd += b.CuYd; g.area_sq_ft += b.Area; }
    g.weight_lbs += weight || 0;
    g.pages.add(page);
  });

  const rows = [...groups.values()].map((g) => {
    const pagesArr = [...g.pages].sort((a, b) => a - b);
    const hasCount = [...g.kinds].some((k) => COUNT_TOOLS.has(k));
    const hasLength = [...g.kinds].some((k) => LENGTH_TOOLS.has(k));
    const hasArea = [...g.kinds].some((k) => AREA_TOOLS.has(k));
    const hasVolume = [...g.kinds].some((k) => VOLUME_TOOLS.has(k));
    return {
      key: g.key,
      label: g.label,
      subject: g.subject,
      tool: g.tool,
      color: g.color,
      fill_color: g.fill_color,
      symbol: g.symbol,
      line_style: g.line_style,
      markups: g.markups,
      count: g.count,
      length_ft: g.length_ft,
      area_sq_ft: g.area_sq_ft,
      volume_cu_yd: g.volume_cu_yd,
      weight_lbs: g.weight_lbs,
      tons: g.weight_lbs / 2000,
      pages: pagesArr,
      page_range: formatPageRange(pagesArr),
      text: {
        label: g.label,
        count: hasCount ? fmt(g.count, 0) : '',
        length: hasLength ? formatFeetInches(g.length_ft) : '',
        area: hasArea ? `${fmt(g.area_sq_ft, 1)} sf` : '',
        volume: hasVolume ? `${fmt(g.volume_cu_yd, 2)} cy` : '',
        weight: g.weight_lbs ? `${fmt(g.weight_lbs, 0)} lb` : '',
        tons: g.weight_lbs ? fmt(g.weight_lbs / 2000, 2) : '',
        pages: formatPageRange(pagesArr),
      },
    };
  }).sort((a, b) => (a.subject || '').localeCompare(b.subject || '') || a.label.localeCompare(b.label));

  const totals = rows.reduce((t, r) => ({
    count: t.count + r.count,
    length_ft: t.length_ft + r.length_ft,
    area_sq_ft: t.area_sq_ft + r.area_sq_ft,
    volume_cu_yd: t.volume_cu_yd + r.volume_cu_yd,
    weight_lbs: t.weight_lbs + r.weight_lbs,
    tons: t.tons + r.tons,
  }), { count: 0, length_ft: 0, area_sq_ft: 0, volume_cu_yd: 0, weight_lbs: 0, tons: 0 });

  // Only keep columns that have something to show.
  const used = (key) => key === 'symbol' || key === 'label' || rows.some((r) => r.text[key]);
  const visibleColumns = LEGEND_COLUMNS.filter((c) => (c.key === 'pages' ? includePages && rows.length > 0 : used(c.key)));
  const totalsText = {
    label: 'Total',
    count: totals.count ? fmt(totals.count, 0) : '',
    length: totals.length_ft ? formatFeetInches(totals.length_ft) : '',
    area: totals.area_sq_ft ? `${fmt(totals.area_sq_ft, 1)} sf` : '',
    volume: totals.volume_cu_yd ? `${fmt(totals.volume_cu_yd, 2)} cy` : '',
    weight: totals.weight_lbs ? `${fmt(totals.weight_lbs, 0)} lb` : '',
    tons: totals.weight_lbs ? fmt(totals.tons, 2) : '',
    pages: '',
  };
  return { title, columns: visibleColumns, rows, totals: { ...totals, text: totalsText } };
}

/**
 * Cell geometry for a legend, in whatever units `measureText` returns (canvas
 * pixels or PDF points). Origin is the table's top-left; y grows downward.
 * @param {object} legend from buildLegendData
 * @param {{ fontSize?, padding?, measureText?: (text, fontSize) => number, symbolSize? }} [opts]
 */
export function layoutLegendTable(legend, opts = {}) {
  const fontSize = opts.fontSize ?? 8;
  const padding = opts.padding ?? 3;
  const symbolSize = opts.symbolSize ?? fontSize * 1.1;
  const measure = opts.measureText || ((t, fs) => String(t).length * fs * 0.55);
  const rowHeight = fontSize + padding * 2;
  const titleHeight = legend.title ? fontSize * 1.25 + padding * 2 : 0;
  const allRows = [...legend.rows.map((r) => r.text), legend.totals.text];
  const columns = legend.columns.map((c) => {
    let w;
    if (c.key === 'symbol') w = symbolSize + padding * 2;
    else {
      const texts = [c.label, ...allRows.map((t) => t[c.key] || '')];
      w = Math.max(...texts.map((t) => measure(t, fontSize))) + padding * 2;
    }
    return { ...c, width: w };
  });
  let x = 0;
  columns.forEach((c) => { c.x = x; x += c.width; });
  const width = Math.max(x, legend.title ? measure(legend.title, fontSize * 1.25) + padding * 2 : 0);
  const headerY = titleHeight;
  const firstRowY = headerY + rowHeight;
  const totalsY = firstRowY + legend.rows.length * rowHeight;
  return { width, height: totalsY + rowHeight, fontSize, padding, symbolSize, rowHeight, titleHeight, headerY, firstRowY, totalsY, columns };
}

/**
 * Outline of a count symbol centered at (cx, cy), y-down, as [x, y] pairs —
 * or null for 'circle'. Shared by canvas legend and PDF export so symbols
 * match countMarkerShapes.js's shapes.
 */
export function symbolPolygon(symbol, cx, cy, r) {
  const regular = (sides, rot) => Array.from({ length: sides }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / sides;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  switch (symbol) {
    case 'square': return [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
    case 'triangle': return [[cx, cy - r], [cx + r, cy + r * 0.8], [cx - r, cy + r * 0.8]];
    case 'diamond': return [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]];
    case 'pentagon': return regular(5, -Math.PI / 2);
    case 'hexagon': return regular(6, 0);
    case 'star': {
      const pts = [];
      let rot = -Math.PI / 2;
      const step = Math.PI / 5;
      for (let i = 0; i < 5; i++) {
        pts.push([cx + Math.cos(rot) * r, cy + Math.sin(rot) * r]); rot += step;
        pts.push([cx + Math.cos(rot) * r * 0.45, cy + Math.sin(rot) * r * 0.45]); rot += step;
      }
      return pts;
    }
    case 'cross': {
      const w = r * 0.4;
      return [[cx - w, cy - r], [cx + w, cy - r], [cx + w, cy - w], [cx + r, cy - w], [cx + r, cy + w], [cx + w, cy + w],
        [cx + w, cy + r], [cx - w, cy + r], [cx - w, cy + w], [cx - r, cy + w], [cx - r, cy - w], [cx - w, cy - w]];
    }
    default: return null;
  }
}

/** Draw a legend swatch (count symbol, line sample, or filled box) on a 2D canvas context. */
export function drawLegendSwatch(ctx, row, cx, cy, size) {
  const r = size / 2;
  ctx.save();
  ctx.strokeStyle = row.color;
  ctx.fillStyle = row.color;
  if (row.symbol) {
    const poly = symbolPolygon(row.symbol, cx, cy, r);
    ctx.beginPath();
    if (poly) { poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); } else ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (FILLED_TOOLS.has(row.tool)) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = row.fill_color || row.color;
    ctx.fillRect(cx - r, cy - r, size, size);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - r, cy - r, size, size);
  } else {
    ctx.lineWidth = Math.max(1.5, size / 6);
    if (row.line_style === 'dashed') ctx.setLineDash([size / 4, size / 6]);
    if (row.line_style === 'dotted') ctx.setLineDash([1, size / 6]);
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw a legend table on a 2D canvas context with its top-left at (x, y),
 * in canvas pixels. For BlueprintCanvas: pass x = pdfX * scale, y = pdfY * scale
 * and fontSize = 8 * scale so it zooms with the drawing.
 */
export function drawLegendOnCanvas(ctx, legend, x, y, opts = {}) {
  const fontSize = opts.fontSize ?? 12;
  const font = (fs, bold) => `${bold ? 'bold ' : ''}${fs}px ${opts.fontFamily || 'Helvetica, Arial, sans-serif'}`;
  const layout = layoutLegendTable(legend, {
    ...opts,
    fontSize,
    measureText: (t, fs) => { ctx.font = font(fs); return ctx.measureText(String(t)).width; },
  });
  const { padding, rowHeight, columns } = layout;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = opts.background || 'rgba(255,255,255,0.95)';
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.strokeStyle = opts.borderColor || '#1e293b';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = opts.textColor || '#0f172a';
  ctx.textBaseline = 'middle';
  if (legend.title) {
    ctx.font = font(fontSize * 1.25, true);
    ctx.fillText(legend.title, padding, layout.titleHeight / 2);
  }
  const drawRow = (texts, rowY, bold, row) => {
    ctx.font = font(fontSize, bold);
    columns.forEach((c) => {
      const cy = rowY + rowHeight / 2;
      if (c.key === 'symbol') { if (row) drawLegendSwatch(ctx, row, c.x + c.width / 2, cy, layout.symbolSize); return; }
      const t = texts[c.key] || '';
      if (!t) return;
      ctx.fillStyle = opts.textColor || '#0f172a';
      const w = ctx.measureText(t).width;
      const tx = c.align === 'right' ? c.x + c.width - padding - w : c.align === 'center' ? c.x + (c.width - w) / 2 : c.x + padding;
      ctx.fillText(t, tx, cy);
    });
    ctx.beginPath();
    ctx.moveTo(0, rowY + rowHeight);
    ctx.lineTo(layout.width, rowY + rowHeight);
    ctx.strokeStyle = '#cbd5e1';
    ctx.stroke();
  };
  drawRow(Object.fromEntries(columns.map((c) => [c.key, c.label])), layout.headerY, true, null);
  legend.rows.forEach((r, i) => drawRow(r.text, layout.firstRowY + i * rowHeight, false, r));
  drawRow(legend.totals.text, layout.totalsY, true, null);
  ctx.restore();
  return layout;
}

// --------------------------------------------------------------- self-check

export function runLegendSelfCheck() {
  const failures = [];
  let passed = 0;
  const check = (label, cond) => { if (cond) passed += 1; else failures.push(label); };
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const items = [
    // Beams: 20 ft + 15 ft (page 1, 2) at 35 lb/ft → 35 ft, 1225 lb, 0.6125 tn
    { tool: 'length', label: 'Beams', length_ft: 20, unit_weight_lbs_per_ft: 35, page_number: 1, color: '#ef4444' },
    { tool: 'length', label: 'beams', length_ft: 15, unit_weight_lbs_per_ft: 35, page_number: 2, color: '#ef4444' },
    // Base plates: 4 + 3 dots on pages 1 and 3 → 7
    { tool: 'count', label: 'Base plates', points: [{}, {}, {}, {}], page_number: 1, color: '#f97316', symbol: 'square' },
    { tool: 'count', label: 'Base plates', points: [{}, {}, {}], page_number: 3, color: '#f97316', symbol: 'square' },
    // Deck 100 + 50.5 sf on page 4
    { tool: 'area', label: 'Deck', area_sq_ft: 100, page_number: 4 },
    { tool: 'area', label: 'Deck', area_sq_ft: 50.5, page_number: 4 },
    // rejected rows never count
    { tool: 'length', label: 'Beams', length_ft: 999, page_number: 1, is_accepted: false },
  ];
  const lg = buildLegendData(items);
  const beams = lg.rows.find((r) => r.label === 'Beams');
  const plates = lg.rows.find((r) => r.label === 'Base plates');
  const deck = lg.rows.find((r) => r.label === 'Deck');
  check('3 rows', lg.rows.length === 3);
  check('beam length 35', beams && near(beams.length_ft, 35));
  check('beam weight 1225', beams && near(beams.weight_lbs, 1225) && near(beams.tons, 0.6125));
  check('beam text', beams?.text.length === '35\'-0"' && beams?.text.weight === '1,225 lb' && beams?.text.tons === '0.61');
  check('beam pages', beams?.page_range === '1-2');
  check('plates 7', plates?.count === 7 && plates.text.count === '7' && plates.page_range === '1, 3');
  check('plates symbol', plates?.symbol === 'square');
  check('deck 150.5', deck && near(deck.area_sq_ft, 150.5) && deck.text.area === '150.5 sf');
  check('totals', near(lg.totals.weight_lbs, 1225) && lg.totals.count === 7);
  check('columns', lg.columns.map((c) => c.key).join(',') === 'symbol,label,count,length,area,weight,tons,pages');
  const p1 = buildLegendData(items, { pages: [1] });
  check('page filter', p1.rows.find((r) => r.label === 'Beams')?.length_ft === 20);
  check('page range', formatPageRange([7, 1, 2, 3, 5, 8]) === '1-3, 5, 7-8');
  check('ft-in', formatFeetInches(12.5) === '12\'-6"' && formatFeetInches(0.99) === '1\'-0"');
  const layout = layoutLegendTable(lg, { fontSize: 10, padding: 2 });
  check('layout height', near(layout.height, (10 * 1.25 + 4) + 14 * (1 + 3 + 1)));
  const set = { tools: [{ id: 't1', tool: 'length', label: 'Beams', subject: 'Framing', color: '#000000' }], columns: [] };
  const bySubject = buildLegendData(items, { toolSet: set, groupBy: 'subject' });
  check('group by subject', bySubject.rows.some((r) => r.label === 'Framing'));
  // Engine kinds: perimeter totals as length, volume in cy, angle never totaled.
  const eng = buildLegendData([
    { tool: 'perimeter', label: 'Edge angle', length_ft: 40, page_number: 1 },
    { tool: 'volume', label: 'Grout', area_sq_ft: 27, depth_ft: 1, volume_cu_yd: 1, page_number: 1 },
    { tool: 'angle', label: 'Angles', angle_deg: 45, page_number: 1 },
  ]);
  check('perimeter as length', eng.rows.find((r) => r.label === 'Edge angle')?.text.length === `40'-0"`);
  check('volume cy', eng.rows.find((r) => r.label === 'Grout')?.text.volume === '1.00 cy');
  check('angle not totaled', eng.rows.find((r) => r.label === 'Angles')?.weight_lbs === 0 && eng.columns.some((c) => c.key === 'volume'));
  return { passed, failed: failures.length, failures };
}
