// Who may do what to the material catalogs (MaterialShapeType /
// MaterialSizeOption / MaterialGradeOption, steel_catalog and its
// StockLengthOption rows). Pure — no db/React/rbacConfig imports — so
// localData.js can enforce the same rule at the write itself and it can be
// checked in Node. materialCatalogAccess.js is the app-facing wrapper.
//
//   - view + edit the Material Catalog admin page: admin, super_admin;
//   - add a size / save a typed weight from a takeoff: estimator too;
//   - a super_admin who isn't impersonating a company has no tenant (see
//     tenantContext.js getEffectiveCompanyId), so it's read-only everywhere
//     and the UI shows the usual "pick a company" notice.
//
// Role names are the BUILTIN_ROLES names in rbacConfig.jsx;
// materialCatalogAccess.js checks they still exist there.

// The admin aliases rbacConfig.normalizeRoleName folds into 'admin' — the
// only aliases that matter for these three roles.
const ADMIN_ALIASES = new Set(['admin', 'system_administrator', 'demo_admin', 'demo admin', 'demo-admin']);

export function normalizeCatalogRole(role) {
  const r = String(role || '').toLowerCase().trim();
  return ADMIN_ALIASES.has(r) ? 'admin' : r;
}

export const CATALOG_EDIT_ROLES = ['admin', 'super_admin'];
export const CATALOG_ADD_ROLES = ['admin', 'super_admin', 'estimator'];

// { canView, canEdit, canAdd, needsCompany, readOnly }
export function catalogPermissions(roles, { impersonating = false, isAdminFlag = false } = {}) {
  const set = new Set((roles || []).map(normalizeCatalogRole));
  if (isAdminFlag) set.add('admin');
  const isSuper = set.has('super_admin');
  const needsCompany = isSuper && !impersonating;
  const editRole = CATALOG_EDIT_ROLES.some((r) => set.has(r));
  const addRole = CATALOG_ADD_ROLES.some((r) => set.has(r));
  return {
    canView: editRole,
    canEdit: editRole && !needsCompany,
    canAdd: addRole && !needsCompany,
    needsCompany,
    readOnly: editRole && needsCompany,
  };
}

export const CATALOG_ENTITIES = ['MaterialShapeType', 'MaterialSizeOption', 'MaterialGradeOption', 'steel_catalog', 'StockLengthOption'];

// Fields a takeoff may set on a size the first time it gets a weight.
export const SIZE_WEIGHT_FIELDS = ['weight_per_ft', 'weight_per_sq_ft', 'weight_per_each', 'weight_source', 'weight_set_by', 'weight_set_date'];

const positive = (v) => v != null && v !== '' && Number(v) > 0;
export const hasStoredWeight = (record) => positive(record?.weight_per_ft) || positive(record?.weight_per_sq_ft) || positive(record?.weight_per_each);

// The rule localData.js runs on every write to a catalog entity. Returns
// null when allowed, else the error message. action: create | update |
// delete. `before` is the stored record (update/delete), `data` the payload.
//   - create: sizes (MaterialSizeOption, steel_catalog) need add rights;
//     shapes, grades and stock lengths need edit rights;
//   - update: edit rights — except the takeoff's first-weight save: a size
//     with no stored weight yet may get weight fields only, with add rights;
//   - delete: edit rights.
export function checkCatalogWrite({ entityName, action, roles, impersonating = false, isAdminFlag = false, before = null, data = {} }) {
  if (!CATALOG_ENTITIES.includes(entityName)) return null;
  const p = catalogPermissions(roles, { impersonating, isAdminFlag });
  const who = p.needsCompany ? 'Pick a company to work as (Impersonate) before changing the material catalog.' : null;
  if (action === 'create' && (entityName === 'MaterialSizeOption' || entityName === 'steel_catalog')) {
    return p.canAdd ? null : (who || 'Only estimators, admins and super admins can add catalog sizes.');
  }
  if (p.canEdit) return null;
  if (action === 'update' && (entityName === 'MaterialSizeOption' || entityName === 'steel_catalog') && p.canAdd) {
    const keys = Object.keys(data || {});
    if (keys.length > 0 && keys.every((k) => SIZE_WEIGHT_FIELDS.includes(k)) && !hasStoredWeight(before)) return null;
    return 'This size already has a weight — only an admin can change a stored weight.';
  }
  return who || 'Only an Admin or Super Admin can change the material catalog.';
}
