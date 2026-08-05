import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, TrendingUp } from 'lucide-react';
import { computeAccountBalance } from '@/lib/cashBalance';

const BUCKET_COUNT = 13; // ~90 days in weekly buckets (13 * 7 = 91)
const RECEIVABLE_STATUSES = ['Approved', 'Released'];

const fmtMoney = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function addDaysIso(baseIso, days) {
  const d = new Date(baseIso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Bucket i covers the 7-day window (todayIso + i*7, todayIso + (i+1)*7] —
// i.e. its label is the inclusive end date, matching how a weekly cash
// forecast is normally read ("balance as of the end of week N").
function bucketIndexForDate(dateIso, todayIso) {
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
function generateOccurrences(item, windowStartIso, windowEndIso) {
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

// 90-day, weekly-bucketed cash forecast. Starting balance and every bucket's
// net change are all derived from data that already exists elsewhere in the
// app (bank transactions, approved vendor bills, approved/released AR
// invoices, recurring items) — nothing here is stored, it's recomputed on
// every load so it's always consistent with the ledger.
export default function CashForecastPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [startingBalance, setStartingBalance] = useState(0);
  const [linkedTransactions, setLinkedTransactions] = useState([]);
  const [vendorBills, setVendorBills] = useState([]);
  const [invoiceReceivables, setInvoiceReceivables] = useState([]);
  const [recurringItems, setRecurringItems] = useState([]);

  useEffect(() => { loadForecastData(); }, []);

  const loadForecastData = async () => {
    setLoading(true);
    try {
      const accounts = await db.entities.BankAccount.filter({ is_active: true }, '-created_date', 100);
      const transactionsByAccount = await Promise.all(
        accounts.map((a) => db.entities.BankTransaction.filter({ bank_account_id: a.id }, '-transaction_date', 1000))
      );
      const allTransactions = transactionsByAccount.flat();
      const balance = accounts.reduce((sum, a, i) => sum + computeAccountBalance(a, transactionsByAccount[i]), 0);

      const [bills, invoices, recurring] = await Promise.all([
        db.entities.VendorBill.filter({ status: 'Approved' }, '-created_date', 500),
        db.entities.InvoiceReceivable.list('-created_date', 500),
        db.entities.RecurringCashItem.filter({ is_active: true }, '-created_date', 200),
      ]);

      setStartingBalance(balance);
      setLinkedTransactions(allTransactions.filter((t) => t.linked_entity_type));
      setVendorBills(bills);
      setInvoiceReceivables(invoices.filter((inv) => RECEIVABLE_STATUSES.includes(inv.payment_status)));
      setRecurringItems(recurring);
    } catch (e) {
      toast({ title: 'Failed to load cash forecast data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const buckets = useMemo(() => {
    const netChange = Array(BUCKET_COUNT).fill(0);

    const paidBillIds = new Set(
      linkedTransactions.filter((t) => t.linked_entity_type === 'VendorBill').map((t) => t.linked_entity_id)
    );
    vendorBills.forEach((bill) => {
      if (paidBillIds.has(bill.id)) return;
      const idx = bucketIndexForDate(bill.due_date, todayIso);
      if (idx >= 0) netChange[idx] -= Number(bill.gross_amount) || 0;
    });

    const receivedInvoiceIds = new Set(
      linkedTransactions.filter((t) => t.linked_entity_type === 'InvoiceReceivable').map((t) => t.linked_entity_id)
    );
    invoiceReceivables.forEach((inv) => {
      if (receivedInvoiceIds.has(inv.id)) return;
      const idx = bucketIndexForDate(inv.expected_payment_date, todayIso);
      if (idx >= 0) netChange[idx] += Number(inv.net_billing) || 0;
    });

    const windowEndIso = addDaysIso(todayIso, BUCKET_COUNT * 7);
    recurringItems.forEach((item) => {
      const sign = item.direction === 'Inflow' ? 1 : -1;
      generateOccurrences(item, todayIso, windowEndIso).forEach((occIso) => {
        const idx = bucketIndexForDate(occIso, todayIso);
        if (idx >= 0) netChange[idx] += sign * (Number(item.amount) || 0);
      });
    });

    let running = startingBalance;
    return netChange.map((change, i) => {
      running += change;
      return { bucketEndDate: addDaysIso(todayIso, (i + 1) * 7), netChange: change, runningBalance: running };
    });
  }, [vendorBills, invoiceReceivables, recurringItems, linkedTransactions, startingBalance, todayIso]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  const willGoNegative = buckets.some((b) => b.runningBalance < 0);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="steel-card p-6">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" />90-Day Cash Forecast</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Starting Balance (all active accounts)</p>
            <p className="font-mono font-bold text-lg">{fmtMoney(startingBalance)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Projected Balance in 90 Days</p>
            <p className={`font-mono font-bold text-lg ${buckets[buckets.length - 1]?.runningBalance < 0 ? 'text-red-500' : ''}`}>
              {fmtMoney(buckets[buckets.length - 1]?.runningBalance)}
            </p>
          </div>
          {willGoNegative && (
            <div>
              <p className="text-xs text-red-500 font-medium">⚠ Projected shortfall — balance goes negative in at least one week below.</p>
            </div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">
          Includes approved vendor bills (by due date), approved/released AR invoices (by expected payment date, net of retainage), and active
          recurring items — excluding anything already reflected in an actual bank transaction.
        </p>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">Weekly Projection</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-3 px-4">Week Ending</th>
                <th className="text-right py-3 px-4">Net Change</th>
                <th className="text-right py-3 px-4">Projected Balance</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.bucketEndDate} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-3 px-4 text-xs">{b.bucketEndDate}</td>
                  <td className={`py-3 px-4 text-right font-mono ${b.netChange < 0 ? 'text-red-500' : 'text-green-500'}`}>{fmtMoney(b.netChange)}</td>
                  <td className={`py-3 px-4 text-right font-mono font-bold ${b.runningBalance < 0 ? 'text-red-500' : ''}`}>{fmtMoney(b.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
