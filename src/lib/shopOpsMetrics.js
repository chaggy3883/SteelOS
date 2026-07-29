const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

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
