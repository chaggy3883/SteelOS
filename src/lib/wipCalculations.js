const MARGIN_VARIANCE_THRESHOLD_PCT = 3;

// Standard cost-to-cost / earned-value WIP schedule for one project.
// - totalContractValue: project.contract_value, maintained as original_contract
//   + change_orders_to_date by syncProjectChangeOrderMetrics (changeOrderMetrics.js)
//   on every change order create/status update — read directly rather than
//   recomputed here, since that's the one place it's kept authoritative.
// - actualJTDCosts: sum of the project's job-cost ledger transactions
// - earnedRevenue: AIA-style earned value — Σ(SOV line scheduled value × % complete)
// - marginVariancePct: how far actuals have run over the estimated cost basis
//   (from ProjectJobCostSummary.revised_estimated_cost); flagged when > 3%
// - billingsToDate/overUnderBilling: the standard WIP over/underbilling
//   figure — billed vs. earned. Computed from real InvoiceReceivable
//   records (invoiceReceivables), not project.total_invoiced_to_date, since
//   that rollup field carries the same staleness risk the contract-value
//   fields had before this was fixed.
export function calculateWIPSchedule(project, sovLines = [], ledgerEntries = [], jobCostSummaryRows = [], invoiceReceivables = []) {
  const totalContractValue = Number(project?.contract_value || 0);
  const actualJTDCosts = ledgerEntries.reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);
  const earnedRevenue = sovLines.reduce((sum, line) => {
    const scheduled = Number(line?.original_scheduled_value) || 0;
    const pct = Number(line?.completion_percentage) || 0;
    return sum + scheduled * (pct / 100);
  }, 0);
  const estimatedCostBasis = jobCostSummaryRows.reduce((sum, row) => sum + (Number(row?.revised_estimated_cost) || 0), 0);
  const marginVariancePct = estimatedCostBasis > 0
    ? ((actualJTDCosts - estimatedCostBasis) / estimatedCostBasis) * 100
    : 0;

  const billingsToDate = invoiceReceivables.reduce((sum, inv) => sum + (Number(inv?.gross_amount) || 0), 0);
  const overUnderBilling = billingsToDate - earnedRevenue;
  const billingStatus = overUnderBilling > 0 ? 'overbilled' : overUnderBilling < 0 ? 'underbilled' : 'even';

  return {
    totalContractValue,
    actualJTDCosts,
    earnedRevenue,
    estimatedCostBasis,
    marginVariancePct,
    isOverBudget: marginVariancePct > MARGIN_VARIANCE_THRESHOLD_PCT,
    billingsToDate,
    overUnderBilling,
    // 'overbilled' = billings in excess of earned revenue (a liability —
    // cash collected for work not yet done); 'underbilled' = earned revenue
    // in excess of billings (an asset — work done not yet billed).
    billingStatus,
  };
}
