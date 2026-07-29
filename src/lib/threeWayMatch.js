const VARIANCE_THRESHOLD = 0.01;

// Compares a vendor bill against its PO and receiving log. Auto-approves when the
// dollar variance is within 1% AND the receiving log has been marked verified;
// otherwise flags the bill for manual review.
export function runThreeWayMatch(vendorBill, purchaseOrder, receivingLog) {
  const poTotal = Number(purchaseOrder?.budgeted_cost || purchaseOrder?.actual_cost || 0);
  const invoiceTotal = Number(vendorBill?.gross_amount || 0);
  const variance = poTotal > 0 ? Math.abs(invoiceTotal - poTotal) / poTotal : 1;
  const verified = !!receivingLog?.verified;

  const status = variance <= VARIANCE_THRESHOLD && verified ? 'Approved' : 'Flagged_Review';

  return {
    status,
    variance_pct: Math.round(variance * 10000) / 100,
  };
}
