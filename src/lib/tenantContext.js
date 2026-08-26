import { db } from '@/api/apiClient';
import { getAuthState, setAuthState } from '@/api/localData';

// HONESTY NOTE: this app has no real backend — every "tenant"'s data still
// lives in the same browser's single localStorage blob. This module (and the
// interceptor in localData.js it works with) makes tenant isolation behave
// correctly for normal in-app use; it is NOT a real security boundary —
// anyone with devtools access to that browser's storage can still read every
// tenant's raw records regardless of this filter.

export function isSuperAdmin(user) {
  const roles = (user?.roles || []).map((r) => String(r).toLowerCase());
  return roles.includes('super_admin');
}

// Broader than isSuperAdmin — true for any role that should see the Admin
// module's tabs (system_administrator, the seeded demo "Demo Admin"/"Admin"
// role strings, or an explicit is_admin flag), not just the platform
// super_admin role.
export function isAdminUser(user) {
  const roles = user?.roles || [];
  const normalizedRoles = roles.map((r) => String(r).toLowerCase());
  return (
    normalizedRoles.includes('admin') ||
    normalizedRoles.includes('system_administrator') ||
    normalizedRoles.includes('super_admin') ||
    user?.is_admin === true ||
    roles.includes('Demo Admin') ||
    roles.includes('Admin')
  );
}

// The session's home tenant, or the tenant a super_admin is currently
// impersonating — this is the single value the query interceptor scopes by.
//
// A super_admin session NEVER falls back to its own User row's company_id,
// even for a seeded demo account that happens to carry one (e.g. "Demo
// Admin" holding both 'admin' and 'super_admin' and a home company_id) —
// otherwise that tenant's data would be visible the instant the platform
// operator logs in, without ever clicking "Impersonate". A super_admin has
// no effective tenant until startImpersonation() sets one explicitly.
export function getEffectiveCompanyId() {
  const auth = getAuthState();
  if (!auth?.user) return null;
  if (auth.impersonating_company_id) return auth.impersonating_company_id;
  if (isSuperAdmin(auth.user)) return null;
  return auth.user.company_id || null;
}

export function isImpersonating() {
  const auth = getAuthState();
  return !!auth?.impersonating_company_id;
}

export function getImpersonatingCompanyId() {
  return getAuthState()?.impersonating_company_id || null;
}

// "Log into Instance": rewrites the session's active tenant without ever
// touching the target tenant's users or passwords.
export function startImpersonation(companyId) {
  const auth = getAuthState();
  if (!auth) return;
  setAuthState({ ...auth, impersonating_company_id: companyId });
}

export function stopImpersonation() {
  const auth = getAuthState();
  if (!auth) return;
  const { impersonating_company_id, ...rest } = auth;
  setAuthState(rest);
}

// Company itself is the tenant registry, so it is never scoped by the
// interceptor — this reads the CURRENT effective tenant's own profile row
// directly by id, rather than "whichever Company row happens to be first."
export async function getEffectiveCompany() {
  const companyId = getEffectiveCompanyId();
  if (!companyId) return null;
  return db.entities.Company.get(companyId);
}
