import { db } from '@/api/apiClient';
import { logStatusChange } from '@/lib/statusHistory';
import { calculateTaxesAndDeductions, calculateGrossPay, allocateLaborToJobs } from '@/lib/payrollEngine';
import { getEffectiveRule } from '@/lib/payrollRules';

// The only leave types PtoBalance/PtoTransaction ever track. Unpaid is
// deliberately excluded everywhere in this file — it never accrues and
// never decrements anything.
export const PTO_TRACKED_LEAVE_TYPES = ['PTO', 'Sick', 'Bereavement'];

// Used only to convert a salaried employee's annual rate into an
// hourly-equivalent for a termination PTO payout — there's no other
// salary->hourly conversion in the app to defer to, so this is a documented
// approximation, not a payroll-wide standard.
const STANDARD_ANNUAL_HOURS = 2080;

// ---------------------------------------------------------------------------
// Future accrual-engine guard (per_pay_period / per_hour_worked)
// ---------------------------------------------------------------------------
// Neither accrual_method is wired to anything yet (see PtoPolicy.accrual_method
// description) — only anniversary_grant runs today, triggered from page load,
// which is naturally idempotent because it advances policy_year_end forward
// and only grants for cycles already elapsed.
//
// Once per_pay_period/per_hour_worked accrual is built and hooked into
// PayrollRunPanel's run-processing loop, it will face a hazard the anniversary
// check doesn't: a PayrollRun can be reopened (locked -> review) and
// reprocessed (see PayrollRun.status docs), and naively re-running "grant
// accrual for this run's hours" a second time would double-accrue.
//
// The guard: that engine must treat (employee_id, leave_type,
// transaction_type: 'accrual', source_type: 'pto_policy', source_id:
// <payroll_run_id>) as a uniqueness key — before writing a new accrual
// transaction for a run, query PtoTransaction for an existing row matching
// that exact tuple and skip if one is found. This means a payroll-run-driven
// accrual must repurpose source_id to carry the payroll_run_id instead of the
// PtoPolicy id (today's convention for pto_policy-sourced transactions) —
// document that deviation clearly in the transaction's `reason` text so the
// ledger stays human-readable. This mirrors the exact pattern
// JobLaborAllocation already uses (posted_to_job_cost boolean +
// job_cost_ledger_entry_id) to make its own payroll-run posting idempotent —
// PtoTransaction has no boolean flag to check, so the equivalent here is an
// existence query instead of a flag read, but the intent is identical: never
// let reprocessing a reopened run write the same grant twice.

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

const todayDateOnly = () => new Date().toISOString().slice(0, 10);

const parseDateOnly = (dateStr) => {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
};

const toDateOnlyString = (date) => date.toISOString().slice(0, 10);

