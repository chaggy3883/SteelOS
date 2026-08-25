import { db } from '@/api/apiClient';
import { getEffectiveCompanyId } from '@/lib/tenantContext';

// Deterministic logic only (see steelos-architecture skill) — no LLM call
// belongs anywhere in ACH matching or payroll->ACH bridging; these are plain
// rule checks over amounts/names/flags, not extraction or drafting tasks.

// Roles that see the "Unmatched ACH Deposits" widget in Accounting.jsx's
// Bank & Cash tab — kept in sync with that tab's own TAB_ROLES.cash list.
export const AR_NOTIFICATION_ROLES = ['finance_department', 'controller', 'president', 'ceo'];

/**
 * Builds one AchOutgoing payload per employee on a payroll run who has
 * direct_deposit_enabled and an active primary EmployeeBankAccount on file.
 * Employees missing either are returned separately as `skipped` so the
 * caller can surface why a check (not ACH) is still owed to them — this
 * never silently drops anyone.
 */
export function buildAchOutgoingPayloads({ payrollRun, payrollLines, employees, bankAccounts }) {
  const created = [];
  const skipped = [];

  payrollLines.forEach((line) => {
    const employee = employees.find((e) => e.id === line.employee_id);
    if (!employee) return;
    if (!employee.direct_deposit_enabled) {
      skipped.push({ employee_id: employee.id, reason: 'direct_deposit_not_enabled' });
      return;
    }
    const account = bankAccounts.find((a) => a.employee_id === employee.id && a.is_primary && a.status === 'active');
    if (!account) {
      skipped.push({ employee_id: employee.id, reason: 'no_active_bank_account' });
      return;
    }
    const amount = Math.round((Number(line.net_pay) || 0) * 100) / 100;
    if (amount <= 0) return;
    created.push({
      payroll_run_id: payrollRun.id,
      employee_id: employee.id,
      destination_bank_account_id: account.id,
      amount,
      effective_date: payrollRun.run_date,
      status: 'pending',
    });
  });

  return { created, skipped };
}

// Requires BOTH vendor name and amount to line up (within a cent) — the
// standing rule is no silent auto-match on amount alone. Returns null when
// nothing (or more than one candidate) matches, leaving it for manual AR
// assignment rather than guessing.
export function matchIncomingAchToPurchaseOrder(achIncoming, purchaseOrders) {
  const senderName = String(achIncoming.sender_name || '').trim().toLowerCase();
  if (!senderName) return null;
  const amount = Number(achIncoming.amount) || 0;

  const candidates = purchaseOrders.filter((po) => {
    const vendorName = String(po.vendor_name || '').trim().toLowerCase();
    if (vendorName !== senderName) return false;
    const poAmount = po.actual_cost > 0 ? po.actual_cost : po.budgeted_cost;
    return Math.abs((Number(poAmount) || 0) - amount) < 0.01;
  });

  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Notifies every user holding an AR-relevant role (see AR_NOTIFICATION_ROLES)
 * that an incoming ACH deposit needs manual assignment. Mirrors the
 * broadcast-by-role approach in src/lib/salesNotifications.js — TopBar.jsx's
 * bell only shows notifications with a real user_id, so this creates one row
 * per recipient rather than a single unaddressed row.
 */
export async function notifyArUnmatchedAch(achIncoming) {
  const companyId = getEffectiveCompanyId();
  const allUsers = await db.entities.User.list('-created_date', 2000);
  const companyUsers = companyId ? allUsers.filter((u) => u.company_id === companyId) : allUsers;
  const recipients = companyUsers.filter((u) =>
    (u.roles || []).some((r) => AR_NOTIFICATION_ROLES.includes(String(r).toLowerCase()))
  );

  const amount = Number(achIncoming.amount) || 0;
  const title = 'Unmatched ACH Deposit';
  const message = `Unmatched ACH deposit of $${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} from ${achIncoming.sender_name} on ${achIncoming.received_date} — requires assignment.`;

  return Promise.all(recipients.map((u) => db.entities.Notification.create({
    user_id: u.id,
    title,
    message,
    type: 'warning',
    link: '/accounting?tab=cash',
    entity_type: 'AchIncoming',
    entity_id: achIncoming.id,
    is_read: false,
  })));
}
