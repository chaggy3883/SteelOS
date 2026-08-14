import { db } from '@/api/apiClient';
import { getStationDwellVariance, stationName } from '@/lib/shopOpsMetrics';
import { getBidPricingHoldState, getBidHoldDays } from '@/lib/bidPricingHold';
import { flagCostCodeOverruns } from '@/lib/jobCostAnalysis';

const DAY_MS = 24 * 60 * 60 * 1000;

// entity_watched values IntelligenceRule can target — one candidate builder
// below per value. Adding a new watched entity means adding one builder here
// and one entry to DEFAULT_SUGGESTIONS; no changes to the evaluator itself.
export const WATCHED_ENTITIES = ['Bid', 'Project', 'Piece', 'Equipment', 'JobCost', 'Certification'];

export const CONDITION_OPERATORS = ['>', '>=', '<', '<=', '=', '!='];

const OPERATORS = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '=': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

function compare(value, operator, threshold) {
  const fn = OPERATORS[operator];
  if (!fn || value === null || value === undefined || Number.isNaN(Number(value))) return false;
  return fn(Number(value), Number(threshold));
}

function daysUntil(dateStr, referenceDate) {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr).getTime() - referenceDate.getTime()) / DAY_MS);
}

// --- Candidate builders: turn a pre-fetched dataset into { id, label, link,
// metrics } shapes the generic evaluator can score against a rule's
// condition. Each reuses the app's existing signal logic rather than
// re-deriving it, per entity_watched:
//   Bid           -> getBidPricingHoldState (bidPricingHold.js)
//   Project       -> Project.health_score (stored field)
//   Piece         -> getStationDwellVariance (shopOpsMetrics.js)
//   Equipment     -> heavy_equipment_inspections.expiration_date
//   JobCost       -> flagCostCodeOverruns (jobCostAnalysis.js)
//   Certification -> employee_certifications.expiration_date

function bidCandidates(dataset) {
  const holdDays = getBidHoldDays(dataset.company);
  return (dataset.bids || [])
    .map((bid) => {
      const hold = getBidPricingHoldState(bid, holdDays);
      if (!hold) return null;
      return {
        id: bid.id,
        label: `${bid.bid_number} — ${bid.job_name}`,
        link: `/estimating/${bid.id}`,
        metrics: { days_old: hold.daysOld },
      };
    })
    .filter(Boolean);
}

function projectCandidates(dataset) {
  return (dataset.projects || [])
    .filter((project) => !project.is_archived)
    .map((project) => ({
      id: project.id,
      label: `${project.project_number} — ${project.name}`,
      link: `/projects/${project.id}`,
      metrics: { health_score: Number.isFinite(project.health_score) ? project.health_score : 100 },
    }));
}

function pieceCandidates(dataset) {
  const variance = getStationDwellVariance(dataset.stationLogs || [], dataset.pieces || [], dataset.pieceProductionLogs || []);
  return variance
    .filter((v) => v.dwellVariancePct !== null)
    .map((v) => ({
      id: String(v.stationId),
      label: stationName(v.stationId),
      link: '/shop-operations',
      metrics: { dwell_variance_pct: v.dwellVariancePct },
    }));
}

function equipmentCandidates(dataset) {
  return (dataset.equipmentInspections || []).map((inspection) => ({
    id: inspection.id,
    label: `${dataset.assetNamesById?.[inspection.asset_id] || inspection.asset_id} — ${inspection.inspection_type}`,
    link: '/field-operations',
    metrics: { days_until_expiration: daysUntil(inspection.expiration_date, dataset.referenceDate) },
  }));
}

function jobCostCandidates(dataset) {
  return (dataset.costOverruns || []).map((row) => ({
    id: `${row.project_id}:${row.cost_code}`,
    label: `${row.bid_number} — ${row.cost_code}`,
    link: `/projects/${row.project_id}`,
    metrics: { overrun_pct: row.overrun_pct },
  }));
}

function certificationCandidates(dataset) {
  return (dataset.certifications || []).map((cert) => ({
    id: cert.id,
    label: `${dataset.employeeNamesById?.[cert.employee_id] || cert.employee_id} — ${cert.cert_type}`,
    link: `/human-resources?employee=${cert.employee_id}`,
    metrics: { days_until_expiration: daysUntil(cert.expiration_date, dataset.referenceDate) },
  }));
}

const CANDIDATE_BUILDERS = {
  Bid: bidCandidates,
  Project: projectCandidates,
  Piece: pieceCandidates,
  Equipment: equipmentCandidates,
  JobCost: jobCostCandidates,
  Certification: certificationCandidates,
};

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

// Pure — given one rule and a pre-fetched dataset bag, returns the signals it
// fires. Rules that are inactive OR still pending AI review never fire,
// regardless of what their is_active field says — that gate is enforced here
// as well as at data-entry time, so a bad direct write can't slip a
// pending_review rule into evaluation.
export function evaluateRule(rule, dataset) {
  if (!rule?.is_active || rule.approval_status === 'pending_review') return [];
  const build = CANDIDATE_BUILDERS[rule.entity_watched];
  if (!build) return [];
  const { field, operator, threshold } = rule.condition || {};
  if (!field || !operator || threshold === undefined || threshold === null) return [];

  return build(dataset)
    .filter((candidate) => compare(candidate.metrics?.[field], operator, threshold))
    .map((candidate) => ({
      rule_id: rule.id,
      rule_name: rule.rule_name,
      description: rule.description,
      severity: rule.severity || 'info',
      entity_watched: rule.entity_watched,
      record_id: candidate.id,
      record_label: candidate.label,
      link: candidate.link,
      field,
      operator,
      threshold: Number(threshold),
      value: candidate.metrics[field],
      notify_roles: rule.notify_roles || [],
    }));
}

