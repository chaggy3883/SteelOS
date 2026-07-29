// SteelOS Erect is a trimmed subscription plan for erection-only contractors
// — no shop, no fabrication. Gating here is UI-only (which cost categories
// render, which nav entries show), same caveat as tenantContext.js: it is
// not a security boundary, just correct behavior for normal in-app use.
export function isErectPlan(company) {
  return company?.subscription_plan === 'SteelOS_Erect';
}
