import { BUILTIN_ROLES, normalizeRoleName } from '@/components/dashboard/rbacConfig';

// Master material catalog (shape types + their size/grade options) feeds the
// Material Takeoff grade dropdown and (per the app's estimating-heavy usage)
// is maintained by whoever owns estimating reference data day to day, not
// only full admins. There is no distinct 'estimating_admin' BUILTIN_ROLE —
// 'estimator' is the closest existing role, so it's admitted here alongside
// admin/super_admin. Names are checked against BUILTIN_ROLES so this can
// never silently drift from the roles that actually exist, matching
// commissionAccess.js's convention.
export const MATERIAL_CATALOG_ALLOWED_ROLES = ['admin', 'super_admin', 'estimator'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!MATERIAL_CATALOG_ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('materialCatalogAccess.js: MATERIAL_CATALOG_ALLOWED_ROLES references a role name not present in BUILTIN_ROLES.');
}

export const hasMaterialCatalogAccess = (roles) => (roles || []).some((r) => MATERIAL_CATALOG_ALLOWED_ROLES.includes(normalizeRoleName(r)));
