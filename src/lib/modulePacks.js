// Single source of truth for MODULE PACK gating (Shop Fab / Full Fabrication /
// Erection Only / Enterprise Connect). This is distinct from — and must never
// be routed through — plan-based gating: there is no other file in this app
// that is allowed to compare `company.subscription_plan` against a literal
// string to decide whether a page/section renders. Every other file asks
// hasModule() (src/lib/moduleEntitlement.js), which resolves through the
// tables below. If a module needs to move between packs, or a new pack is
// added, this file is the only place that changes.
//
// Also distinct from rbacConfig.jsx's per-ROLE allowed_modules (which
// answers "can this user's role see this page") and from
// moduleEntitlement.js's non-path add-on keys like 'payroll'/'equipment'/
// 'ironsight' (independently toggleable per company, not tied to a pack) —
// with one deliberate exception, PACK_DERIVED_ADDON_KEYS, documented below.

export const PACKS = {
  FAB: 'SteelOS_Fab',
  ERECT: 'SteelOS_Erect',
  ENTERPRISE: 'Enterprise_Connect',
  SHOP_FAB: 'SteelOS_ShopFab',
};

// Underlying subscription_plan string values are kept stable across this
// rename so existing seeded/live company data never needs migrating — only
// the display text changed.
export const PACK_LABELS = {
  [PACKS.FAB]: 'Full Fabrication',
  [PACKS.ERECT]: 'Erection Only',
  [PACKS.ENTERPRISE]: 'Enterprise Connect',
  [PACKS.SHOP_FAB]: 'Shop Fab',
};

// Smallest common denominator — every pack, including Shop Fab, gets these:
// Estimating and its components, Project Management (Projects/Change
// Orders/Subcontracts), core account/admin scaffolding every tenant needs
// regardless of size, and Executive Analytics/Meeting Mode (both pack-aware
// INTERNALLY for what they display — see ExecutiveAnalytics.jsx's
// hasModule(company, '/accounting') gate and PACK_DERIVED_ADDON_KEYS below).
const TRUE_MINIMAL_SHARED = [
  '/',
  '/estimating',
  '/estimating/analytics',
  '/estimating/spec-review',
  '/estimating/blueprint-takeoff',
  '/projects',
  '/projects/change-orders',
  '/subcontracts',
  '/crm',
  '/crm/directory',
  '/intelligence',
  '/intelligence-signals',
  '/rfis',
  '/portal/login',
  '/users',
  '/settings',
  '/admin',
  '/employee-center',
  '/system-integrations',
  '/executive-analytics',
  '/meeting-mode',
];

// Back-office functions: Full Fabrication, Erection Only, and Enterprise get
// these; Shop Fab does not — a shop-floor-only tenant on the smallest tier
// isn't running its own books, payroll, purchasing, HR, or quality/safety
// program through this app.
//
// Also carries 'meeting-mode-dwell-report' (see PACK_DERIVED_ADDON_KEYS
// below) — its pack membership needs to match this list exactly (granted to
// every pack except Shop Fab), so it rides along here rather than existing
// as a fourth separately-maintained list.
const BACK_OFFICE_MODULES = [
  '/accounting',
  '/legal',
  '/reports',
  '/certified-payroll',
  '/payroll/hours',
  '/payroll/processing',
  '/payroll/setup',
  '/payroll/garnishments',
  '/payroll/401k-contributions',
  '/human-resources',
  '/purchasing',
  '/purchasing/module',
  '/quality',
  '/quality/kpi-builder',
  '/safety',
  '/documents',
  '/sales/dashboard',
  'meeting-mode-dwell-report',
];

// Shop-floor: raw material, fabrication production, shipping product out,
// and receiving (pulled out of the full Purchasing module specifically for
// this — Shop Fab gets receiving without the full Purchasing/Procurement
// module). Every pack that includes a shop gets this list; an erection-only
// contractor has no shop, so none of it applies there.
const SHOP_FAB_ONLY_MODULES = [
  '/production',
  '/shop-fabrication',
  '/shop-operations',
  '/shop-floor-command-center',
  '/shop-efficiency',
  '/inventory',
  '/shipping',
  '/purchasing/receiving-kiosk',
  '/detailer-imports',
];

