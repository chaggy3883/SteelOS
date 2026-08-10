// Module entitlement — separate from rbacConfig.jsx's per-role module list.
// rbacConfig answers "can this user see this module"; hasModule answers "did
// this tenant buy this module at all." A missing/empty enabled_modules is
// treated as "everything on" so existing tenants and demo data (seeded
// before this field existed) are unaffected.
export function hasModule(company, moduleKey) {
  const enabled = company?.enabled_modules;
  if (!enabled || enabled.length === 0) return true;
  return enabled.includes(moduleKey);
}
