import { base44 } from '@/api/base44Client';

// Procore Pay and Textura both push billing/payment status changes for progress
// billings. This app has no backend, so there's no live HTTP endpoint to receive
// these — these are the payload-mapping functions a real webhook route would call.
// Exercise them via a manual "paste a sample payload" test UI until a server exists.

const PROCORE_STATUS_MAP = {
  draft: 'Draft',
  pending_approval: 'Submitted',
  approved: 'Approved',
  paid: 'Released',
};

const TEXTURA_STATUS_MAP = {
  Pending: 'Submitted',
  Approved: 'Approved',
  Released: 'Released',
};

export async function handleProcorePayWebhook(payload) {
  const invoiceReceivableId = payload?.invoice_receivable_id;
  const mapped = PROCORE_STATUS_MAP[String(payload?.status || '').toLowerCase()];
  if (!invoiceReceivableId || !mapped) {
    throw new Error('Unrecognized Procore Pay payload — expected { invoice_receivable_id, status }');
  }
  return base44.entities.InvoiceReceivable.update(invoiceReceivableId, { payment_status: mapped });
}

export async function handleTexturaWebhook(payload) {
  const invoiceReceivableId = payload?.invoice_receivable_id;
  const mapped = TEXTURA_STATUS_MAP[payload?.sov_status];
  if (!invoiceReceivableId || !mapped) {
    throw new Error('Unrecognized Textura payload — expected { invoice_receivable_id, sov_status }');
  }
  return base44.entities.InvoiceReceivable.update(invoiceReceivableId, { payment_status: mapped });
}