const addDaysToDateOnly = (dateStr, days) => {
  const d = parseDateOnly(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateOnlyString(d);
};

const addYearsToDateOnly = (dateStr, years) => {
  const d = parseDateOnly(dateStr);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return toDateOnlyString(d);
};

// Full years elapsed between two date-only strings, respecting month/day —
// i.e. "years of service as of this date", not a naive year-number subtraction.
const yearsBetweenDateOnly = (startStr, endStr) => {
  const start = parseDateOnly(startStr);
  const end = parseDateOnly(endStr);
  let years = end.getUTCFullYear() - start.getUTCFullYear();
  const anniversaryInEndYear = new Date(Date.UTC(end.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  if (end < anniversaryInEndYear) years -= 1;
  return Math.max(0, years);
};

export async function getActivePolicy(companyId, leaveType) {
  const policies = await db.entities.PtoPolicy.filter({ company_id: companyId, leave_type: leaveType, is_active: true }, '-created_date', 10);
  return policies[0] || null;
}

export async function listActivePoliciesForCompany(companyId) {
  return db.entities.PtoPolicy.filter({ company_id: companyId, is_active: true }, 'leave_type', 50);
}

// This employee's current override row for one leave type, if any — at most
// one is meaningful per (employee_id, leave_type), so the most recently
// created one wins if duplicates ever exist (mirrors getActivePolicy's own
// tie-break), and setEmployeePtoPolicy below updates that row in place
// rather than appending a new one on every save.
export async function getEmployeePtoPolicyOverride(employeeId, leaveType) {
  const rows = await db.entities.EmployeePtoPolicy.filter({ employee_id: employeeId, leave_type: leaveType }, '-created_date', 1);
  return rows[0] || null;
}

export async function listEmployeePtoPoliciesForEmployee(employeeId) {
  return db.entities.EmployeePtoPolicy.filter({ employee_id: employeeId }, 'leave_type', 20);
}

// The single resolver every accrual/approval/termination code path below
// reads through instead of calling getActivePolicy directly — an employee's
// override (use_standard_policy: false) takes precedence; anything else
// (no override row, use_standard_policy: true, or an override pointing at a
// policy that's since been deleted) falls back to the company's active
// policy for that leave type, exactly like before this feature existed.
export async function getApplicablePolicy(employee, leaveType) {
  const override = await getEmployeePtoPolicyOverride(employee.id, leaveType);
  if (override && override.use_standard_policy === false && override.pto_policy_id) {
    const policy = await db.entities.PtoPolicy.get(override.pto_policy_id);
    if (policy) return policy;
  }
  return getActivePolicy(employee.company_id, leaveType);
}

// Upserts this employee's override for one leave type — called from
// PtoPolicyPanel.jsx's Save. useStandardPolicy: true blanks pto_policy_id and
// notes regardless of what's passed, so a record can never claim both "use
// the standard policy" and "here's a custom policy/reason" at once.
export async function setEmployeePtoPolicy(employee, leaveType, { useStandardPolicy, ptoPolicyId, notes, effectiveDate } = {}) {
  const existing = await getEmployeePtoPolicyOverride(employee.id, leaveType);
  const payload = {
    employee_id: employee.id,
    leave_type: leaveType,
    use_standard_policy: !!useStandardPolicy,
    pto_policy_id: useStandardPolicy ? '' : (ptoPolicyId || ''),
    effective_date: effectiveDate || existing?.effective_date || todayDateOnly(),
    notes: useStandardPolicy ? '' : (notes || '').trim(),
  };
  if (existing) return db.entities.EmployeePtoPolicy.update(existing.id, payload);
  return db.entities.EmployeePtoPolicy.create(payload);
}

// Called once at hire (hireCandidate/provisionEmployee in employeesApi.js) so
// every new employee starts on the company's standard policy for every
// tracked leave type — HR then flips individual leave types to a custom
// policy via PtoPolicyPanel.jsx for negotiated terms.
export async function createDefaultEmployeePtoPolicies(employee) {
  return Promise.all(PTO_TRACKED_LEAVE_TYPES.map((leaveType) => db.entities.EmployeePtoPolicy.create({
    employee_id: employee.id,
    leave_type: leaveType,
    use_standard_policy: true,
    pto_policy_id: '',
    effective_date: employee.hire_date || todayDateOnly(),
    notes: '',
  })));
}

// The highest tenure tier whose years_of_service threshold the employee has
// reached, falling back to the flat annual_hours when tenure_tiers is empty
// or the employee hasn't reached its lowest threshold yet.
export function resolveTenureAnnualHours(policy, yearsOfService) {
  const tiers = Array.isArray(policy?.tenure_tiers) ? policy.tenure_tiers : [];
  let hours = Number(policy?.annual_hours) || 0;
  [...tiers]
    .sort((a, b) => (Number(a.years_of_service) || 0) - (Number(b.years_of_service) || 0))
    .forEach((tier) => {
      if (yearsOfService >= (Number(tier.years_of_service) || 0)) hours = Number(tier.annual_hours) || 0;
    });
  return hours;
}

export async function getOrCreatePtoBalance(employee, leaveType, policy) {
  const existing = await db.entities.PtoBalance.filter({ employee_id: employee.id, leave_type: leaveType }, '-created_date', 1);
  if (existing[0]) return existing[0];

  const anniversary = employee.hire_date || todayDateOnly();
  return db.entities.PtoBalance.create({
    company_id: employee.company_id,
    employee_id: employee.id,
    leave_type: leaveType,
    policy_id: policy?.id || '',
    balance_hours: 0,
    accrued_ytd: 0,
    used_ytd: 0,
    carried_over_hours: 0,
    last_accrual_date: '',
    anniversary_date: anniversary,
    policy_year_start: anniversary,
    policy_year_end: addYearsToDateOnly(anniversary, 1),
  });
}

// The single write path for every PtoBalance change. balance_hours is never
// updated any other way — every call here also appends a PtoTransaction.
async function writePtoTransaction({ balance, employee, leaveType, transactionType, hours, effectiveDate, sourceType = '', sourceId = '', reason = '', createdBy = 'System' }) {
  const signedHours = round2(hours);
  const newBalanceHours = round2((Number(balance.balance_hours) || 0) + signedHours);
  const patch = { balance_hours: newBalanceHours };

  if (transactionType === 'accrual' || transactionType === 'carryover') {
    patch.accrued_ytd = round2((Number(balance.accrued_ytd) || 0) + Math.max(0, signedHours));
  }
  if (transactionType === 'usage') {
    if (signedHours < 0) patch.used_ytd = round2((Number(balance.used_ytd) || 0) + Math.abs(signedHours));
    else patch.used_ytd = round2(Math.max(0, (Number(balance.used_ytd) || 0) - signedHours));
  }

  const updatedBalance = await db.entities.PtoBalance.update(balance.id, patch);
  const transaction = await db.entities.PtoTransaction.create({
    company_id: employee.company_id,
    employee_id: employee.id,
    leave_type: leaveType,
    transaction_type: transactionType,
    hours: signedHours,
    balance_after: newBalanceHours,
    effective_date: effectiveDate || todayDateOnly(),
    source_type: sourceType,
    source_id: sourceId,
    reason,
    created_by: createdBy,
    created_at: new Date().toISOString(),
  });

  return { balance: updatedBalance, transaction };
}

// Runs every renewal an employee is due for anniversary_grant policies —
// there's no backend scheduler in this app, so this is invoked from HR page
// load and Employee Center login instead of a cron job. Loops (capped) so an
// employee who hasn't opened the app in 2+ years still catches up correctly
// rather than only ever granting one year. Comparing policy_year_end (a
// stored date) against today, and only ever advancing it forward, is what
// makes repeat calls a no-op for a policy year already granted.
export async function runAnniversaryRenewalCheckForEmployee(employee, asOfDate = todayDateOnly()) {
  const grants = [];
  if (!employee?.hire_date) return { grants };

  for (const leaveType of PTO_TRACKED_LEAVE_TYPES) {
    const policy = await getApplicablePolicy(employee, leaveType);
    if (!policy || policy.accrual_method !== 'anniversary_grant') continue;

    let balance = await getOrCreatePtoBalance(employee, leaveType, policy);
    let iterations = 0;
    while (balance.policy_year_end <= asOfDate && iterations < 50) {
      iterations += 1;
      const cycleEndDate = balance.policy_year_end;
      const carryoverCap = policy.carryover_allowed ? (Number(policy.max_carryover_hours) || 0) : 0;
      const preRenewalBalance = Number(balance.balance_hours) || 0;
      const forfeited = round2(Math.max(0, preRenewalBalance - carryoverCap));

      if (forfeited > 0) {
        ({ balance } = await writePtoTransaction({
          balance, employee, leaveType, transactionType: 'forfeiture', hours: -forfeited,
          effectiveDate: cycleEndDate, sourceType: 'pto_policy', sourceId: policy.id,
          reason: `Carryover cap of ${carryoverCap}h reached at renewal — ${forfeited}h forfeited`,
          createdBy: 'System',
        }));
      }

      // New policy year starts here — YTD counters and the carryover snapshot reset before the grant is applied.
      balance = await db.entities.PtoBalance.update(balance.id, { accrued_ytd: 0, used_ytd: 0, carried_over_hours: balance.balance_hours });

      const yearsOfService = yearsBetweenDateOnly(balance.anniversary_date, cycleEndDate);
      const grantHours = resolveTenureAnnualHours(policy, yearsOfService);
      if (grantHours > 0) {
        ({ balance } = await writePtoTransaction({
          balance, employee, leaveType, transactionType: 'accrual', hours: grantHours,
          effectiveDate: cycleEndDate, sourceType: 'pto_policy', sourceId: policy.id,
          reason: `Anniversary renewal — year ${yearsOfService} (${grantHours}h grant)`,
          createdBy: 'System',
        }));
      }

      const maxBalance = Number(policy.max_balance) || 0;
      if (maxBalance > 0 && balance.balance_hours > maxBalance) {
        const excess = round2(balance.balance_hours - maxBalance);
        ({ balance } = await writePtoTransaction({
          balance, employee, leaveType, transactionType: 'forfeiture', hours: -excess,
          effectiveDate: cycleEndDate, sourceType: 'pto_policy', sourceId: policy.id,
          reason: `Balance exceeded policy max of ${maxBalance}h — ${excess}h forfeited`,
          createdBy: 'System',
        }));
      }

      const nextYearEnd = addYearsToDateOnly(cycleEndDate, 1);
      balance = await db.entities.PtoBalance.update(balance.id, {
        policy_year_start: cycleEndDate,
        policy_year_end: nextYearEnd,
        last_accrual_date: cycleEndDate,
      });

      grants.push({ employeeId: employee.id, leaveType, effectiveDate: cycleEndDate, grantHours, forfeited });
    }
  }

  return { grants };
}

export async function runAnniversaryRenewalCheckForCompany(companyId) {
  if (!companyId) return { grants: [] };
  const employees = await db.entities.employees.filter({ company_id: companyId, is_active: true }, 'full_name', 500);
  const grants = [];
  for (const employee of employees) {
    const result = await runAnniversaryRenewalCheckForEmployee(employee);
    grants.push(...result.grants);
  }
  return { grants };
}

// Single decision point for both "approve" and "deny/cancel after approval"
// — HumanResources.jsx and EmployeeCenter.jsx's HR queue both call this
// instead of updating time_off_requests directly, so the ledger discipline
// can't be bypassed from either surface.
export async function decidePtoRequest({ request, newStatus, notes = '', changedBy = 'Unknown' }) {
  const wasApproved = request.status === 'Approved';
  const willBeApproved = newStatus === 'Approved';
  const leaveType = request.leave_type;
  const isPtoTracked = PTO_TRACKED_LEAVE_TYPES.includes(leaveType);
  const totalHours = Number(request.total_hours) || 0;
  const employee = isPtoTracked ? await db.entities.employees.get(request.employee_id) : null;

  let warning = null;

  if (willBeApproved && !wasApproved && isPtoTracked && employee) {
    const policy = await getApplicablePolicy(employee, leaveType);

    if (Number(policy?.waiting_period_days) > 0 && employee.hire_date) {
      const eligibleDate = addDaysToDateOnly(employee.hire_date, policy.waiting_period_days);
      if (todayDateOnly() < eligibleDate) {
        return { ok: false, reason: 'waiting_period', message: `${employee.full_name} is inside the ${policy.waiting_period_days}-day ${leaveType} waiting period — eligible ${eligibleDate}.` };
      }
    }

    let balance = await getOrCreatePtoBalance(employee, leaveType, policy);
    const available = Number(balance.balance_hours) || 0;
    // No policy at all for this leave type means there's no configured rule
    // to enforce — let it through (still ledgered) rather than hard-blocking
    // HR with nothing to point to.
    const overdraftAction = policy ? (policy.overdraft_action || 'hard_block') : 'allow_negative';

    if (totalHours > available && overdraftAction === 'hard_block') {
      return { ok: false, reason: 'insufficient_balance', message: `Only ${available}h of ${leaveType} available — this request needs ${totalHours}h.` };
    }

    ({ balance } = await writePtoTransaction({
      balance, employee, leaveType, transactionType: 'usage', hours: -totalHours,
      effectiveDate: request.start_date, sourceType: 'time_off_request', sourceId: request.id,
      reason: `Time off ${request.start_date} to ${request.end_date}`, createdBy: changedBy,
    }));

    if (totalHours > available) {
      warning = `Approved into a negative balance (${balance.balance_hours}h) — policy allows overdraft.`;
    }
  } else if (!willBeApproved && wasApproved && isPtoTracked && employee) {
    // Was Approved (and already decremented), now being denied/cancelled —
    // reverse with a new positive-hours transaction. The original usage
    // entry is never deleted or edited.
    const policy = await getApplicablePolicy(employee, leaveType);
    const balance = await getOrCreatePtoBalance(employee, leaveType, policy);
    await writePtoTransaction({
      balance, employee, leaveType, transactionType: 'usage', hours: totalHours,
      effectiveDate: todayDateOnly(), sourceType: 'time_off_request', sourceId: request.id,
      reason: `Reversal — request changed to ${newStatus} after approval`, createdBy: changedBy,
    });
  }

  const updated = await db.entities.time_off_requests.update(request.id, { status: newStatus, supervisor_notes: notes });
  await logStatusChange({
    entityType: 'time_off_requests', entityId: request.id, fieldName: 'status',
    fromValue: request.status, toValue: newStatus, changedBy, note: notes,
  });

  return { ok: true, request: updated, warning };
}

export async function adjustPtoBalance({ employee, leaveType, hours, reason, changedBy }) {
  if (!reason || !reason.trim()) throw new Error('A reason is required to adjust a PTO balance.');
  const policy = await getApplicablePolicy(employee, leaveType);
  const balance = await getOrCreatePtoBalance(employee, leaveType, policy);
  const previousBalanceHours = round2(Number(balance.balance_hours) || 0);
  const result = await writePtoTransaction({
    balance, employee, leaveType, transactionType: 'adjustment', hours: Number(hours) || 0,
    effectiveDate: todayDateOnly(), sourceType: 'manual_adjustment', sourceId: '',
    reason: reason.trim(), createdBy: changedBy,
  });

  // Manual balance adjustments are the one PtoTransaction write path that
  // also gets a StatusHistoryEntry — automated accrual/usage/carryover/
  // payout writes above don't, since they're already traceable back to
  // their own source record (a PayrollRun, a time_off_request, a
  // termination). A manual adjustment has no other record to point back to,
  // so it needs its own audit entry. Values are stringified so a balance
  // that lands on exactly 0 doesn't get silently dropped by
  // logStatusChange's `!toValue` falsy-zero guard.
  await logStatusChange({
    entityType: 'PtoBalance',
    entityId: balance.id,
    fieldName: 'balance_hours',
    fromValue: String(previousBalanceHours),
    toValue: String(result.balance.balance_hours),
    changedBy,
    note: reason.trim(),
  });

  return result.balance;
}

export async function listPtoBalancesForEmployee(employeeId) {
  return db.entities.PtoBalance.filter({ employee_id: employeeId }, 'leave_type', 20);
}

export async function listPtoTransactionsForEmployee(employeeId, limit = 500) {
  return db.entities.PtoTransaction.filter({ employee_id: employeeId }, '-effective_date', limit);
}

// "How much would be left if this pending request were approved" — read-only
// projection for the employee-facing view, never writes anything.
export function projectedBalanceIfApproved(balance, requestTotalHours) {
  if (!balance) return null;
  return round2((Number(balance.balance_hours) || 0) - (Number(requestTotalHours) || 0));
}

// Most-recent EmployeePayRate effective as of a given date, same
// effective_date/end_date window PayrollRunPanel.jsx uses when it prices a
// TimeEntry — kept here rather than imported so this file's only dependency
// stays the pure payrollEngine helpers, not the payroll UI. Salary is
// converted to an hourly-equivalent via STANDARD_ANNUAL_HOURS purely for
// pricing a PTO payout; it never touches the employee's actual salary pricing
// elsewhere.
async function resolveCurrentPayRate(employeeId, asOfDate) {
  const rates = await db.entities.EmployeePayRate.filter({ employee_id: employeeId }, '-effective_date', 200);
  const rate = rates
    .filter((r) => r.effective_date <= asOfDate && (!r.end_date || r.end_date > asOfDate))
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0] || null;
  if (!rate) return null;
  const hourlyRate = rate.pay_type === 'salary'
    ? round2((Number(rate.rate) || 0) / STANDARD_ANNUAL_HOURS)
    : round2(Number(rate.rate) || 0);
  return { ...rate, hourlyRate };
}

// Read-only — never creates a PtoBalance row for a leave type the employee
// never touched, unlike getOrCreatePtoBalance (used by the write path below,
// where a row is actually about to be written against).
async function getExistingPtoBalance(employeeId, leaveType) {
  const rows = await db.entities.PtoBalance.filter({ employee_id: employeeId, leave_type: leaveType }, '-created_date', 1);
  return rows[0] || null;
}

// The raw EmployeePayRate row (pay_type/rate/overtime_eligible), not the
// hourly-equivalent conversion resolveCurrentPayRate above returns — gross
// pay for actual worked hours must be priced exactly the way
// PayrollRunPanel.jsx's runPayroll() prices it (same effective_date/end_date
// window, same "latest wins" tie-break), so a terminated employee's final
// wages come out identical to what a regular run would have paid.
async function resolveRawPayRate(employeeId, asOfDate) {
  const rates = await db.entities.EmployeePayRate.filter({ employee_id: employeeId }, '-effective_date', 200);
  return rates
    .filter((r) => r.effective_date <= asOfDate && (!r.end_date || r.end_date > asOfDate))
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0] || null;
}

// Every approved Timecard for this employee that no PayrollRun (regular or a
// prior final_check) has paid yet — see Timecard.payroll_run_id. This is the
// "unpaid earned wages" side of a termination final check, computed the same
// way PayrollRunPanel.jsx computes a regular run: TimeEntry -> allocations
// (job costing) + the approved Timecard's own totals -> gross (via
// calculateGrossPay), never re-derived from raw hours, so it can never drift
// from what the normal payroll run would have produced for the same period.
async function collectUnpaidWageLines(employee, payrollRules) {
  const timecards = (await db.entities.Timecard.filter({ employee_id: employee.id, status: 'approved' }, '-created_date', 100))
    .filter((t) => !t.payroll_run_id);
  if (timecards.length === 0) return { lines: [], allocationPayloads: [] };

  const allTimeEntries = await db.entities.TimeEntry.filter({ employee_id: employee.id }, '-work_date', 2000);
  const lines = [];
  const allocationPayloads = [];

  for (const timecard of timecards) {
    const period = await db.entities.PayPeriod.get(timecard.pay_period_id);
    if (!period) continue;
    const asOfDate = period.period_end;
    const payRate = await resolveRawPayRate(employee.id, asOfDate);
    if (!payRate) continue; // same "skip, no rate on file" behavior as runPayroll()

    const entries = allTimeEntries.filter((t) => t.work_date >= period.period_start && t.work_date <= period.period_end);
    const overtimeRule = getEffectiveRule(payrollRules, 'overtime', { asOfDate });
    const doubleTimeRule = getEffectiveRule(payrollRules, 'double_time', { asOfDate });
    const allocations = allocateLaborToJobs(entries, { payRate, overtimeRule, doubleTimeRule, workweekStartDay: period.workweek_start_day });
    const gross = calculateGrossPay(timecard, payRate, payrollRules, { asOfDate, periodFrequency: period.frequency });

    lines.push({
      timecardId: timecard.id,
      payType: payRate.pay_type,
      regularHours: Number(timecard.total_regular_hours) || 0,
      otHours: Number(timecard.total_ot_hours) || 0,
      doubleTimeHours: Number(timecard.total_double_time_hours) || 0,
      grossPay: gross.grossPay,
    });
    allocations.forEach((a) => allocationPayloads.push(a));
  }

  return { lines, allocationPayloads };
}

// Read-only preview of the wages side of a final check — what HR sees before
// confirming a termination, alongside the PTO settlement preview.
export async function computeUnpaidWagesPreview(employee) {
  const payrollRules = await db.entities.PayrollRule.list('-effective_date', 500);
  const { lines } = await collectUnpaidWageLines(employee, payrollRules);
  const totalGross = round2(lines.reduce((sum, l) => sum + l.grossPay, 0));
  const totalRegularHours = round2(lines.reduce((sum, l) => sum + l.regularHours, 0));
  const totalOtHours = round2(lines.reduce((sum, l) => sum + l.otHours, 0));
  return { lines, totalGross, totalRegularHours, totalOtHours };
}

// What the HR termination checklist shows before anyone confirms anything —
// per leave type, the current balance, the governing policy, and (if
// payout_on_termination is 'always') the dollar amount that balance would be
// worth on a final check. Writes nothing.
export async function computeTerminationPtoSettlementPreview(employee, asOfDate = todayDateOnly()) {
  const payRate = await resolveCurrentPayRate(employee.id, asOfDate);
  const lines = [];
  for (const leaveType of PTO_TRACKED_LEAVE_TYPES) {
    const policy = await getApplicablePolicy(employee, leaveType);
    const balance = await getExistingPtoBalance(employee.id, leaveType);
    const hours = Number(balance?.balance_hours) || 0;
    const payoutSetting = policy?.payout_on_termination || 'never';
    const willPayOut = payoutSetting === 'always' && hours > 0;
    const amount = willPayOut && payRate ? round2(hours * payRate.hourlyRate) : 0;
    lines.push({ leaveType, policy, balance, hours, payoutSetting, willPayOut, amount });
  }
  return { payRate, lines };
}

// The actual termination settlement — call once, when HR confirms a
// termination. Combines three sources into a single off-cycle final_check
// PayrollRun/PayrollLine, so a terminated employee is never paid across two
// separate checks for the same event:
//   1. PTO/Sick/Bereavement — pays out the balance (a 'payout' PtoTransaction)
//      if the governing policy's payout_on_termination is 'always', otherwise
//      forfeits it (a 'forfeiture' PtoTransaction — auditable, never a silent
//      balance reset). 'policy_dependent' and "no policy on file" both
//      resolve to forfeiture until a real jurisdiction rule table exists (see
//      PtoPolicy.payout_on_termination). Priced off PtoBalance/EmployeePayRate
//      directly — no TimeEntry involved, so this portion never produces a
//      JobLaborAllocation/JobCostLedgerEntry, same as before this function
//      also covered wages.
//   2. Unpaid earned wages — any approved Timecard not yet paid by another
//      run (collectUnpaidWageLines) as of termination. Priced identically to
//      a regular PayrollRunPanel run, and — unlike PTO — DOES post
//      JobLaborAllocation/JobCostLedgerEntry, since these are real worked
//      hours against a job.
//   3. An optional one-off adjustment (bonus/correction/etc, HR-entered at
//      confirm time) recorded as a PayrollAdjustment against the same run.
// Never touches the regular biweekly PayrollRun/PayPeriod — the final_check
// run is entirely separate and off-cycle.
export async function processTerminationSettlement({ employee, terminationDate = todayDateOnly(), createdBy = 'System', adjustmentAmount = 0, adjustmentType = 'bonus', adjustmentReason = '' }) {
  const ptoPayRate = await resolveCurrentPayRate(employee.id, terminationDate);
  const leaveResults = [];
  let totalPayoutHours = 0;
  let totalPayoutAmount = 0;

  for (const leaveType of PTO_TRACKED_LEAVE_TYPES) {
    const policy = await getApplicablePolicy(employee, leaveType);
    let balance = await getOrCreatePtoBalance(employee, leaveType, policy);
    const hours = Number(balance.balance_hours) || 0;

    if (hours === 0) {
      leaveResults.push({ leaveType, policy, hours: 0, action: 'none' });
      continue;
    }

    const payoutSetting = policy?.payout_on_termination || 'never';
    if (payoutSetting === 'always' && ptoPayRate) {
      const amount = round2(hours * ptoPayRate.hourlyRate);
      const { balance: updated, transaction } = await writePtoTransaction({
        balance, employee, leaveType, transactionType: 'payout', hours: -hours,
        effectiveDate: terminationDate, sourceType: 'termination', sourceId: '',
        reason: `Termination payout — ${hours}h × $${ptoPayRate.hourlyRate.toFixed(2)}/hr per "${policy.policy_name}" (payout_on_termination: always)`,
        createdBy,
      });
      totalPayoutHours = round2(totalPayoutHours + hours);
      totalPayoutAmount = round2(totalPayoutAmount + amount);
      leaveResults.push({ leaveType, policy, hours, amount, action: 'payout', balance: updated, transaction });
    } else {
      const reason = policy
        ? `Termination — unused ${leaveType} forfeited per "${policy.policy_name}" (payout_on_termination: ${payoutSetting})`
        : `Termination — unused ${leaveType} forfeited (no active ${leaveType} policy on file)`;
      const { balance: updated, transaction } = await writePtoTransaction({
        balance, employee, leaveType, transactionType: 'forfeiture', hours: -hours,
        effectiveDate: terminationDate, sourceType: 'termination', sourceId: '',
        reason, createdBy,
      });
      leaveResults.push({ leaveType, policy, hours, action: 'forfeit', balance: updated, transaction });
    }
  }

  const payrollRules = await db.entities.PayrollRule.list('-effective_date', 500);
  const { lines: wageLines, allocationPayloads } = await collectUnpaidWageLines(employee, payrollRules);
  const wagesRegularHours = round2(wageLines.reduce((sum, l) => sum + l.regularHours, 0));
  const wagesOtHours = round2(wageLines.reduce((sum, l) => sum + l.otHours, 0));
  const wagesDoubleTimeHours = round2(wageLines.reduce((sum, l) => sum + l.doubleTimeHours, 0));
  const wagesGross = round2(wageLines.reduce((sum, l) => sum + l.grossPay, 0));
  const adjustment = round2(Number(adjustmentAmount) || 0);

  const totalGross = round2(wagesGross + totalPayoutAmount + adjustment);

  let payrollRun = null;
  let payrollLine = null;
  let payrollAdjustment = null;

  if (totalGross > 0) {
    const period = await db.entities.PayPeriod.create({
      company_id: employee.company_id,
      period_start: terminationDate,
      period_end: terminationDate,
      pay_date: terminationDate,
      frequency: 'off_cycle',
      workweek_start_day: 'Monday',
      status: 'open',
      notes: `Final check — ${employee.full_name} termination`,
    });
    payrollRun = await db.entities.PayrollRun.create({
      company_id: employee.company_id,
      pay_period_id: period.id,
      run_type: 'final_check',
      status: 'review',
      run_date: terminationDate,
      total_gross: totalGross,
      total_net: totalGross,
      total_employer_tax: 0,
    });

    const [taxWithholdings, deductions] = await Promise.all([
      db.entities.TaxWithholding.filter({ employee_id: employee.id }, '-effective_date', 50),
      db.entities.Deduction.filter({ employee_id: employee.id }, '-effective_date', 50),
    ]);
    const activeWithholdings = taxWithholdings
      .filter((w) => w.effective_date <= terminationDate)
      .reduce((latestByJurisdiction, w) => {
        const existing = latestByJurisdiction.get(w.jurisdiction);
        if (!existing || w.effective_date > existing.effective_date) latestByJurisdiction.set(w.jurisdiction, w);
        return latestByJurisdiction;
      }, new Map());
    const activeDeductions = deductions.filter((d) => d.effective_date <= terminationDate && (!d.end_date || d.end_date >= terminationDate));
    const netCalc = calculateTaxesAndDeductions(totalGross, [...activeWithholdings.values()], activeDeductions);

    payrollLine = await db.entities.PayrollLine.create({
      company_id: employee.company_id,
      payroll_run_id: payrollRun.id,
      employee_id: employee.id,
      pay_type_snapshot: wageLines[0]?.payType || ptoPayRate?.pay_type || 'hourly',
      regular_hours: wagesRegularHours,
      ot_hours: wagesOtHours,
      double_time_hours: wagesDoubleTimeHours,
      pto_payout_hours: totalPayoutHours,
      pto_payout_amount: totalPayoutAmount,
      gross_pay: totalGross,
      deductions_total: netCalc.deductionsTotal,
      tax_total: netCalc.taxTotal,
      net_pay: netCalc.netPay,
    });

    payrollRun = await db.entities.PayrollRun.update(payrollRun.id, { total_net: netCalc.netPay });

    if (adjustment !== 0) {
      payrollAdjustment = await db.entities.PayrollAdjustment.create({
        company_id: employee.company_id,
        payroll_run_id: payrollRun.id,
        employee_id: employee.id,
        adjustment_type: adjustmentType,
        amount: adjustment,
        reason: adjustmentReason || 'Final-check adjustment entered at termination',
        created_by: createdBy,
      });
    }

    // Job costing for the wages portion only — same one-JobLaborAllocation
    // +one-JobCostLedgerEntry-per-TimeEntry pattern as PayrollRunPanel's
    // regular run, and marks each absorbed timecard paid (see
    // Timecard.payroll_run_id) so the regular per-period run can never pay it
    // again once that period is eventually processed.
    if (allocationPayloads.length > 0) {
      const costCodes = await db.entities.CostCode.list('code_name', 500);
      const createdAllocations = await db.entities.JobLaborAllocation.bulkCreate(
        allocationPayloads.map((a) => ({ ...a, company_id: employee.company_id, payroll_run_id: payrollRun.id }))
      );
      await Promise.all(createdAllocations.map(async (alloc) => {
        const code = costCodes.find((c) => c.id === alloc.cost_code_id);
        const entry = await db.entities.JobCostLedgerEntry.create({
          company_id: employee.company_id,
          project_id: alloc.project_id,
          cost_code: code?.code_name || alloc.cost_code_id,
          cost_class: 'LAB',
          amount: alloc.labor_cost,
          transaction_date: terminationDate,
          source_type: 'labor',
          source_id: alloc.id,
          description: `Final check — ${employee.full_name}: ${alloc.regular_hours}reg/${alloc.ot_hours}OT/${alloc.double_time_hours}DT hrs${alloc.phase_id ? ` · ${alloc.phase_id}` : ''}${alloc.area_id ? ` · ${alloc.area_id}` : ''}`,
        });
        await db.entities.JobLaborAllocation.update(alloc.id, { posted_to_job_cost: true, job_cost_ledger_entry_id: entry.id });
      }));
    }
    if (wageLines.length > 0) {
      await Promise.all(wageLines.map((l) => db.entities.Timecard.update(l.timecardId, { payroll_run_id: payrollRun.id })));
    }
  }

  return {
    leaveResults, totalPayoutHours, totalPayoutAmount,
    wagesRegularHours, wagesOtHours, wagesDoubleTimeHours, wagesGross,
    adjustment, totalGross,
    payrollRun, payrollLine, payrollAdjustment, payRate: ptoPayRate,
  };
}
