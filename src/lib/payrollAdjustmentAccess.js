import { BUILTIN_ROLES, normalizeRoleName } from '@/components/dashboard/rbacConfig';

// Manually editing hours or adding a bonus/deduction on a payroll run in
// review is an operational correction, not a finalization decision — same
// audience as running payroll itself (PAYROLL_PROCESSING_ALLOWED_ROLES in
// PayrollProcessing.jsx), unlike approve/lock (payrollApprovalAccess.js)
// which deliberately excludes payroll_admin for segregation of duties.
export const PAYROLL_ADJUSTMENT_ALLOWED_ROLES = ['admin', 'super_admin', 'payroll_admin', 'controller'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!PAYROLL_ADJUSTMENT_ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('payrollAdjustmentAccess.js: PAYROLL_ADJUSTMENT_ALLOWED_ROLES references a role name not present in BUILTIN_ROLES.');
}

export const hasPayrollAdjustmentAccess = (roles) => (roles || []).some((r) => PAYROLL_ADJUSTMENT_ALLOWED_ROLES.includes(normalizeRoleName(r)));
