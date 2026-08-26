import { BUILTIN_ROLES, normalizeRoleName } from '@/components/dashboard/rbacConfig';

// Payroll Setup (master data: pay rates, tax withholding, deductions, GL
// mappings, pay period calendar, payroll rules) is payroll/HR/admin only —
// narrower than general HR access (compensation + tax setup, not just
// personnel records) but broader than PayrollProcessing.jsx's own ALLOWED_ROLES since
// hr_admin also needs to set up new hires' pay rates and withholding. Names
// are checked against BUILTIN_ROLES below so this can never silently drift
// from the roles that actually exist.
export const PAYROLL_SETUP_ALLOWED_ROLES = ['admin', 'super_admin', 'payroll_admin', 'hr_admin', 'controller'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!PAYROLL_SETUP_ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('payrollSetupAccess.js: PAYROLL_SETUP_ALLOWED_ROLES references a role name not present in BUILTIN_ROLES.');
}

export const hasPayrollSetupAccess = (roles) => (roles || []).some((r) => PAYROLL_SETUP_ALLOWED_ROLES.includes(normalizeRoleName(r)));
