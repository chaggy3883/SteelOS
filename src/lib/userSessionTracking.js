import { db } from '@/api/apiClient';

// One UserSessionLog row per browser tab, for as long as that tab stays
// open — most users close the tab rather than clicking Sign Out, so
// last_heartbeat_at (kept fresh every 60s from AppLayout) is the reliable
// "how long were they actually active" signal, not logout_at. The row id
// lives in sessionStorage (not app state) specifically because it needs to
// survive both a full page reload from Login.jsx's `window.location.href`
// redirect and any later in-app navigation, while still being scoped to
// this one tab (a second tab on an already-authenticated browser gets its
// own row via AppLayout's fallback, not this one).
const SESSION_LOG_ID_KEY = 'steelos-session-log-id';

export function getStoredSessionLogId() {
  return sessionStorage.getItem(SESSION_LOG_ID_KEY);
}

export async function startUserSession(user) {
  if (!user) return;
  const now = new Date().toISOString();
  try {
    const row = await db.entities.UserSessionLog.create({
      company_id: user.company_id,
      user_id: user.id,
      user_email: user.email,
      login_at: now,
      last_heartbeat_at: now,
    });
    sessionStorage.setItem(SESSION_LOG_ID_KEY, row.id);
  } catch (e) {
    // Usage tracking must never block a real login.
  }
}

export async function sendHeartbeat() {
  const id = getStoredSessionLogId();
  if (!id) return;
  try {
    await db.entities.UserSessionLog.update(id, { last_heartbeat_at: new Date().toISOString() });
  } catch (e) {}
}

export async function endUserSession() {
  const id = getStoredSessionLogId();
  if (!id) return;
  try {
    await db.entities.UserSessionLog.update(id, { logout_at: new Date().toISOString() });
  } catch (e) {}
  sessionStorage.removeItem(SESSION_LOG_ID_KEY);
}
