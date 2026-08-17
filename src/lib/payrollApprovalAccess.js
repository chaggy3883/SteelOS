import { BUILTIN_ROLES, normalizeRoleName } from '@/components/dashboard/rbacConfig';

// Segregation of duties: payroll_admin/controller can already run payroll
// (create it in 'review' — see PAYROLL_PROCESSING_ALLOWED_ROLES in
// PayrollProcessing.jsx), but approving/locking it — the action that makes a
// run's numbers final and locks the source timecards — requires a stricter,
// separate set of roles. payroll_admin is deliberately excluded here: the
// role that prepares payroll should not also be the one that signs off on
// it. Self-validated against BUILTIN_ROLES so this can never silently drift
// from the roles that actually exist, matching payrollSetupAccess.js.
export const PAYROLL_APPROVAL_ALLOWED_ROLES = ['admin', 'super_admin', 'controller'];

// Reopening a locked run is an operational undo (so corrections can be made
// before a fresh approve/lock cycle), not a finalization decision — the
// same broader audience that can run payroll can also reopen it.
export const PAYROLL_REOPEN_ALLOWED_ROLES = ['admin', 'super_admin', 'payroll_admin', 'controller'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!PAYROLL_APPROVAL_ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name)) || !PAYROLL_REOPEN_ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('payrollApprovalAccess.js: an allowed-roles list references a role name not present in BUILTIN_ROLES.');
}

export const hasPayrollApprovalAccess = (roles) => (roles || []).some((r) => PAYROLL_APPROVAL_ALLOWED_ROLES.includes(normalizeRoleName(r)));
export const hasPayrollReopenAccess = (roles) => (roles || []).some((r) => PAYROLL_REOPEN_ALLOWED_ROLES.includes(normalizeRoleName(r)));
