import { encodePin } from '@/lib/hrSecurity';

// SECURITY CAVEAT — read before touching this file.
// This PIN is a deterministic FORMULA of two employee fields, not an
// independently chosen secret: the last two digits of ssn_last4, plus the
// 3-digit employee_number. employee_number is sequential and already
// treated as a public field elsewhere in this app (employeesApi.js's own
// masking layer exposes it to every role) — so the only actual unknown is 2
// SSN digits, a 100-value search space that a 3-attempt/5-minute lockout
// slows but does not meaningfully prevent from being brute-forced. This is
// implemented exactly as specified because this app only ever contains fake,
// non-real employee data. It is NOT a pattern to reuse for a real
// payroll/HR system — a PIN should be an independently chosen secret, never
// derived from other stored fields.
export function computeFormulaPin(employee) {
  const ssnLast4 = String(employee?.ssn_last4 || '').padStart(4, '0').slice(-4);
  const ssnDigits34 = ssnLast4.slice(2, 4); // "digits 3 & 4" of the 4-digit suffix = its final two characters
  const employeeNumber = String(employee?.employee_number || '').padStart(3, '0').slice(-3);
  return `${ssnDigits34}${employeeNumber}`;
}

export function encodeFormulaPin(employee) {
  return encodePin(computeFormulaPin(employee));
}
