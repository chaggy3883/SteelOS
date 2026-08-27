import { db } from '@/api/apiClient';

// Subcontract statuses that represent a real, still-open obligation —
// 'draft' has no signed commitment yet, 'terminated' has none anymore.
const COMMITTED_SUBCONTRACT_STATUSES = ['executed', 'active', 'complete'];

// Project statuses excluded from Meeting Mode's agenda sections entirely —
// not real, live jobs a recurring meeting needs to walk. 'cancelled' is the
// only hard exclusion; everything else (including 'complete') can still
// carry open committed value, a closeout variance, or a last few days of
// crew still on site worth reviewing.
const EXCLUDED_PROJECT_STATUSES = ['cancelled'];

// Shared by every Meeting Mode agenda builder (Job Cost, Manpower, ...) so
// "what counts as a live job" never drifts between sections.
export async function getLiveProjects() {
  const projects = await db.entities.Project.filter({ is_archived: false }, 'name', 200);
  return projects.filter((p) => !EXCLUDED_PROJECT_STATUSES.includes(p.status));
}

function sumPaidPayApps(payApps, subcontractId) {
  return payApps
    .filter((p) => p.subcontract_id === subcontractId && p.status === 'paid')
    .reduce((sum, p) => sum + (Number(p.amount_approved) || 0), 0);
}

// Resolves one project's estimate for a cost code from ProjectJobCostSummary
// — the only place a per-code estimate is actually stored in this app.
// Falls back to original_estimate + approved_co when revised_estimated_cost
// itself wasn't kept in sync, same convention Accounting.jsx's own Job
// Costing Summary tab uses. Returns null (not 0) when nothing usable is on
// file, so callers never compute a percentage against zero.
function resolveEstimate(jobCostSummaryRow) {
  if (!jobCostSummaryRow) return null;
  const revised = Number(jobCostSummaryRow.revised_estimated_cost) || 0;
  const fallback = (Number(jobCostSummaryRow.original_estimate) || 0) + (Number(jobCostSummaryRow.approved_co) || 0);
  const value = revised > 0 ? revised : fallback;
  return value > 0 ? value : null;
}

// Builds the Estimate / Actual / Committed / Variance rows for one project,
// one row per active company Cost Code, plus a trailing "Unmapped" row for
// any real ledger dollars whose cost_code doesn't match an active Cost
// Code by name. That second part matters: this app has historically let
// JobCostLedgerEntry.cost_code be free text (subcontract pay-app postings
// used to write the subcontract number as a pseudo-code — see
// Subcontracts.jsx's createSubLedgerEntry) rather than always the
// CostCode entity's own code_name. Rather than silently dropping dollars
// that don't line up with a named code, they surface in their own row so
// a real cost is never missing from the total without saying so.
export function buildJobCostRows({ project, activeCostCodes, jobCostSummaries, ledgerEntries, subcontracts, payApps }) {
  const projectSummaries = jobCostSummaries.filter((r) => r.project_id === project.id);
  const projectLedgerEntries = ledgerEntries.filter((e) => e.project_id === project.id);
  const projectSubcontracts = subcontracts.filter((s) => s.project_id === project.id);

  const matchedCodeNames = new Set(activeCostCodes.map((c) => c.code_name));

  const rows = activeCostCodes.map((code) => {
    const codeName = code.code_name;
    const entries = projectLedgerEntries.filter((e) => e.cost_code === codeName);
    const actual = entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const summaryRow = projectSummaries.find((r) => r.cost_code === codeName);
    const estimate = resolveEstimate(summaryRow);

    const committedSubs = projectSubcontracts.filter(
      (s) => s.cost_code === codeName && COMMITTED_SUBCONTRACT_STATUSES.includes(s.status)
    );
    const committed = committedSubs.reduce((sum, s) => {
      const remaining = (Number(s.contract_value) || 0) - sumPaidPayApps(payApps, s.id);
      return sum + Math.max(0, remaining);
    }, 0);

    const hasEstimate = estimate !== null;
    const variance = hasEstimate ? actual - estimate : null;
    const variancePct = hasEstimate ? (variance / estimate) * 100 : null;

    return {
      cost_code: codeName,
      description: code.description || '',
      hasEstimate,
      estimate,
      actual,
      committed,
      variance,
      variancePct,
      ledgerEntries: entries,
      committedSubcontracts: committedSubs.map((s) => ({ subcontract: s, paidToDate: sumPaidPayApps(payApps, s.id) })),
    };
  }).filter((row) => row.hasEstimate || row.actual !== 0 || row.committed !== 0);

  const unmatchedEntries = projectLedgerEntries.filter((e) => !matchedCodeNames.has(e.cost_code));
  const unmatchedActual = unmatchedEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  if (unmatchedActual !== 0) {
    rows.push({
      cost_code: 'Unmapped',
      description: "Ledger entries whose cost code doesn't match an active Cost Code",
      hasEstimate: false,
      estimate: null,
      actual: unmatchedActual,
      committed: 0,
      variance: null,
      variancePct: null,
      ledgerEntries: unmatchedEntries,
      committedSubcontracts: [],
      isUnmapped: true,
    });
  }

  return rows;
}

export async function loadJobCostAgendaData() {
  const [liveProjects, activeCostCodes, allJobCostSummaries, ledgerEntries, subcontracts, payApps] = await Promise.all([
    getLiveProjects(),
    db.entities.CostCode.filter({ is_active: true }, 'code_name', 200),
    db.entities.ProjectJobCostSummary.list('-created_date', 1000),
    db.entities.JobCostLedgerEntry.list('-created_date', 2000),
    db.entities.Subcontract.list('-created_date', 500),
    db.entities.SubcontractPayApp.list('-created_date', 1000),
  ]);
  const jobCostSummaries = allJobCostSummaries.filter((r) => !r.is_deleted);

  return liveProjects.map((project) => ({
    project,
    rows: buildJobCostRows({ project, activeCostCodes, jobCostSummaries, ledgerEntries, subcontracts, payApps }),
  }));
}
