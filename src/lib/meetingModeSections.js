import { hasModule } from '@/lib/moduleEntitlement';

// Single source of truth for what a Meeting Mode section IS — company admins
// (MeetingModeSettingsPanel) and the Add Meeting modal both read this same
// list rather than each maintaining their own. `includesPricing` is what
// keeps the "pricing must never leak" guarantee generalized past a single
// hardcoded meeting type: a meeting that never includes a pricing section
// never mounts a component that fetches cost/pricing data at all (see each
// section component's own effect in src/components/meeting-mode/sections/).
export const SECTION_DEFINITIONS = [
  {
    key: 'project_status',
    label: 'Project Status',
    description: 'Active projects: stage, schedule, open blockers. No cost or pricing data.',
    moduleGate: '/production',
    includesPricing: false,
  },
  {
    key: 'manpower',
    label: 'Manpower & Staffing',
    description: 'Crew assignments and staffing gaps by project. No cost or pricing data.',
    moduleGate: '/field-operations',
    includesPricing: false,
  },
  {
    key: 'dwell_report',
    label: 'Dwell Report',
    description: 'Shop station dwell-time and bottleneck signals. No cost or pricing data.',
    moduleGate: 'meeting-mode-dwell-report',
    includesPricing: false,
  },
  {
    key: 'project_breakdown',
    label: 'Project Breakdown',
    description: 'Estimate / Actual / Committed / Variance by job cost code. Includes cost and pricing data.',
    moduleGate: '/production',
    includesPricing: true,
  },
  {
    key: 'estimating_updates',
    label: 'Estimating Updates',
    description: "Active bids awaiting a decision, including bids overdue for follow-up. Includes bid pricing.",
    moduleGate: '/estimating',
    includesPricing: true,
  },
];

// A meeting type is selectable if its pack requirement is actually granted
// to this company — same hasModule() single source of truth every other
// pack-gated page uses, never a direct subscription_plan string comparison.
export function getAvailableSections(company) {
  return SECTION_DEFINITIONS.filter((s) => hasModule(company, s.moduleGate));
}

export function getSectionDefinition(key) {
  return SECTION_DEFINITIONS.find((s) => s.key === key) || null;
}
