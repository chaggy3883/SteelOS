const REGULAR_DAILY_CAP_MINUTES = 8 * 60;
const REGULAR_WEEKLY_CAP_MINUTES = 40 * 60;

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const startOfWeek = (date) => {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday as week start
  d.setDate(d.getDate() + diff);
  return d;
};

// Finds the most recent Clock_In for this employee before the given
// Clock_Out — the demo-app equivalent of "which shift is this clock-out
// closing," since there's no formal shift-id linking punches together.
export function findShiftStart(employeeId, clockOutTime, allPunches) {
  const prior = allPunches
    .filter((p) => p.employee_id === employeeId && new Date(p.punch_time) < new Date(clockOutTime))
    .sort((a, b) => new Date(b.punch_time).getTime() - new Date(a.punch_time).getTime());
  return prior.find((p) => p.punch_type === 'Clock_In') || null;
}

export function getBreaksBetween(employeeId, startTime, endTime, allPunches) {
  return allPunches.filter((p) => (
    p.employee_id === employeeId
    && (p.punch_type === 'Start_Break' || p.punch_type === 'End_Break')
    && new Date(p.punch_time) >= new Date(startTime)
    && new Date(p.punch_time) <= new Date(endTime)
  ));
}

export function computeShiftMinutes(clockInTime, clockOutTime, breakPunches) {
  const totalMs = new Date(clockOutTime).getTime() - new Date(clockInTime).getTime();
  const sorted = [...breakPunches].sort((a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime());
  let breakMs = 0;
  let openBreakStart = null;
  sorted.forEach((p) => {
    if (p.punch_type === 'Start_Break') {
      openBreakStart = new Date(p.punch_time);
    } else if (p.punch_type === 'End_Break' && openBreakStart) {
      breakMs += new Date(p.punch_time).getTime() - openBreakStart.getTime();
      openBreakStart = null;
    }
  });
  return Math.max(0, Math.round((totalMs - breakMs) / 60000));
}

export function getPriorRegularMinutes(employeeId, referenceTime, allPunches, sameDay) {
  const ref = new Date(referenceTime);
  const boundary = sameDay ? startOfDay(ref) : startOfWeek(ref);
  return allPunches
    .filter((p) => p.employee_id === employeeId && p.punch_type === 'Clock_Out' && new Date(p.punch_time) >= boundary && new Date(p.punch_time) < ref)
    .reduce((sum, p) => sum + (p.total_regular_minutes || 0), 0);
}

// Daily-8hr rule applied first, then weekly-40hr rule on top of whatever's
// left as "regular" from the daily calc — avoids double-counting the same
// minutes as overtime under both rules.
export function splitRegularOvertime(shiftMinutes, priorRegularMinutesToday, priorRegularMinutesThisWeek) {
  const dailyRemaining = Math.max(0, REGULAR_DAILY_CAP_MINUTES - priorRegularMinutesToday);
  const dailyRegular = Math.min(shiftMinutes, dailyRemaining);
  const dailyOvertime = shiftMinutes - dailyRegular;

  const weeklyRemaining = Math.max(0, REGULAR_WEEKLY_CAP_MINUTES - priorRegularMinutesThisWeek);
  const weeklyRegular = Math.min(dailyRegular, weeklyRemaining);
  const weeklyOvertime = dailyRegular - weeklyRegular;

  return {
    total_regular_minutes: weeklyRegular,
    total_overtime_minutes: dailyOvertime + weeklyOvertime,
  };
}

export function computeOvertimeForClockOut(employeeId, clockOutTime, allPunches) {
  const shiftStart = findShiftStart(employeeId, clockOutTime, allPunches);
  if (!shiftStart) return { total_regular_minutes: 0, total_overtime_minutes: 0 };
  const breaks = getBreaksBetween(employeeId, shiftStart.punch_time, clockOutTime, allPunches);
  const shiftMinutes = computeShiftMinutes(shiftStart.punch_time, clockOutTime, breaks);
  const priorToday = getPriorRegularMinutes(employeeId, clockOutTime, allPunches, true);
  const priorWeek = getPriorRegularMinutes(employeeId, clockOutTime, allPunches, false);
  return splitRegularOvertime(shiftMinutes, priorToday, priorWeek);
}

// Multi-scale payroll rate matrix — Shop Fabrication and Field Erection
// labor are priced off two different admin-configured hourly rates
// (SystemSetting.fab_shop_rate / field_erection_rate, set in Settings >
// Cost Variables), each taxed through the same 1.5x overtime multiplier.
// This only prices minutes that `splitRegularOvertime` already split — it
// never re-derives the regular/overtime split itself.
export const LABOR_SCALES = {
  Shop_Fabrication: 'Shop_Fabrication',
  Field_Erection: 'Field_Erection',
};

const OVERTIME_MULTIPLIER = 1.5;

// attendance_punches.labor_activity_category is the only per-punch signal
// this app has for which wage scale applies — Field_Erection punches (the
// out-of-town/mobile crew case) price off the Field scale, every other shop
// station (Shop_Fab, Drill_Line, Welding, Paint) prices off the Shop scale.
export function resolveLaborScaleFromCategory(laborActivityCategory) {
  return laborActivityCategory === 'Field_Erection' ? LABOR_SCALES.Field_Erection : LABOR_SCALES.Shop_Fabrication;
}

export function resolveLaborScaleRateCents(laborScale, { fabShopRateCents, fieldErectionRateCents }) {
  return laborScale === LABOR_SCALES.Field_Erection
    ? (Number(fieldErectionRateCents) || 0)
    : (Number(fabShopRateCents) || 0);
}

export function computeGrossPayCents({ regularMinutes, overtimeMinutes, baseHourlyRateCents }) {
  const rate = Number(baseHourlyRateCents) || 0;
  const regularPayCents = Math.round(((regularMinutes || 0) / 60) * rate);
  const overtimePayCents = Math.round(((overtimeMinutes || 0) / 60) * rate * OVERTIME_MULTIPLIER);
  return { regularPayCents, overtimePayCents, totalGrossPayCents: regularPayCents + overtimePayCents };
}

export function computeMultiScaleGrossPayCents({ laborScale, regularMinutes, overtimeMinutes, fabShopRateCents, fieldErectionRateCents }) {
  const baseHourlyRateCents = resolveLaborScaleRateCents(laborScale, { fabShopRateCents, fieldErectionRateCents });
  return {
    ...computeGrossPayCents({ regularMinutes, overtimeMinutes, baseHourlyRateCents }),
    laborScale,
    baseHourlyRateCents,
  };
}
