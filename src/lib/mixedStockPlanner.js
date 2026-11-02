// Mixed stock-length cut planning for "Combine for ordering" (Mult). Pure,
// deterministic, Node-checkable — no db/React.
//
// Given every piece of one shape + size + grade and the stock lengths on
// offer, each bar may be a different length: the goal is the least total
// length bought (= the lowest % drop), then the fewest bars, then the fewest
// different lengths on the order. Every bar has a capacity (how much of it can
// hold pieces + kerf) set by the caller — stock length minus squaring minus
// the larger of the clamp allowance and the grace (see stockCombiner.js).
//
// Several strategies run and the best plan wins:
//   1. Pattern greedy: repeatedly find, across every stock length, the cut
//      pattern that uses the highest share of its bar for the pieces still
//      left (a bounded knapsack over the distinct piece lengths), and cut as
//      many bars of it as the remaining pieces allow.
//      It also runs with only the lengths from each offered length upward.
//   2. First-fit decreasing into the longest stock, and into each single
//      stock length.
//   3. Best-fit decreasing into the longest stock.
// After each, every bar is re-sized to the SHORTEST offered length that still
// holds its cuts, which is what turns a one-length plan into a mixed one.
// Finally the worst-used bars are pooled and re-planned with the pattern
// greedy, kept only if that lowers the total.
//
// Lengths are in inches. Knapsack weights are rounded UP to 1/16", so a
// pattern that fits on paper always fits the bar.

const EPS = 1e-9;
const RES = 16; // 1/16" grid for the knapsack

const lenKey = (n) => Math.round(n * 10000) / 10000;

// units: [{ piece_id, length_in }] -> distinct lengths (longest first), each
// with its queue of piece ids.
function groupUnits(units) {
  const map = new Map();
  units.forEach((u) => {
    const k = lenKey(u.length_in);
    if (!map.has(k)) map.set(k, { length_in: u.length_in, ids: [] });
    map.get(k).ids.push(u.piece_id);
  });
  return [...map.values()].sort((a, b) => b.length_in - a.length_in);
}

// Bounded knapsack: pick counts[i] <= demand[i] of each length so that
// sum(len + kerf) <= capacity + kerf (kerf only between cuts) and the summed
// piece length is as large as possible. Returns counts per distinct length.
function bestPattern(lengths, demand, capacityIn, kerfIn) {
  const cap = Math.floor((capacityIn + kerfIn + EPS) * RES);
  if (cap <= 0) return null;
  const best = new Float64Array(cap + 1); // best piece length at weight <= w
  const choice = []; // per expanded item: { idx, mult, take: Uint8Array }
  lengths.forEach((L, idx) => {
    let left = demand[idx];
    if (!(left > 0)) return;
    const w1 = Math.ceil((L + kerfIn) * RES - EPS);
    if (w1 > cap) return;
    left = Math.min(left, Math.floor(cap / w1));
    // Binary splitting turns a bounded item into 0/1 items.
    for (let mult = 1; left > 0; mult *= 2) {
      const m = Math.min(mult, left);
      left -= m;
      const w = w1 * m;
      const v = L * m;
      const take = new Uint8Array(cap + 1);
      for (let c = cap; c >= w; c--) {
        const cand = best[c - w] + v;
        if (cand > best[c] + EPS) { best[c] = cand; take[c] = 1; }
      }
      choice.push({ idx, m, w, take });
    }
  });
  if (best[cap] <= EPS) return null;
  const counts = lengths.map(() => 0);
  let c = cap;
  for (let i = choice.length - 1; i >= 0; i--) {
    if (choice[i].take[c]) { counts[choice[i].idx] += choice[i].m; c -= choice[i].w; }
  }
  return { counts, pieceIn: best[cap] };
}

// Shortest offered stock that holds `usedIn` (pieces + kerf between them).
function shortestFitting(stocks, usedIn) {
  return stocks.find((s) => s.capacity_in + EPS >= usedIn) || null;
}

const usedOf = (cuts, kerfIn) => cuts.reduce((sum, c) => sum + c.length_in, 0) + Math.max(0, cuts.length - 1) * kerfIn;

function resize(bars, stocks, kerfIn) {
  return bars.map((b) => {
    const used = usedOf(b.cuts, kerfIn);
    const s = shortestFitting(stocks, used) || stocks.find((x) => x.length_in === b.stock_length_in);
    return { stock_length_in: s.length_in, capacity_in: s.capacity_in, cuts: b.cuts, used_in: used };
  });
}

