import { db } from '@/api/apiClient';
import { logStatusChange } from '@/lib/statusHistory';

// The only leave types PtoBalance/PtoTransaction ever track. Unpaid is
// deliberately excluded everywhere in this file — it never accrues and
// never decrements anything.
export const PTO_TRACKED_LEAVE_TYPES = ['PTO', 'Sick', 'Bereavement'];

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
    const policy = await getActivePolicy(employee.company_id, leaveType);
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
    const policy = await getActivePolicy(employee.company_id, leaveType);

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
    const policy = await getActivePolicy(employee.company_id, leaveType);
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
  const policy = await getActivePolicy(employee.company_id, leaveType);
  const balance = await getOrCreatePtoBalance(employee, leaveType, policy);
  const result = await writePtoTransaction({
    balance, employee, leaveType, transactionType: 'adjustment', hours: Number(hours) || 0,
    effectiveDate: todayDateOnly(), sourceType: 'manual_adjustment', sourceId: '',
    reason: reason.trim(), createdBy: changedBy,
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
