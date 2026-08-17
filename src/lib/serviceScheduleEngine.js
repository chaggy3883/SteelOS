// Pure, no-db-access logic for the A/B/C/D escalating equipment service
// levels. Reads live ServiceSchedule records (never hardcodes checklist
// content) and composes/evaluates them against an erection_fleet_assets
// record. No test runner exists in this repo — verify by hand against the
// seeded fixtures in src/lib/serviceScheduleSeedData.js before wiring into
// a component.

export const EQUIPMENT_TYPES = [
  { value: 'SEMI_TRACTOR', label: 'Semi Tractor' },
  { value: 'SEMI_TRAILER', label: 'Semi Trailer' },
  { value: 'MOBILE_CRANE', label: 'Mobile Crane' },
  { value: 'AERIAL_BOOM_LIFT', label: 'Aerial / Boom Lift' },
  { value: 'TELEHANDLER_FORKLIFT', label: 'Telehandler / Forklift' },
  { value: 'WELDING_MACHINE', label: 'Welding Machine' },
  { value: 'GENERATOR', label: 'Generator' },
  { value: 'PICKUP_SERVICE_TRUCK', label: 'Pickup / Service Truck' },
];

export const SERVICE_LEVELS = ['A', 'B', 'C', 'D'];
const LEVEL_ORDER = { A: 0, B: 1, C: 2, D: 3 };

export const INTERVAL_UNITS = [
  { value: 'miles', label: 'Miles' },
  { value: 'engine_hours', label: 'Engine Hours' },
  { value: 'months', label: 'Months' },
];

// Average Gregorian month length in days — used to convert a `months`
// interval to days so a fractional severe-duty multiplier (e.g.
// 12 * 0.7 = 8.4 months) has something to multiply against. Date#setMonth
// only accepts whole months, so this is deliberately arithmetic on days,
// not calendar month math.
const DAYS_PER_MONTH = 30.4368;
const DAY_MS = 24 * 60 * 60 * 1000;

// A trigger counts as "Due" (approaching, not yet overdue) once it has
// consumed this fraction of its effective interval. UI-only threshold —
// has no bearing on the intelligence-signal integration, which only cares
// about Overdue (see intelligenceRuleEngine.js).
const DUE_SOON_FRACTION = 0.9;

// interval_unit 'engine_hours' reads erection_fleet_assets.runtime_hours —
// there is no separate field literally named engine_hours anywhere in this
// codebase. 'miles' reads odometer_miles.
const assetReading = (asset, unit) => (unit === 'miles' ? (asset?.odometer_miles || 0) : (asset?.runtime_hours || 0));

const checkpointReading = (checkpoint, unit) => {
  if (!checkpoint) return null;
  const v = unit === 'miles' ? checkpoint.odometer_miles : checkpoint.runtime_hours;
  return v === undefined || v === null ? null : v;
};

/**
 * Gathers this equipment_type's own checklist_items for every active
 * ServiceSchedule row at or below `level`, grouped by section ACROSS all
 * contributing rows (so e.g. level A's and level B's "Engine" items merge
 * into one collapsible section), deduped by (section, item) text.
 * Returns [{ section, items: [{ item, notes_required }] }].
 */
