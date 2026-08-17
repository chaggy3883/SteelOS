// Resolves the PayrollRule that actually applies for a given rule_type as of
// a date, instead of any component hardcoding a threshold/multiplier. Rules
// layer federal/company-wide -> state: a jurisdiction_state-specific rule
// wins over a blank-jurisdiction (company-wide) one, and within each layer
// the most recently effective row as of `asOfDate` wins. Only one
// jurisdiction is actually configured today, but this resolution order is
// what lets a state-specific override coexist later without a schema or
// component change.
//
// This module intentionally contains no weekly-processing logic (no
// timecard math, no register generation) — Part A/setup only. Callers read
// `.config` for the actual values; this function never invents defaults for
// missing config keys.
export function getEffectiveRule(rules, ruleType, { state = null, asOfDate = new Date().toISOString().slice(0, 10) } = {}) {
  const candidates = (rules || []).filter((r) => r.rule_type === ruleType && r.effective_date && r.effective_date <= asOfDate);
  if (candidates.length === 0) return null;

  const stateMatches = state ? candidates.filter((r) => (r.jurisdiction_state || '').toUpperCase() === state.toUpperCase()) : [];
  const companyWide = candidates.filter((r) => !r.jurisdiction_state);

  const pickLatest = (rows) => rows.reduce((latest, r) => (!latest || r.effective_date > latest.effective_date ? r : latest), null);

  return pickLatest(stateMatches) || pickLatest(companyWide) || null;
}

export const PAYROLL_RULE_TYPES = ['overtime', 'double_time', 'holiday', 'pto', 'rounding', 'employer_tax', 'excessive_hours'];

export const RULE_TYPE_LABELS = {
  overtime: 'Overtime',
  double_time: 'Double Time',
  holiday: 'Holiday Pay',
  pto: 'PTO Accrual',
  rounding: 'Time Rounding',
  employer_tax: 'Employer Tax',
  excessive_hours: 'Excessive Hours (Control Check)',
};

// One PayrollRule row per employer-paid tax type — calculateEmployerTax() in
// payrollEngine.js resolves one effective rule per type via this list rather
// than a single rule_type='employer_tax' row (FICA/Medicare/FUTA/SUTA all
// need independent rates and effective dates).
export const EMPLOYER_TAX_TYPES = ['fica_employer', 'medicare_employer', 'futa', 'suta'];

export const EMPLOYER_TAX_TYPE_LABELS = {
  fica_employer: 'FICA (Employer)',
  medicare_employer: 'Medicare (Employer)',
  futa: 'FUTA',
  suta: 'SUTA',
};

// Per rule_type, which config keys the setup UI collects — the setup form
// reads/writes exactly these keys and nothing else is assumed by any
// consumer; unrecognized rule_types still work via the raw JSON fallback
// editor.
export const RULE_TYPE_CONFIG_FIELDS = {
  overtime: [
    { key: 'threshold_hours', label: 'Weekly Threshold (hours)', type: 'number', placeholder: 'e.g. 40' },
    { key: 'multiplier', label: 'Multiplier', type: 'number', placeholder: 'e.g. 1.5' },
    { key: 'requires_approval', label: 'Overtime Requires Sign-Off Before Approval', type: 'boolean' },
  ],
  double_time: [
    { key: 'threshold_hours', label: 'Daily/Weekly Threshold (hours)', type: 'number', placeholder: 'e.g. 12' },
    { key: 'multiplier', label: 'Multiplier', type: 'number', placeholder: 'e.g. 2' },
  ],
  holiday: [
    { key: 'multiplier', label: 'Holiday Pay Multiplier', type: 'number', placeholder: 'e.g. 1.5' },
    { key: 'requires_scheduled_shift', label: 'Requires Scheduled Shift', type: 'boolean' },
  ],
  pto: [
    { key: 'accrual_rate_hours_per_period', label: 'Accrual Rate (hours per pay period)', type: 'number', placeholder: 'e.g. 3.08' },
    { key: 'max_balance_hours', label: 'Max Balance (hours)', type: 'number', placeholder: 'e.g. 120' },
  ],
  rounding: [
    { key: 'increment_minutes', label: 'Rounding Increment (minutes)', type: 'number', placeholder: 'e.g. 15' },
  ],
  employer_tax: [
    { key: 'tax_type', label: 'Tax Type', type: 'select', options: EMPLOYER_TAX_TYPES.map((t) => ({ value: t, label: EMPLOYER_TAX_TYPE_LABELS[t] })) },
    { key: 'rate_percent', label: 'Rate (%)', type: 'number', placeholder: 'e.g. 6.2' },
    { key: 'wage_base_cap', label: 'Annual Wage Base Cap ($, optional)', type: 'number', placeholder: 'e.g. 168600' },
  ],
  // Read by payrollControls.js's excessive_hours check — a warning threshold,
  // separate from the overtime/double_time PayrollRule thresholds that
  // actually price hours (an employee can be under the OT/DT pay thresholds
  // and still be flagged here for review, e.g. a 10hr/day cap tighter than
  // the 12hr double-time threshold).
  excessive_hours: [
    { key: 'daily_threshold_hours', label: 'Daily Threshold (hours)', type: 'number', placeholder: 'e.g. 12' },
    { key: 'weekly_threshold_hours', label: 'Weekly Threshold (hours)', type: 'number', placeholder: 'e.g. 60' },
  ],
};
