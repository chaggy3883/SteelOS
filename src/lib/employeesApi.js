import { db } from '@/api/apiClient';
import { encodeFormulaPin } from '@/lib/pinFormula';
import { encodePin } from '@/lib/hrSecurity';
import { computeI9ReverificationDueDate } from '@/lib/i9Compliance';
import { provisionDefaultIssuedAssets } from '@/lib/issuedAssetsApi';
import { createDefaultEmployeePtoPolicies } from '@/lib/ptoEngine';
import { moveCandidateDocumentsToEmployee, deleteAllCandidateDocuments } from '@/lib/hiringDocumentsApi';
import { logStatusChange } from '@/lib/statusHistory';

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

// Single source of truth for "what status badge does this employee show" —
// termination_date always wins (an employee can't be simultaneously
// Terminated and On Leave), falling back to employee_status, and finally to
// the older is_active boolean for records created before employee_status
// existed.
export const employeeDisplayStatus = (employee) => {
  if (employee?.termination_date) return 'Terminated';
  if (employee?.employee_status) return employee.employee_status;
  return employee?.is_active === false ? 'Inactive' : 'Active';
};

// The one place that assigns an employee's platform role(s) — used by both
// the HR "Unassigned Platform Roles" panel and Admin's Employee Management
// page. employees.platform_roles and a linked User account's `roles` are
// otherwise completely independent fields (see rbacConfig.jsx/NavBar.jsx —
// allowed modules are computed live from User.roles, never from
// platform_roles, as the UNION of every role's allowed_modules/
// allowed_widgets), so a role change here cascades to that linked login too
// — otherwise "assign roles" would be cosmetic for anyone who also has
// portal access. This deliberately overwrites the linked User's full roles
// array to match, matching the roles-only, deterministic model (no
// per-account custom permissions). An empty array is a valid, deliberate
// state — an employee with no roles yet gets no module access beyond the
// hardcoded Employee Center.
export async function assignPlatformRoles(employee, roleNames) {
  const roles = (Array.isArray(roleNames) ? roleNames : [roleNames]).filter(Boolean);
  const updated = await db.entities.employees.update(employee.id, { platform_roles: roles });
  const linkedUsers = await db.entities.User.filter({ employee_id: employee.id }, '-created_date', 1);
  if (linkedUsers[0]) {
    await db.entities.User.update(linkedUsers[0].id, { roles });
  }
  return updated;
}

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
// provisioning (including the document move below) can never be skipped.
// `hire_date`/`position_title` come from the Hire modal's confirm step
// (HumanResources.jsx) — both fall back to today/the applied-for position so
// older call sites that don't pass them still work.
export async function hireCandidate(candidateId, { hire_date: hireDateInput, position_title } = {}, changedBy = 'Unknown') {
  const candidate = await db.entities.candidate_profiles.get(candidateId);
  if (!candidate) throw new Error('Candidate not found');

  const employee_number = await nextEmployeeNumber();
  const hire_date = hireDateInput || new Date().toISOString().slice(0, 10);
  const classification = position_title || candidate.position_applied;
  // PIN is the employee's own last-4 SSN (see pinFormula.js's security
  // caveat) — with ssn_last4 still blank at provisioning time, this computes
  // a placeholder PIN ("0000") that becomes real the moment HR enters the SSN.
  const employee = await db.entities.employees.create({
    employee_number,
    full_name: candidate.candidate_name,
    classification,
    personal_email: candidate.email,
    phone: candidate.phone,
    hire_date,
    is_active: true,
    pin_encrypted: encodeFormulaPin({ employee_number, ssn_last4: '' }),
    is_timeclock_locked: true,
    has_w4_approved: false,
    i9_on_file: false,
    // Placeholder due date pre-computed from hire_date so the reverification
    // clock is visible immediately, even before HR fills in the actual I-9 —
    // it gets recomputed from i9_date once that's entered.
    i9_reverification_due_date: computeI9ReverificationDueDate(hire_date),
    e_verify_status: 'not_submitted',
    ssn_last4: '',
    pay_rate_cents: 0,
    is_active_login: true,
  });

  await db.entities.candidate_profiles.update(candidateId, {
    status: 'Hired',
    hired_employee_id: employee.id,
    hire_date,
  });

  await moveCandidateDocumentsToEmployee(candidateId, employee.id);
  await provisionDefaultIssuedAssets(employee.id);
  await createDefaultEmployeePtoPolicies(employee);
  await logStatusChange({
    entityType: 'candidate_profiles',
    entityId: candidateId,
    fieldName: 'status',
    fromValue: candidate.status,
    toValue: 'Hired',
    changedBy,
    note: `Hired as ${classification}`,
  });

  return employee;
}

