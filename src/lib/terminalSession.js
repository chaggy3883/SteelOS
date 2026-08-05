import { db } from '@/api/apiClient';

const TERMINAL_ID_KEY = 'steelos_terminal_id';
const LOCKOUT_THRESHOLD = 3;
const LOCKOUT_MINUTES = 5;

export function getTerminalId() {
  let id = localStorage.getItem(TERMINAL_ID_KEY);
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `terminal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(TERMINAL_ID_KEY, id);
  }
  return id;
}

const getOrCreateSession = async (terminalId) => {
  const matches = await db.entities.employee_portal_sessions.filter({ terminal_id: terminalId }, '-created_date', 1);
  if (matches[0]) return matches[0];
  return db.entities.employee_portal_sessions.create({ terminal_id: terminalId, attempts_count: 0, locked_until_timestamp: '', active_token: '' });
};

export async function isTerminalLocked(terminalId) {
  const session = await getOrCreateSession(terminalId);
  if (!session.locked_until_timestamp) return { locked: false, session };
  const lockedUntil = new Date(session.locked_until_timestamp);
  if (lockedUntil.getTime() > Date.now()) return { locked: true, session, lockedUntil };
  return { locked: false, session };
}

// On the 3rd consecutive failure, locks the TERMINAL (not the employee) for
// 5 minutes and drops an audit alert — this is a device-level brute-force
// gate, matching the spec's own field list (employee_portal_sessions has no
// employee_id), so it blocks anyone hammering PINs at that physical kiosk
// regardless of which employee_number they're trying.
export async function recordFailedAttempt(terminalId) {
  const session = await getOrCreateSession(terminalId);
  const attempts_count = (session.attempts_count || 0) + 1;
  const updates = { attempts_count };
  let justLocked = false;
  if (attempts_count >= LOCKOUT_THRESHOLD) {
    updates.locked_until_timestamp = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
    updates.attempts_count = 0;
    justLocked = true;
  }
  const updated = await db.entities.employee_portal_sessions.update(session.id, updates);
  if (justLocked) {
    await db.entities.AuditLog.create({
      user_id: terminalId,
      action_type: 'OTHER',
      entity_type: 'employee_portal_sessions',
      entity_id: session.id,
      notes: `Kiosk terminal ${terminalId} locked for ${LOCKOUT_MINUTES} minutes after ${LOCKOUT_THRESHOLD} consecutive failed PIN attempts.`,
    });
  }
  return { session: updated, justLocked };
}

// The employee identity is encoded directly into the token string rather
// than as a separate field, since employee_portal_sessions' field list in
// the spec has no employee_id column.
export async function recordSuccessfulLogin(terminalId, employeeId) {
  const session = await getOrCreateSession(terminalId);
  const active_token = `${employeeId}::${Date.now()}::${Math.random().toString(16).slice(2)}`;
  return db.entities.employee_portal_sessions.update(session.id, {
    attempts_count: 0,
    locked_until_timestamp: '',
    active_token,
  });
}

export function getEmployeeIdFromToken(token) {
  if (!token) return null;
  return token.split('::')[0] || null;
}
