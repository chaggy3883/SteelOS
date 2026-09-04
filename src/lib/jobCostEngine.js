// Job Cost Detail's real math — replaces the old Accounting.jsx behavior of
// letting accounting hand-type "JTD Hours"/"JTD Costs"/"Profit/Loss" into
// ProjectJobCostSummary (see that entity's schema for the deprecation note).
// Those three numbers are now always computed live from the actual ledger:
//   - JobCostLedgerEntry — the existing unified $ ledger every cost source
//     already posts to (labor via JobLaborAllocation, material, subcontract,
//     equipment) — grouped by its own free-text cost_code string.
//   - JobLaborAllocation — read separately only for its `hours` field, since
//     JobCostLedgerEntry never carries hours, only dollars. Never used for $
//     here — its dollars are already inside JobCostLedgerEntry, and adding
//     them again would double-count labor cost.
//   - credit_card_expenses — NOT posted to JobCostLedgerEntry (no such
//     pipeline exists in this app), so its cost-coded, Approved/Reimbursed
//     rows are blended in directly by resolving cost_code_id -> CostCode.code_name.
// ProjectJobCostSummary survives only as the per-project BUDGET input
// (Original Estimate / Approved C.O. / Revised Estimated Cost) — figures a
// real job cost system can't derive from actuals, so a human still has to
// enter them.
const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

// Only Approved/Reimbursed expenses count as real job cost — a Pending
// expense hasn't cleared review yet, same "not real cost until approved"
// gate VendorBill/PO 3-way-match already applies elsewhere in this app.
const isRealizedExpense = (expense) => expense.status === 'Approved' || expense.status === 'Reimbursed';

// One row per distinct cost_code string seen across the master CostCode
// list, the project's budget rows, its ledger entries, and its cost-coded
// expenses — a code with real activity but no budget still shows, and a
// budgeted code with zero activity still shows at zero, instead of either
// side silently going missing.
export function buildProjectJobCostRows({ costCodes = [], budgetRows = [], ledgerEntries = [], laborAllocations = [], expenses = [] }) {
  const codeNameById = new Map(costCodes.map((c) => [c.id, c.code_name]));
  const masterByName = new Map(costCodes.map((c) => [c.code_name, c]));
  const rows = new Map();

  const ensureRow = (costCode) => {
    if (!costCode) return null;
    if (!rows.has(costCode)) {
      const master = masterByName.get(costCode);
      rows.set(costCode, {
        cost_code: costCode,
        cost_class: '',
        description: master?.description || '',
        original_estimate: 0,
        approved_co: 0,
        revised_estimated_cost: 0,
        jtd_hours: 0,
        jtd_costs: 0,
        budgetRowId: null,
      });
    }
    return rows.get(costCode);
  };

  costCodes.filter((c) => c.is_active).forEach((c) => ensureRow(c.code_name));

  budgetRows.forEach((b) => {
    const row = ensureRow(b.cost_code);
    if (!row) return;
    row.cost_class = b.cost_class || row.cost_class;
    row.description = b.description || row.description;
    row.original_estimate = Number(b.original_estimate) || 0;
    row.approved_co = Number(b.approved_co) || 0;
    row.revised_estimated_cost = Number(b.revised_estimated_cost) || 0;
    row.budgetRowId = b.id;
  });

  ledgerEntries.forEach((e) => {
    const row = ensureRow(e.cost_code);
    if (!row) return;
    if (!row.cost_class) row.cost_class = e.cost_class || '';
    row.jtd_costs = round2(row.jtd_costs + (Number(e.amount) || 0));
  });

  laborAllocations.forEach((a) => {
    const codeName = codeNameById.get(a.cost_code_id) || a.cost_code_id;
    const row = ensureRow(codeName);
    if (!row) return;
    if (!row.cost_class) row.cost_class = 'LAB';
    row.jtd_hours = round2(row.jtd_hours + (Number(a.hours) || 0));
  });

  expenses.filter(isRealizedExpense).forEach((ex) => {
    if (!ex.cost_code_id) return;
    const codeName = codeNameById.get(ex.cost_code_id);
    const row = ensureRow(codeName);
    if (!row) return;
    row.jtd_costs = round2(row.jtd_costs + (Number(ex.amount_cents) || 0) / 100);
  });

  return [...rows.values()]
    .map((r) => ({ ...r, profit_loss: round2(r.revised_estimated_cost - r.jtd_costs) }))
    .sort((a, b) => a.cost_code.localeCompare(b.cost_code));
}