function patternGreedy(groups, stocks, kerfIn) {
  const lengths = groups.map((g) => g.length_in);
  const demand = groups.map((g) => g.ids.length);
  const queues = groups.map((g) => [...g.ids]);
  const bars = [];
  let guard = 0;
  while (demand.some((d) => d > 0) && guard++ < 100000) {
    let pick = null;
    stocks.forEach((s) => {
      const p = bestPattern(lengths, demand, s.capacity_in, kerfIn);
      if (!p) return;
      const util = p.pieceIn / s.length_in;
      // Highest share of the bar used; ties go to the longer pattern (more
      // pieces placed per bar), then the shorter stock.
      if (!pick || util > pick.util + EPS || (Math.abs(util - pick.util) <= EPS && p.pieceIn > pick.p.pieceIn + EPS)) pick = { s, p, util };
    });
    if (!pick) break; // nothing left fits any stock (caller pre-filters these)
    let times = Infinity;
    pick.p.counts.forEach((n, i) => { if (n > 0) times = Math.min(times, Math.floor(demand[i] / n)); });
    for (let t = 0; t < times; t++) {
      const cuts = [];
      pick.p.counts.forEach((n, i) => { for (let k = 0; k < n; k++) cuts.push({ piece_id: queues[i].shift(), length_in: lengths[i] }); });
      pick.p.counts.forEach((n, i) => { demand[i] -= n; });
      bars.push({ stock_length_in: pick.s.length_in, cuts });
    }
  }
  return bars;
}

function fitDecreasing(units, stocks, openStock, kerfIn, mode) {
  const sorted = [...units].sort((a, b) => b.length_in - a.length_in);
  const bars = [];
  sorted.forEach((u) => {
    let target = null;
    let bestSlack = Infinity;
    for (const b of bars) {
      const need = u.length_in + (b.cuts.length ? kerfIn : 0);
      const slack = b.capacity_in - b.used_in - need;
      if (slack < -EPS) continue;
      if (mode === 'first') { target = b; break; }
      if (slack < bestSlack) { bestSlack = slack; target = b; }
    }
    if (target) {
      target.used_in += u.length_in + (target.cuts.length ? kerfIn : 0);
      target.cuts.push({ piece_id: u.piece_id, length_in: u.length_in });
      return;
    }
    const s = openStock.capacity_in + EPS >= u.length_in ? openStock : shortestFitting(stocks, u.length_in);
    if (!s) return;
    bars.push({ stock_length_in: s.length_in, capacity_in: s.capacity_in, used_in: u.length_in, cuts: [{ piece_id: u.piece_id, length_in: u.length_in }] });
  });
  return bars;
}

const orderedOf = (bars) => bars.reduce((sum, b) => sum + b.stock_length_in, 0);
const distinctOf = (bars) => new Set(bars.map((b) => b.stock_length_in)).size;

function better(a, b) {
  if (!b) return true;
  const oa = orderedOf(a); const ob = orderedOf(b);
  if (oa < ob - EPS) return true;
  if (oa > ob + EPS) return false;
  if (a.length !== b.length) return a.length < b.length;
  return distinctOf(a) < distinctOf(b);
}

// Pool the least-used bars (below 97% piece use) and re-plan them together;
// keep it only when the total ordered length drops.
function improveTail(bars, stocks, kerfIn) {
  const util = (b) => b.cuts.reduce((s, c) => s + c.length_in, 0) / b.stock_length_in;
  const weak = bars.filter((b) => util(b) < 0.97);
  if (weak.length < 2) return bars;
  const keep = bars.filter((b) => util(b) >= 0.97);
  const units = weak.flatMap((b) => b.cuts.map((c) => ({ piece_id: c.piece_id, length_in: c.length_in })));
  const replanned = resize(patternGreedy(groupUnits(units), stocks, kerfIn), stocks, kerfIn);
  return orderedOf(replanned) < orderedOf(weak) - EPS ? [...keep, ...replanned] : bars;
}

/**
 * units:  [{ piece_id, length_in }] — one per physical piece, every one
 *         already known to fit the longest stock's capacity.
 * stocks: [{ length_in, capacity_in }] — the lengths on offer.
 * Returns bars [{ stock_length_in, capacity_in, used_in, cuts: [{ piece_id, length_in }] }]
 * in a stable order: longest stock first, then fullest.
 */
export function planMixedStock(units, stocks, kerfIn = 0) {
  const offer = [...stocks].filter((s) => s.capacity_in > 0).sort((a, b) => a.length_in - b.length_in);
  if (!units.length || !offer.length) return [];
  const longest = offer[offer.length - 1];
  const candidates = [
    resize(patternGreedy(groupUnits(units), offer, kerfIn), offer, kerfIn),
    // Pattern greedy held to one length at a time, so the mix is never worse
    // than the best single length.
    ...offer.map((s) => resize(patternGreedy(groupUnits(units), offer.filter((x) => x.length_in >= s.length_in), kerfIn), offer, kerfIn)),
    resize(fitDecreasing(units, offer, longest, kerfIn, 'first'), offer, kerfIn),
    resize(fitDecreasing(units, offer, longest, kerfIn, 'best'), offer, kerfIn),
    ...offer.map((s) => resize(fitDecreasing(units, offer, s, kerfIn, 'first'), offer, kerfIn)),
  ].map((bars) => improveTail(bars, offer, kerfIn));
  // A plan that left a piece out (can't happen once the caller pre-filters
  // oversize pieces) never wins.
  const complete = candidates.filter((bars) => bars.reduce((n, b) => n + b.cuts.length, 0) === units.length);
  let best = null;
  complete.forEach((bars) => { if (better(bars, best)) best = bars; });
  return (best || []).slice().sort((a, b) => b.stock_length_in - a.stock_length_in || b.used_in - a.used_in);
}
