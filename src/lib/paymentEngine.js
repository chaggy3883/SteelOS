import { db } from '@/api/apiClient';
import { triggerCommissionOnPayment } from '@/lib/commissionEngine';

// The real payment layer underneath AR and AP (see schema/entities/Payment.jsonc).
// This module is the single place that creates Payment rows and computes
// outstanding balances from them — every caller (Accounting.jsx's Vendor
// Bills / AR & Billings tabs, VendorBillDetailModal, InvoiceReceivableDetailModal,
// Subcontracts.jsx's retainage release action, agingReport.js, balancesReport.js)
// goes through here rather than reimplementing the applied/unapplied split.
//
// IMPORTANT — transition note: InvoiceReceivable.payment_status and
// VendorBill.status remain the source of truth for the high-level lifecycle
// (Draft/Submitted/Approved/Released, Pending_Match/Approved/Flagged_Review/Paid).
// Only payments recorded THROUGH this module (going forward) produce Payment
// rows. An invoice/bill already marked Released/Paid before this existed has
// no Payment history behind it — getAppliedTotal for those returns 0, and
// callers must keep trusting the existing status field for anything not
// re-touched. Nothing here retroactively fabricates Payment rows for old data.

export const PAYMENT_METHODS = ['check', 'ach', 'wire', 'credit_card', 'cash', 'other'];

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const todayISO = () => new Date().toISOString().slice(0, 10);

// Every payment ever recorded for one company, fetched once by the page and
// filtered client-side — mirrors how Accounting.jsx already loads vendorBills/
// invoiceReceivables in full rather than paging per-row. Keep the cap
// generous; a company with more than this many payments needs a real backend
// long before it needs a bigger page size here.
export async function loadAllPayments() {
  return db.entities.Payment.list('-payment_date', 5000);
}

const matches = (p, relatedEntityType, relatedEntityId) =>
  p.related_entity_type === relatedEntityType && p.related_entity_id === relatedEntityId;

// Total applied against one record, INCLUDING write-offs — this is the
// number that zeroes out a balance for aging/statements/customer-and-vendor-
// balance purposes, per the write-off requirement that it "correctly zeroes
// the customer balance."
export function appliedTotalFromList(payments, relatedEntityType, relatedEntityId) {
  return round2((payments || []).filter((p) => matches(p, relatedEntityType, relatedEntityId)).reduce((s, p) => s + (Number(p.applied_amount) || 0), 0));
}

// Same total but EXCLUDING write-offs — this is what gates the
// payment_status/status "fully paid" transition (and therefore the
// commission trigger). A write-off is not cash received, so it must never
// look like a real payment completed the invoice.
export function cashAppliedTotalFromList(payments, relatedEntityType, relatedEntityId) {
  return round2((payments || []).filter((p) => matches(p, relatedEntityType, relatedEntityId) && !p.is_write_off).reduce((s, p) => s + (Number(p.applied_amount) || 0), 0));
}

export function paymentsForEntity(payments, relatedEntityType, relatedEntityId) {
  return (payments || [])
    .filter((p) => matches(p, relatedEntityType, relatedEntityId))
    .sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || ''));
}

export function outstandingFor(totalOwed, appliedTotal) {
  return round2(Math.max(0, (Number(totalOwed) || 0) - (Number(appliedTotal) || 0)));
}

// Core write path. `owedAmount` is the caller-computed outstanding balance on
// the related record BEFORE this payment (gross/net minus prior applied
// total) — used only to split amount into applied_amount/unapplied_amount,
// never trusted for anything else. is_write_off short-circuits the split:
// the full amount is applied (that's the point of a write-off).
export async function recordPayment({
  direction, relatedEntityType, relatedEntityId, amount, paymentDate, paymentMethod, referenceNumber, notes, createdBy,
  owedAmount = 0, isWriteOff = false, isRetainageRelease = false,
}) {
  const amt = round2(amount);
  const applied = isWriteOff ? amt : round2(Math.min(amt, Math.max(0, Number(owedAmount) || 0)));
  const unapplied = isWriteOff ? 0 : round2(amt - applied);

  return db.entities.Payment.create({
    direction,
    related_entity_type: relatedEntityType,
    related_entity_id: relatedEntityId,
    amount: amt,
    payment_date: paymentDate || todayISO(),
    payment_method: paymentMethod || 'other',
    reference_number: referenceNumber || '',
    applied_amount: applied,
    is_fully_applied: unapplied <= 0.005,
    is_write_off: !!isWriteOff,
    is_unapplied: unapplied > 0.005,
    unapplied_amount: unapplied,
    is_retainage_release: !!isRetainageRelease,
    notes: notes || '',
    created_by: createdBy || 'Unknown',
  });
}

