import { db } from '@/api/apiClient';

// Completely separate session from the internal db.auth system — its own
// localStorage key, so a portal login can never collide with or silently log
// out an internal staff session (and vice versa). See src/pages/portal/*.
const PORTAL_AUTH_KEY = 'steelos_portal_auth_state';

export async function portalLogin(orgType, email, password) {
  const entityName = orgType === 'vendor' ? 'Vendor' : 'Customer';
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const list = await db.entities[entityName].filter({ portal_enabled: true }, '-created_date', 100);
  const match = list.find(
    (org) => String(org.portal_email || '').toLowerCase() === normalizedEmail && org.portal_password === password
  );
  if (!match) {
    throw new Error('Invalid email or password');
  }
  const session = { orgType, orgId: match.id, orgName: match.name };
  localStorage.setItem(PORTAL_AUTH_KEY, JSON.stringify(session));
  return session;
}

export function portalLogout() {
  localStorage.removeItem(PORTAL_AUTH_KEY);
}

export function getPortalSession() {
  try {
    const raw = localStorage.getItem(PORTAL_AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
