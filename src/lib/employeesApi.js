import { base44 } from '@/api/base44Client';
import { encodeFormulaPin } from '@/lib/pinFormula';

const PUBLIC_FIELDS = ['id', 'employee_number', 'full_name', 'classification', 'hire_date', 'is_active', 'is_active_login', 'created_date', 'updated_date'];
const FULL_ACCESS_ROLES = ['hr_admin', 'payroll_admin', 'admin'];

const normalizeRoles = (roles) => (Array.isArray(roles) ? roles : [roles]).map((r) => String(r || '').toLowerCase().trim());

export const hasFullEmployeeAccess = (roles) => normalizeRoles(roles).some((r) => FULL_ACCESS_ROLES.includes(r));
const hasFullAccess = hasFullEmployeeAccess;

const maskEmployee = (employee) => {
  const masked = {};
  PUBLIC_FIELDS.forEach((field) => { masked[field] = employee[field]; });
  return masked;
};

// This is the "employees API routing" masking chokepoint the HR module is
// built around. Every UI surface must read employee records through these
// two functions instead of calling base44.entities.employees directly, or
// the SSN / pay-rate / PIN / lock-state masking below is bypassed entirely.
// Shop_Manager / Project_Manager (and any role not in FULL_ACCESS_ROLES) only
// ever see Name, ID, and classification — never pay rate, SSN, or PIN state.
export async function listEmployeesForRole(roles, sortField = '-created_date', limit = 200) {
  const rows = await base44.entities.employees.list(sortField, limit);
  return hasFullAccess(roles) ? rows : rows.map(maskEmployee);
}

export async function getEmployeeForRole(id, roles) {
  const row = await base44.entities.employees.get(id);
  if (!row) return null;
  return hasFullAccess(roles) ? row : maskEmployee(row);
}

const nextEmployeeNumber = async () => {
  const existing = await base44.entities.employees.list('-created_date', 500);
  const max = existing.reduce((m, e) => {
    const n = parseInt(e.employee_number, 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return String(max + 1).padStart(3, '0');
};

// The "candidate flipped to Hired" provisioning trigger. No real backend
// trigger system exists in this app, so this function IS the trigger — any
// "mark candidate hired" UI action must go through this single call site so
// provisioning can never be skipped.
export async function hireCandidate(candidateId) {
  const candidate = await base44.entities.candidate_profiles.get(candidateId);
  if (!candidate) throw new Error('Candidate not found');

  const employee_number = await nextEmployeeNumber();
  // PIN is a pure formula of ssn_last4 + employee_number (see pinFormula.js's
  // security caveat) — with ssn_last4 still blank at provisioning time, this
  // computes a placeholder PIN that becomes real the moment HR enters the SSN.
  const employee = await base44.entities.employees.create({
    employee_number,
    full_name: candidate.candidate_name,
    classification: candidate.position_applied,
    hire_date: new Date().toISOString().slice(0, 10),
    is_active: true,
    pin_encrypted: encodeFormulaPin({ employee_number, ssn_last4: '' }),
    is_timeclock_locked: true,
    has_w4_approved: false,
    has_i9_approved: false,
    ssn_last4: '',
    pay_rate_cents: 0,
    is_active_login: true,
  });

  await base44.entities.candidate_profiles.update(candidateId, {
    status: 'Hired',
    hired_employee_id: employee.id,
  });

  return employee;
}

// PIN-lockout auto-unlock rule: a locked timeclock terminal unlocks the
// instant BOTH W-4 and I-9 are approved, and re-locks if either is revoked.
export async function reevaluateTimeclockLock(employee) {
  const shouldUnlock = !!employee.has_w4_approved && !!employee.has_i9_approved;
  return base44.entities.employees.update(employee.id, { is_timeclock_locked: !shouldUnlock });
}

// The PIN is never manually set — it's always recomputed from the formula
// whenever the underlying fields (ssn_last4, employee_number) change, so
// there's exactly one source of truth for what an employee's PIN is.
export async function syncFormulaPin(employee) {
  return base44.entities.employees.update(employee.id, { pin_encrypted: encodeFormulaPin(employee) });
}
