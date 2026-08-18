const DAY_MS = 24 * 60 * 60 * 1000;

// Shared by I9ComplianceCenter.jsx (the dropdown) and anywhere that needs to
// print a label for e_verify_status, same one-place-only pattern as
// TERMINATION_REASONS in employeesApi.js.
export const E_VERIFY_STATUSES = [
  { value: 'not_submitted', label: 'Not Submitted' },
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
  { value: 'failed', label: 'Failed' },
  { value: 'expired', label: 'Expired' },
];

export const everifyStatusLabel = (value) => E_VERIFY_STATUSES.find((s) => s.value === value)?.label || value;

// Federal default reverification window for most I-9 work-authorization
// documents. This app doesn't track visa type as a field, so employees on
// shorter-duration visas (e.g. 1-year) need HR to directly override the
// computed due date in the Compliance tab — this is a starting point, not a
// guarantee.
export function computeI9ReverificationDueDate(fromDate) {
  if (!fromDate) return '';
  const base = new Date(fromDate);
  if (Number.isNaN(base.getTime())) return '';
  base.setFullYear(base.getFullYear() + 3);
  return base.toISOString().slice(0, 10);
}

function dateFlag(dueDate, days, referenceDate) {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const daysRemaining = Math.floor((due.getTime() - referenceDate.getTime()) / DAY_MS);
  if (daysRemaining < 0) return 'overdue';
  if (daysRemaining <= days) return 'due_soon';
  return null;
}

// null (no flag), 'due_soon', or 'overdue' — mirrors getCertStatus's
// Valid/Expiring_Soon/Expired shape in certAlerts.js, just as a 2-state flag
// instead of a 3-state enum since "on file, not due yet" needs no badge.
export function getI9ReverificationFlag(employee, days = 30, referenceDate = new Date()) {
  if (!employee?.i9_on_file) return null;
  return dateFlag(employee.i9_reverification_due_date, days, referenceDate);
}

export function getEVerifyFlag(employee, days = 30, referenceDate = new Date()) {
  if (!employee) return null;
  if (employee.e_verify_status === 'expired') return 'overdue';
  return dateFlag(employee.e_verify_recheck_due_date, days, referenceDate);
}

// Compliance report (item 4): overdue/due-soon employees, most-overdue
// first. Terminated employees are excluded — there's no HR action to take
// on a departed employee's reverification, even though their I-9/E-Verify
// records are kept on file permanently per federal retention requirements.
export function getComplianceAlerts(employees, days = 30, referenceDate = new Date()) {
  return employees
    .filter((e) => !e.termination_date)
    .map((employee) => ({
      employee,
      i9Flag: getI9ReverificationFlag(employee, days, referenceDate),
      everifyFlag: getEVerifyFlag(employee, days, referenceDate),
    }))
    .filter((row) => row.i9Flag || row.everifyFlag)
    .sort((a, b) => {
      const aDate = [a.i9Flag && a.employee.i9_reverification_due_date, a.everifyFlag && a.employee.e_verify_recheck_due_date].filter(Boolean).sort()[0] || '';
      const bDate = [b.i9Flag && b.employee.i9_reverification_due_date, b.everifyFlag && b.employee.e_verify_recheck_due_date].filter(Boolean).sort()[0] || '';
      return aDate.localeCompare(bDate);
    });
}