// The "candidate flipped to Rejected" trigger — mirrors hireCandidate's role
// as the single call site so the rejection date/reason and the documents
// decision can never be skipped by a UI path that forgets one of them.
// `keep_documents: false` permanently deletes the candidate's attached
// documents (and their blobs); `true` (the default) leaves them in place so
// they stay visible from the read-only Candidate Archive view.
export async function rejectCandidate(candidateId, { rejection_reason, keep_documents = true } = {}, changedBy = 'Unknown') {
  const candidate = await db.entities.candidate_profiles.get(candidateId);
  if (!candidate) throw new Error('Candidate not found');

  const rejection_date = new Date().toISOString().slice(0, 10);
  const updated = await db.entities.candidate_profiles.update(candidateId, {
    status: 'Rejected',
    rejection_date,
    rejection_reason: rejection_reason || '',
  });

  if (!keep_documents) {
    await deleteAllCandidateDocuments(candidateId);
  }

  await logStatusChange({
    entityType: 'candidate_profiles',
    entityId: candidateId,
    fieldName: 'status',
    fromValue: candidate.status,
    toValue: 'Rejected',
    changedBy,
    note: rejection_reason || '',
  });

  return updated;
}

// The "Add Employee" wizard's provisioning trigger — same shape as
// hireCandidate above, but for employees onboarded directly without first
// going through the ATS pipeline. Kept as a single call site for the same
// reason hireCandidate is: so the formula-PIN + lockout defaults can never
// be skipped by a UI path that forgets one of them.
export async function provisionEmployee(formData) {
  const employee_number = await nextEmployeeNumber();
  const ssn_last4 = (formData.ssn_last4 || '').replace(/\D/g, '').slice(0, 4);

  const employee = await db.entities.employees.create({
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
    emergency_contact2_name: formData.emergency_contact2_name,
    emergency_contact2_phone: formData.emergency_contact2_phone,
    emergency_contact2_relationship: formData.emergency_contact2_relationship,
    classification: formData.classification,
    job_title: formData.job_title,
    hire_date: formData.hire_date,
    pay_type: formData.pay_type,
    pay_rate_cents: formData.pay_type === 'salary' ? 0 : (Number(formData.pay_rate_cents) || 0),
    annual_salary_cents: formData.pay_type === 'salary' ? (Number(formData.annual_salary_cents) || 0) : 0,
    department: formData.department,
    platform_roles: Array.isArray(formData.platform_roles) ? formData.platform_roles : [],
    supervisor_name: formData.supervisor_name,
    pin_encrypted: encodeFormulaPin({ employee_number, ssn_last4 }),
    is_timeclock_locked: true,
    has_w4_approved: false,
    i9_on_file: false,
    // See hireCandidate's matching comment — placeholder due date from
    // hire_date, recomputed from i9_date once HR fills in the real I-9.
    i9_reverification_due_date: computeI9ReverificationDueDate(formData.hire_date),
    e_verify_status: 'not_submitted',
    employee_status: formData.employee_status || 'Active',
    is_active: formData.employee_status !== 'Inactive',
    is_active_login: true,
    is_salesman: false,
  });

  await provisionDefaultIssuedAssets(employee.id);
  await createDefaultEmployeePtoPolicies(employee);

  return employee;
}

// PIN-lockout auto-unlock rule: a locked timeclock terminal unlocks the
// instant BOTH W-4 and I-9 are approved, and re-locks if either is revoked.
export async function reevaluateTimeclockLock(employee) {
  const shouldUnlock = !!employee.has_w4_approved && !!employee.i9_on_file;
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
