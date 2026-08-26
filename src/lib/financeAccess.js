import { BUILTIN_ROLES, normalizeRoleName } from '@/components/dashboard/rbacConfig';

// The finance-side equivalent of payrollApprovalAccess.js's reopen gate:
// bypassing a closed accounting period, or changing a paid invoice's dollar
// amount, requires this same audience and a mandatory reason. Self-validated
// against BUILTIN_ROLES so it can never silently drift from the roles that
// actually exist.
export const FINANCE_OVERRIDE_ALLOWED_ROLES = ['admin', 'super_admin', 'controller'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!FINANCE_OVERRIDE_ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('financeAccess.js: an allowed-roles list references a role name not present in BUILTIN_ROLES.');
}

export const hasFinanceOverrideAccess = (roles) => (roles || []).some((r) => FINANCE_OVERRIDE_ALLOWED_ROLES.includes(normalizeRoleName(r)));
