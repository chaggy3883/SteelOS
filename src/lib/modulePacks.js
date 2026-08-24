// Single source of truth for MODULE PACK gating (Fabricator / Erector /
// Enterprise Connect). This is distinct from — and must never be routed
// through — plan-based gating: there is no other file in this app that is
// allowed to compare `company.subscription_plan` against a literal string
// to decide whether a page/section renders. Every other file asks
// hasModule() (src/lib/moduleEntitlement.js), which resolves through the
// tables below. If a module needs to move between packs, or a new pack is
// added, this file is the only place that changes.
//
// Also distinct from rbacConfig.jsx's per-ROLE allowed_modules (which
// answers "can this user's role see this page") and from
// moduleEntitlement.js's non-path add-on keys like 'payroll'/'equipment'/
// 'ironsight' (independently toggleable per company, not tied to a pack).

export const PACKS = {
  FAB: 'SteelOS_Fab',
  ERECT: 'SteelOS_Erect',
  ENTERPRISE: 'Enterprise_Connect',
};

export const PACK_LABELS = {
  [PACKS.FAB]: 'Fabricator',
  [PACKS.ERECT]: 'Erector',
  [PACKS.ENTERPRISE]: 'Enterprise Connect',
};

// Every pack includes these — general back-office/estimating/PM functions
// that apply regardless of whether the company fabricates, erects, or both.
const SHARED_MODULES = [
  '/',
  '/estimating',
  '/estimating/analytics',
  '/estimating/spec-review',
  '/estimating/blueprint-takeoff',
  '/projects',
  '/projects/change-orders',
  '/subcontracts',
  '/certified-payroll',
  '/intelligence',
  '/intelligence-signals',
  '/crm',
  '/crm/directory',
  '/purchasing',
  '/purchasing/module',
  '/purchasing/receiving-kiosk',
  '/quality',
  '/quality/kpi-builder',
  '/safety',
  '/documents',
  '/rfis',
  '/accounting',
  '/reports',
  '/legal',
  '/portal/login',
  '/users',
  '/settings',
  '/admin',
  '/human-resources',
  '/payroll',
  '/payroll/hours',
  '/executive-analytics',
  '/employee-center',
  '/system-integrations',
  '/meeting-mode',
];

// Shop-floor: raw material, fabrication production, shipping product out.
// An erection-only contractor has no shop, so none of this applies to them.
const FAB_ONLY_MODULES = [
  '/inventory',
  '/production',
  '/shop-fabrication',
  '/shop-operations',
  '/shop-floor-command-center',
  '/shop-efficiency',
  '/shipping',
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

// Enterprise Connect bundles every pack — it is not a fourth distinct set of
// modules, just the union. Keeping it derived (rather than a fourth literal
// list) is what "one place" means for this mapping.
export const MODULE_PACKS = {
  [PACKS.FAB]: [...SHARED_MODULES, ...FAB_ONLY_MODULES],
  [PACKS.ERECT]: [...SHARED_MODULES, ...ERECT_ONLY_MODULES],
  [PACKS.ENTERPRISE]: [...SHARED_MODULES, ...FAB_ONLY_MODULES, ...ERECT_ONLY_MODULES],
};

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
