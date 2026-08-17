import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { PlayCircle, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { getEffectiveRule } from '@/lib/payrollRules';
import { allocateLaborToJobs, calculateGrossPay, calculateTaxesAndDeductions, calculateEmployerTax, resolveEmployerTaxRules, resolveGLAccount } from '@/lib/payrollEngine';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);

const TAX_JURISDICTION_TO_LIABILITY = { federal: 'federal_withholding', state: 'state_withholding', local: 'local_withholding' };
const DEDUCTION_TYPE_TO_LIABILITY = { benefits: 'benefits', garnishment: 'garnishment', other: 'other' };

// Orchestrates Time Entry -> Timecard -> Job Allocation -> Gross ->
// Taxes/Deductions -> Net -> Employer Taxes -> Payroll Journal -> Job
// Costing -> Liabilities for every APPROVED timecard in a pay period. Every
// dollar figure comes from src/lib/payrollEngine.js's pure functions; this
// component's job is only to fetch the inputs, call them, and persist the
// outputs. The run lands in 'review' — nothing here approves or locks it.
export default function PayrollRunPanel({ employees, projects, costCodes, payPeriods, payrollRules }) {
  const { toast } = useToast();
  const [periodId, setPeriodId] = useState('');
  const [timecards, setTimecards] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [viewingRun, setViewingRun] = useState(null);
  const [runDetail, setRunDetail] = useState(null);

  useEffect(() => { load(); }, []);
  useEffect(() => { if (payPeriods.length > 0 && !periodId) setPeriodId(payPeriods[0].id); }, [payPeriods]);

  const load = async () => {
    setLoading(true);
    try {
      const [tc, r] = await Promise.all([
        db.entities.Timecard.filter({ status: 'approved' }, '-approved_at', 2000),
        db.entities.PayrollRun.list('-run_date', 200),
      ]);
      setTimecards(tc);
      setRuns(r);
    } catch (e) {
      toast({ title: 'Unable to load payroll runs', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const period = payPeriods.find((p) => p.id === periodId) || null;
  const approvedForPeriod = useMemo(() => timecards.filter((t) => t.pay_period_id === periodId), [timecards, periodId]);
  const existingRunForPeriod = runs.find((r) => r.pay_period_id === periodId) || null;
  const employeeName = (id) => employees.find((e) => e.id === id)?.full_name || id;
  const projectLabel = (id) => { const p = projects.find((pr) => pr.id === id); return p ? `${p.project_number} — ${p.name}` : id; };
  const costCodeName = (id) => costCodes.find((c) => c.id === id)?.code_name || id;

  const runPayroll = async () => {
    if (!period || approvedForPeriod.length === 0 || existingRunForPeriod) return;
    setRunning(true);
    const unmappedCostTypes = new Set();
    try {
      const [allTimeEntries, allPayRates, allTaxWithholdings, allDeductions, allGlMappings] = await Promise.all([
        db.entities.TimeEntry.list('-work_date', 5000),
        db.entities.EmployeePayRate.list('-effective_date', 2000),
        db.entities.TaxWithholding.list('-effective_date', 2000),
        db.entities.Deduction.list('priority_order', 2000),
        db.entities.PayrollGLMapping.list('cost_type', 500),
      ]);

      const asOfDate = period.period_end;
      const employerTaxRules = resolveEmployerTaxRules(payrollRules, { asOfDate });

      const lines = [];
      const allocationPayloads = [];
      let totalGross = 0, totalNet = 0, totalEmployerTax = 0;
      const totalEmployeeTaxByJurisdiction = {};
      const totalDeductionsByType = {};
      const totalEmployerTaxByType = {};

      for (const timecard of approvedForPeriod) {
        const employee = employees.find((e) => e.id === timecard.employee_id);
        if (!employee) continue;

        const payRate = allPayRates
          .filter((r) => r.employee_id === employee.id && r.effective_date <= asOfDate && (!r.end_date || r.end_date > asOfDate))
          .sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0] || null;
        if (!payRate) {
          toast({ title: `Skipped ${employee.full_name}`, description: 'No pay rate on file for this period.', variant: 'destructive' });
          continue;
        }

        const entries = allTimeEntries.filter((t) => t.employee_id === employee.id && t.work_date >= period.period_start && t.work_date <= period.period_end);
        const overtimeRule = getEffectiveRule(payrollRules, 'overtime', { asOfDate });
        const doubleTimeRule = getEffectiveRule(payrollRules, 'double_time', { asOfDate });
        const allocations = allocateLaborToJobs(entries, { payRate, overtimeRule, doubleTimeRule, workweekStartDay: period.workweek_start_day });

        const gross = calculateGrossPay(timecard, payRate, payrollRules, { asOfDate, periodFrequency: period.frequency });

        const activeWithholdings = allTaxWithholdings.filter((w) => w.employee_id === employee.id && w.effective_date <= asOfDate);
        const latestByJurisdiction = new Map();
        activeWithholdings.forEach((w) => {
          const existing = latestByJurisdiction.get(w.jurisdiction);
          if (!existing || w.effective_date > existing.effective_date) latestByJurisdiction.set(w.jurisdiction, w);
        });
        const activeDeductions = allDeductions.filter((d) => d.employee_id === employee.id && d.effective_date <= asOfDate && (!d.end_date || d.end_date >= asOfDate));

        const netCalc = calculateTaxesAndDeductions(gross.grossPay, [...latestByJurisdiction.values()], activeDeductions);
        const employerTax = calculateEmployerTax(gross.grossPay, employerTaxRules);
        const employerTaxTotalForEmployee = employerTax.reduce((s, t) => s + t.amount, 0);

        lines.push({
          employee_id: employee.id,
          pay_type_snapshot: payRate.pay_type,
          regular_hours: Number(timecard.total_regular_hours) || 0,
          ot_hours: Number(timecard.total_ot_hours) || 0,
          double_time_hours: Number(timecard.total_double_time_hours) || 0,
          gross_pay: gross.grossPay,
          deductions_total: netCalc.deductionsTotal,
          tax_total: netCalc.taxTotal,
          net_pay: netCalc.netPay,
          _employerTax: employerTax,
          _timecardId: timecard.id,
        });

        allocations.forEach((a) => allocationPayloads.push(a));

        totalGross += gross.grossPay;
        totalNet += netCalc.netPay;
        totalEmployerTax += employerTaxTotalForEmployee;
        netCalc.taxBreakdown.forEach((t) => { totalEmployeeTaxByJurisdiction[t.jurisdiction] = (totalEmployeeTaxByJurisdiction[t.jurisdiction] || 0) + t.amount; });
        netCalc.deductionBreakdown.forEach((d) => { totalDeductionsByType[d.deduction_type] = (totalDeductionsByType[d.deduction_type] || 0) + d.amount; });
        employerTax.forEach((t) => { totalEmployerTaxByType[t.tax_type] = (totalEmployerTaxByType[t.tax_type] || 0) + t.amount; });
      }

      if (lines.length === 0) {
        toast({ title: 'Nothing to run', description: 'No approved timecard had a pay rate on file.', variant: 'destructive' });
        setRunning(false);
        return;
      }

      const run = await db.entities.PayrollRun.create({
        pay_period_id: periodId,
        status: 'review',
        run_date: new Date().toISOString().slice(0, 10),
        total_gross: Math.round(totalGross * 100) / 100,
        total_net: Math.round(totalNet * 100) / 100,
        total_employer_tax: Math.round(totalEmployerTax * 100) / 100,
      });

      const createdLines = await db.entities.PayrollLine.bulkCreate(lines.map(({ _employerTax, _timecardId, ...line }) => ({ ...line, payroll_run_id: run.id })));

      const employerTaxPayloads = [];
      lines.forEach((line) => {
        line._employerTax.forEach((t) => employerTaxPayloads.push({ payroll_run_id: run.id, employee_id: line.employee_id, tax_type: t.tax_type, amount: t.amount }));
      });
      if (employerTaxPayloads.length > 0) await db.entities.EmployerTax.bulkCreate(employerTaxPayloads);

      // Job costing — one JobLaborAllocation + one JobCostLedgerEntry per
      // TimeEntry, tied to the real cost_code, so estimated vs actual labor
      // is comparable per job/phase/area immediately.
      const createdAllocations = await db.entities.JobLaborAllocation.bulkCreate(allocationPayloads.map((a) => ({ ...a, payroll_run_id: run.id })));
      await Promise.all(createdAllocations.map(async (alloc) => {
        const code = costCodes.find((c) => c.id === alloc.cost_code_id);
        if (!code) unmappedCostTypes.add(`cost_code:${alloc.cost_code_id}`);
        const entry = await db.entities.JobCostLedgerEntry.create({
          project_id: alloc.project_id,
          cost_code: code?.code_name || alloc.cost_code_id,
          cost_class: 'LAB',
          amount: alloc.labor_cost,
          transaction_date: period.period_end,
          source_type: 'labor',
          source_id: alloc.id,
          description: `Payroll ${period.period_start} – ${period.period_end}: ${alloc.regular_hours}reg/${alloc.ot_hours}OT/${alloc.double_time_hours}DT hrs${alloc.phase_id ? ` · ${alloc.phase_id}` : ''}${alloc.area_id ? ` · ${alloc.area_id}` : ''}`,
        });
        await db.entities.JobLaborAllocation.update(alloc.id, { posted_to_job_cost: true, job_cost_ledger_entry_id: entry.id });
      }));

      // Liabilities — everything withheld/accrued that must be remitted out.
      const liabilityTotals = {};
      Object.entries(totalEmployeeTaxByJurisdiction).forEach(([j, amt]) => {
        const type = TAX_JURISDICTION_TO_LIABILITY[j] || 'other';
        liabilityTotals[type] = (liabilityTotals[type] || 0) + amt;
      });
      Object.entries(totalEmployerTaxByType).forEach(([t, amt]) => { liabilityTotals[t] = (liabilityTotals[t] || 0) + amt; });
      Object.entries(totalDeductionsByType).forEach(([t, amt]) => {
        const type = DEDUCTION_TYPE_TO_LIABILITY[t] || 'other';
        liabilityTotals[type] = (liabilityTotals[type] || 0) + amt;
      });
      const liabilityPayloads = Object.entries(liabilityTotals)
        .filter(([, amt]) => amt > 0)
        .map(([liability_type, amount]) => ({ payroll_run_id: run.id, liability_type, amount: Math.round(amount * 100) / 100, status: 'unpaid' }));
      if (liabilityPayloads.length > 0) await db.entities.PayrollLiability.bulkCreate(liabilityPayloads);

      // Journal — debits (gross wages expense + employer payroll tax
      // expense) always equal credits (tax liability + benefits liability +
      // net pay/other-deduction liability): gross + employerTax on one side,
      // (employeeTax + employerTax) + benefits + (net + garnishment/other)
      // algebraically reduces to the same total on the other, since
      // net = gross - employeeTax - allDeductions.
      const resolveOrFlag = (costType) => {
        const account = resolveGLAccount(allGlMappings, costType);
        if (account) return account;
        unmappedCostTypes.add(costType);
        return `UNMAPPED-${costType}`;
      };
      const laborGl = resolveOrFlag('labor');
      const taxGl = resolveOrFlag('tax_liability');
      const benefitsGl = resolveOrFlag('benefits');
      const accrualGl = resolveOrFlag('accrual');

      const employeeTaxTotal = Object.values(totalEmployeeTaxByJurisdiction).reduce((s, v) => s + v, 0);
      const benefitsTotal = totalDeductionsByType.benefits || 0;
      const otherPayableDeductions = (totalDeductionsByType.garnishment || 0) + (totalDeductionsByType.other || 0);

      const round2 = (n) => Math.round(n * 100) / 100;
      const journalPayloads = [
        { gl_account: laborGl, debit: round2(totalGross), credit: 0, description: 'Gross wages expense' },
        { gl_account: taxGl, debit: round2(totalEmployerTax), credit: 0, description: 'Employer payroll tax expense' },
        { gl_account: taxGl, debit: 0, credit: round2(employeeTaxTotal + totalEmployerTax), description: 'Payroll tax liability (employee withheld + employer)' },
        { gl_account: benefitsGl, debit: 0, credit: round2(benefitsTotal), description: 'Benefit deductions liability' },
        { gl_account: accrualGl, debit: 0, credit: round2(totalNet + otherPayableDeductions), description: 'Net pay + garnishment/other deductions payable' },
      ].filter((j) => j.debit > 0 || j.credit > 0);
      await db.entities.PayrollJournal.bulkCreate(journalPayloads.map((j) => ({ ...j, payroll_run_id: run.id })));

      if (unmappedCostTypes.size > 0) {
        toast({ title: 'Some GL accounts are unmapped', description: `Set them up in Payroll Setup → GL Mappings: ${[...unmappedCostTypes].join(', ')}`, variant: 'destructive' });
      }

      setRuns((prev) => [run, ...prev]);
      toast({ title: `Payroll run created — ${createdLines.length} employee(s)`, description: `Gross ${money(totalGross)} · Net ${money(totalNet)} · in review` });
    } catch (e) {
      console.error(e);
      toast({ title: 'Unable to run payroll', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const openRunDetail = async (run) => {
    setViewingRun(run);
    setRunDetail(null);
    try {
      const [lines, employerTax, liabilities, journal] = await Promise.all([
        db.entities.PayrollLine.filter({ payroll_run_id: run.id }, '-created_date', 500),
        db.entities.EmployerTax.filter({ payroll_run_id: run.id }, '-created_date', 500),
        db.entities.PayrollLiability.filter({ payroll_run_id: run.id }, '-created_date', 100),
        db.entities.PayrollJournal.filter({ payroll_run_id: run.id }, '-created_date', 100),
      ]);
      setRunDetail({ lines, employerTax, liabilities, journal });
    } catch (e) {
      toast({ title: 'Unable to load run detail', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={periodId} onValueChange={setPeriodId}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Select a pay period" /></SelectTrigger>
          <SelectContent>
            {payPeriods.map((p) => <SelectItem key={p.id} value={p.id}>{p.period_start} — {p.period_end}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button className="gap-2 steel-gradient text-white border-0" disabled={!period || approvedForPeriod.length === 0 || !!existingRunForPeriod || running} onClick={runPayroll}>
          <PlayCircle className="w-4 h-4" />{running ? 'Running…' : 'Run Payroll'}
        </Button>
        {period && (
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" />{approvedForPeriod.length} approved timecard{approvedForPeriod.length === 1 ? '' : 's'} for this period
          </span>
        )}
      </div>

      {existingRunForPeriod && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />A run already exists for this pay period — view it below rather than running again.
        </div>
      )}

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-2 px-3">Run Date</th>
                <th className="text-left py-2 px-3">Pay Period</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-right py-2 px-3">Gross</th>
                <th className="text-right py-2 px-3">Net</th>
                <th className="text-right py-2 px-3">Employer Tax</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
              ) : runs.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No payroll runs yet</td></tr>
              ) : runs.map((r) => {
                const p = payPeriods.find((pp) => pp.id === r.pay_period_id);
                return (
                  <tr key={r.id} onClick={() => openRunDetail(r)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                    <td className="py-2 px-3 font-medium">{r.run_date}</td>
                    <td className="py-2 px-3 text-muted-foreground">{p ? `${p.period_start} — ${p.period_end}` : r.pay_period_id}</td>
                    <td className="py-2 px-3">{titleCase(r.status)}</td>
                    <td className="py-2 px-3 text-right font-mono">{money(r.total_gross)}</td>
                    <td className="py-2 px-3 text-right font-mono">{money(r.total_net)}</td>
                    <td className="py-2 px-3 text-right font-mono">{money(r.total_employer_tax)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!viewingRun} onOpenChange={(o) => !o && setViewingRun(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Payroll Run — {viewingRun?.run_date} ({titleCase(viewingRun?.status)})</DialogTitle></DialogHeader>
          {!runDetail ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold mb-2">Payroll Lines</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="text-left py-1.5 pr-3">Employee</th>
                        <th className="text-right py-1.5 pr-3">Reg</th>
                        <th className="text-right py-1.5 pr-3">OT</th>
                        <th className="text-right py-1.5 pr-3">Gross</th>
                        <th className="text-right py-1.5 pr-3">Tax</th>
                        <th className="text-right py-1.5 pr-3">Deductions</th>
                        <th className="text-right py-1.5 pr-3">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runDetail.lines.map((l) => (
                        <tr key={l.id} className="border-b border-border/50">
                          <td className="py-1.5 pr-3 font-medium">{employeeName(l.employee_id)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{l.regular_hours.toFixed(2)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{l.ot_hours.toFixed(2)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{money(l.gross_pay)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{money(l.tax_total)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{money(l.deductions_total)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono font-semibold">{money(l.net_pay)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-semibold mb-2">Liabilities</h4>
                  <div className="space-y-1 text-sm">
                    {runDetail.liabilities.map((l) => (
                      <div key={l.id} className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">{titleCase(l.liability_type)}</span><span className="font-mono">{money(l.amount)}</span></div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold mb-2">Journal</h4>
                  <div className="space-y-1 text-sm">
                    {runDetail.journal.map((j) => (
                      <div key={j.id} className="flex justify-between border-b border-border/50 py-1 gap-2">
                        <span className="text-muted-foreground truncate" title={j.description}>{j.gl_account}</span>
                        <span className="font-mono flex-shrink-0">{j.debit > 0 ? `Dr ${money(j.debit)}` : `Cr ${money(j.credit)}`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
