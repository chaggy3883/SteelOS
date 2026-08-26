import { db } from '@/api/apiClient';

// The single gate every financial mutation site funnels through. Before this
// existed, MonthEndClose.status was a checklist label only — closing a
// period never actually stopped a VendorBill, InvoiceReceivable, or
// ProjectJobCostSummary row from being edited or deleted inside it. See
// src/lib/financeAccess.js for who can bypass this with a reason.
export async function isPeriodLocked(dateString) {
  if (!dateString) return false;
  const period = String(dateString).slice(0, 7); // YYYY-MM
  const closes = await db.entities.MonthEndClose.filter({ period }, '-created_date', 1);
  return closes[0]?.status === 'Closed';
}

export function formatPeriodLabel(period) {
  const [y, m] = String(period || '').split('-').map(Number);
  if (!y || !m) return period;
  const parsed = new Date(y, m - 1, 1); // local-time constructor, not UTC string parsing
  return parsed.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function periodLockedMessage(dateString) {
  return `This period (${formatPeriodLabel(String(dateString || '').slice(0, 7))}) is closed. An Admin, Controller, or Super Admin must reopen it before this can be edited.`;
}
