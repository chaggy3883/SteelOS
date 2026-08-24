// KPI Builder metric catalog — one entry per selectable metric, each backed
// by a REAL entity/field already tracked elsewhere in the app (qa_inspections,
// PieceMark, station_logs, EquipmentService, loads, ...) rather than a
// parallel data source invented for this page. A handful of metrics reference
// data this app doesn't track anywhere yet (equipment downtime duration,
// shipping promised/actual dates, training hours) — those are marked
// `stub: true` and always compute to 0, with `definition` explaining why, so
// the UI can be honest about it instead of fabricating numbers.
import { computeLevelStatus } from '@/lib/serviceScheduleEngine';

export const AREAS = [
  { value: 'safety', label: 'Safety' },
  { value: 'quality', label: 'Quality' },
  { value: 'production', label: 'Production' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'shipping', label: 'Shipping' },
];

export const CHART_TYPES = [
  { value: 'line', label: 'Line' },
  { value: 'bar', label: 'Bar' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Pie' },
];

export const AGGREGATION_LEVELS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

export const DATE_RANGE_OPTIONS = [
  { value: 'last_week', label: 'Last 7 Days' },
  { value: 'last_month', label: 'Last 30 Days' },
  { value: 'last_year', label: 'Last Year' },
  { value: 'custom', label: 'Custom' },
];

// Entities the KPI builder reads from, keyed exactly as registered in
// src/api/apiClient.js — used by the page to fetch everything once up front.
export const KPI_SOURCE_ENTITIES = [
  'safety_incidents', 'SafetyMeeting', 'employees', 'attendance_punches',
  'qa_inspections', 'ncr_records', 'PieceMark', 'pieces', 'shop_schedules',
  'piece_production_logs', 'station_logs', 'EquipmentService',
  'erection_fleet_assets', 'ServiceSchedule', 'loads', 'shipping_manifests',
];

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfWeekMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function resolveDateRange({ date_range_type, custom_start_date, custom_end_date }) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();

  if (date_range_type === 'custom') {
    const s = toDate(custom_start_date) || new Date();
    const e = toDate(custom_end_date) || new Date();
    s.setHours(0, 0, 0, 0);
    e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  if (date_range_type === 'last_week') start.setDate(end.getDate() - 6);
  else if (date_range_type === 'last_year') start.setDate(end.getDate() - 364);
  else start.setDate(end.getDate() - 29); // last_month default
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function enumerateBuckets(start, end, aggregationLevel) {
  const buckets = [];
  if (aggregationLevel === 'monthly') {
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      const bucketStart = new Date(cursor);
      const bucketEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
      buckets.push({ key, label: monthLabel(key), bucketStart, bucketEnd });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  } else if (aggregationLevel === 'weekly') {
    let cursor = startOfWeekMonday(start);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      const bucketStart = new Date(cursor);
      const bucketEnd = new Date(cursor);
      bucketEnd.setDate(bucketEnd.getDate() + 6);
      bucketEnd.setHours(23, 59, 59, 999);
      buckets.push({ key, label: `Week of ${bucketStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, bucketStart, bucketEnd });
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 7);
    }
  } else {
    let cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      const bucketStart = new Date(cursor);
      const bucketEnd = new Date(cursor);
      bucketEnd.setHours(23, 59, 59, 999);
      buckets.push({ key, label: bucketStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), bucketStart, bucketEnd });
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  // Guard against a pathological range (e.g. custom end before start)
  // producing an infinite/huge loop — cap at 5 years of daily buckets.
  return buckets.slice(0, 1830);
}

function bucketIndexForDate(dateVal, buckets) {
  const d = toDate(dateVal);
  if (!d) return -1;
  const t = d.getTime();
  return buckets.findIndex((b) => t >= b.bucketStart.getTime() && t <= b.bucketEnd.getTime());
}

function within(dateVal, start, end) {
  const d = toDate(dateVal);
  if (!d) return false;
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}

function countBy(records, dateFn, buckets, filterFn = () => true) {
  const counts = buckets.map(() => 0);
  records.forEach((r) => {
    if (!filterFn(r)) return;
    const idx = bucketIndexForDate(dateFn(r), buckets);
    if (idx >= 0) counts[idx] += 1;
  });
  return buckets.map((b, i) => ({ key: b.key, label: b.label, value: counts[i] }));
}

function sumBy(records, dateFn, valueFn, buckets, filterFn = () => true) {
  const sums = buckets.map(() => 0);
  records.forEach((r) => {
    if (!filterFn(r)) return;
    const idx = bucketIndexForDate(dateFn(r), buckets);
    if (idx >= 0) sums[idx] += valueFn(r) || 0;
  });
  return buckets.map((b, i) => ({ key: b.key, label: b.label, value: sums[i] }));
}

function ratioBy(records, dateFn, numeratorFn, denominatorFn, buckets, scale = 100) {
  const num = buckets.map(() => 0);
  const den = buckets.map(() => 0);
  records.forEach((r) => {
    if (!denominatorFn(r)) return;
    const idx = bucketIndexForDate(dateFn(r), buckets);
    if (idx < 0) return;
    den[idx] += 1;
    if (numeratorFn(r)) num[idx] += 1;
  });
  return buckets.map((b, i) => ({ key: b.key, label: b.label, value: den[i] > 0 ? (num[i] / den[i]) * scale : 0 }));
}

function avgBy(records, dateFn, valueFn, buckets, filterFn = () => true) {
  const sums = buckets.map(() => 0);
  const counts = buckets.map(() => 0);
  records.forEach((r) => {
    if (!filterFn(r)) return;
    const idx = bucketIndexForDate(dateFn(r), buckets);
    if (idx < 0) return;
    const v = valueFn(r);
    if (v == null || Number.isNaN(v)) return;
    sums[idx] += v;
    counts[idx] += 1;
  });
  return buckets.map((b, i) => ({ key: b.key, label: b.label, value: counts[i] > 0 ? sums[i] / counts[i] : 0 }));
}

const zeroSeries = (buckets) => buckets.map((b) => ({ key: b.key, label: b.label, value: 0 }));

const INCIDENT_TYPES = [
  { value: 'near_miss', label: 'Near Miss' },
  { value: 'minor_injury', label: 'Minor Injury' },
  { value: 'major_injury', label: 'Major Injury' },
  { value: 'fatality', label: 'Fatality' },
];

// PieceMark statuses that indicate fabrication is behind it (this enum's
// natural order is not_started -> in_fabrication -> fabricated -> inspected
// -> painted -> shipped -> erected -> rejected).
const FAB_COMPLETE_STATUSES = ['fabricated', 'inspected', 'painted', 'shipped', 'erected'];

export const METRICS = [
  // ---------------------------------------------------------------- SAFETY
  {
    key: 'incident_count', area: 'safety', label: 'Incident Count', unit: 'count', shape: 'timeseries', pieAgg: 'sum',
    definition: 'Count of safety_incidents with an incident date in the selected period.',
    compute: ({ data, buckets }) => countBy(data.safety_incidents, (r) => r.incident_date, buckets),
  },
  {
    key: 'incident_types_breakdown', area: 'safety', label: 'Incident Types Breakdown', unit: 'count', shape: 'category', pieAgg: 'sum',
    definition: 'safety_incidents in the selected period, grouped by incident_type (near miss / minor / major / fatality).',
    compute: ({ data, start, end }) => {
      const rows = data.safety_incidents.filter((r) => within(r.incident_date, start, end));
      return INCIDENT_TYPES.map((t) => ({ key: t.value, label: t.label, value: rows.filter((r) => r.incident_type === t.value).length }));
    },
  },
  {
    key: 'hours_without_lost_time', area: 'safety', label: 'Hours Without Lost-Time Incident', unit: 'hours', shape: 'timeseries', pieAgg: 'avg',
    definition: 'Cumulative hours worked (attendance_punches) since the most recent major-injury or fatality incident, as of the end of each period.',
    compute: ({ data, buckets }) => {
      const lostTimeTimes = data.safety_incidents
        .filter((r) => r.incident_type === 'major_injury' || r.incident_type === 'fatality')
        .map((r) => toDate(r.incident_date)?.getTime())
        .filter(Boolean)
        .sort((a, b) => a - b);
      return buckets.map((b) => {
        const bucketEndTime = b.bucketEnd.getTime();
        const sinceTime = [...lostTimeTimes].reverse().find((t) => t <= bucketEndTime) || null;
        const hours = data.attendance_punches.reduce((sum, p) => {
          const t = toDate(p.punch_time)?.getTime();
          if (!t || t > bucketEndTime) return sum;
          if (sinceTime && t <= sinceTime) return sum;
          return sum + ((p.total_regular_minutes || 0) + (p.total_overtime_minutes || 0)) / 60;
        }, 0);
        return { key: b.key, label: b.label, value: Math.round(hours) };
      });
    },
  },
  {
    key: 'training_hours_completed', area: 'safety', label: 'Training Hours Completed', unit: 'hours', shape: 'timeseries', pieAgg: 'sum', stub: true,
    definition: 'Not yet tracked — SteelOS has no employee training-hours log. Shown as 0 until that data source exists.',
    compute: ({ buckets }) => zeroSeries(buckets),
  },
  {
    key: 'toolbox_talk_count', area: 'safety', label: 'Toolbox Talk Count', unit: 'count', shape: 'timeseries', pieAgg: 'sum',
    definition: 'Count of SafetyMeeting records with a meeting date in the selected period (all meeting types).',
    compute: ({ data, buckets }) => countBy(data.SafetyMeeting, (r) => r.meeting_date, buckets),
  },
  {
    key: 'safety_meeting_attendance_rate', area: 'safety', label: 'Safety Meeting Attendance Rate', unit: 'percent', shape: 'timeseries', pieAgg: 'avg',
    definition: 'Average of (meeting attendees ÷ currently active employees) across SafetyMeeting records in each period. SteelOS has no per-meeting "required attendee" list, so the current active headcount is used as the denominator.',
    compute: ({ data, buckets }) => {
      const activeCount = Math.max(1, data.employees.filter((e) => e.is_active_login !== false).length);
      return avgBy(data.SafetyMeeting, (r) => r.meeting_date, (r) => ((r.attendees || []).length / activeCount) * 100, buckets);
    },
  },
  {
    key: 'ppe_violations', area: 'safety', label: 'PPE Violations', unit: 'count', shape: 'timeseries', pieAgg: 'sum', stub: true,
    definition: 'Not yet tracked — no PPE-violation data source exists in SteelOS. Shown as 0.',
    compute: ({ buckets }) => zeroSeries(buckets),
  },

  // --------------------------------------------------------------- QUALITY
  {
    key: 'defect_rate_pct', area: 'quality', label: 'Defect Rate %', unit: 'percent', shape: 'timeseries', pieAgg: 'avg',
    definition: 'qa_inspections with status = Failed ÷ total qa_inspections in the period, by inspected_at date.',
    compute: ({ data, buckets }) => ratioBy(data.qa_inspections, (r) => r.inspected_at, (r) => r.status === 'Failed', () => true, buckets),
  },
  {
    key: 'rework_pct', area: 'quality', label: 'Rework %', unit: 'percent', shape: 'timeseries', pieAgg: 'avg',
    definition: 'PieceMark records with status = rejected ÷ total PieceMark records, by fab_complete_date (or created date if not yet fabricated). SteelOS has no dedicated "rework" status, so rejected piece marks are used as the closest tracked proxy.',
    compute: ({ data, buckets }) => ratioBy(data.PieceMark, (r) => r.fab_complete_date || r.created_date, (r) => r.status === 'rejected', () => true, buckets),
  },
  {
    key: 'first_pass_yield_pct', area: 'quality', label: 'First-Pass Yield %', unit: 'percent', shape: 'timeseries', pieAgg: 'avg',
    definition: '100 − Rework %, using the same PieceMark rejection proxy.',
    compute: ({ data, buckets }) => ratioBy(data.PieceMark, (r) => r.fab_complete_date || r.created_date, (r) => r.status !== 'rejected', () => true, buckets),
  },
  {
    key: 'ncr_count', area: 'quality', label: 'NCR Count', unit: 'count', shape: 'timeseries', pieAgg: 'sum',
    definition: 'Count of ncr_records logged in the selected period.',
    compute: ({ data, buckets }) => countBy(data.ncr_records, (r) => r.created_date, buckets),
  },
  {
    key: 'customer_returns', area: 'quality', label: 'Customer Returns', unit: 'count', shape: 'timeseries', pieAgg: 'sum', stub: true,
    definition: 'Not yet tracked — no customer-return/feedback entity exists in SteelOS. Shown as 0.',
    compute: ({ buckets }) => zeroSeries(buckets),
  },
  {
    key: 'inspection_pass_rate_pct', area: 'quality', label: 'Inspection Pass Rate %', unit: 'percent', shape: 'timeseries', pieAgg: 'avg',
    definition: 'qa_inspections with status = Approved ÷ total qa_inspections in the period, by inspected_at date.',
    compute: ({ data, buckets }) => ratioBy(data.qa_inspections, (r) => r.inspected_at, (r) => r.status === 'Approved', () => true, buckets),
  },

  // ------------------------------------------------------------ PRODUCTION
  {
    key: 'tonnage_actual', area: 'production', label: 'Tonnage Actual', unit: 'tons', shape: 'timeseries', pieAgg: 'sum',
    definition: 'Sum of PieceMark weight_lbs × quantity ÷ 2000, by fab_complete_date.',
    compute: ({ data, buckets }) => sumBy(data.PieceMark, (r) => r.fab_complete_date, (r) => ((r.weight_lbs || 0) * (r.quantity || 1)) / 2000, buckets, (r) => !!r.fab_complete_date),
  },
  {
    key: 'tonnage_planned', area: 'production', label: 'Tonnage Planned', unit: 'tons', shape: 'timeseries', pieAgg: 'sum',
    definition: 'Sum of shop_schedules target_tons, by scheduled_start_date.',
    compute: ({ data, buckets }) => sumBy(data.shop_schedules, (r) => r.scheduled_start_date, (r) => r.target_tons || 0, buckets),
  },
  {
    key: 'pieces_completed', area: 'production', label: 'Pieces Completed', unit: 'count', shape: 'timeseries', pieAgg: 'sum',
    definition: 'Count of PieceMark records reaching fabricated (or later) status, by fab_complete_date.',
    compute: ({ data, buckets }) => countBy(data.PieceMark, (r) => r.fab_complete_date, buckets, (r) => FAB_COMPLETE_STATUSES.includes(r.status)),
  },
  {
    key: 'schedule_adherence_pct', area: 'production', label: 'Schedule Adherence %', unit: 'percent', shape: 'timeseries', pieAgg: 'avg', stub: true,
    definition: 'Not yet tracked — PieceMark has no target/due completion date to compare fab_complete_date against. Shown as 0.',
    compute: ({ buckets }) => zeroSeries(buckets),
  },
  {
    key: 'average_cycle_time', area: 'production', label: 'Average Cycle Time', unit: 'minutes', shape: 'timeseries', pieAgg: 'avg',
    definition: 'Average piece_production_logs.elapsed_minutes for completed logs, by end_time.',
    compute: ({ data, buckets }) => avgBy(data.piece_production_logs, (r) => r.end_time, (r) => r.elapsed_minutes, buckets, (r) => r.status === 'Complete' && !!r.end_time),
  },
  {
    key: 'station_dwell_time', area: 'production', label: 'Station Dwell Time', unit: 'minutes', shape: 'timeseries', pieAgg: 'avg',
    definition: 'Average station_logs.elapsed_minutes across all stations for completed logs, by end_time.',
    compute: ({ data, buckets }) => avgBy(data.station_logs, (r) => r.end_time, (r) => r.elapsed_minutes, buckets, (r) => r.status === 'Complete' && !!r.end_time),
  },
  {
    key: 'station_utilization_pct', area: 'production', label: 'Station Utilization %', unit: 'percent', shape: 'timeseries', pieAgg: 'avg',
    definition: 'Total completed station_logs hours ÷ total attendance_punches labor hours in the same period, as a proxy for productive-time utilization (SteelOS has no separate "available hours" schedule to divide by).',
    compute: ({ data, buckets }) => {
      const stationHours = sumBy(data.station_logs, (r) => r.end_time, (r) => (r.elapsed_minutes || 0) / 60, buckets, (r) => r.status === 'Complete');
      const laborHours = sumBy(data.attendance_punches, (r) => r.punch_time, (r) => ((r.total_regular_minutes || 0) + (r.total_overtime_minutes || 0)) / 60, buckets);
      return buckets.map((b, i) => ({ key: b.key, label: b.label, value: laborHours[i].value > 0 ? (stationHours[i].value / laborHours[i].value) * 100 : 0 }));
    },
  },

  // ------------------------------------------------------------- EQUIPMENT
  {
    key: 'downtime_hours', area: 'equipment', label: 'Downtime Hours', unit: 'hours', shape: 'timeseries', pieAgg: 'sum', stub: true,
    definition: 'Not yet tracked — EquipmentService records a pass/fail outcome per service, not an out-of-service duration. Shown as 0.',
    compute: ({ buckets }) => zeroSeries(buckets),
  },
  {
    key: 'maintenance_overdue_count', area: 'equipment', label: 'Maintenance Overdue Count', unit: 'count', shape: 'timeseries', pieAgg: 'avg',
    definition: 'Current count of fleet assets with an Overdue service level (via the same interval engine as Field Operations). This is a point-in-time snapshot, not a historical trend — SteelOS does not retain past due/overdue states.',
    compute: ({ data, buckets }) => {
      const overdueAssetIds = new Set();
      data.erection_fleet_assets.forEach((asset) => {
        data.ServiceSchedule
          .filter((s) => s.equipment_type === asset.equipment_type && s.is_active !== false)
          .forEach((s) => {
            const status = computeLevelStatus(asset, s);
            if (status?.status === 'Overdue') overdueAssetIds.add(asset.id);
          });
      });
      const count = overdueAssetIds.size;
      return buckets.map((b) => ({ key: b.key, label: b.label, value: count }));
    },
  },
  {
    key: 'failed_inspection_count', area: 'equipment', label: 'Failed Inspection Count', unit: 'count', shape: 'timeseries', pieAgg: 'sum',
    definition: 'Count of EquipmentService records with service_action = Requires_Repair, by service_date.',
    compute: ({ data, buckets }) => countBy(data.EquipmentService, (r) => r.service_date, buckets, (r) => r.service_action === 'Requires_Repair'),
  },
  {
    key: 'equipment_availability_pct', area: 'equipment', label: 'Equipment Availability %', unit: 'percent', shape: 'timeseries', pieAgg: 'avg', stub: true,
    definition: 'Not yet tracked — fleet assets have no available-hours/total-hours schedule recorded. Shown as 0.',
    compute: ({ buckets }) => zeroSeries(buckets),
  },
  {
    key: 'service_completion_rate_pct', area: 'equipment', label: 'Service Completion Rate %', unit: 'percent', shape: 'timeseries', pieAgg: 'avg',
    definition: 'EquipmentService records with service_action = Pass ÷ total service records in the period, by service_date.',
    compute: ({ data, buckets }) => ratioBy(data.EquipmentService, (r) => r.service_date, (r) => r.service_action === 'Pass', () => true, buckets),
  },

  // -------------------------------------------------------------- SHIPPING
  {
    key: 'on_time_delivery_pct', area: 'shipping', label: 'On-Time Delivery %', unit: 'percent', shape: 'timeseries', pieAgg: 'avg', stub: true,
    definition: 'Not yet tracked — loads/shipping_manifests have no promised/actual delivery date fields. Shown as 0.',
    compute: ({ buckets }) => zeroSeries(buckets),
  },
  {
    key: 'shipping_damage_count', area: 'shipping', label: 'Shipping Damage Count', unit: 'count', shape: 'timeseries', pieAgg: 'sum', stub: true,
    definition: 'Not yet tracked — shipping_manifests has no damage-reported flag. Shown as 0.',
    compute: ({ buckets }) => zeroSeries(buckets),
  },
  {
    key: 'average_days_late', area: 'shipping', label: 'Average Days Late', unit: 'days', shape: 'timeseries', pieAgg: 'avg', stub: true,
    definition: 'Not yet tracked — no promised/actual delivery dates recorded to compare. Shown as 0.',
    compute: ({ buckets }) => zeroSeries(buckets),
  },
  {
    key: 'loads_shipped', area: 'shipping', label: 'Loads Shipped', unit: 'count', shape: 'timeseries', pieAgg: 'sum',
    definition: 'Count of loads reaching In_Transit or Delivered status, by bol_generated_date (or created date if no BOL was generated yet).',
    compute: ({ data, buckets }) => countBy(data.loads, (r) => r.bol_generated_date || r.created_date, buckets, (r) => ['In_Transit', 'Delivered'].includes(r.status)),
  },
  {
    key: 'on_time_pickup_pct', area: 'shipping', label: 'On-Time Pickup %', unit: 'percent', shape: 'timeseries', pieAgg: 'avg', stub: true,
    definition: 'Not yet tracked — no scheduled/actual pickup date fields exist on loads. Shown as 0.',
    compute: ({ buckets }) => zeroSeries(buckets),
  },
];

export function getMetric(key) {
  return METRICS.find((m) => m.key === key) || null;
}

export function metricsForArea(area) {
  return METRICS.filter((m) => m.area === area);
}

// Runs one metric over one period ({start, end}) at the given aggregation
// level. Returns [{key,label,value}] — a category breakdown when the metric
// is shape:'category' (ignores aggregationLevel), otherwise a time series.
export function computeMetricSeries(metric, data, start, end, aggregationLevel) {
  const buckets = enumerateBuckets(start, end, aggregationLevel);
  return metric.compute({ data, buckets, start, end });
}

export function pieValueForSeries(metric, series) {
  if (series.length === 0) return 0;
  const total = series.reduce((sum, r) => sum + (r.value || 0), 0);
  return metric.pieAgg === 'avg' ? total / series.length : total;
}

export const UNIT_SUFFIX = {
  percent: '%', count: '', hours: ' hrs', tons: ' tn', minutes: ' min', days: ' days',
};

export function formatMetricValue(unit, value) {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return `${rounded.toLocaleString()}${UNIT_SUFFIX[unit] || ''}`;
}
