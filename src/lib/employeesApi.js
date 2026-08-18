import { db } from '@/api/apiClient';
import { encodeFormulaPin } from '@/lib/pinFormula';
import { encodePin } from '@/lib/hrSecurity';

// termination_reason (but not termination_reason_other/final_notes, which can
// carry sensitive HR detail) is deliberately public — standing rule: it must
// be visible in the HR employee list/reports, not just to full-access roles.
const PUBLIC_FIELDS = ['id', 'employee_number', 'full_name', 'classification', 'hire_date', 'is_active', 'is_active_login', 'termination_date', 'termination_reason', 'created_date', 'updated_date'];
const FULL_ACCESS_ROLES = ['hr_admin', 'payroll_admin', 'admin'];

// Shared by TerminationPanel.jsx (the dropdown) and HumanResources.jsx (label
// lookup for the employee list/reports) so the value<->label mapping only
// lives in one place.
export const TERMINATION_REASONS = [
  { value: 'voluntary_resignation', label: 'Voluntary Resignation' },
  { value: 'involuntary_discharge', label: 'Involuntary Discharge' },
  { value: 'reduction_in_force', label: 'Reduction in Force' },
  { value: 'retirement', label: 'Retirement' },
  { value: 'deceased', label: 'Deceased' },
  { value: 'other', label: 'Other' },
];

export const terminationReasonLabel = (employee) => {
  if (!employee?.termination_reason) return '';
  if (employee.termination_reason === 'other') return employee.termination_reason_other || 'Other';
  return TERMINATION_REASONS.find((r) => r.value === employee.termination_reason)?.label || employee.termination_reason;
};

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
// two functions instead of calling db.entities.employees directly, or
// the SSN / pay-rate / PIN / lock-state masking below is bypassed entirely.
// Shop_Manager / Project_Manager (and any role not in FULL_ACCESS_ROLES) only
// ever see Name, ID, and classification — never pay rate, SSN, or PIN state.
export async function listEmployeesForRole(roles, sortField = '-created_date', limit = 200) {
  const rows = await db.entities.employees.list(sortField, limit);
  return hasFullAccess(roles) ? rows : rows.map(maskEmployee);
}

export async function getEmployeeForRole(id, roles) {
  const row = await db.entities.employees.get(id);
  if (!row) return null;
  return hasFullAccess(roles) ? row : maskEmployee(row);
}

export const nextEmployeeNumber = async () => {
  const existing = await db.entities.employees.list('-created_date', 500);
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
  const candidate = await db.entities.candidate_profiles.get(candidateId);
  if (!candidate) throw new Error('Candidate not found');

  const employee_number = await nextEmployeeNumber();
  // PIN is the employee's own last-4 SSN (see pinFormula.js's security
  // caveat) — with ssn_last4 still blank at provisioning time, this computes
  // a placeholder PIN ("0000") that becomes real the moment HR enters the SSN.
  const employee = await db.entities.employees.create({
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

  await db.entities.candidate_profiles.update(candidateId, {
    status: 'Hired',
    hired_employee_id: employee.id,
  });

  return employee;
}

// The "Add Employee" wizard's provisioning trigger — same shape as
// hireCandidate above, but for employees onboarded directly without first
// going through the ATS pipeline. Kept as a single call site for the same
// reason hireCandidate is: so the formula-PIN + lockout defaults can never
// be skipped by a UI path that forgets one of them.
export async function provisionEmployee(formData) {
  const employee_number = await nextEmployeeNumber();
  const ssn_last4 = (formData.ssn_last4 || '').replace(/\D/g, '').slice(0, 4);

  return db.entities.employees.create({
    employee_number,
    full_name: formData.full_name,
    dob: formData.dob,
    address_street: formData.address_street,
    address_city: formData.address_city,
    address_state: formData.address_state,
    address_zip: formData.address_zip,
    phone: formData.phone,
    personal_email: formData.personal_email,
    ssn_last4,
    emergency_contact_name: formData.emergency_contact_name,
    emergency_contact_phone: formData.emergency_contact_phone,
    emergency_contact_relationship: formData.emergency_contact_relationship,
    classification: formData.classification,
    hire_date: formData.hire_date,
    pay_type: formData.pay_type,
    pay_rate_cents: formData.pay_type === 'salary' ? 0 : (Number(formData.pay_rate_cents) || 0),
    annual_salary_cents: formData.pay_type === 'salary' ? (Number(formData.annual_salary_cents) || 0) : 0,
    department: formData.department,
    platform_role: formData.platform_role,
    supervisor_name: formData.supervisor_name,
    pin_encrypted: encodeFormulaPin({ employee_number, ssn_last4 }),
    is_timeclock_locked: true,
    has_w4_approved: false,
    has_i9_approved: false,
    is_active: true,
    is_active_login: true,
  });
}

// PIN-lockout auto-unlock rule: a locked timeclock terminal unlocks the
// instant BOTH W-4 and I-9 are approved, and re-locks if either is revoked.
export async function reevaluateTimeclockLock(employee) {
  const shouldUnlock = !!employee.has_w4_approved && !!employee.has_i9_approved;
  return db.entities.employees.update(employee.id, { is_timeclock_locked: !shouldUnlock });
}

// The formula PIN is the auto-assigned DEFAULT whenever the underlying
// fields (ssn_last4, employee_number) change — it is no longer the only
// source of truth. The System Access Portal (HumanResources.jsx) lets HR
// explicitly overwrite an employee's PIN via setManualPin below; that
// override sticks until either HR sets a new one or edits ssn_last4/employee
// number again, which recomputes the formula and replaces it.
export async function syncFormulaPin(employee) {
  return db.entities.employees.update(employee.id, { pin_encrypted: encodeFormulaPin(employee) });
}

// Explicit HR override — bypasses the formula entirely. `rawPin` must be
// exactly 5 digits (enforced by the System Access Portal's input mask).
export async function setManualPin(employee, rawPin) {
  return db.entities.employees.update(employee.id, { pin_encrypted: encodePin(rawPin) });
}
