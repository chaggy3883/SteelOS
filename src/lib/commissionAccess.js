import { BUILTIN_ROLES, normalizeRoleName } from '@/components/dashboard/rbacConfig';

// Commission plan setup (SalesCommissionConfig — method, default rate,
// per-salesman override toggle) controls how every salesman's commission is
// calculated company-wide, so it's admin-only. Names are checked against
// BUILTIN_ROLES below so this can never silently drift from the roles that
// actually exist, matching payrollSetupAccess.js's convention.
export const COMMISSION_SETUP_ALLOWED_ROLES = ['admin', 'super_admin'];

// Per-salesman rate management is narrower than full commission setup but
// broader than admin-only — payroll_admin and hr_admin both need to maintain
// compensation records as part of normal HR/payroll duties.
export const SALESMAN_RATE_ALLOWED_ROLES = ['admin', 'super_admin', 'payroll_admin', 'hr_admin'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!COMMISSION_SETUP_ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name)) || !SALESMAN_RATE_ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('commissionAccess.js: an allowed-roles list references a role name not present in BUILTIN_ROLES.');
}

export const hasCommissionSetupAccess = (roles) => (roles || []).some((r) => COMMISSION_SETUP_ALLOWED_ROLES.includes(normalizeRoleName(r)));
export const hasSalesmanRateAccess = (roles) => (roles || []).some((r) => SALESMAN_RATE_ALLOWED_ROLES.includes(normalizeRoleName(r)));