// Jobsite/erection-site: fleet, rigging, crane/equipment maintenance. A
// fabrication-only contractor has no field crews or cranes, so none of this
// applies to them. This is "the maintenance section" — rigging inspection
// and equipment service both live under Field Operations here.
const ERECT_ONLY_MODULES = [
  '/field-operations',
  '/field-operations/rigging-inspection',
  '/field-operations/equipment-service',
];

// Enterprise Connect bundles every pack — it is not a fifth distinct set of
// modules, just the union. Keeping it derived (rather than a fifth literal
// list) is what "one place" means for this mapping.
export const MODULE_PACKS = {
  [PACKS.SHOP_FAB]: [...TRUE_MINIMAL_SHARED, ...SHOP_FAB_ONLY_MODULES],
  [PACKS.FAB]: [...TRUE_MINIMAL_SHARED, ...BACK_OFFICE_MODULES, ...SHOP_FAB_ONLY_MODULES],
  [PACKS.ERECT]: [...TRUE_MINIMAL_SHARED, ...BACK_OFFICE_MODULES, ...ERECT_ONLY_MODULES],
  [PACKS.ENTERPRISE]: [...TRUE_MINIMAL_SHARED, ...BACK_OFFICE_MODULES, ...SHOP_FAB_ONLY_MODULES, ...ERECT_ONLY_MODULES],
};

// Legacy subscription_plan values that predate the Fab/Erect pack split
// (Company.jsonc's subscription_plan enum still allows them, for customers
// who signed up before packs existed). Mapped explicitly onto Enterprise
// Connect's full module set — these customers were sold access to
// everything — rather than left to fall through packModulesFor()'s "missing
// data = unrestricted" null default in moduleEntitlement.js, which should
// only ever apply to a genuinely unrecognized plan string, not one of these
// three known ones.
['starter', 'professional', 'enterprise'].forEach((legacyPlan) => {
  MODULE_PACKS[legacyPlan] = MODULE_PACKS[PACKS.ENTERPRISE];
});

// Non-'/' module keys that, unlike the ordinary 'payroll'/'equipment'/
// 'ironsight' add-on toggles (independently switchable per company via
// company.enabled_modules, unrelated to pack), must instead track pack
// membership exactly like a path-shaped module does. moduleEntitlement.js's
// hasModule() special-cases keys in this list to resolve through
// MODULE_PACKS instead of enabled_modules.
//
// 'meeting-mode-dwell-report': the Dwell Report section (planned, built
// separately — see the Meeting Mode feature work) pulls from Shop Operations
// data, so gating it on hasModule(company, '/shop-operations') would seem
// natural — except Shop Fab DOES include '/shop-operations' (see
// SHOP_FAB_ONLY_MODULES above), and the business rule is explicitly "no
// Dwell Report on the smallest tier" regardless of that. This key is a
// Meeting-Mode-specific exception layered on top of the module system, not a
// reflection of general Shop Operations access, which is why it can't just
// be a second path check — it needs its own key, granted to Full
// Fabrication/Erection Only/Enterprise Connect and withheld from Shop Fab
// (see its entry in BACK_OFFICE_MODULES above).
export const PACK_DERIVED_ADDON_KEYS = ['meeting-mode-dwell-report'];

// Paths outside the pack model entirely (platform-operator surfaces, not
// sold as part of any tenant's pack). Never filtered by hasModule().
export const PACK_EXEMPT_MODULES = ['/super-admin/dashboard'];

// For locked-state messaging: "this lives in the Erector or Enterprise
// Connect pack." Returns pack keys, in MODULE_PACKS iteration order, whose
// module list includes modulePath — excluding the union pack when a more
// specific single pack already covers it, so an Erect-only module reports
// just ['SteelOS_Erect', 'Enterprise_Connect'] rather than implying Fab helps.
export function packsIncludingModule(modulePath) {
  return Object.entries(MODULE_PACKS)
    .filter(([, modules]) => modules.includes(modulePath))
    .map(([pack]) => pack);
}

export function packsIncludingModuleLabel(modulePath) {
  const packs = packsIncludingModule(modulePath);
  return packs.map((p) => PACK_LABELS[p] || p).join(' or ');
}
