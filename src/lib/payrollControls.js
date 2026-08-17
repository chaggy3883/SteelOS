// Pre-finalization control checks — pure functions only, same shape as
// payrollEngine.js (plain data in, plain data out, no db/api imports). Runs
// against everything feeding a PayrollRun's pay period so a run sitting in
// 'review' can be checked (and re-checked) live, rather than freezing a
// stale snapshot at creation time.
import { getEffectiveRule } from '@/lib/payrollRules';
import { getWorkweekStart } from '@/lib/payrollEngine';

export const CONTROL_CHECK_KEYS = [
  'missing_timecards',
  'unapproved_time_entries',
  'duplicate_time_entries',
  'excessive_hours',
  'invalid_cost_code_or_project',
  'no_pay_rate_on_file',
  'mid_period_rate_change',
  'ot_requires_approval',
  'negative_or_manual_adjustments',
];

export const CONTROL_CHECK_LABELS = {
  missing_timecards: 'Missing Timecards',
  unapproved_time_entries: 'Unapproved Time Entries',
  duplicate_time_entries: 'Duplicate Time Entries',
  excessive_hours: 'Excessive Hours',
  invalid_cost_code_or_project: 'Invalid/Inactive Cost Code or Project',
  no_pay_rate_on_file: 'No Pay Rate on File',
  mid_period_rate_change: 'Pay Rate Changed Mid-Period',
  ot_requires_approval: 'Overtime Requires Approval',
  negative_or_manual_adjustments: 'Negative/Manual Adjustments',
};

// Only mid_period_rate_change is informational — every other check must be
// resolved or explicitly overridden (with a note) before a run can be
// approved.
const NON_BLOCKING_KEYS = new Set(['mid_period_rate_change']);

const inPeriod = (dateStr, period) => !!dateStr && dateStr >= period.period_start && dateStr <= period.period_end;
const employeeName = (employees, id) => employees.find((e) => e.id === id)?.full_name || id;

function checkMissingTimecards(activeEmployees, timecards, period, employees) {
  const issues = activeEmployees
    .filter((emp) => !timecards.some((tc) => tc.employee_id === emp.id && tc.pay_period_id === period.id))
    .map((emp) => ({ employee_id: emp.id, message: `${employeeName(employees, emp.id)} has no timecard for this pay period.` }));
  return issues;
}

function checkUnapprovedTimeEntries(activeEmployees, timeEntries, timecards, period, employees) {
  const issues = [];
  activeEmployees.forEach((emp) => {
    const hasEntries = timeEntries.some((t) => t.employee_id === emp.id && inPeriod(t.work_date, period));
    if (!hasEntries) return;
    const tc = timecards.find((t) => t.employee_id === emp.id && t.pay_period_id === period.id);
    if (tc && tc.status !== 'approved') {
      issues.push({ employee_id: emp.id, message: `${employeeName(employees, emp.id)}'s timecard is '${tc.status}', not approved.` });
    }
  });
  return issues;
}

// Two clock ranges for the same employee/day overlap if one starts before
// the other ends on both sides — entries with no clock_in/clock_out (e.g. a
// manually-entered PTO/holiday day) can't overlap and are skipped.
function checkDuplicateTimeEntries(timeEntries, period, employees) {
  const issues = [];
  const byEmployeeDay = new Map();
  timeEntries
    .filter((t) => inPeriod(t.work_date, period) && t.clock_in && t.clock_out)
    .forEach((t) => {
      const k = `${t.employee_id}::${t.work_date}`;
      if (!byEmployeeDay.has(k)) byEmployeeDay.set(k, []);
      byEmployeeDay.get(k).push(t);
    });
  byEmployeeDay.forEach((entries) => {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i], b = entries[j];
        const aStart = new Date(a.clock_in).getTime(), aEnd = new Date(a.clock_out).getTime();
        const bStart = new Date(b.clock_in).getTime(), bEnd = new Date(b.clock_out).getTime();
        if (aStart < bEnd && bStart < aEnd) {
          issues.push({ employee_id: a.employee_id, message: `${employeeName(employees, a.employee_id)} has overlapping time entries on ${a.work_date}.` });
        }
      }
    }
  });
  return issues;
}

function checkExcessiveHours(activeEmployees, timeEntries, period, payrollRules, employees) {
  const rule = getEffectiveRule(payrollRules, 'excessive_hours', { asOfDate: period.period_end });
  const dailyThreshold = Number(rule?.config?.daily_threshold_hours);
  const weeklyThreshold = Number(rule?.config?.weekly_threshold_hours);
  if (!rule || (!Number.isFinite(dailyThreshold) && !Number.isFinite(weeklyThreshold))) return [];

  const issues = [];
  activeEmployees.forEach((emp) => {
    const entries = timeEntries.filter((t) => t.employee_id === emp.id && t.entry_type === 'regular' && inPeriod(t.work_date, period));
    if (entries.length === 0) return;

    if (Number.isFinite(dailyThreshold)) {
      const byDay = {};
      entries.forEach((t) => { byDay[t.work_date] = (byDay[t.work_date] || 0) + (Number(t.hours) || 0); });
      Object.entries(byDay).forEach(([day, hours]) => {
        if (hours > dailyThreshold) issues.push({ employee_id: emp.id, message: `${employeeName(employees, emp.id)} worked ${hours.toFixed(2)} hours on ${day} (daily threshold ${dailyThreshold}).` });
      });
    }
    if (Number.isFinite(weeklyThreshold)) {
      const byWeek = {};
      entries.forEach((t) => {
        const wk = getWorkweekStart(t.work_date, period.workweek_start_day);
        byWeek[wk] = (byWeek[wk] || 0) + (Number(t.hours) || 0);
      });
      Object.entries(byWeek).forEach(([wk, hours]) => {
        if (hours > weeklyThreshold) issues.push({ employee_id: emp.id, message: `${employeeName(employees, emp.id)} worked ${hours.toFixed(2)} hours in the workweek of ${wk} (weekly threshold ${weeklyThreshold}).` });
      });
    }
  });
  return issues;
}

