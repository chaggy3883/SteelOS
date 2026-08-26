import { appliedTotalFromList, outstandingFor, round2 } from '@/lib/paymentEngine';
import { memoTotalFromList } from '@/lib/memoEngine';

// Computed (never stored) customer/vendor running balances — Stage 4 of the
// AR/AP payment-layer build. Pure functions over already-loaded arrays
// (Accounting.jsx loads Project/InvoiceReceivable/VendorBill/SubcontractPayApp/
// Subcontract/Customer/Payment company-wide once, same pattern as every
// other list on that page) so this has no db access of its own and can be
// traced by hand against a concrete example.

// Customer balance = sum of (net_billing - applied payments) across every
// non-Draft InvoiceReceivable for that customer's projects (Project.customer_id).
// A customer with no non-Draft invoices anywhere doesn't appear at all.
export function computeCustomerBalances({ invoices, payments, memos, projects, customers }) {
  const projectById = new Map((projects || []).map((p) => [p.id, p]));
  const byCustomer = new Map();

  (invoices || []).filter((inv) => inv.payment_status !== 'Draft').forEach((inv) => {
    const project = projectById.get(inv.project_id);
    const customerId = project?.customer_id;
    if (!customerId) return;
    const applied = appliedTotalFromList(payments, 'InvoiceReceivable', inv.id) + memoTotalFromList(memos, 'InvoiceReceivable', inv.id);
    const outstanding = outstandingFor(inv.net_billing, applied);
    const entry = byCustomer.get(customerId) || { customerId, balance: 0, invoices: [] };
    entry.balance = round2(entry.balance + outstanding);
    entry.invoices.push({ invoice: inv, project, applied, outstanding });
    byCustomer.set(customerId, entry);
  });

  return [...byCustomer.values()]
    .map((e) => ({ ...e, customer: (customers || []).find((c) => c.id === e.customerId) || null }))
    .sort((a, b) => b.balance - a.balance);
}

// A SubcontractPayApp reaching 'paid' via the pre-existing legacy status
// flip (Subcontracts.jsx handleQuickMarkPaid/handleSavePayAppEdit) has no
// Payment rows behind it at all — same "existing single-flip behavior keeps
// working, only new activity flows through Payment" rule as InvoiceReceivable.
// So a 'paid' pay app is treated as fully settled (0 outstanding) rather than
// fabricating history; only 'approved' (approved for payment, not yet paid)
// pay apps carry an outstanding balance. received/under_review/disputed
// aren't yet an approved payable amount.
export function payAppOutstanding(payApp, payments) {
  if (payApp.status !== 'approved') return 0;
  const applied = appliedTotalFromList(payments, 'SubcontractPayApp', payApp.id);
  return outstandingFor(payApp.amount_approved, applied);
}

// Vendor balance = sum of (gross_amount - applied payments) across every
// Approved/Paid VendorBill for that vendor, PLUS the same for
// SubcontractPayApp rows tied to that vendor's Subcontract(s).
export function computeVendorBalances({ vendorBills, payApps, subcontracts, payments, memos, vendors }) {
  const subcontractById = new Map((subcontracts || []).map((s) => [s.id, s]));
  const byVendor = new Map();

  const bump = (vendorId, entry) => {
    if (!vendorId) return;
    const existing = byVendor.get(vendorId) || { vendorId, balance: 0, bills: [], payApps: [] };
    if (entry.bill) { existing.balance = round2(existing.balance + entry.outstanding); existing.bills.push(entry); }
    else { existing.balance = round2(existing.balance + entry.outstanding); existing.payApps.push(entry); }
    byVendor.set(vendorId, existing);
  };

  (vendorBills || []).filter((b) => ['Approved', 'Paid'].includes(b.status)).forEach((bill) => {
    const applied = appliedTotalFromList(payments, 'VendorBill', bill.id) + memoTotalFromList(memos, 'VendorBill', bill.id);
    const outstanding = outstandingFor(bill.gross_amount, applied);
    bump(bill.vendor_id, { bill, applied, outstanding });
  });

  (payApps || []).forEach((payApp) => {
    const subcontract = subcontractById.get(payApp.subcontract_id);
    if (!subcontract?.vendor_id) return;
    const outstanding = payAppOutstanding(payApp, payments);
    if (outstanding <= 0.005 && payApp.status !== 'approved') return;
    bump(subcontract.vendor_id, { payApp, subcontract, applied: appliedTotalFromList(payments, 'SubcontractPayApp', payApp.id), outstanding });
  });

  return [...byVendor.values()]
    .map((e) => ({ ...e, vendor: (vendors || []).find((v) => v.id === e.vendorId) || null }))
    .sort((a, b) => b.balance - a.balance);
}
