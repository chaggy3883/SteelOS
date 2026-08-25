// Shapes a WH-347-style certified payroll report from Hancock's own locked
// PayrollRun data — pure function, no db/api imports, same style as
// payrollEngine.js. Every dollar figure traces back to the exact rows a
// locked run already produced; this module only re-slices them per project
// and re-derives the itemized withholding breakdown payrollEngine.js already
// knows how to compute (reused via calculateTaxesAndDeductions, not
// reimplemented) — PayrollLine only ever stored the total.
import { calculateTaxesAndDeductions } from '@/lib/payrollEngine';

// JobLaborAllocation carries no employee_id of its own — it's reached via
// its time_entry_id back to the TimeEntry that produced it, which is also
// where the per-day work_date for the report's daily-hours grid comes from.
export function buildCertifiedPayrollReportRows({ project, period, payrollLines, jobLaborAllocations, timeEntries, employees, payRates, taxWithholdings, deductions, employerTaxRules }) {
  const timeEntryById = new Map((timeEntries || []).map((t) => [t.id, t]));
  const byEmployee = new Map();

  (jobLaborAllocations || []).forEach((alloc) => {
    const entry = timeEntryById.get(alloc.time_entry_id);
    if (!entry) return;
    const employeeId = entry.employee_id;
    if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, { allocations: [], dailyHours: {} });
    const bucket = byEmployee.get(employeeId);
    bucket.allocations.push(alloc);
    const day = bucket.dailyHours[entry.work_date] || { regular: 0, ot: 0, dt: 0 };
    day.regular += Number(alloc.regular_hours) || 0;
    day.ot += Number(alloc.ot_hours) || 0;
    day.dt += Number(alloc.double_time_hours) || 0;
    bucket.dailyHours[entry.work_date] = day;
  });

  const asOfDate = period.period_end;

  return Array.from(byEmployee.entries()).map(([employeeId, { allocations, dailyHours }]) => {
    const employee = (employees || []).find((e) => e.id === employeeId) || {};
    const payRate = (payRates || [])
      .filter((r) => r.employee_id === employeeId && r.effective_date <= asOfDate && (!r.end_date || r.end_date > asOfDate))
      .sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0] || null;
    const line = (payrollLines || []).find((l) => l.employee_id === employeeId) || null;

    const totals = allocations.reduce((acc, a) => ({
      regular_hours: acc.regular_hours + (Number(a.regular_hours) || 0),
      ot_hours: acc.ot_hours + (Number(a.ot_hours) || 0),
      double_time_hours: acc.double_time_hours + (Number(a.double_time_hours) || 0),
      gross_this_project: acc.gross_this_project + (Number(a.labor_cost) || 0),
    }), { regular_hours: 0, ot_hours: 0, double_time_hours: 0, gross_this_project: 0 });

    const employeeWithholdings = (taxWithholdings || [])
      .filter((w) => w.employee_id === employeeId && w.effective_date <= asOfDate)
      .reduce((latestByJurisdiction, w) => {
        const existing = latestByJurisdiction.get(w.jurisdiction);
        if (!existing || w.effective_date > existing.effective_date) latestByJurisdiction.set(w.jurisdiction, w);
        return latestByJurisdiction;
      }, new Map());
    const employeeDeductions = (deductions || []).filter((d) => d.employee_id === employeeId && d.effective_date <= asOfDate && (!d.end_date || d.end_date >= asOfDate));
    const grossAllProjects = Number(line?.gross_pay) || 0;
    const netCalc = calculateTaxesAndDeductions(grossAllProjects, [...employeeWithholdings.values()], employeeDeductions, employerTaxRules);

    return {
      employee_id: employeeId,
      full_name: employee.full_name || employeeId,
      classification: employee.classification || employee.job_title || '—',
      ssn_last4: employee.ssn_last4 || '',
      rate_of_pay: Number(payRate?.rate) || 0,
      pay_type: payRate?.pay_type || 'hourly',
      daily_hours: dailyHours,
      regular_hours: totals.regular_hours,
      ot_hours: totals.ot_hours,
      double_time_hours: totals.double_time_hours,
      gross_this_project: Math.round(totals.gross_this_project * 100) / 100,
      gross_all_projects: grossAllProjects,
      tax_breakdown: netCalc.taxBreakdown,
      deduction_breakdown: netCalc.deductionBreakdown,
      total_deductions: netCalc.taxTotal + netCalc.deductionsTotal,
      net_wages: netCalc.netPay,
    };
  }).sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export function reportDateColumns(period) {
  const dates = [];
  const cursor = new Date(`${period.period_start}T00:00:00`);
  const end = new Date(`${period.period_end}T00:00:00`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
