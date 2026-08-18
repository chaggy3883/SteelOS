import { encodePin } from '@/lib/hrSecurity';

// SECURITY CAVEAT — read before touching this file.
// The kiosk/timeclock PIN is the employee's own last-4 Social Security
// digits, entered directly — identified separately by the 3-digit
// employee_number (already a public, sequential field elsewhere in this app;
// see employeesApi.js's masking layer). This mirrors a common real-world
// convention (many HR/benefits self-service kiosks already use SSN-last-4 as
// the "PIN"), but it is still only a 10,000-value space and is the same 4
// digits already printed on this employee's own paperwork — the
// 3-attempt/5-minute terminal lockout (terminalSession.js) slows brute
// forcing, it does not prevent someone who already knows the digits. HR can
// always override it with an independently chosen PIN via setManualPin
// (System Access Portal) for a company that wants stronger credentials.
export function computeFormulaPin(employee) {
  return String(employee?.ssn_last4 || '').padStart(4, '0').slice(-4);
}

export function encodeFormulaPin(employee) {
  return encodePin(computeFormulaPin(employee));
}
