import { BUILTIN_ROLES } from '@/components/dashboard/rbacConfig';
import { isImpersonating } from '@/lib/tenantContext';
import { CATALOG_ADD_ROLES, CATALOG_EDIT_ROLES, catalogPermissions } from '@/lib/materialCatalogRoles';

// Master material catalog (shape types + sizes/grades), steel_catalog and
// its stock lengths. Viewing and editing the Material Catalog admin page is
// admin + super_admin only (a super_admin must be impersonating a company to
// edit — read-only otherwise). Estimators can still ADD a size and save the
// first weight for a "Weight needed" size from a takeoff
// (canAddCatalogSize), but can't change or delete what's stored. The same
// rule runs inside localData.js on every catalog write
// (materialCatalogRoles.js checkCatalogWrite). Names are checked against
// BUILTIN_ROLES so this can never silently drift from the roles that
// actually exist, matching commissionAccess.js's convention.
export const MATERIAL_CATALOG_ALLOWED_ROLES = CATALOG_EDIT_ROLES;
export const CATALOG_SIZE_ADD_ROLES = CATALOG_ADD_ROLES;

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (![...MATERIAL_CATALOG_ALLOWED_ROLES, ...CATALOG_SIZE_ADD_ROLES].every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('materialCatalogAccess.js: a material catalog role references a role name not present in BUILTIN_ROLES.');
}

// { canView, canEdit, canAdd, needsCompany, readOnly } — `impersonating`
// defaults to the live session's state.
export const materialCatalogPermissions = (roles, impersonating = isImpersonating()) => catalogPermissions(roles, { impersonating });

// Can open the Material Catalog admin page (read-only for a super_admin
// who hasn't picked a company).
export const hasMaterialCatalogAccess = (roles) => catalogPermissions(roles).canView;

export const canEditMaterialCatalog = (roles, impersonating = isImpersonating()) => catalogPermissions(roles, { impersonating }).canEdit;

// Takeoff "+ Add size" and the first save of a typed weight.
export const canAddCatalogSize = (roles, impersonating = isImpersonating()) => catalogPermissions(roles, { impersonating }).canAdd;
