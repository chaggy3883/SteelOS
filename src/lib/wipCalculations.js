const MARGIN_VARIANCE_THRESHOLD_PCT = 3;

// Standard cost-to-cost / earned-value WIP schedule for one project.
// - totalContractValue: original contract plus approved change orders to date
// - actualJTDCosts: sum of the project's job-cost ledger transactions
// - earnedRevenue: AIA-style earned value — Σ(SOV line scheduled value × % complete)
// - marginVariancePct: how far actuals have run over the estimated cost basis
//   (from ProjectJobCostSummary.revised_estimated_cost); flagged when > 3%
export function calculateWIPSchedule(project, sovLines = [], ledgerEntries = [], jobCostSummaryRows = []) {
  const totalContractValue = Number(project?.original_contract || 0) + Number(project?.change_orders_to_date || 0);
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

  return {
    totalContractValue,
    actualJTDCosts,
    earnedRevenue,
    estimatedCostBasis,
    marginVariancePct,
    isOverBudget: marginVariancePct > MARGIN_VARIANCE_THRESHOLD_PCT,
  };
}
