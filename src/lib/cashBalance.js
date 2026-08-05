// Single source of truth for "what's the current balance of this account" —
// opening_balance plus every transaction's amount, reconciled or not. Used
// by CashManagementPanel (per selected account) and CashForecastPanel
// (summed across every active account) so the two views can never disagree
// about what "current balance" means.
export function computeAccountBalance(account, transactions) {
  const opening = account?.opening_balance || 0;
  return transactions.reduce((sum, t) => sum + (Number(t.amount) || 0), opening);
}