export function sumProjectJobCostTotals(rows = []) {
  return rows.reduce((acc, r) => ({
    original_estimate: round2(acc.original_estimate + (Number(r.original_estimate) || 0)),
    approved_co: round2(acc.approved_co + (Number(r.approved_co) || 0)),
    revised_estimated_cost: round2(acc.revised_estimated_cost + (Number(r.revised_estimated_cost) || 0)),
    jtd_hours: round2(acc.jtd_hours + (Number(r.jtd_hours) || 0)),
    jtd_costs: round2(acc.jtd_costs + (Number(r.jtd_costs) || 0)),
    profit_loss: round2(acc.profit_loss + (Number(r.profit_loss) || 0)),
  }), { original_estimate: 0, approved_co: 0, revised_estimated_cost: 0, jtd_hours: 0, jtd_costs: 0, profit_loss: 0 });
}

// Synthetic ledger-shaped rows for credit_card_expenses, so they can share
// LedgerDrilldownModal (which only knows about real JobCostLedgerEntry
// shape: transaction_date/cost_code/cost_class/source_type/amount/description)
// without that modal needing to learn a second entry shape.
export function expenseAsLedgerRow(expense, codeName) {
  return {
    id: expense.id,
    transaction_date: expense.expense_date,
    cost_code: codeName,
    cost_class: '',
    source_type: 'credit_card_expense',
    amount: round2((Number(expense.amount_cents) || 0) / 100),
    description: [expense.merchant_name, expense.expense_category].filter(Boolean).join(' — '),
  };
}

// Company-wide distribution across every project — "how much did we spend
// company-wide on Fuel across every job" — actuals only, no budget axis
// (a budget is inherently per-project). callerLedgerEntries/callerExpenses
// are expected to already be date-range-filtered by the caller, if a range
// was picked.
export function buildCompanyWideJobCostRollup({ costCodes = [], ledgerEntries = [], expenses = [] }) {
  const codeNameById = new Map(costCodes.map((c) => [c.id, c.code_name]));
  const masterByName = new Map(costCodes.map((c) => [c.code_name, c]));
  const rows = new Map();

  const ensureRow = (costCode) => {
    if (!costCode) return null;
    if (!rows.has(costCode)) {
      rows.set(costCode, {
        cost_code: costCode,
        description: masterByName.get(costCode)?.description || '',
        jtd_costs: 0,
        projectIds: new Set(),
      });
    }
    return rows.get(costCode);
  };

  ledgerEntries.forEach((e) => {
    const row = ensureRow(e.cost_code);
    if (!row) return;
    row.jtd_costs = round2(row.jtd_costs + (Number(e.amount) || 0));
    if (e.project_id) row.projectIds.add(e.project_id);
  });

  expenses.filter(isRealizedExpense).forEach((ex) => {
    if (!ex.cost_code_id || !ex.project_id) return;
    const codeName = codeNameById.get(ex.cost_code_id);
    const row = ensureRow(codeName);
    if (!row) return;
    row.jtd_costs = round2(row.jtd_costs + (Number(ex.amount_cents) || 0) / 100);
    row.projectIds.add(ex.project_id);
  });

  const grandTotal = round2([...rows.values()].reduce((sum, r) => sum + r.jtd_costs, 0));

  return [...rows.values()]
    .map((r) => ({
      cost_code: r.cost_code,
      description: r.description,
      jtd_costs: r.jtd_costs,
      project_count: r.projectIds.size,
      pct_of_total: grandTotal > 0 ? round2((r.jtd_costs / grandTotal) * 100) : 0,
    }))
    .sort((a, b) => b.jtd_costs - a.jtd_costs);
}

export { round2, isRealizedExpense };
