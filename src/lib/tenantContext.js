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

// The session's home tenant, or the tenant a super_admin is currently
// impersonating — this is the single value the query interceptor scopes by.
export function getEffectiveCompanyId() {
  const auth = getAuthState();
  if (!auth?.user) return null;
  return auth.impersonating_company_id || auth.user.company_id || null;
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
