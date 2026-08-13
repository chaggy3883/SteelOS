import { BUILTIN_ROLES, normalizeRoleName } from '@/components/dashboard/rbacConfig';

// Disciplinary actions are sensitive personnel/legal records — restricted to
// the roles BUILTIN_ROLES actually labels for HR administration ('hr_admin'),
// plus the platform admin wildcard. Deliberately narrower than
// HumanResources.jsx's own page-level access (payroll_admin/controller can
// see the HR module for compensation reasons but should not author
// disciplinary write-ups). Names are checked against BUILTIN_ROLES below so
// this can never silently drift from the roles that actually exist.
const DISCIPLINARY_ACTION_ROLE_NAMES = ['admin', 'hr_admin'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!DISCIPLINARY_ACTION_ROLE_NAMES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('disciplinaryAccess.js: DISCIPLINARY_ACTION_ROLE_NAMES references a role name not present in BUILTIN_ROLES.');
}

export function canManageDisciplinaryActions(roles) {
  const list = (Array.isArray(roles) ? roles : [roles]).filter(Boolean);
  return list.some((r) => DISCIPLINARY_ACTION_ROLE_NAMES.includes(normalizeRoleName(r)));
}