// Pure — evaluate every rule against the dataset, sorted critical -> info.
export function evaluateRules(rules, dataset) {
  const signals = (rules || []).flatMap((rule) => evaluateRule(rule, dataset));
  return signals.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99));
}

// --- Orchestration: fetch what evaluateRules needs, then run it. Kept
// separate from evaluateRule/evaluateRules above so those stay pure and unit
// testable against plain fixtures, no db access required.

export async function fetchIntelligenceDataset(referenceDate = new Date()) {
  const [bids, projects, pieces, stationLogs, pieceProductionLogs, equipmentInspections, certifications, fleetAssets, employees] = await Promise.all([
    db.entities.Bid.list('-created_date', 500),
    db.entities.Project.filter({ is_archived: false }, '-created_date', 500),
    db.entities.pieces.list('-created_date', 1000),
    db.entities.station_logs.list('-created_date', 1000),
    db.entities.piece_production_logs.list('-created_date', 1000),
    db.entities.heavy_equipment_inspections.list('-created_date', 200),
    db.entities.employee_certifications.list('-created_date', 500),
    db.entities.erection_fleet_assets.list('-created_date', 200),
    db.entities.employees.list('-created_date', 500),
  ]);

  const costOverruns = (await Promise.all(projects.map((project) => flagCostCodeOverruns(project.id)))).flat();

  const assetNamesById = Object.fromEntries(fleetAssets.map((asset) => [asset.id, asset.asset_name]));
  const employeeNamesById = Object.fromEntries(employees.map((employee) => [employee.id, employee.full_name || employee.id]));

  let company = null;
  try {
    company = employees.length ? await db.entities.Company.get(employees[0].company_id) : null;
  } catch (e) {
    company = null;
  }

  return {
    company, bids, projects, pieces, stationLogs, pieceProductionLogs,
    equipmentInspections, certifications, costOverruns,
    assetNamesById, employeeNamesById, referenceDate,
  };
}

// The single entry point pages should call: loads active+approved rules,
// fetches the dataset they need, and returns sorted signals.
export async function runIntelligenceRules() {
  const [rules, dataset] = await Promise.all([
    db.entities.IntelligenceRule.filter({ is_active: true, approval_status: 'approved' }, '-created_date', 200),
    fetchIntelligenceDataset(),
  ]);
  return evaluateRules(rules, dataset);
}

// --- AI-assisted rule authoring. Same honesty convention as
// src/lib/aiIntelligenceEngine.js's contract-risk analyzer: there is no real
// LLM call anywhere in this app (db.integrations.Core.InvokeLLM is a mock
// echo), so rather than pretend to call one, this is an honest deterministic
// suggester — it looks at which entity_watched types the company has no rule
// for yet and proposes one with a sensible default condition. Every field
// this returns must be treated as a DRAFT: source/approval_status/is_active
// are fixed here and callers must never override them before create() —
// this is what "never auto-activate" means in practice.
const DEFAULT_SUGGESTIONS = {
  Bid: { rule_name: 'Bid pricing past hold window', description: 'Flags active bids whose quoted pricing has aged past the company hold window.', condition: { field: 'days_old', operator: '>', threshold: 21 }, severity: 'warning' },
  Project: { rule_name: 'Project health score below threshold', description: 'Flags projects whose health score has dropped below a healthy range.', condition: { field: 'health_score', operator: '<', threshold: 60 }, severity: 'critical' },
  Piece: { rule_name: 'Station dwell time bottleneck', description: 'Flags shop stations where actual dwell time is running well over target.', condition: { field: 'dwell_variance_pct', operator: '>', threshold: 25 }, severity: 'warning' },
  Equipment: { rule_name: 'Equipment inspection overdue', description: 'Flags rigging/equipment inspections past their expiration date.', condition: { field: 'days_until_expiration', operator: '<=', threshold: 0 }, severity: 'critical' },
  JobCost: { rule_name: 'Job cost exceeding estimate', description: 'Flags cost codes where job-to-date hours exceed the estimate by a significant margin.', condition: { field: 'overrun_pct', operator: '>=', threshold: 15 }, severity: 'warning' },
  Certification: { rule_name: 'Certification expiring soon', description: 'Flags employee certifications expiring within the configured window.', condition: { field: 'days_until_expiration', operator: '<=', threshold: 30 }, severity: 'info' },
};

export async function suggestNextRule() {
  const existing = await db.entities.IntelligenceRule.list('-created_date', 200);
  const coveredEntities = new Set(existing.map((rule) => rule.entity_watched));
  const nextEntity = WATCHED_ENTITIES.find((entity) => !coveredEntities.has(entity));
  if (!nextEntity) return null;

  const suggestion = DEFAULT_SUGGESTIONS[nextEntity];
  return {
    ...suggestion,
    entity_watched: nextEntity,
    notify_roles: [],
    source: 'ai_suggested',
    approval_status: 'pending_review',
    is_active: false,
    ai_suggestion_rationale: `No rule currently watches ${nextEntity} — suggested based on default SteelOS intelligence rule coverage.`,
  };
}
