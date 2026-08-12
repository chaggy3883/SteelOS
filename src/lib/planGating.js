// SteelOS Erect is a trimmed subscription plan for erection-only contractors
// — no shop, no fabrication. Gating here is UI-only (which cost categories
// render, which nav entries show), same caveat as tenantContext.js: it is
// not a security boundary, just correct behavior for normal in-app use.
export function isErectPlan(company) {
  return company?.subscription_plan === 'SteelOS_Erect';
}

// Erection-site Field Operations workflows (rigging, fleet/equipment
// service) — gated to the Erector pack and to Enterprise Connect (which
// bundles every pack), not to Fab.
const ERECTOR_ENTERPRISE_PLANS = ['SteelOS_Erect', 'Enterprise_Connect'];

export function canAccessRiggingInspection(company) {
  return ERECTOR_ENTERPRISE_PLANS.includes(company?.subscription_plan);
}

export function canAccessEquipmentService(company) {
  return ERECTOR_ENTERPRISE_PLANS.includes(company?.subscription_plan);
}
