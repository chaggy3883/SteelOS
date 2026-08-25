// Weekly payroll processing math — pure functions only. No db/api imports,
// no React, no AI. Every function here takes plain data in and returns plain
// data out, so it's independently testable with fixed inputs -> fixed
// outputs (see the worked example in the PR/commit description this module
// shipped with). Thresholds and multipliers always come from PayrollRule
// rows passed in by the caller — this file never hardcodes a threshold or a
// multiplier as the primary value, only as a last-resort fallback when no
// rule has been configured at all (documented inline at each fallback).
import { getEffectiveRule } from '@/lib/payrollRules';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---------------------------------------------------------------------------
// Time entry -> hours
// ---------------------------------------------------------------------------

// TimeEntry.hours is stored (not derived on every read) so a later
// clock_in/clock_out edit can't silently redate hours already rolled into an
// approved Timecard — this is what computes it at entry-creation time.
export function computeTimeEntryHours(clockIn, clockOut) {
  if (!clockIn || !clockOut) return 0;
  const ms = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return round2(ms / 3600000);
}

const WEEKDAY_INDEX = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

// FLSA overtime is computed per workweek, never averaged across weeks — this
// is exactly why PayPeriod carries workweek_start_day (a biweekly/
// semimonthly period doesn't always align to one 7-day workweek boundary).
export function getWorkweekStart(workDate, workweekStartDay = 'Monday') {
  const d = new Date(`${workDate}T00:00:00`);
  const targetDow = WEEKDAY_INDEX[workweekStartDay] ?? 1;
  const diff = (d.getDay() - targetDow + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Labor allocation — TimeEntry[] (one employee) -> JobLaborAllocation[]
// ---------------------------------------------------------------------------

// Splits each TimeEntry's own hours into regular/OT/double-time by consuming
// the employee's weekly overtime/double_time PayrollRule thresholds in
// chronological order across the entries — the same cumulative-consumption
// approach attendanceMath.js already uses for punches, but reading
// thresholds from PayrollRule.config instead of hardcoded constants, and
// operating on whole TimeEntry rows instead of individual clock punches.
//
// project_id/phase_id/area_id/cost_code_id are carried through from each
// TimeEntry completely unchanged — this function only ever computes the
// regular/OT/DT split and the resulting cost, it never reassigns an entry's
// job allocation.
//
// `overtimeRule`/`doubleTimeRule` are the already-resolved PayrollRule rows
// (pass the result of getEffectiveRule(rules, 'overtime', {...}) etc.) — this
// function itself does no jurisdiction resolution, keeping it a pure
// hours-in/allocations-out transform.
export function allocateLaborToJobs(timeEntries, { payRate, overtimeRule, doubleTimeRule, workweekStartDay = 'Monday' } = {}) {
  const rate = Number(payRate?.rate) || 0;
  const overtimeEligible = payRate?.overtime_eligible !== false;

  // No configured rule (or an ineligible pay rate) means every hour is
  // regular — Infinity thresholds make that fall out naturally below rather
  // than needing a separate branch.
  const weeklyOtThreshold = overtimeEligible && overtimeRule?.config?.threshold_hours != null ? Number(overtimeRule.config.threshold_hours) : Infinity;
  const otMultiplier = Number(overtimeRule?.config?.multiplier) || 1.5; // fallback only when threshold is finite but multiplier wasn't set
  const weeklyDtThreshold = overtimeEligible && doubleTimeRule?.config?.threshold_hours != null ? Number(doubleTimeRule.config.threshold_hours) : Infinity;
  const dtMultiplier = Number(doubleTimeRule?.config?.multiplier) || 2;

  const sorted = [...timeEntries].sort((a, b) => (a.work_date || '').localeCompare(b.work_date || '') || (a.clock_in || '').localeCompare(b.clock_in || ''));
  const weekHoursConsumed = {}; // workweekStart -> cumulative WORKED hours already attributed

  return sorted.map((entry) => {
    const hours = Number(entry.hours) || 0;
    const isWorked = entry.entry_type === 'regular';
    let regular_hours = hours;
    let ot_hours = 0;
    let double_time_hours = 0;

    if (isWorked) {
      const weekKey = getWorkweekStart(entry.work_date, workweekStartDay);
      const priorHours = weekHoursConsumed[weekKey] || 0;

      const remainingRegular = Math.max(0, weeklyOtThreshold - priorHours);
      regular_hours = round2(Math.min(hours, remainingRegular));
      const afterRegular = round2(hours - regular_hours);

      const otBandSize = Math.max(0, weeklyDtThreshold - weeklyOtThreshold);
      const priorOtBandConsumed = Math.max(0, Math.min(priorHours, weeklyDtThreshold) - weeklyOtThreshold);
      const remainingOt = Math.max(0, otBandSize - priorOtBandConsumed);
      ot_hours = round2(Math.min(afterRegular, remainingOt));
      double_time_hours = round2(afterRegular - ot_hours);

      weekHoursConsumed[weekKey] = priorHours + hours;
    }
    // pto/holiday entries never touch the weekly threshold and are always
    // 100% regular_hours — there's no "overtime" concept for hours not
    // physically worked.

    const labor_cost = round2(regular_hours * rate + ot_hours * rate * otMultiplier + double_time_hours * rate * dtMultiplier);
    const labor_rate = hours > 0 ? round2(labor_cost / hours) : rate;

    return {
      time_entry_id: entry.id,
      project_id: entry.project_id,
      phase_id: entry.phase_id || null,
      area_id: entry.area_id || null,
      cost_code_id: entry.cost_code_id,
      hours,
      regular_hours,
      ot_hours,
      double_time_hours,
      labor_rate,
      labor_cost,
    };
  });
}

// ---------------------------------------------------------------------------
// Gross pay — Timecard totals -> regular/OT/double-time/gross breakdown
// ---------------------------------------------------------------------------

// Salary employees: gross is the period salary itself (periodsPerYear comes
// from the pay period's own frequency), independent of hours worked — OT/DT
// hours are still recorded on the timecard for reference but never priced.
const PERIODS_PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

export function calculateGrossPay(timecard, payRate, payrollRules, { asOfDate, state, periodFrequency = 'biweekly' } = {}) {
  if (payRate?.pay_type === 'salary') {
    const periodsPerYear = PERIODS_PER_YEAR[periodFrequency] || 26;
    const grossPay = round2((Number(payRate.rate) || 0) / periodsPerYear);
    return { regularPay: grossPay, otPay: 0, doubleTimePay: 0, grossPay, otMultiplier: 1, dtMultiplier: 1, hourlyRate: 0 };
  }

  const overtimeRule = getEffectiveRule(payrollRules, 'overtime', { state, asOfDate });
  const doubleTimeRule = getEffectiveRule(payrollRules, 'double_time', { state, asOfDate });
  const overtimeEligible = payRate?.overtime_eligible !== false;

  const hourlyRate = Number(payRate?.rate) || 0;
  const otMultiplier = overtimeEligible ? (Number(overtimeRule?.config?.multiplier) || 1.5) : 1;
  const dtMultiplier = overtimeEligible ? (Number(doubleTimeRule?.config?.multiplier) || 2) : 1;

  const regularHours = Number(timecard?.total_regular_hours) || 0;
  const otHours = Number(timecard?.total_ot_hours) || 0;
  const dtHours = Number(timecard?.total_double_time_hours) || 0;

  const regularPay = round2(regularHours * hourlyRate);
  const otPay = round2(otHours * hourlyRate * otMultiplier);
  const doubleTimePay = round2(dtHours * hourlyRate * dtMultiplier);
  const grossPay = round2(regularPay + otPay + doubleTimePay);

  return { regularPay, otPay, doubleTimePay, grossPay, otMultiplier, dtMultiplier, hourlyRate };
}

// ---------------------------------------------------------------------------
// Taxes, deductions, net pay
// ---------------------------------------------------------------------------

// Simplified flat-rate withholding, NOT a substitute for real IRS Circular E
// / state percentage-method tables (out of scope to build here) — but the
// rate itself comes from TaxWithholding.flat_rate_percent (admin-configured
// master data), not a constant in this file. PER_ALLOWANCE_REDUCTION is the
// one genuinely hardcoded number in this module: a simplified stand-in for
// "how much each W-4-style allowance/credit shrinks taxable wages by," since
// there's no real bracket table to derive it from. It's isolated here, named,
// and documented so it's easy to find and replace once real tables exist.
const PER_ALLOWANCE_REDUCTION = 100;

const JURISDICTION_TO_TAX_TYPE = { federal: 'federal_income', state: 'state_income', local: 'local_income' };

// Employee-side FICA has no dedicated PayrollRule of its own — it
// statutorily mirrors the employer's own match (both sides pay the same
// 6.2% Social Security / 1.45% Medicare), so this reuses the same
// employer_tax PayrollRule rows calculateEmployerTax() already resolves
// instead of adding a second, duplicate rate-configuration surface.
// `employerTaxRules` is optional — omit it (or pass none configured) and
// taxBreakdown simply has no social_security/medicare rows, same graceful
// degradation as a missing TaxWithholding jurisdiction. Additional Medicare
// (the 0.9% surtax on wages over $200k/yr) is never computed — like
// calculateEmployerTax's wage_base_cap, it requires year-to-date wage
// tracking no entity in this build carries; flagged rather than silently
// approximated against a single pay period's gross.
export function calculateTaxesAndDeductions(grossPay, taxWithholdings, deductions, employerTaxRules) {
  const gross = Number(grossPay) || 0;

  // source_id/source_type let a caller persist which specific record drove
  // each line (TaxWithholding for jurisdiction taxes, PayrollRule for the
  // FICA rows reused from the employer side) — the standing "every line item
  // clickable to its underlying rule" project rule needs a real FK, not a
  // re-lookup of "whichever record is active today," which could drift once
  // an employee's withholding config changes after the run.
  const taxBreakdown = (taxWithholdings || []).map((tw) => ({
    tax_type: JURISDICTION_TO_TAX_TYPE[tw.jurisdiction] || tw.jurisdiction,
    jurisdiction: tw.jurisdiction,
    filing_status: tw.filing_status || '',
    amount: round2(Math.max(0, gross - (Number(tw.allowances_or_credits) || 0) * PER_ALLOWANCE_REDUCTION) * (Number(tw.flat_rate_percent) || 0) / 100 + (Number(tw.additional_withholding) || 0)),
    source_id: tw.id,
    source_type: 'TaxWithholding',
  }));

  const ficaRule = (employerTaxRules || []).find((r) => r?.config?.tax_type === 'fica_employer');
  if (ficaRule) {
    taxBreakdown.push({ tax_type: 'social_security', jurisdiction: null, filing_status: '', amount: round2(gross * (Number(ficaRule.config.rate_percent) || 0) / 100), source_id: ficaRule.id, source_type: 'PayrollRule' });
  }
  const medicareRule = (employerTaxRules || []).find((r) => r?.config?.tax_type === 'medicare_employer');
  if (medicareRule) {
    taxBreakdown.push({ tax_type: 'medicare', jurisdiction: null, filing_status: '', amount: round2(gross * (Number(medicareRule.config.rate_percent) || 0) / 100), source_id: medicareRule.id, source_type: 'PayrollRule' });
  }

  const taxTotal = round2(taxBreakdown.reduce((sum, t) => sum + t.amount, 0));

  // Priority order matters: a garnishment (typically priority 1) must be
  // withheld before a voluntary benefit deduction if pay runs out.
  let remaining = round2(gross - taxTotal);
  const sortedDeductions = [...(deductions || [])].sort((a, b) => (Number(a.priority_order) || 0) - (Number(b.priority_order) || 0));
  const deductionBreakdown = sortedDeductions.map((d) => {
    const requested = round2(d.is_percent ? gross * (Number(d.amount_or_percent) || 0) / 100 : (Number(d.amount_or_percent) || 0));
    const applied = round2(Math.max(0, Math.min(requested, remaining)));
    remaining = round2(remaining - applied);
    return {
      deduction_type: d.deduction_type,
      deduction_subtype: d.deduction_subtype || d.deduction_type,
      priority_order: Number(d.priority_order) || 0,
      requested,
      amount: applied,
      fullyWithheld: applied >= requested,
      source_id: d.id,
    };
  });
  const deductionsTotal = round2(deductionBreakdown.reduce((sum, d) => sum + d.amount, 0));

  const netPay = round2(Math.max(0, gross - taxTotal - deductionsTotal));

  return { taxBreakdown, taxTotal, deductionBreakdown, deductionsTotal, netPay };
}

// ---------------------------------------------------------------------------
// Employer-side taxes
// ---------------------------------------------------------------------------

// `employerTaxRules` is the already-resolved set of PayrollRule rows (one
// per EMPLOYER_TAX_TYPES entry, via resolveEmployerTaxRules below) — this
// function itself just applies each rate to gross pay. wage_base_cap is
// accepted but NOT enforced here (that requires year-to-date gross tracking,
// which no entity in this build carries yet) — flagged rather than silently
// approximated; every amount below is uncapped.
export function calculateEmployerTax(grossPay, employerTaxRules) {
  const gross = Number(grossPay) || 0;
  return (employerTaxRules || [])
    .filter((rule) => rule?.config?.tax_type)
    .map((rule) => ({
      tax_type: rule.config.tax_type,
      amount: round2(gross * (Number(rule.config.rate_percent) || 0) / 100),
    }));
}

// ---------------------------------------------------------------------------
// GL account resolution
// ---------------------------------------------------------------------------

// Prefers a mapping scoped to this exact cost_code_id over the company-wide
// default (blank cost_code_id) for the same cost_type — same
// specific-beats-default resolution order as getEffectiveRule.
export function resolveGLAccount(glMappings, costType, costCodeId = null) {
  const candidates = (glMappings || []).filter((m) => m.cost_type === costType);
  const specific = costCodeId ? candidates.find((m) => m.cost_code_id === costCodeId) : null;
  const companyWide = candidates.find((m) => !m.cost_code_id);
  return specific?.gl_account || companyWide?.gl_account || null;
}

// Picks the latest-effective PayrollRule for each employer_tax tax_type
// independently (FICA/Medicare/FUTA/SUTA each need their own rate/effective
// date) rather than one rule_type='employer_tax' row overall.
export function resolveEmployerTaxRules(payrollRules, { state, asOfDate } = {}) {
  const employerTaxRows = (payrollRules || []).filter((r) => r.rule_type === 'employer_tax');
  const taxTypes = [...new Set(employerTaxRows.map((r) => r.config?.tax_type).filter(Boolean))];
  return taxTypes
    .map((taxType) => {
      const candidates = employerTaxRows.filter((r) => r.config?.tax_type === taxType);
      return getEffectiveRule(candidates, 'employer_tax', { state, asOfDate });
    })
    .filter(Boolean);
}
