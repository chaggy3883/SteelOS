// Build Area breakdown for a bid's takeoff — each area's share of the whole
// project, worked out from the Full Takeoff lines assigned to it. Pure (no
// db/React), so it's Node-checkable and shared by the Full Takeoff, the
// Areas tab and the save that keeps ProjectSequenceArea.contract_value_pct
// current.
//
// Basis: tons. An area's % of the project = its tons ÷ the takeoff's total
// tons × 100, every line counted once (lines with no area land in
// "Unassigned"). Hours are shown alongside on the same rows. Percentages are
// rounded to one decimal with the largest-remainder method, so the rounded
// figures always add up to exactly 100.0.

const round = (n, d) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;

// Largest remainder: floor every share to `d` decimals, then hand the
// leftover units to the biggest remainders, so the list sums to `total`.
export function roundSharesToTotal(values, total = 100, d = 1) {
  const scale = 10 ** d;
  const sum = values.reduce((s, v) => s + (Number(v) || 0), 0);
  if (!(sum > 0)) return values.map(() => 0);
  const exact = values.map((v) => ((Number(v) || 0) / sum) * total * scale);
  const floors = exact.map((v) => Math.floor(v));
  let left = Math.round(total * scale) - floors.reduce((s, v) => s + v, 0);
  const order = exact.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < order.length && left > 0; k += 1, left -= 1) floors[order[k][1]] += 1;
  return floors.map((v) => v / scale);
}

/**
 * areas: ProjectSequenceArea rows ({ id, name, production_priority }).
 * lines: [{ sequence_area_id, tons, hours, label }] — one per takeoff line
 *        (the caller computes tons / hours the same way the takeoff shows them).
 * Returns { rows: [{ key, area, name, tons, hours, lineCount, pctTons,
 *   pctHours, exactPctTons, steps }], totals: { tons, hours, lineCount },
 *   unassigned (the Unassigned row or null) }.
 */
export function buildAreaBreakdown(areas = [], lines = []) {
  const byKey = new Map();
  const ensure = (key, area) => {
    if (!byKey.has(key)) byKey.set(key, { key, area: area || null, name: area ? area.name : 'Unassigned', tons: 0, hours: 0, lineCount: 0, lines: [] });
    return byKey.get(key);
  };
  const known = new Map(areas.map((a) => [a.id, a]));
  areas.forEach((a) => ensure(a.id, a));
  lines.forEach((l) => {
    const area = l.sequence_area_id && known.get(l.sequence_area_id);
    const bucket = ensure(area ? area.id : 'unassigned', area);
    bucket.tons += Number(l.tons) || 0;
    bucket.hours += Number(l.hours) || 0;
    bucket.lineCount += 1;
    bucket.lines.push(l);
  });
  const ordered = [...areas.map((a) => byKey.get(a.id)), ...(byKey.has('unassigned') ? [byKey.get('unassigned')] : [])];
  const totalTons = ordered.reduce((s, r) => s + r.tons, 0);
  const totalHours = ordered.reduce((s, r) => s + r.hours, 0);
  const pctTons = roundSharesToTotal(ordered.map((r) => r.tons));
  const pctHours = roundSharesToTotal(ordered.map((r) => r.hours));
  const rows = ordered.map((r, i) => ({
    ...r,
    tons: round(r.tons, 4),
    hours: round(r.hours, 2),
    pctTons: pctTons[i],
    pctHours: pctHours[i],
    exactPctTons: totalTons > 0 ? (r.tons / totalTons) * 100 : 0,
    steps: [
      ...r.lines.map((l) => `${l.label || 'Line'}: ${round(l.tons, 4)} t`),
      `${r.name}: ${round(r.tons, 4)} t ÷ project ${round(totalTons, 4)} t × 100 = ${totalTons > 0 ? round((r.tons / totalTons) * 100, 3) : 0}%`,
      `Shown rounded to ${pctTons[i]}% (one decimal; every area's rounded % adds to 100.0)`,
    ],
  }));
  return {
    rows,
    totals: { tons: round(totalTons, 4), hours: round(totalHours, 2), lineCount: lines.length },
    unassigned: rows.find((r) => r.key === 'unassigned') || null,
  };
}

// Does this Area's % follow the takeoff? 'takeoff' yes, 'manual' no. Areas
// saved before this existed have no pct_source: one with a % already typed
// in keeps it (treated as set by hand — never overwritten quietly); one at
// 0% follows the takeoff.
export const areaFollowsTakeoff = (area) => (area?.pct_source
  ? area.pct_source === 'takeoff'
  : !(Number(area?.contract_value_pct) > 0));

// The % each area should store as its contract_value_pct when it follows
// the takeoff (pct_source !== 'manual'): its share of the tons that ARE in
// an area, so the areas themselves sum to 100 even while some lines are
// still unassigned. Returns Map(areaId -> pct).
export function automaticAreaPercents(areas = [], lines = []) {
  const assigned = lines.filter((l) => areas.some((a) => a.id === l.sequence_area_id));
  const tons = areas.map((a) => assigned.filter((l) => l.sequence_area_id === a.id).reduce((s, l) => s + (Number(l.tons) || 0), 0));
  const pct = roundSharesToTotal(tons);
  return new Map(areas.map((a, i) => [a.id, pct[i]]));
}
