import { db } from '@/api/apiClient';
import { computeAccountBalance } from '@/lib/cashBalance';

// Pure bucket-computation + data-loading logic behind the 90-Day Cash
// Forecast, extracted out of CashForecastPanel.jsx so a second surface
// (ExecutiveAnalytics.jsx's Cash Position card, which embeds
// CashForecastPanel purely for its on-screen table/stats) can derive the
// exact same starting balance + weekly buckets for its own PDF export
// without either duplicating this math or reaching into CashForecastPanel's
// component state.
export const BUCKET_COUNT = 13; // ~90 days in weekly buckets (13 * 7 = 91)
const RECEIVABLE_STATUSES = ['Approved', 'Released'];

export function addDaysIso(baseIso, days) {
  const d = new Date(baseIso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Bucket i covers the 7-day window (todayIso + i*7, todayIso + (i+1)*7] —
// i.e. its label is the inclusive end date, matching how a weekly cash
// forecast is normally read ("balance as of the end of week N").
export function bucketIndexForDate(dateIso, todayIso) {
  if (!dateIso) return -1;
  if (dateIso <= todayIso) return 0;
  for (let i = 0; i < BUCKET_COUNT; i++) {
    const start = addDaysIso(todayIso, i * 7);
    const end = addDaysIso(todayIso, (i + 1) * 7);
    if (dateIso > start && dateIso <= end) return i;
  }
  return -1;
}

const FREQUENCY_STEP_DAYS = { Weekly: 7, Biweekly: 14 };

// Walks forward from next_occurrence_date at the item's frequency, only
// keeping dates that land inside (windowStartIso, windowEndIso]. A stale
// next_occurrence_date years in the past still terminates quickly — the
// guard just exists so a corrupt/garbage date can't spin forever.
export function generateOccurrences(item, windowStartIso, windowEndIso) {
  const occurrences = [];
  const cursor = new Date(item.next_occurrence_date);
  if (Number.isNaN(cursor.getTime())) return occurrences;

  let cursorIso = cursor.toISOString().slice(0, 10);
  let guard = 0;
  while (cursorIso <= windowEndIso && guard < 1000) {
    if (cursorIso > windowStartIso) occurrences.push(cursorIso);
    const stepDays = FREQUENCY_STEP_DAYS[item.frequency];
    if (stepDays) {
      cursor.setDate(cursor.getDate() + stepDays);
    } else {
      cursor.setMonth(cursor.getMonth() + 1); // Monthly
    }
    cursorIso = cursor.toISOString().slice(0, 10);
    guard++;
  }
  return occurrences;
}

// Fetches every entity the forecast depends on (bank accounts/transactions,
// approved vendor bills, approved/released AR invoices, active recurring
// items) and reduces them to the starting balance + the four already-filtered
// lists computeCashForecastBuckets needs — same queries CashForecastPanel's
// loadForecastData ran inline before this was extracted.
export async function loadCashForecastData() {
  const accounts = await db.entities.BankAccount.filter({ is_active: true }, '-created_date', 100);
  const transactionsByAccount = await Promise.all(
    accounts.map((a) => db.entities.BankTransaction.filter({ bank_account_id: a.id }, '-transaction_date', 1000))
  );
  const allTransactions = transactionsByAccount.flat();
  const startingBalance = accounts.reduce((sum, a, i) => sum + computeAccountBalance(a, transactionsByAccount[i]), 0);

  const [bills, invoices, recurring] = await Promise.all([
    db.entities.VendorBill.filter({ status: 'Approved' }, '-created_date', 500),
    db.entities.InvoiceReceivable.list('-created_date', 500),
    db.entities.RecurringCashItem.filter({ is_active: true }, '-created_date', 200),
  ]);

  return {
    startingBalance,
    linkedTransactions: allTransactions.filter((t) => t.linked_entity_type),
    vendorBills: bills,
    invoiceReceivables: invoices.filter((inv) => RECEIVABLE_STATUSES.includes(inv.payment_status)),
    recurringItems: recurring,
  };
}

// Same weekly-bucket walk CashForecastPanel's `buckets` useMemo ran inline —
// starting balance and every bucket's net change derived from bank
// transactions, approved vendor bills, approved/released AR invoices, and
// recurring items, none of it stored (recomputed fresh every call so it's
// always consistent with the ledger).
export function computeCashForecastBuckets({ startingBalance, vendorBills, invoiceReceivables, recurringItems, linkedTransactions, todayIso }) {
  const netChange = Array(BUCKET_COUNT).fill(0);
  const items = Array.from({ length: BUCKET_COUNT }, () => []);

  const paidBillIds = new Set(
    (linkedTransactions || []).filter((t) => t.linked_entity_type === 'VendorBill').map((t) => t.linked_entity_id)
  );
  (vendorBills || []).forEach((bill) => {
    if (paidBillIds.has(bill.id)) return;
    const idx = bucketIndexForDate(bill.due_date, todayIso);
    if (idx >= 0) {
      const amount = -(Number(bill.gross_amount) || 0);
      netChange[idx] += amount;
      items[idx].push({
        id: bill.id, transaction_date: bill.due_date, cost_code: 'Vendor Bill', cost_class: '',
        source_type: 'vendor_bill', amount, description: `Bill ${bill.invoice_number || bill.id}`,
      });
    }
  });

  const receivedInvoiceIds = new Set(
    (linkedTransactions || []).filter((t) => t.linked_entity_type === 'InvoiceReceivable').map((t) => t.linked_entity_id)
  );
  (invoiceReceivables || []).forEach((inv) => {
    if (receivedInvoiceIds.has(inv.id)) return;
    const idx = bucketIndexForDate(inv.expected_payment_date, todayIso);
    if (idx >= 0) {
      const amount = Number(inv.net_billing) || 0;
      netChange[idx] += amount;
      items[idx].push({
        id: inv.id, transaction_date: inv.expected_payment_date, cost_code: 'AR Invoice', cost_class: '',
        source_type: 'invoice', amount, description: inv.billing_period || inv.id,
      });
    }
  });

  const windowEndIso = addDaysIso(todayIso, BUCKET_COUNT * 7);
  (recurringItems || []).forEach((item) => {
    const sign = item.direction === 'Inflow' ? 1 : -1;
    generateOccurrences(item, todayIso, windowEndIso).forEach((occIso) => {
      const idx = bucketIndexForDate(occIso, todayIso);
      if (idx >= 0) {
        const amount = sign * (Number(item.amount) || 0);
        netChange[idx] += amount;
        items[idx].push({
          id: `${item.id}-${occIso}`, transaction_date: occIso, cost_code: 'Recurring', cost_class: '',
          source_type: 'recurring_cash_item', amount, description: item.description || item.name || item.id,
        });
      }
    });
  });

  let running = startingBalance;
  return netChange.map((change, i) => {
    running += change;
    return { bucketEndDate: addDaysIso(todayIso, (i + 1) * 7), netChange: change, runningBalance: running, items: items[i] };
  });
}
