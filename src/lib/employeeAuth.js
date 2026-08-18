// Single source of truth for "is this employee currently allowed to log in
// anywhere" — kiosk PIN, the Employee Center's manual PIN card, and any
// portal User account linked to an employees row via employee_id all defer
// to this instead of re-deriving the rule. An employee is terminated when
// EITHER is_active is false OR termination_date has arrived (today or
// earlier) — see TerminationPanel.jsx for the write side.
const todayDateOnly = () => new Date().toISOString().slice(0, 10);

export function isEmployeeActive(employee) {
  if (!employee) return false;
  if (employee.is_active === false) return false;
  if (employee.termination_date && employee.termination_date <= todayDateOnly()) return false;
  return true;
}

export const DEACTIVATION_MESSAGE = 'Your account has been deactivated. Please contact HR.';
