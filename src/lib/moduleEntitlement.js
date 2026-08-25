// Module entitlement — two independent axes, both reached only through
// hasModule() below:
//   1. Module PACK gating (Fabricator / Erector / Enterprise Connect) for
//      page/section-shaped keys (moduleKey starts with '/'), resolved
//      against company.subscription_plan via modulePacks.js's MODULE_PACKS
//      — the single source of truth for the pack -> module mapping. This is
//      module-based gating; nothing here compares subscription_plan against
//      a literal string outside of packModulesFor(), and no other file in
//      the app is allowed to either — they all call hasModule().
//   2. Per-company add-on entitlement toggles for non-path keys ('payroll',
//      'equipment', 'ironsight', ...) via company.enabled_modules — this is
//      the original mechanism, unrelated to pack/plan, independently
//      switchable per company from SuperAdminDashboard regardless of pack.
//
// rbacConfig.jsx answers a third, separate question — "can this user's
// ROLE see this module" — and is never consulted here.
//
// A company on a legacy/unset plan (not one of the three pack keys) is
// treated as "everything on" for pack-gated paths, same "missing data =
// unrestricted" philosophy this file has always used for enabled_modules,
// so pre-existing demo data and any tenant not yet migrated to a pack is
// unaffected.
import { MODULE_PACKS, PACK_EXEMPT_MODULES } from '@/lib/modulePacks';

function packModulesFor(company) {
  const plan = company?.subscription_plan;
  return MODULE_PACKS[plan] || null;
}

export function hasModule(company, moduleKey) {
  // Super_admin impersonating still respects the customer's plan — no blanket
  // bypass. See module docblock above.
  if (typeof moduleKey === 'string' && moduleKey.startsWith('/')) {
    if (PACK_EXEMPT_MODULES.includes(moduleKey)) return true;
    const packModules = packModulesFor(company);
    if (!packModules) return true;
    return packModules.includes(moduleKey);
  }

  const enabled = company?.enabled_modules;
  if (!enabled || enabled.length === 0) return true;
  return enabled.includes(moduleKey);
}

// The resolved list of page/section modules this company's pack grants —
// "allowed_modules" for a company, the same shape rbacConfig.jsx's
// getUserPermissions() returns per-role. null means unrestricted (legacy
// plan). Used by nav components to filter a whole list in one pass instead
// of calling hasModule() item-by-item.
export function getAllowedModules(company) {
  return packModulesFor(company);
}
