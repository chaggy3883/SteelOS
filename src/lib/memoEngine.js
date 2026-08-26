import { db } from '@/api/apiClient';
import { round2, todayISO } from '@/lib/paymentEngine';

// Minimum-viable credit/debit memo layer — Stage 7 of the payment-layer
// build (schema/entities/Memo.jsonc). A memo reduces the EFFECTIVE balance
// owed everywhere balance is computed (aging, customer/vendor balances, the
// detail-modal "Outstanding Balance" figure, statements) WITHOUT touching
// the original InvoiceReceivable/VendorBill's own gross_amount/net_billing —
// those stay as the historical record of what was actually billed, matching
// the audit-trail principle from the Accounting Controls fix. Memos do NOT
// drive the payment_status/status "fully paid" transition or the commission
// trigger — only real Payment rows do that (see paymentEngine.js); a memo
// just shrinks what's left to collect/pay.
export const MEMO_TYPES = ['customer_credit', 'vendor_debit'];

export async function loadAllMemos() {
  return db.entities.Memo.list('-issued_date', 5000);
}

const matches = (m, relatedEntityType, relatedEntityId) =>
  m.related_entity_type === relatedEntityType && m.related_entity_id === relatedEntityId;

export function memoTotalFromList(memos, relatedEntityType, relatedEntityId) {
  return round2((memos || []).filter((m) => matches(m, relatedEntityType, relatedEntityId)).reduce((s, m) => s + (Number(m.amount) || 0), 0));
}

export function memosForEntity(memos, relatedEntityType, relatedEntityId) {
  return (memos || [])
    .filter((m) => matches(m, relatedEntityType, relatedEntityId))
    .sort((a, b) => (b.issued_date || '').localeCompare(a.issued_date || ''));
}

export async function issueMemo({ type, relatedEntityType, relatedEntityId, amount, reason, issuedDate, createdBy }) {
  return db.entities.Memo.create({
    type,
    related_entity_type: relatedEntityType,
    related_entity_id: relatedEntityId,
    amount: round2(amount),
    reason: reason || '',
    issued_date: issuedDate || todayISO(),
    created_by: createdBy || 'Unknown',
  });
}
