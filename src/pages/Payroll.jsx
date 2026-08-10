import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/api/apiClient';
import { DollarSign, Plus, Lock, Download, Landmark, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';
import { normalizeRoleName } from '@/components/dashboard/rbacConfig';
import { computeOvertimeForClockOut } from '@/lib/attendanceMath';
import { exportPayrollRegisterCSV } from '@/lib/payrollExport';

const ALLOWED_ROLES = ['admin', 'super_admin', 'payroll_admin', 'controller'];

const PERIODS_PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

const PERIOD_STATUS_STYLES = {
  open: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  locked: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  exported: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  posted: 'bg-green-500/10 text-green-600 border-green-500/20',
};

const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);
const dollars = (cents) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;

const emptyPeriodForm = () => ({ period_start: '', period_end: '', pay_date: '', frequency: 'biweekly' });

// Sums a shift's regular/overtime minutes by re-running the shared daily
// 8hr/weekly 40hr split (attendanceMath.js) against the employee's FULL
// punch history for every Clock_Out that lands in the period — demo-seeded
// punches hardcode total_regular_minutes with no OT ever applied, so this
// can't just trust what's already stored on the punch.
function computePeriodMinutesForEmployee(employeeId, allEmployeePunches, periodStart, periodEnd) {
  const startMs = new Date(`${periodStart}T00:00:00`).getTime();
  const endMs = new Date(`${periodEnd}T23:59:59`).getTime();
  let regularMinutes = 0;
  let overtimeMinutes = 0;
  let totalMinutes = 0;
  const projectMinutes = {};

  allEmployeePunches
    .filter((p) => p.punch_type === 'Clock_Out')
    .forEach((p) => {
      const t = new Date(p.punch_time).getTime();
      if (Number.isNaN(t) || t < startMs || t > endMs) return;
      const { total_regular_minutes, total_overtime_minutes } = computeOvertimeForClockOut(employeeId, p.punch_time, allEmployeePunches);
      regularMinutes += total_regular_minutes;
      overtimeMinutes += total_overtime_minutes;
      const shiftMinutes = total_regular_minutes + total_overtime_minutes;
      totalMinutes += shiftMinutes;
      const key = p.project_id || '';
      projectMinutes[key] = (projectMinutes[key] || 0) + shiftMinutes;
    });

  return { regularMinutes, overtimeMinutes, totalMinutes, projectMinutes };
}

