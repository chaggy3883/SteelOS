import { db } from '@/api/apiClient';

// The full set of widgets a salesman dashboard can show. Admin sets which of
// these are ON by default (SalesCommissionConfig.default_dashboard_widgets);
// each salesman's own on/off choices are stored separately per-user (see
// PAGE_KEY in src/pages/SalesDashboard.jsx).
export const SALES_WIDGETS = [
  { id: 'pipeline', label: 'Sales Pipeline', description: 'Prospect → quote → won/lost' },
  { id: 'my_projects', label: 'My Active Projects', description: 'Status, ship dates, issues' },
  { id: 'commission', label: 'Commission YTD', description: 'Earned, pending, paid out' },
  { id: 'recent_rfis', label: 'Recent RFIs', description: 'Open/pending/closed on my projects' },
  { id: 'change_orders', label: 'Change Orders', description: 'Pending my approval/input' },
  { id: 'addenda', label: 'Addenda/Bulletins', description: 'On my projects' },
  { id: 'quick_stats', label: 'Quick Stats', description: 'Quotes submitted, win %, avg deal size' },
];

const ACTIVE_PROJECT_STATUSES = ['awarded', 'engineering', 'fabrication', 'erection'];
export const OPEN_RFI_STATUSES = ['draft', 'submitted', 'under_review'];

export async function getMyProjects(salesmanEmployeeId) {
  if (!salesmanEmployeeId) return [];
  return db.entities.Project.filter({ salesman_id: salesmanEmployeeId }, '-created_date', 500);
}

export function activeProjectsOnly(projects) {
  return (projects || []).filter((p) => ACTIVE_PROJECT_STATUSES.includes(p.status));
}

// One combined pass over PieceMark for both % complete (quantity-weighted:
// shipped/erected quantity over total quantity) and next ship date (the
// earliest upcoming ship_date, falling back to the most recent past one).
// No existing "% complete"/"next ship date" calculation exists anywhere else
// in the codebase for this to match — see the commission-feature research
// this was built from — so this establishes the convention fresh.
export async function getProjectPieceStats(projectIds) {
  const result = new Map();
  if (!projectIds.length) return result;

  const pieceMarks = await db.entities.PieceMark.filter({ project_id: { $in: projectIds } }, 'ship_date', 10000);
  const today = new Date().toISOString().slice(0, 10);
  const byProject = new Map();
  pieceMarks.forEach((pm) => {
    if (!byProject.has(pm.project_id)) byProject.set(pm.project_id, []);
    byProject.get(pm.project_id).push(pm);
  });

  projectIds.forEach((id) => {
    const rows = byProject.get(id) || [];
    const total = rows.reduce((s, pm) => s + (Number(pm.quantity) || 0), 0);
    const done = rows.filter((pm) => pm.status === 'shipped' || pm.status === 'erected').reduce((s, pm) => s + (Number(pm.quantity) || 0), 0);
    const dates = rows.filter((pm) => pm.ship_date).map((pm) => pm.ship_date).sort();
    const nextShipDate = dates.find((d) => d >= today) || dates[dates.length - 1] || null;
    result.set(id, { pctComplete: total > 0 ? Math.round((done / total) * 100) : null, nextShipDate });
  });
  return result;
}

// Issue flags: rejected pieces (pieces.workflow_status has no distinct
// "rework" state — 'Rejected' is the closest equivalent and is used here as
// that signal), open RFIs, and any Failed QA inspection. qa_inspections has
// no project_id of its own, so it's joined through pieces.piece_id -> the
// same already-scoped `pieces` rows fetched below.
export async function getProjectIssueFlags(projectIds) {
  const flags = new Map();
  if (!projectIds.length) return flags;
  projectIds.forEach((id) => flags.set(id, { rejectedPieces: false, openRfiCount: 0, qaFailed: false, any: false }));

  const [pieces, rfis, allQa] = await Promise.all([
    db.entities.pieces.filter({ project_id: { $in: projectIds } }, '-created_date', 5000),
    db.entities.RFI.filter({ project_id: { $in: projectIds } }, '-created_date', 2000),
    db.entities.qa_inspections.list('-inspected_at', 5000),
  ]);

  const pieceById = new Map(pieces.map((p) => [p.id, p]));

  pieces.forEach((p) => {
    if (p.workflow_status !== 'Rejected') return;
    const f = flags.get(p.project_id);
    if (f) f.rejectedPieces = true;
  });
  rfis.forEach((r) => {
    if (!OPEN_RFI_STATUSES.includes(r.status)) return;
    const f = flags.get(r.project_id);
    if (f) f.openRfiCount += 1;
  });
  allQa.forEach((qa) => {
    if (qa.status !== 'Failed') return;
    const piece = pieceById.get(qa.piece_id);
    if (!piece) return;
    const f = flags.get(piece.project_id);
    if (f) f.qaFailed = true;
  });

  flags.forEach((f) => { f.any = f.rejectedPieces || f.openRfiCount > 0 || f.qaFailed; });
  return flags;
}

export async function getPipelineBids(salesmanEmployeeId) {
  if (!salesmanEmployeeId) return [];
  return db.entities.Bid.filter({ salesman_id: salesmanEmployeeId }, '-created_date', 1000);
}

export function bucketPipeline(bids) {
  return {
    prospects: (bids || []).filter((b) => ['draft', 'in_progress'].includes(b.status)),
    quotes: (bids || []).filter((b) => b.status === 'submitted'),
    won: (bids || []).filter((b) => b.status === 'won'),
    lost: (bids || []).filter((b) => b.status === 'lost'),
  };
}

// Trace by hand: 3 submitted + 2 won + 1 lost = 6 counted quotes; win % =
// 2 / (2 + 1) = 67%; avg deal size = sum(won bid_quoted_price) / 2.
export function computeQuickStats(bids) {
  const counted = (bids || []).filter((b) => ['submitted', 'won', 'lost'].includes(b.status));
  const won = (bids || []).filter((b) => b.status === 'won');
  const lost = (bids || []).filter((b) => b.status === 'lost');
  const decided = won.length + lost.length;
  return {
    quotesSubmitted: counted.length,
    winPct: decided > 0 ? Math.round((won.length / decided) * 100) : null,
    avgDealSize: won.length > 0 ? won.reduce((s, b) => s + (Number(b.bid_quoted_price) || 0), 0) / won.length : 0,
  };
}

export async function getRfisForProjects(projectIds) {
  if (!projectIds.length) return [];
  return db.entities.RFI.filter({ project_id: { $in: projectIds } }, '-created_date', 500);
}

export async function getChangeOrdersForProjects(projectIds) {
  if (!projectIds.length) return [];
  return db.entities.change_orders.filter({ project_id: { $in: projectIds } }, '-created_date', 500);
}

export async function getBulletinsForProjects(projectIds) {
  if (!projectIds.length) return [];
  return db.entities.ProjectBulletin.filter({ project_id: { $in: projectIds } }, '-date_issued', 500);
}
