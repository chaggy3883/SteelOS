import { BUILTIN_ROLES, normalizeRoleName } from '@/components/dashboard/rbacConfig';

// Build Areas carry contract_value_pct, an estimator-entered % of total
// contract value — shop/production roles must see an Area's name and
// production_priority only, never this or any dollar figure derived from
// it. Mirrors financeAccess.js's self-validated-against-BUILTIN_ROLES
// pattern so this can never silently drift from the roles that actually
// exist. super_admin is included alongside the front-office roles for the
// same reason FINANCE_OVERRIDE_ALLOWED_ROLES includes it: a platform
// operator should never be more restricted than a tenant admin.
export const AREA_PRICING_VISIBLE_ROLES = ['admin', 'super_admin', 'estimator', 'project_manager', 'controller', 'finance_department'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!AREA_PRICING_VISIBLE_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('areaVisibility.js: an allowed-roles list references a role name not present in BUILTIN_ROLES.');
}

export const canSeeAreaPricing = (roles) => (roles || []).some((r) => AREA_PRICING_VISIBLE_ROLES.includes(normalizeRoleName(r)));