export default function Payroll() {
  const { toast } = useToast();
  const [accessChecked, setAccessChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);

  const [loading, setLoading] = useState(true);
  const [payPeriods, setPayPeriods] = useState([]);
  const [allRegisterLines, setAllRegisterLines] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [allPunches, setAllPunches] = useState([]);
  const [projects, setProjects] = useState([]);

  const [activeTab, setActiveTab] = useState('periods');
  const [selectedPeriodId, setSelectedPeriodId] = useState(null);

  const [newPeriodOpen, setNewPeriodOpen] = useState(false);
  const [newPeriodForm, setNewPeriodForm] = useState(emptyPeriodForm());
  const [creatingPeriod, setCreatingPeriod] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [locking, setLocking] = useState(false);
  const [posting, setPosting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const me = await db.auth.me();
        const roles = me?.roles || me?.user?.roles || ['user'];
        setAllowed(roles.some((r) => ALLOWED_ROLES.includes(normalizeRoleName(r))));
      } catch (e) {
        setAllowed(false);
      } finally {
        setAccessChecked(true);
      }
    };
    checkAccess();
  }, []);

  useEffect(() => {
    if (accessChecked && allowed) loadData();
  }, [accessChecked, allowed]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [periods, lines, emps, punches, projList] = await Promise.all([
        db.entities.PayPeriod.list('-period_start', 200),
        db.entities.PayrollRegisterLine.list('-created_date', 2000),
        db.entities.employees.filter({ is_active: true }, 'full_name', 500),
        db.entities.attendance_punches.list('-punch_time', 3000),
        db.entities.Project.list('name', 300),
      ]);
      setPayPeriods(periods);
      setAllRegisterLines(lines);
      setEmployees(emps);
      setAllPunches(punches);
      setProjects(projList);
    } catch (e) {
      console.error('Failed to load payroll data', e);
      toast({ title: 'Failed to load payroll data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const employeesById = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
  const projectsById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

  const selectedPeriod = useMemo(() => payPeriods.find((p) => p.id === selectedPeriodId) || null, [payPeriods, selectedPeriodId]);
  const registerLines = useMemo(() => allRegisterLines.filter((l) => l.pay_period_id === selectedPeriodId), [allRegisterLines, selectedPeriodId]);
  const isReadOnly = !!selectedPeriod && selectedPeriod.status !== 'open';

  const periodStats = (periodId) => {
    const lines = allRegisterLines.filter((l) => l.pay_period_id === periodId);
    return { grossTotal: lines.reduce((s, l) => s + (l.gross_pay_cents || 0), 0), employeeCount: lines.length };
  };

  const openPeriod = (period) => {
    setSelectedPeriodId(period.id);
    setActiveTab('register');
  };

  const handleCreatePeriod = async () => {
    if (!newPeriodForm.period_start || !newPeriodForm.period_end) {
      toast({ title: 'Start and end dates are required', variant: 'destructive' });
      return;
    }
    setCreatingPeriod(true);
    try {
      const created = await db.entities.PayPeriod.create({ ...newPeriodForm, status: 'open' });
      setPayPeriods((prev) => [created, ...prev]);
      setNewPeriodOpen(false);
      setNewPeriodForm(emptyPeriodForm());
      toast({ title: 'Pay period created' });
    } catch (e) {
      toast({ title: 'Unable to create pay period', variant: 'destructive' });
    } finally {
      setCreatingPeriod(false);
    }
  };

  // ============ Register generation ============
  const handleGenerateRegister = async () => {
    if (!selectedPeriod || selectedPeriod.status !== 'open') return;
    setGenerating(true);
    try {
      const lines = employees.map((emp) => {
        const empPunches = allPunches.filter((p) => p.employee_id === emp.id);
        const { regularMinutes, overtimeMinutes } = computePeriodMinutesForEmployee(emp.id, empPunches, selectedPeriod.period_start, selectedPeriod.period_end);
        const payType = emp.pay_type || 'hourly';
        const exempt = !!emp.is_flsa_exempt;
        const otMultiplier = Number(emp.ot_multiplier) || 1.5;
        const regularHours = Math.round((regularMinutes / 60) * 100) / 100;
        let otHours = exempt ? 0 : Math.round((overtimeMinutes / 60) * 100) / 100;

        let regularPayCents = 0;
        let otPayCents = 0;
        let grossPayCents = 0;

        if (payType === 'salary') {
          const periodsPerYear = PERIODS_PER_YEAR[selectedPeriod.frequency] || 26;
          grossPayCents = Math.round((Number(emp.annual_salary_cents) || 0) / periodsPerYear);
          regularPayCents = grossPayCents;
          otHours = 0;
          otPayCents = 0;
        } else {
          const rate = Number(emp.pay_rate_cents) || 0;
          regularPayCents = Math.round(regularHours * rate);
          otPayCents = exempt ? 0 : Math.round(otHours * rate * otMultiplier);
          grossPayCents = regularPayCents + otPayCents;
        }

        return {
          pay_period_id: selectedPeriod.id,
          employee_id: emp.id,
          employee_name: emp.full_name,
          pay_type_snapshot: payType,
          regular_hours: regularHours,
          ot_hours: otHours,
          regular_pay_cents: regularPayCents,
          ot_pay_cents: otPayCents,
          gross_pay_cents: grossPayCents,
          posted_to_job_cost: false,
          job_cost_entry_ids: [],
        };
      });

      const existing = allRegisterLines.filter((l) => l.pay_period_id === selectedPeriod.id);
      await Promise.all(existing.map((l) => db.entities.PayrollRegisterLine.delete(l.id)));
      const created = await db.entities.PayrollRegisterLine.bulkCreate(lines);
      setAllRegisterLines((prev) => [...prev.filter((l) => l.pay_period_id !== selectedPeriod.id), ...created]);
      toast({ title: 'Register generated', description: `${created.length} employee(s)` });
    } catch (e) {
      toast({ title: 'Unable to generate register', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const recomputeLine = (line, emp) => {
    const updated = { ...line };
    if (line.pay_type_snapshot === 'salary') {
      updated.ot_hours = 0;
      updated.ot_pay_cents = 0;
      updated.gross_pay_cents = updated.regular_pay_cents;
    } else {
      const rate = Number(emp?.pay_rate_cents) || 0;
      const otMultiplier = Number(emp?.ot_multiplier) || 1.5;
      const exempt = !!emp?.is_flsa_exempt;
      const otHours = exempt ? 0 : (Number(updated.ot_hours) || 0);
      updated.ot_hours = otHours;
      updated.regular_pay_cents = Math.round((Number(updated.regular_hours) || 0) * rate);
      updated.ot_pay_cents = Math.round(otHours * rate * otMultiplier);
      updated.gross_pay_cents = updated.regular_pay_cents + updated.ot_pay_cents;
    }
    return updated;
  };

  const handleLineFieldChange = (lineId, field, value) => {
    setAllRegisterLines((prev) => prev.map((l) => {
      if (l.id !== lineId) return l;
      const draft = { ...l, [field]: Number(value) || 0 };
      return recomputeLine(draft, employeesById[l.employee_id]);
    }));
  };

  const handleLineBlur = async (line) => {
    if (isReadOnly) return;
    try {
      const updated = await db.entities.PayrollRegisterLine.update(line.id, {
        regular_hours: line.regular_hours,
        ot_hours: line.ot_hours,
        regular_pay_cents: line.regular_pay_cents,
        ot_pay_cents: line.ot_pay_cents,
        gross_pay_cents: line.gross_pay_cents,
      });
      setAllRegisterLines((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } catch (e) {
      toast({ title: 'Unable to save register line', variant: 'destructive' });
    }
  };

  const handleLockPeriod = async () => {
    if (!selectedPeriod || selectedPeriod.status !== 'open' || registerLines.length === 0) return;
    setLocking(true);
    try {
      const updated = await db.entities.PayPeriod.update(selectedPeriod.id, { status: 'locked', locked_at: new Date().toISOString() });
      setPayPeriods((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast({ title: 'Pay period locked' });
    } catch (e) {
      toast({ title: 'Unable to lock pay period', variant: 'destructive' });
    } finally {
      setLocking(false);
    }
  };

  // ============ Provider export ============
  const handleExport = async () => {
    if (!selectedPeriod || selectedPeriod.status !== 'locked') return;
    setExporting(true);
    try {
      exportPayrollRegisterCSV(selectedPeriod, registerLines, employees);
      const updated = await db.entities.PayPeriod.update(selectedPeriod.id, { status: 'exported', exported_at: new Date().toISOString() });
      setPayPeriods((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast({ title: 'Register exported' });
    } catch (e) {
      toast({ title: 'Unable to export register', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  // ============ Job cost posting ============
  const jobCostPreview = useMemo(() => {
    if (!selectedPeriod || registerLines.length === 0) return [];
    const totals = {};
    registerLines.forEach((line) => {
      const emp = employeesById[line.employee_id];
      if (!emp) return;
      const empPunches = allPunches.filter((p) => p.employee_id === emp.id);
      const { totalMinutes, projectMinutes } = computePeriodMinutesForEmployee(emp.id, empPunches, selectedPeriod.period_start, selectedPeriod.period_end);
      if (totalMinutes <= 0) return;
      Object.entries(projectMinutes).forEach(([projectId, minutes]) => {
        if (!projectId) return;
        const share = minutes / totalMinutes;
        const projDollars = (line.gross_pay_cents * share) / 100;
        if (!totals[projectId]) totals[projectId] = { hours: 0, dollars: 0 };
        totals[projectId].hours += minutes / 60;
        totals[projectId].dollars += projDollars;
      });
    });
    return Object.entries(totals).map(([projectId, v]) => ({ projectId, hours: v.hours, dollars: v.dollars }));
  }, [selectedPeriod, registerLines, allPunches, employeesById]);

  const handlePostLaborToJobCost = async () => {
    if (!selectedPeriod || selectedPeriod.status === 'posted') return;
    if (selectedPeriod.status !== 'locked' && selectedPeriod.status !== 'exported') return;
    if (jobCostPreview.length === 0) {
      toast({ title: 'Nothing to post', description: 'No project-tagged hours in this period.', variant: 'destructive' });
      return;
    }
    setPosting(true);
    try {
      const createdEntries = await Promise.all(jobCostPreview.map((row) => db.entities.JobCostLedgerEntry.create({
        project_id: row.projectId,
        cost_class: 'LAB',
        cost_code: 'LAB-001',
        amount: Math.round(row.dollars * 100) / 100,
        transaction_date: selectedPeriod.period_end,
        source_type: 'labor',
        source_id: selectedPeriod.id,
        description: `Payroll ${selectedPeriod.period_start} to ${selectedPeriod.period_end}`,
      })));
      const entryIdByProject = {};
      jobCostPreview.forEach((row, i) => { entryIdByProject[row.projectId] = createdEntries[i].id; });

      const updatedLines = await Promise.all(registerLines.map(async (line) => {
        const emp = employeesById[line.employee_id];
        if (!emp) return line;
        const empPunches = allPunches.filter((p) => p.employee_id === emp.id);
        const { projectMinutes } = computePeriodMinutesForEmployee(emp.id, empPunches, selectedPeriod.period_start, selectedPeriod.period_end);
        const relevantEntryIds = Object.keys(projectMinutes).filter((pid) => pid && entryIdByProject[pid]).map((pid) => entryIdByProject[pid]);
        if (relevantEntryIds.length === 0) return line;
        return db.entities.PayrollRegisterLine.update(line.id, { posted_to_job_cost: true, job_cost_entry_ids: relevantEntryIds });
      }));
      setAllRegisterLines((prev) => prev.map((l) => updatedLines.find((u) => u.id === l.id) || l));

      const updatedPeriod = await db.entities.PayPeriod.update(selectedPeriod.id, { status: 'posted' });
      setPayPeriods((prev) => prev.map((p) => (p.id === updatedPeriod.id ? updatedPeriod : p)));
      toast({ title: `Posted labor to ${jobCostPreview.length} project(s)` });
    } catch (e) {
      toast({ title: 'Unable to post labor to job cost', variant: 'destructive' });
    } finally {
      setPosting(false);
    }
  };

  if (!accessChecked) {
    return <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>;
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="steel-card p-8 text-center max-w-md mx-auto mt-12">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">Access Restricted</h2>
          <p className="text-sm text-muted-foreground">Payroll and salary data is only available to Admin, Payroll Admin, and Controller roles.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader title="Payroll" subtitle="Pay periods, payroll register, job cost posting, and provider export" icon={DollarSign} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="periods">Pay Periods</TabsTrigger>
          <TabsTrigger value="register" disabled={!selectedPeriod}>Register</TabsTrigger>
          <TabsTrigger value="jobcost" disabled={!selectedPeriod}>Job Cost Posting</TabsTrigger>
        </TabsList>

        {/* ============ TAB 1 — Pay Periods ============ */}
        <TabsContent value="periods">
          <div className="flex justify-end mb-4">
            <Dialog open={newPeriodOpen} onOpenChange={setNewPeriodOpen}>
              <DialogTrigger asChild>
                <Button className="steel-gradient text-white border-0"><Plus className="w-4 h-4 mr-2" />New Pay Period</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Pay Period</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Period Start *</Label><Input type="date" value={newPeriodForm.period_start} onChange={(e) => setNewPeriodForm((f) => ({ ...f, period_start: e.target.value }))} className="mt-1" /></div>
                    <div><Label>Period End *</Label><Input type="date" value={newPeriodForm.period_end} onChange={(e) => setNewPeriodForm((f) => ({ ...f, period_end: e.target.value }))} className="mt-1" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Pay Date</Label><Input type="date" value={newPeriodForm.pay_date} onChange={(e) => setNewPeriodForm((f) => ({ ...f, pay_date: e.target.value }))} className="mt-1" /></div>
                    <div>
                      <Label>Frequency</Label>
                      <Select value={newPeriodForm.frequency} onValueChange={(v) => setNewPeriodForm((f) => ({ ...f, frequency: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.keys(PERIODS_PER_YEAR).map((f) => <SelectItem key={f} value={f}>{titleCase(f)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button onClick={handleCreatePeriod} disabled={creatingPeriod || !newPeriodForm.period_start || !newPeriodForm.period_end} className="w-full steel-gradient text-white border-0">
                    {creatingPeriod ? 'Creating...' : 'Create Pay Period'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="steel-card overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-2 px-3">Period</th>
                  <th className="text-left py-2 px-3">Pay Date</th>
                  <th className="text-left py-2 px-3">Frequency</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-right py-2 px-3">Employees</th>
                  <th className="text-right py-2 px-3">Gross Total</th>
                </tr>
              </thead>
              <tbody>
                {payPeriods.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-sm text-muted-foreground">No pay periods yet</td></tr>
                ) : payPeriods.map((p) => {
                  const stats = periodStats(p.id);
                  return (
                    <tr key={p.id} onClick={() => openPeriod(p)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                      <td className="py-2 px-3 font-medium">{p.period_start} — {p.period_end}</td>
                      <td className="py-2 px-3 text-muted-foreground">{p.pay_date || '—'}</td>
                      <td className="py-2 px-3">{titleCase(p.frequency)}</td>
                      <td className="py-2 px-3"><span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${PERIOD_STATUS_STYLES[p.status] || PERIOD_STATUS_STYLES.open}`}>{titleCase(p.status)}</span></td>
                      <td className="py-2 px-3 text-right">{stats.employeeCount}</td>
                      <td className="py-2 px-3 text-right font-mono">{dollars(stats.grossTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ============ TAB 2 — Register ============ */}
        <TabsContent value="register">
          {selectedPeriod && (
            <div className="space-y-4">
              <div className="steel-card p-4 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="font-semibold">{selectedPeriod.period_start} — {selectedPeriod.period_end}</p>
                  <p className="text-xs text-muted-foreground">{titleCase(selectedPeriod.frequency)} · Pay date {selectedPeriod.pay_date || '—'}</p>
                </div>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${PERIOD_STATUS_STYLES[selectedPeriod.status] || PERIOD_STATUS_STYLES.open}`}>{titleCase(selectedPeriod.status)}</span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={handleGenerateRegister} disabled={isReadOnly || generating} variant="outline">
                  {generating ? 'Generating...' : 'Generate Register'}
                </Button>
                <Button onClick={handleLockPeriod} disabled={selectedPeriod.status !== 'open' || registerLines.length === 0 || locking} className="steel-gradient text-white border-0">
                  <Lock className="w-4 h-4 mr-2" />{locking ? 'Locking...' : 'Lock Period'}
                </Button>
                <Button onClick={handleExport} disabled={selectedPeriod.status !== 'locked' || exporting} variant="outline">
                  <Download className="w-4 h-4 mr-2" />{exporting ? 'Exporting...' : 'Export for Payroll Provider'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Import this file into your payroll provider (Gusto, ADP, Paychex). Direct API sync requires a server-side connection and is not yet configured.</p>

              <div className="steel-card overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left py-2 px-3">Employee</th>
                      <th className="text-left py-2 px-3">Pay Type</th>
                      <th className="text-right py-2 px-3">Reg. Hours</th>
                      <th className="text-right py-2 px-3">OT Hours</th>
                      <th className="text-right py-2 px-3">Reg. Pay</th>
                      <th className="text-right py-2 px-3">OT Pay</th>
                      <th className="text-right py-2 px-3">Gross Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registerLines.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-12 text-sm text-muted-foreground">No register generated yet for this period</td></tr>
                    ) : registerLines.map((line) => {
                      const emp = employeesById[line.employee_id];
                      const exempt = !!emp?.is_flsa_exempt;
                      return (
                        <tr key={line.id} className="border-b border-border/50">
                          <td className="py-2 px-3 font-medium">
                            {line.employee_name}
                            {exempt && <span className="ml-2 text-[11px] text-muted-foreground">(Exempt)</span>}
                          </td>
                          <td className="py-2 px-3">{titleCase(line.pay_type_snapshot)}</td>
                          <td className="py-2 px-3 text-right">
                            <Input
                              type="number" step="0.01" value={line.regular_hours}
                              disabled={isReadOnly || line.pay_type_snapshot === 'salary'}
                              onChange={(e) => handleLineFieldChange(line.id, 'regular_hours', e.target.value)}
                              onBlur={() => handleLineBlur(allRegisterLines.find((l) => l.id === line.id))}
                              className="w-24 text-right ml-auto"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <Input
                              type="number" step="0.01" value={line.ot_hours}
                              disabled={isReadOnly || exempt || line.pay_type_snapshot === 'salary'}
                              onChange={(e) => handleLineFieldChange(line.id, 'ot_hours', e.target.value)}
                              onBlur={() => handleLineBlur(allRegisterLines.find((l) => l.id === line.id))}
                              className="w-24 text-right ml-auto"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-mono">{dollars(line.regular_pay_cents)}</td>
                          <td className="py-2 px-3 text-right font-mono">{dollars(line.ot_pay_cents)}</td>
                          <td className="py-2 px-3 text-right font-mono font-semibold">{dollars(line.gross_pay_cents)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ============ TAB 3 — Job Cost Posting ============ */}
        <TabsContent value="jobcost">
          {selectedPeriod && (
            <div className="space-y-4">
              <div className="steel-card p-4 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="font-semibold">{selectedPeriod.period_start} — {selectedPeriod.period_end}</p>
                  <p className="text-xs text-muted-foreground">Labor dollars prorated by each employee's punched hours per project.</p>
                </div>
                <Button
                  onClick={handlePostLaborToJobCost}
                  disabled={(selectedPeriod.status !== 'locked' && selectedPeriod.status !== 'exported') || posting}
                  className="steel-gradient text-white border-0"
                >
                  <Landmark className="w-4 h-4 mr-2" />{posting ? 'Posting...' : 'Post Labor to Job Cost'}
                </Button>
              </div>

              {selectedPeriod.status === 'posted' && (
                <p className="text-sm text-green-600">Labor already posted to job cost for this period.</p>
              )}

              <div className="steel-card overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left py-2 px-3">Project</th>
                      <th className="text-right py-2 px-3">Hours</th>
                      <th className="text-right py-2 px-3">Labor Dollars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobCostPreview.length === 0 ? (
                      <tr><td colSpan={3} className="text-center py-12 text-sm text-muted-foreground">No project-tagged hours to post for this period</td></tr>
                    ) : jobCostPreview.map((row) => (
                      <tr key={row.projectId} className="border-b border-border/50">
                        <td className="py-2 px-3">{projectsById[row.projectId] ? `${projectsById[row.projectId].project_number} — ${projectsById[row.projectId].name}` : row.projectId}</td>
                        <td className="py-2 px-3 text-right">{row.hours.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right font-mono">{dollars(Math.round(row.dollars * 100))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
