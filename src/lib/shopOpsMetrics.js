const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// Single source of truth for the 6 shop-floor stations — station names and
// heatmap colors are shared verbatim between ShopOperations.jsx's Bottleneck
// Radar tab and the Shop Floor Command Center so the two views never drift
// into a second naming/color convention for the same stations.
export const STATIONS = [
  { id: 1, name: 'Receiving' }, { id: 2, name: 'Shot Blaster' }, { id: 3, name: 'Iron Worker' },
  { id: 4, name: 'Drill Line' }, { id: 5, name: 'Fab (Layout / Tack)' }, { id: 6, name: 'Paint' },
];
export const stationName = (id) => STATIONS.find((s) => s.id === Number(id))?.name || `Station ${id}`;
export const HEATMAP_COLOR = { Green: 'bg-green-500/20 text-green-700', Yellow: 'bg-yellow-500/30 text-yellow-800', Red: 'bg-red-500/40 text-red-800' };

// piece_timing_events.event_type enum. start/complete/hold/resume are the
// scan-driven per-station clock audit trail (ShopFloorCommandCenter.jsx)
// alongside station_logs' start/stop sessions. The rest are the piece
// lifecycle timeline (ShopFabrication.jsx, JobsiteReceiving.jsx) — see
// src/lib/pieceTimeline.js for the shared read side.
export const TIMING_EVENT_TYPES = [
  'start', 'complete', 'hold', 'resume',
  'qr_created', 'received', 'start_work', 'ready_for_inspection', 'inspection_pass', 'inspection_fail', 'scan_generic',
];

const startOfWeek = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday as week start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

const weeksSpanned = (schedule) => {
  const s = startOfWeek(schedule.scheduled_start_date);
  const e = startOfWeek(schedule.scheduled_end_date);
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / WEEK_MS) + 1);
};

export function buildWeekColumns(count = 8, referenceDate = new Date()) {
  const start = startOfWeek(referenceDate);
  return Array.from({ length: count }, (_, i) => {
    const weekStart = new Date(start.getTime() + i * WEEK_MS);
    const weekEnd = new Date(weekStart.getTime() + WEEK_MS - DAY_MS);
    return { weekStart, weekEnd, label: weekStart.toISOString().slice(0, 10) };
  });
}

// Green <= 85%, Yellow 86-100%, Red > 100% of max_shop_capacity_tons_weekly.
export function getCapacityStatus(tons, maxCapacityWeekly) {
  if (!maxCapacityWeekly) return 'Green';
  const pct = (tons / maxCapacityWeekly) * 100;
  if (pct > 100) return 'Red';
  if (pct > 85) return 'Yellow';
  return 'Green';
}

// Prorates each schedule's target_tons evenly across the weeks it spans, so a
// multi-week job doesn't double-count its full tonnage in every week it touches.
export function buildCapacityMatrix(schedules, projects, weekColumns, maxCapacityWeekly) {
  const rows = projects.map((project) => {
    const projectSchedules = schedules.filter((s) => s.project_id === project.id);
    const cells = weekColumns.map((week) => {
      const tons = projectSchedules.reduce((sum, s) => {
        const start = new Date(s.scheduled_start_date);
        const end = new Date(s.scheduled_end_date);
        if (end < week.weekStart || start > week.weekEnd) return sum;
        return sum + (Number(s.target_tons) || 0) / weeksSpanned(s);
      }, 0);
      return tons;
    });
    return { project, cells };
  });
  const totals = weekColumns.map((_, i) => rows.reduce((sum, r) => sum + r.cells[i], 0));
  const statuses = totals.map((t) => getCapacityStatus(t, maxCapacityWeekly));
  return { rows, totals, statuses };
}