function checkInvalidCostCodeOrProject(timeEntries, period, projects, costCodes, employees) {
  const issues = [];
  timeEntries.filter((t) => inPeriod(t.work_date, period)).forEach((t) => {
    const project = projects.find((p) => p.id === t.project_id);
    const costCode = costCodes.find((c) => c.id === t.cost_code_id);
    if (!project) issues.push({ employee_id: t.employee_id, message: `${employeeName(employees, t.employee_id)}'s entry on ${t.work_date} references an unknown project.` });
    else if (project.is_archived) issues.push({ employee_id: t.employee_id, message: `${employeeName(employees, t.employee_id)}'s entry on ${t.work_date} is on an archived project (${project.project_number}).` });
    if (!costCode) issues.push({ employee_id: t.employee_id, message: `${employeeName(employees, t.employee_id)}'s entry on ${t.work_date} references an unknown cost code.` });
    else if (!costCode.is_active) issues.push({ employee_id: t.employee_id, message: `${employeeName(employees, t.employee_id)}'s entry on ${t.work_date} uses an inactive cost code (${costCode.code_name}).` });
  });
  return issues;
}

function checkNoPayRateOnFile(activeEmployees, payRates, period, employees) {
  const asOfDate = period.period_end;
  return activeEmployees
    .filter((emp) => !payRates.some((r) => r.employee_id === emp.id && r.effective_date <= asOfDate && (!r.end_date || r.end_date > asOfDate)))
    .map((emp) => ({ employee_id: emp.id, message: `${employeeName(employees, emp.id)} has no pay rate on file covering this period.` }));
}

function checkMidPeriodRateChange(payRates, period, employees) {
  return payRates
    .filter((r) => inPeriod(r.effective_date, period))
    .map((r) => ({ employee_id: r.employee_id, message: `${employeeName(employees, r.employee_id)}'s pay rate changed effective ${r.effective_date}, inside this pay period.` }));
}

function checkOvertimeRequiresApproval(timecards, period, payrollRules, employees) {
  const overtimeRule = getEffectiveRule(payrollRules, 'overtime', { asOfDate: period.period_end });
  if (!overtimeRule?.config?.requires_approval) return [];
  return timecards
    .filter((tc) => tc.pay_period_id === period.id && ((Number(tc.total_ot_hours) || 0) > 0 || (Number(tc.total_double_time_hours) || 0) > 0))
    .map((tc) => ({ employee_id: tc.employee_id, message: `${employeeName(employees, tc.employee_id)} has overtime/double-time hours requiring sign-off.` }));
}

function checkNegativeOrManualAdjustments(adjustments, employees) {
  return (adjustments || [])
    .filter((a) => (Number(a.amount) || 0) < 0 || a.adjustment_type === 'correction')
    .map((a) => ({ employee_id: a.employee_id, message: `${employeeName(employees, a.employee_id)} has a ${a.adjustment_type} adjustment of ${a.amount} requiring review.` }));
}

// `adjustments` should already be scoped to this run's payroll_run_id by the
// caller; every other list is scoped to the pay period here.
export function runPayrollControlChecks({ period, employees, timeEntries, timecards, payRates, adjustments, projects, costCodes, payrollRules }) {
  const activeEmployees = (employees || []).filter((e) => e.is_active);
  const checks = [
    { key: 'missing_timecards', issues: checkMissingTimecards(activeEmployees, timecards || [], period, employees || []) },
    { key: 'unapproved_time_entries', issues: checkUnapprovedTimeEntries(activeEmployees, timeEntries || [], timecards || [], period, employees || []) },
    { key: 'duplicate_time_entries', issues: checkDuplicateTimeEntries(timeEntries || [], period, employees || []) },
    { key: 'excessive_hours', issues: checkExcessiveHours(activeEmployees, timeEntries || [], period, payrollRules || [], employees || []) },
    { key: 'invalid_cost_code_or_project', issues: checkInvalidCostCodeOrProject(timeEntries || [], period, projects || [], costCodes || [], employees || []) },
    { key: 'no_pay_rate_on_file', issues: checkNoPayRateOnFile(activeEmployees, payRates || [], period, employees || []) },
    { key: 'mid_period_rate_change', issues: checkMidPeriodRateChange(payRates || [], period, employees || []) },
    { key: 'ot_requires_approval', issues: checkOvertimeRequiresApproval(timecards || [], period, payrollRules || [], employees || []) },
    { key: 'negative_or_manual_adjustments', issues: checkNegativeOrManualAdjustments(adjustments || [], employees || []) },
  ];
  return checks.map((c) => ({ ...c, label: CONTROL_CHECK_LABELS[c.key], blocking: !NON_BLOCKING_KEYS.has(c.key) }));
}

// A run is approvable once every blocking check is either issue-free or has
// a matching override with a non-empty note — an override with a blank note
// doesn't count, since the whole point is a recorded reason.
export function isRunApprovable(checkResults, controlOverrides) {
  const overrides = controlOverrides || [];
  return (checkResults || [])
    .filter((c) => c.blocking)
    .every((c) => c.issues.length === 0 || overrides.some((o) => o.check_key === c.key && (o.note || '').trim().length > 0));
}
