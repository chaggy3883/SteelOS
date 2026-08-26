import { appliedTotalFromList, outstandingFor, round2, todayISO } from '@/lib/paymentEngine';
import { memoTotalFromList } from '@/lib/memoEngine';

// AR/AP aging — Stage 5 of the payment-layer build. Buckets the outstanding
// balance of every unpaid/partially-paid InvoiceReceivable (AR) and
// VendorBill (AP) by days past due into the standard Current/1-30/31-60/
// 61-90/90+ buckets. Pure functions over already-loaded arrays, same
// convention as balancesReport.js.

export const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'];
export const AGING_BUCKET_LABELS = { current: 'Current', '1-30': '1-30 Days', '31-60': '31-60 Days', '61-90': '61-90 Days', '90+': '90+ Days' };

const emptyBuckets = () => ({ current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 });

// Whole days between asOfDate and dueDate (positive = past due). Both are
// 'YYYY-MM-DD' strings — parsed as local dates (new Date('YYYY-MM-DD') is
// UTC-midnight in most engines, but since both sides use the same parsing,
// the DIFFERENCE in days is still correct regardless of timezone offset).
function daysPastDue(asOfDate, dueDate) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((new Date(asOfDate).getTime() - new Date(dueDate).getTime()) / msPerDay);
}

export function bucketForDays(days) {
  if (days <= 0) return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

// AR aging groups by customer (via Project.customer_id), same join
// balancesReport.js uses. Invoices with no due-date equivalent
// (expected_payment_date) can't be judged overdue against nothing, so they
// land in 'current'.
export function computeArAging({ invoices, payments, memos, projects, customers, asOfDate = todayISO() }) {
  const projectById = new Map((projects || []).map((p) => [p.id, p]));
  const rows = new Map();

  (invoices || []).filter((inv) => inv.payment_status !== 'Draft').forEach((inv) => {
    const project = projectById.get(inv.project_id);
    const customerId = project?.customer_id;
    if (!customerId) return;
    const applied = appliedTotalFromList(payments, 'InvoiceReceivable', inv.id) + memoTotalFromList(memos, 'InvoiceReceivable', inv.id);
    const outstanding = outstandingFor(inv.net_billing, applied);
    if (outstanding <= 0.005) return;

    const dueDate = inv.expected_payment_date;
    const days = dueDate ? daysPastDue(asOfDate, dueDate) : 0;
    const bucket = bucketForDays(days);

    const entry = rows.get(customerId) || { customerId, customer: (customers || []).find((c) => c.id === customerId) || null, buckets: emptyBuckets(), total: 0, items: [] };
    entry.buckets[bucket] = round2(entry.buckets[bucket] + outstanding);
    entry.total = round2(entry.total + outstanding);
    entry.items.push({ invoice: inv, project, outstanding, bucket, daysPastDue: days });
    rows.set(customerId, entry);
  });

  return [...rows.values()].sort((a, b) => b.total - a.total);
}

// AP aging groups by vendor. VendorBill.due_date is a real field (unlike
// InvoiceReceivable), so every row has a due date to judge against.
export function computeApAging({ vendorBills, payments, memos, vendors, asOfDate = todayISO() }) {
  const rows = new Map();

  (vendorBills || []).filter((b) => ['Approved', 'Paid'].includes(b.status)).forEach((bill) => {
    const applied = appliedTotalFromList(payments, 'VendorBill', bill.id) + memoTotalFromList(memos, 'VendorBill', bill.id);
    const outstanding = outstandingFor(bill.gross_amount, applied);
    if (outstanding <= 0.005) return;

    const days = bill.due_date ? daysPastDue(asOfDate, bill.due_date) : 0;
    const bucket = bucketForDays(days);

    const entry = rows.get(bill.vendor_id) || { vendorId: bill.vendor_id, vendor: (vendors || []).find((v) => v.id === bill.vendor_id) || null, buckets: emptyBuckets(), total: 0, items: [] };
    entry.buckets[bucket] = round2(entry.buckets[bucket] + outstanding);
    entry.total = round2(entry.total + outstanding);
    entry.items.push({ bill, outstanding, bucket, daysPastDue: days });
    rows.set(bill.vendor_id, entry);
  });

  return [...rows.values()].sort((a, b) => b.total - a.total);
}