export function composeCumulativeChecklist(schedules, equipmentType, level) {
  const targetOrder = LEVEL_ORDER[level];
  if (targetOrder === undefined) return [];

  const contributing = (schedules || [])
    .filter((s) => s.is_active !== false && s.equipment_type === equipmentType && LEVEL_ORDER[s.service_level] <= targetOrder)
    .sort((a, b) => LEVEL_ORDER[a.service_level] - LEVEL_ORDER[b.service_level]);

  const sectionOrder = [];
  const itemsBySection = new Map();
  const seenKeys = new Set();

  contributing.forEach((schedule) => {
    (schedule.checklist_items || []).forEach(({ section, item, notes_required }) => {
      const sectionName = section || 'General';
      const key = `${sectionName}::${item}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      if (!itemsBySection.has(sectionName)) {
        itemsBySection.set(sectionName, []);
        sectionOrder.push(sectionName);
      }
      itemsBySection.get(sectionName).push({ item, notes_required: !!notes_required });
    });
  });

  return sectionOrder.map((section) => ({ section, items: itemsBySection.get(section) }));
}

// Status for a single interval trigger. `elapsed`/`effective` stay in the
// trigger's native unit (miles, engine hours, or days) so callers can decide
// how — or whether — to translate them into something else (e.g. a real
// calendar day count for the intelligence signal).
function evaluateTrigger(unit, intervalValue, multiplier, asset, checkpoint, referenceDate) {
  if (!intervalValue) return null;
  const effective = intervalValue * (multiplier || 1);

  if (unit === 'months') {
    const effectiveDays = effective * DAYS_PER_MONTH;
    const lastDate = checkpoint?.date;
    // No checkpoint recorded for this level yet. Unlike miles/engine_hours
    // (below), there's no field anywhere tracking "calendar time since
    // acquisition" to honestly measure elapsed time against, so rather than
    // fabricate a day count, flag it as a neutral "Due" (needs a baseline
    // established) with elapsed left unknown.
    if (!lastDate) {
      return { unit, effective: effectiveDays, elapsed: null, remaining: 0, status: 'Due' };
    }
    const elapsedDays = Math.floor((referenceDate.getTime() - new Date(lastDate).getTime()) / DAY_MS);
    const remaining = effectiveDays - elapsedDays;
    return { unit, effective: effectiveDays, elapsed: elapsedDays, remaining, status: statusFor(elapsedDays, effectiveDays) };
  }

  // miles/engine_hours totals are real cumulative readings already tracked
  // on the asset, so "no checkpoint yet" can honestly use the current
  // reading itself as elapsed (i.e. "however much usage since this asset
  // has existed, since it's never had this level performed") rather than
  // needing the months branch's neutral fallback above.
  const current = assetReading(asset, unit);
  const lastReading = checkpointReading(checkpoint, unit);
  const elapsed = lastReading !== null ? current - lastReading : current;
  const remaining = effective - elapsed;
  return { unit, effective, elapsed, remaining, status: statusFor(elapsed, effective) };
}

function statusFor(elapsed, effective) {
  if (effective <= 0) return 'Overdue';
  if (elapsed >= effective) return 'Overdue';
  if (elapsed >= effective * DUE_SOON_FRACTION) return 'Due';
  return 'OK';
}

const WORSE = { OK: 0, Due: 1, Overdue: 2 };
const worseStatus = (a, b) => (WORSE[b] > WORSE[a] ? b : a);

/**
 * Evaluates ONE ServiceSchedule row (a single equipment_type + level) against
 * an asset's current readings and its last_service_by_level[level] checkpoint.
 * "Whichever comes first" (a schedule's optional secondary_interval_*) is
 * modeled as taking the worse of the two triggers' statuses, since both are
 * evaluated as of `referenceDate` — the one already further along wins.
 */
export function computeLevelStatus(asset, schedule, referenceDate = new Date()) {
  if (!schedule) return null;
  const level = schedule.service_level;
  const checkpoint = asset?.last_service_by_level?.[level] || null;
  const multiplier = asset?.severe_duty_multiplier || 1;

  const primary = evaluateTrigger(schedule.interval_unit, schedule.interval_value, multiplier, asset, checkpoint, referenceDate);
  const secondary = schedule.secondary_interval_unit
    ? evaluateTrigger(schedule.secondary_interval_unit, schedule.secondary_interval_value, multiplier, asset, checkpoint, referenceDate)
    : null;

  if (!primary && !secondary) return null;
  const status = worseStatus(primary?.status || 'OK', secondary?.status || 'OK');

  return { level, status, primary, secondary };
}

/**
 * Real calendar days until due (negative = overdue) when the schedule's
 * primary or secondary trigger is months-based; null when the only trigger
 * that's actually Overdue is usage-based (miles/engine_hours), since there's
 * no usage-rate data in this app to honestly project a day count for those.
 * Intended for the intelligence-signal integration, not the form UI (which
 * shows `status` directly).
 */
export function daysUntilDueForSignal(levelStatus) {
  if (!levelStatus) return null;
  // Only the trigger that's ACTUALLY Overdue and calendar-based counts —
  // e.g. if a dual-trigger schedule is Overdue on its usage trigger while
  // its months trigger still has time left, that remaining-months number
  // isn't the reason this level is overdue and would be misleading here.
  const overdueMonthsTrigger = [levelStatus.primary, levelStatus.secondary].find((t) => t?.unit === 'months' && t.status === 'Overdue');
  return overdueMonthsTrigger ? overdueMonthsTrigger.remaining : null;
}

export function equipmentTypeLabel(value) {
  return EQUIPMENT_TYPES.find((t) => t.value === value)?.label || value;
}
