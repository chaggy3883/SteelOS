// Shared calculation helpers for Time & Material bids/projects — used by
// TmEstimateWorksheet.jsx (bid-side estimate), TmTrackingPanel.jsx
// (project-side actual-vs-estimate), and InvoiceReceivableDetailModal.jsx
// (T&M invoice generation). Pure functions only, so every total here can be
// traced by hand against a concrete example.
//
// IMPORTANT: this module never writes a JobCostLedgerEntry for labor. Actual
// internal labor cost keeps posting through the existing payroll pipeline
// (PayrollRunPanel.jsx's job costing block, in PayrollProcessing.jsx) —
// TmLaborRate is a customer BILL rate, not the employee's pay rate, and is
// only used here to compute estimate/billing totals on the fly. Posting a
// second LAB entry from this module would double-count labor cost per the
// "no double-entry" rule.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function computeLaborEstimateTotal(lineItems = []) {
  return round2(lineItems.reduce((sum, li) => sum + (Number(li.estimated_hours) || 0) * (Number(li.hourly_rate) || 0), 0));
}

export function computeMaterialEstimateTotal(lineItems = []) {
  return round2(lineItems.reduce((sum, li) => sum + (Number(li.total_cost) || 0), 0));
}

export function computeSubEstimateTotal(lineItems = []) {
  return round2(lineItems.reduce((sum, li) => sum + (Number(li.quoted_price) || 0), 0));
}

export function applyMarkup(subtotal, pct) {
  return round2((Number(subtotal) || 0) * (Number(pct) || 0) / 100);
}

// Trace by hand: 100 hrs Welder @ $65 = $6,500 labor, $500 materials, $1,000
// sub, 10% markup -> markup = (6500+500+1000)*0.10 = $800, grand total $8,800.
export function computeTmEstimateSummary({ laborLineItems = [], materialLineItems = [], subLineItems = [], markupPct = 0 }) {
  const laborTotal = computeLaborEstimateTotal(laborLineItems);
  const materialTotal = computeMaterialEstimateTotal(materialLineItems);
  const subTotal = computeSubEstimateTotal(subLineItems);
  const subtotal = round2(laborTotal + materialTotal + subTotal);
  const markupAmount = applyMarkup(subtotal, markupPct);
  return {
    laborTotal,
    materialTotal,
    subTotal,
    subtotal,
    markupAmount,
    grandTotal: round2(subtotal + markupAmount),
  };
}

// Resolves the TmLaborRate in effect for a position on asOfDate — same
// effective-dated lookup shape as resolveSalesmanCommissionRate in
// commissionEngine.js.
export function resolveTmLaborRate(tmLaborRates, position, asOfDate = new Date().toISOString().slice(0, 10)) {
  const candidates = (tmLaborRates || [])
    .filter((r) => r.position === position && r.effective_date <= asOfDate && (!r.end_date || r.end_date > asOfDate))
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  return candidates[0] || null;
}

// Sums billable (non-PTO/holiday) TimeEntry hours for a project, grouped by
// employee job_title, and prices each group against the matching
// TmLaborRate. Entries whose employee's job_title has no matching rate are
// returned separately under unmatchedHours/unmatchedPositions so the UI can
// flag them rather than silently pricing them at $0.
export function computeActualLaborCost(timeEntries = [], employees = [], tmLaborRates = []) {
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const byPosition = new Map();
  let unmatchedHours = 0;
  const unmatchedPositions = new Set();

  timeEntries.forEach((entry) => {
    if (entry.entry_type === 'pto' || entry.entry_type === 'holiday') return;
    const hours = Number(entry.hours) || 0;
    if (hours <= 0) return;
    const position = employeeById.get(entry.employee_id)?.job_title || '';
    const rate = resolveTmLaborRate(tmLaborRates, position, entry.work_date);
    if (!rate) {
      unmatchedHours = round2(unmatchedHours + hours);
      if (position) unmatchedPositions.add(position);
      return;
    }
    const existing = byPosition.get(position) || { position, hours: 0, rate: Number(rate.hourly_rate) || 0, cost: 0 };
    existing.hours = round2(existing.hours + hours);
    existing.cost = round2(existing.hours * existing.rate);
    byPosition.set(position, existing);
  });

  const byPositionArr = Array.from(byPosition.values());
  return {
    byPosition: byPositionArr,
    totalHours: round2(byPositionArr.reduce((sum, p) => sum + p.hours, 0) + unmatchedHours),
    totalCost: round2(byPositionArr.reduce((sum, p) => sum + p.cost, 0)),
    unmatchedHours,
    unmatchedPositions: Array.from(unmatchedPositions),
  };
}

export function laborVariance(estimatedHours, actualHours) {
  const est = Number(estimatedHours) || 0;
  const act = Number(actualHours) || 0;
  const variancePct = est > 0 ? round2(((act - est) / est) * 100) : null;
  return { estimatedHours: est, actualHours: act, variancePct };
}

// Per-line-item material variance: flags usage that exceeds the quoted
// quantity, and separately totals usage rows with no matching estimate line
// (unquoted/additional material).
export function computeMaterialVariance(lineItems = [], usageRows = []) {
  const usageByLineItem = new Map();
  let unquotedTotal = 0;
  usageRows.forEach((u) => {
    if (!u.tm_material_line_item_id) {
      unquotedTotal = round2(unquotedTotal + (Number(u.total_cost) || 0));
      return;
    }
    const existing = usageByLineItem.get(u.tm_material_line_item_id) || { quantityUsed: 0, costUsed: 0 };
    existing.quantityUsed = round2(existing.quantityUsed + (Number(u.quantity_used) || 0));
    existing.costUsed = round2(existing.costUsed + (Number(u.total_cost) || 0));
    usageByLineItem.set(u.tm_material_line_item_id, existing);
  });

  const lines = lineItems.map((li) => {
    const usage = usageByLineItem.get(li.id) || { quantityUsed: 0, costUsed: 0 };
    return {
      lineItem: li,
      quantityUsed: usage.quantityUsed,
      costUsed: usage.costUsed,
      overQuantity: usage.quantityUsed > (Number(li.quantity) || 0),
    };
  });

  return {
    lines,
    estimatedTotal: computeMaterialEstimateTotal(lineItems),
    actualTotal: round2(lines.reduce((sum, l) => sum + l.costUsed, 0) + unquotedTotal),
    unquotedTotal,
  };
}

// purchase_orders actual cost convention (same field fallback used by
// postSubcontractorPoToJobCosting in ReceivingKiosk.jsx).
const poActualCost = (po) => Number(po?.actual_cost || po?.budgeted_cost || po?.total_estimated_cost) || 0;

export function computeSubVariance(lineItems = [], purchaseOrders = []) {
  const poById = new Map(purchaseOrders.map((po) => [po.id, po]));
  const lines = lineItems.map((li) => {
    const po = li.purchase_order_id ? poById.get(li.purchase_order_id) : null;
    const actualCost = po ? poActualCost(po) : 0;
    return {
      lineItem: li,
      purchaseOrder: po || null,
      actualCost,
      variance: po ? round2(actualCost - (Number(li.quoted_price) || 0)) : null,
    };
  });
  return {
    lines,
    estimatedTotal: computeSubEstimateTotal(lineItems),
    actualTotal: round2(lines.reduce((sum, l) => sum + l.actualCost, 0)),
  };
}