// The single definition of "a target was actually set" for target_minutes —
// used at the EmployeeCenter write path and every downstream read, so a
// blank kiosk input, garbage input (non-numeric, negative, zero), and an
// unset record all collapse to the same null rather than three different
// silent-zero bugs. A real target is always a positive number.
export function normalizeTargetMinutes(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function getStationBottlenecks(pieces, threshold = 50) {
  const counts = {};
  pieces.forEach((p) => {
    counts[p.current_station_id] = (counts[p.current_station_id] || 0) + 1;
  });
  return Object.entries(counts).map(([stationId, count]) => ({
    stationId: Number(stationId),
    count,
    isBottleneck: count > threshold,
  }));
}

// Dwell-time bottleneck signal, additive to the headcount signal above (that
// function is left untouched — this is a second, independent read on the
// same stations). avgTargetMinutes has no real per-station source today:
// piece_production_logs (EmployeeCenter's manual self-timer) carries
// target_minutes at the whole-piece level only, keyed by a free-text
// piece_mark, with no piece_id or station_id — it is a separate, disconnected
// timing system from the pieces/station_logs shop-floor pipeline these
// stations belong to (there is no FK between them). This does a best-effort
// match on piece_mark text (same convention already used by
// getMaterialShortages for its PO-category match) to borrow a target where
// the same piece_mark happens to appear in both systems. When no match
// exists for a station's pieces in the window, avgTargetMinutes/
// dwellVariancePct are left null for it and only the headcount signal (via
// headcountBottlenecks) can flag that station — a real limitation of the
// current data model, not a bug. The join key is `${project_id}::${mark}`,
// not piece_mark alone — piece_mark repeats legitimately across projects,
// and both pieces/station_logs and piece_production_logs already carry
// project_id, so scoping the key by it prevents one project's manually
// logged target minutes from being attributed to another project's piece.
//
// headcountBottlenecks is the array returned by getStationBottlenecks —
// passed in (rather than recomputed) so the two signals are merged into one
// isBottleneck per station here, instead of ShopOperations.jsx and the Shop
// Floor Command Center each reconciling two separate flags themselves.
export function getStationDwellVariance(stationLogs, pieces, pieceProductionLogs, headcountBottlenecks = [], thresholdPct = 25, referenceDate = new Date()) {
  const windowStart = referenceDate.getTime() - WEEK_MS;
  const byStation = {};
  stationLogs.forEach((log) => {
    if (log.status !== 'Complete' || !log.end_time) return;
    const endMs = new Date(log.end_time).getTime();
    if (endMs < windowStart || endMs > referenceDate.getTime()) return;
    const stationId = Number(log.station_id);
    if (!byStation[stationId]) byStation[stationId] = { actualMinutesSum: 0, actualCount: 0, pieceMarks: new Set() };
    const bucket = byStation[stationId];
    bucket.actualMinutesSum += log.elapsed_minutes || 0;
    bucket.actualCount += 1;
    const piece = pieces.find((p) => p.id === log.piece_id);
    if (piece?.piece_mark) bucket.pieceMarks.add(`${piece.project_id || ''}::${piece.piece_mark.trim().toLowerCase()}`);
  });

  const targetsByPieceMark = {};
  pieceProductionLogs.forEach((log) => {
    if (log.status !== 'Complete' || !log.piece_mark) return;
    const target = normalizeTargetMinutes(log.target_minutes);
    if (target == null) return; // no target entered — must not drag the piece-mark average toward 0
    const key = `${log.project_id || ''}::${log.piece_mark.trim().toLowerCase()}`;
    if (!targetsByPieceMark[key]) targetsByPieceMark[key] = [];
    targetsByPieceMark[key].push(target);
  });

  const headcountByStation = {};
  headcountBottlenecks.forEach((b) => { headcountByStation[b.stationId] = b; });

  // Seeded from STATIONS (not just whatever ids happen to show up in the data)
  // so a station with zero current pieces and zero recent completions still
  // gets a result row — getStationBottlenecks only emits ids with count >= 1,
  // which would otherwise make a quiet station vanish from the grid instead
  // of showing as an empty/Green tile.
  const stationIds = new Set([
    ...STATIONS.map((s) => s.id),
    ...Object.keys(byStation).map(Number),
    ...headcountBottlenecks.map((b) => b.stationId),
  ]);

  return Array.from(stationIds).sort((a, b) => a - b).map((stationId) => {
    const bucket = byStation[stationId];
    const avgActualMinutes = bucket && bucket.actualCount > 0 ? bucket.actualMinutesSum / bucket.actualCount : null;

    let avgTargetMinutes = null;
    if (bucket) {
      const targets = [];
      bucket.pieceMarks.forEach((mark) => {
        (targetsByPieceMark[mark] || []).forEach((t) => targets.push(t));
      });
      if (targets.length > 0) avgTargetMinutes = targets.reduce((sum, t) => sum + t, 0) / targets.length;
    }

    const dwellVariancePct = avgTargetMinutes > 0 && avgActualMinutes != null
      ? ((avgActualMinutes - avgTargetMinutes) / avgTargetMinutes) * 100
      : null;
    const isDwellBottleneck = dwellVariancePct != null && dwellVariancePct > thresholdPct;

    const headcount = headcountByStation[stationId];
    const isHeadcountBottleneck = !!headcount?.isBottleneck;
    const count = headcount?.count || 0;

    let signal = 'None';
    if (isHeadcountBottleneck && isDwellBottleneck) signal = 'Both';
    else if (isHeadcountBottleneck) signal = 'Queue';
    else if (isDwellBottleneck) signal = 'Dwell';

    return {
      stationId,
      count,
      avgActualMinutes,
      avgTargetMinutes,
      dwellVariancePct,
      isHeadcountBottleneck,
      isDwellBottleneck,
      isBottleneck: isHeadcountBottleneck || isDwellBottleneck,
      signal,
    };
  });
}

// The single ratio formula behind every efficiency number in the app
// (ShopEfficiency.jsx's leaderboard/variance tables and the Shop Floor
// Command Center's shop-wide figure alike) — callers aggregate
// elapsed_minutes/target_minutes however makes sense for their grouping
// (per employee, per material profile, per shop per day), then pass the
// totals through here so the actual math lives in exactly one place.
// targetMinutes must be a sum of already-normalized (normalizeTargetMinutes)
// values — a group where nothing had a target sums to 0 here, which is
// deliberately treated the same as "no data" (null) rather than computed
// into a real-looking 0% or divide-by-zero result. Callers use the null to
// render "No target set" instead of a bogus percentage.
export function computeEfficiencyPct(actualMinutes, targetMinutes) {
  if (!(targetMinutes > 0) || !(actualMinutes > 0)) return null;
  return Math.round((targetMinutes / actualMinutes) * 100);
}

// A Paused log is measured from when it was paused (end_time); an In_Progress
// log is measured from when it started — both answer "how long has this piece
// been sitting in this state without moving."
export function getStalePieces(stationLogs, hours = 8, referenceDate = new Date()) {
  const thresholdMs = hours * 60 * 60 * 1000;
  return stationLogs.filter((log) => {
    if (log.status !== 'In_Progress' && log.status !== 'Paused') return false;
    const anchor = log.status === 'In_Progress' ? log.start_time : (log.end_time || log.start_time);
    if (!anchor) return false;
    return referenceDate.getTime() - new Date(anchor).getTime() > thresholdMs;
  });
}

// Approximation, not ground truth: qa_inspections records the inspector, not
// the fabricator, so "whose piece" is derived from station 5 station_logs
// entries. "First attempt" = the earliest qa_inspections row per (piece, stage).
export function getEmployeeScorecards(stationLogs, qaInspections) {
  const byEmployee = {};
  stationLogs.forEach((log) => {
    if (!log.employee_id) return;
    if (!byEmployee[log.employee_id]) {
      byEmployee[log.employee_id] = { employee_id: log.employee_id, totalActiveMinutes: 0, piecesWorked: new Set(), completedPieces: new Set() };
    }
    const entry = byEmployee[log.employee_id];
    entry.totalActiveMinutes += log.elapsed_minutes || 0;
    if (Number(log.station_id) === 5) entry.piecesWorked.add(log.piece_id);
    if (log.status === 'Complete') entry.completedPieces.add(log.piece_id);
  });

  const firstAttempt = {};
  qaInspections.forEach((insp) => {
    const key = `${insp.piece_id}:${insp.stage}`;
    if (!firstAttempt[key] || new Date(insp.inspected_at) < new Date(firstAttempt[key].inspected_at)) {
      firstAttempt[key] = insp;
    }
  });
  const allKeys = Object.keys(firstAttempt);

  return Object.values(byEmployee).map((entry) => {
    const relevantKeys = allKeys.filter((key) => entry.piecesWorked.has(key.split(':')[0]));
    const totalInspected = relevantKeys.length;
    const passedFirstAttempt = relevantKeys.filter((key) => firstAttempt[key].status === 'Approved').length;
    return {
      employee_id: entry.employee_id,
      totalActiveMinutes: entry.totalActiveMinutes,
      partThroughput: entry.completedPieces.size,
      totalInspected,
      qaPassRatePct: totalInspected > 0 ? Math.round((passedFirstAttempt / totalInspected) * 100) : null,
    };
  });
}

// No Tekla integration exists (or is planned) in this app. This uses the
// existing bid Material Takeoff as the material-requirement source, matched
// against Purchasing's purchase_orders/receiving_logs pair by category text —
// there's no formal schema/FK for either, so this is a best-effort string match.
export function getMaterialShortages(materialTakeoffLines, purchaseOrders, receivingLogs) {
  return materialTakeoffLines.filter((line) => {
    const shapeText = String(line.material_type || line.material_size || '').toLowerCase();
    const matchingPOs = purchaseOrders.filter((po) => String(po.material_category || '').toLowerCase().includes(shapeText));
    if (matchingPOs.length === 0) return true;
    const poIds = new Set(matchingPOs.map((po) => po.id));
    const hasCompleteReceipt = receivingLogs.some((log) => poIds.has(log.po_id) && log.delivery_status === 'Received Complete');
    return !hasCompleteReceipt;
  });
}

export function hasActiveOverride(overrides, pieceId, overrideType) {
  return overrides.some((o) => o.piece_id === pieceId && o.override_type === overrideType);
}

// The single source of truth for "priority sync" — both the Scheduler Matrix
// and ShopFabrication.jsx's tablet Pieces list must sort through this function
// so an Expedite_Part override or a priority_weight change is reflected
// identically everywhere, not reimplemented per screen.
export function sortPiecesByPriority(pieces, schedules, overrides) {
  const priorityByProject = {};
  schedules.forEach((s) => {
    priorityByProject[s.project_id] = Math.max(priorityByProject[s.project_id] || 0, Number(s.priority_weight) || 0);
  });
  const expeditedIds = new Set(overrides.filter((o) => o.override_type === 'Expedite_Part').map((o) => o.piece_id));

  return [...pieces].sort((a, b) => {
    const aExpedited = expeditedIds.has(a.id) ? 1 : 0;
    const bExpedited = expeditedIds.has(b.id) ? 1 : 0;
    if (aExpedited !== bExpedited) return bExpedited - aExpedited;
    const aPriority = priorityByProject[a.project_id] || 0;
    const bPriority = priorityByProject[b.project_id] || 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime();
  });
}
