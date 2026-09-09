import { BUILTIN_ROLES, normalizeRoleName } from '@/components/dashboard/rbacConfig';

// Bid Worksheet default rates (CostCategoryDefaultRate) are estimating
// reference data, same as the master material catalog — admitted to
// whoever owns estimating day to day, not only full admins. There is no
// distinct 'estimating_admin' BUILTIN_ROLE, so 'estimator' is the closest
// existing role, matching materialCatalogAccess.js's convention exactly.
export const BID_WORKSHEET_RATE_ALLOWED_ROLES = ['admin', 'super_admin', 'estimator'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!BID_WORKSHEET_RATE_ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('bidWorksheetRateAccess.js: BID_WORKSHEET_RATE_ALLOWED_ROLES references a role name not present in BUILTIN_ROLES.');
}

export const hasBidWorksheetRateAccess = (roles) => (roles || []).some((r) => BID_WORKSHEET_RATE_ALLOWED_ROLES.includes(normalizeRoleName(r)));
