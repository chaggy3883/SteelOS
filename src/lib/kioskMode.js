// Dedicated Shop Kiosk Mode — a device-level setting (not a user/session
// setting), so it survives across logins/logouts on the same physical
// terminal. Persisted to localStorage, exactly like terminalSession.js's
// lockout tracker, since this app has no per-device server config either.
const KIOSK_STORAGE_KEY = 'steelos_kiosk_mode';

export function getKioskMode() {
  try {
    const raw = localStorage.getItem(KIOSK_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function isKioskModeEnabled() {
  return !!getKioskMode()?.companyCode;
}

export function enableKioskMode(companyCode, companyName) {
  localStorage.setItem(KIOSK_STORAGE_KEY, JSON.stringify({ companyCode, companyName }));
}

export function disableKioskMode() {
  localStorage.removeItem(KIOSK_STORAGE_KEY);
}