// Records a receivable payment against an InvoiceReceivable and — if it
// completes the invoice — flips payment_status to Released and fires the
// commission trigger exactly once. Factored out so every caller that can
// complete an invoice (InvoiceReceivableDetailModal's Record Payment action,
// IncomingAchPanel's ACH-to-invoice assignment for Stage 10) shares ONE
// release/commission guard instead of drifting copies of it. memoTotal
// (a credit memo permanently reducing what's owed) shrinks both the
// outstanding balance and the amount commission is prorated against — see
// InvoiceReceivableDetailModal.jsx's effectiveNetBilling comment.
export async function recordInvoiceReceivablePayment({ invoice, amount, paymentDate, paymentMethod, referenceNumber, notes, createdBy, existingPayments, memoTotal = 0 }) {
  const appliedTotal = appliedTotalFromList(existingPayments, 'InvoiceReceivable', invoice.id);
  const cashApplied = cashAppliedTotalFromList(existingPayments, 'InvoiceReceivable', invoice.id);
  const outstanding = outstandingFor(invoice.net_billing, appliedTotal + memoTotal);
  const effectiveNetBilling = round2(Number(invoice.net_billing) - memoTotal);

  const payment = await recordPayment({
    direction: 'receivable', relatedEntityType: 'InvoiceReceivable', relatedEntityId: invoice.id,
    amount, paymentDate, paymentMethod, referenceNumber, notes, createdBy, owedAmount: outstanding,
  });

  const wasReleased = invoice.payment_status === 'Released';
  const newCashApplied = round2(cashApplied + (Number(payment.applied_amount) || 0));
  const isNowReleased = !wasReleased && newCashApplied >= effectiveNetBilling - 0.01;

  let commissionPayment = null;
  let commissionError = null;
  if (isNowReleased) {
    await db.entities.InvoiceReceivable.update(invoice.id, { payment_status: 'Released', paid_date: paymentDate });
    try {
      commissionPayment = await triggerCommissionOnPayment(invoice.id, effectiveNetBilling, paymentDate);
    } catch (e) {
      commissionError = e;
    }
  }

  return { payment, isNowReleased, commissionPayment, commissionError };
}

// Applies a previously-unapplied portion of a payment (overpayment or an
// unmatched incoming ACH routed through Stage 10's Unapplied Cash panel) to a
// specific invoice/bill, reducing the source payment's unapplied_amount and
// creating a proper applied-payment link (a new Payment row against the
// target, is_unapplied false) rather than mutating the original payment's
// direction/target.
export async function applyUnappliedCash(sourcePayment, { relatedEntityType, relatedEntityId, amount, owedAmount, createdBy }) {
  const applyAmt = round2(Math.min(Number(amount) || 0, Number(sourcePayment.unapplied_amount) || 0, Math.max(0, Number(owedAmount) || 0)));
  if (applyAmt <= 0) throw new Error('Nothing to apply');

  const newUnapplied = round2((Number(sourcePayment.unapplied_amount) || 0) - applyAmt);
  await db.entities.Payment.update(sourcePayment.id, {
    unapplied_amount: newUnapplied,
    is_unapplied: newUnapplied > 0.005,
  });

  return db.entities.Payment.create({
    direction: sourcePayment.direction,
    related_entity_type: relatedEntityType,
    related_entity_id: relatedEntityId,
    amount: applyAmt,
    payment_date: sourcePayment.payment_date,
    payment_method: sourcePayment.payment_method,
    reference_number: sourcePayment.reference_number,
    applied_amount: applyAmt,
    is_fully_applied: true,
    is_write_off: false,
    is_unapplied: false,
    unapplied_amount: 0,
    notes: `Applied from unapplied cash — Payment ${sourcePayment.id}`,
    created_by: createdBy || 'Unknown',
  });
}
