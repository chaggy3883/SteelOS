import { db } from '@/api/apiClient';

const OVERRUN_THRESHOLD_PCT = 15;

// Flags cost codes where job-to-date hours exceed the original estimate (sourced
// from the winning bid's Worksheet, matched by cost_code === cost_category) by
// more than OVERRUN_THRESHOLD_PCT — the general form of a "58 est vs 103 JTD" pattern.
export async function flagCostCodeOverruns(projectId) {
  if (!projectId) return [];

  const [bids, allJobCostRows] = await Promise.all([
    db.entities.Bid.filter({ won_project_id: projectId }, '-created_date', 1),
    db.entities.ProjectJobCostSummary.filter({ project_id: projectId }, '-created_date', 200),
  ]);
  const jobCostRows = allJobCostRows.filter((r) => !r.is_deleted);
  const bid = bids[0];
  if (!bid || jobCostRows.length === 0) return [];

  const takeoffLines = await db.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 100);
  const estimatedHoursByCode = {};
  takeoffLines.forEach((line) => { estimatedHoursByCode[line.cost_category] = line.man_hours || 0; });

  return jobCostRows
    .map((row) => {
      const estimatedHours = estimatedHoursByCode[row.cost_code];
      if (!estimatedHours) return null;
      const jtdHours = row.jtd_hours || 0;
      const overrunPct = ((jtdHours - estimatedHours) / estimatedHours) * 100;
      if (overrunPct < OVERRUN_THRESHOLD_PCT) return null;
      return {
        project_id: projectId,
        bid_id: bid.id,
        bid_number: bid.bid_number,
        cost_code: row.cost_code,
        description: row.description,
        estimated_hours: estimatedHours,
        jtd_hours: jtdHours,
        overrun_pct: overrunPct,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.overrun_pct - a.overrun_pct);
}
