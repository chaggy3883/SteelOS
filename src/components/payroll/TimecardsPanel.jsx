import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { RefreshCw, Send, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { getEffectiveRule } from '@/lib/payrollRules';
import { allocateLaborToJobs } from '@/lib/payrollEngine';

const STATUS_STYLES = {
  unsubmitted: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  submitted: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  approved: 'bg-green-500/10 text-green-600 border-green-500/20',
};
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);

// Timecards roll up an employee's TimeEntry rows for a pay period into the
// regular/OT/double-time totals PayrollLine will price — computed with the
// exact same allocateLaborToJobs() split the payroll run itself uses, so a
// timecard's totals and what the run actually pays never disagree.
export default function TimecardsPanel({ employees, payPeriods, payrollRules }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [timecards, setTimecards] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [payRates, setPayRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [periodId, setPeriodId] = useState('');
  const [busyEmployeeId, setBusyEmployeeId] = useState(null);

  useEffect(() => { load(); }, []);
  useEffect(() => { if (payPeriods.length > 0 && !periodId) setPeriodId(payPeriods[0].id); }, [payPeriods]);

  const load = async () => {
    setLoading(true);
    try {
      const [tc, te, rates] = await Promise.all([
        db.entities.Timecard.list('-approved_at', 2000),
        db.entities.TimeEntry.list('-work_date', 5000),
        db.entities.EmployeePayRate.list('-effective_date', 2000),
      ]);
      setTimecards(tc);
      setTimeEntries(te);
      setPayRates(rates);
    } catch (e) {
      toast({ title: 'Unable to load timecards', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const period = payPeriods.find((p) => p.id === periodId) || null;
  const activeEmployees = useMemo(() => [...employees].filter((e) => e.is_active).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')), [employees]);

  const currentRateFor = (employeeId, asOfDate) => payRates
    .filter((r) => r.employee_id === employeeId && r.effective_date <= asOfDate && (!r.end_date || r.end_date > asOfDate))
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0] || null;

  const entriesForEmployeeInPeriod = (employeeId) => {
    if (!period) return [];
    return timeEntries.filter((t) => t.employee_id === employeeId && t.work_date >= period.period_start && t.work_date <= period.period_end);
  };

  const timecardFor = (employeeId) => timecards.find((t) => t.employee_id === employeeId && t.pay_period_id === periodId) || null;

  const generateTimecard = async (employee) => {
    if (!period) return;
    setBusyEmployeeId(employee.id);
    try {
      const entries = entriesForEmployeeInPeriod(employee.id);
      const payRate = currentRateFor(employee.id, period.period_end);
      const overtimeRule = getEffectiveRule(payrollRules, 'overtime', { asOfDate: period.period_end });
      const doubleTimeRule = getEffectiveRule(payrollRules, 'double_time', { asOfDate: period.period_end });
      const allocations = allocateLaborToJobs(entries, { payRate, overtimeRule, doubleTimeRule, workweekStartDay: period.workweek_start_day });

      const totals = allocations.reduce((acc, a) => ({
        total_regular_hours: acc.total_regular_hours + a.regular_hours,
        total_ot_hours: acc.total_ot_hours + a.ot_hours,
        total_double_time_hours: acc.total_double_time_hours + a.double_time_hours,
      }), { total_regular_hours: 0, total_ot_hours: 0, total_double_time_hours: 0 });

      const existing = timecardFor(employee.id);
      let saved;
      if (existing) {
        if (existing.status === 'approved') {
          toast({ title: 'Timecard already approved', description: 'Un-approve is a Part C control action, not available here.', variant: 'destructive' });
          return;
        }
        saved = await db.entities.Timecard.update(existing.id, totals);
      } else {
        saved = await db.entities.Timecard.create({ employee_id: employee.id, pay_period_id: periodId, status: 'unsubmitted', ...totals });
      }
      setTimecards((prev) => [...prev.filter((t) => t.id !== saved.id), saved]);
      toast({ title: `Timecard updated for ${employee.full_name}`, description: `${totals.total_regular_hours.toFixed(2)} reg / ${totals.total_ot_hours.toFixed(2)} OT hours` });
    } catch (e) {
      toast({ title: 'Unable to generate timecard', variant: 'destructive' });
    } finally {
      setBusyEmployeeId(null);
    }
  };

  const submitTimecard = async (timecard) => {
    setBusyEmployeeId(timecard.employee_id);
    try {
      const updated = await db.entities.Timecard.update(timecard.id, { status: 'submitted' });
      setTimecards((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (e) {
      toast({ title: 'Unable to submit timecard', variant: 'destructive' });
    } finally {
      setBusyEmployeeId(null);
    }
  };

  const approveTimecard = async (timecard) => {
    setBusyEmployeeId(timecard.employee_id);
    try {
      const updated = await db.entities.Timecard.update(timecard.id, {
        status: 'approved', approved_by: user?.full_name || user?.email || 'Unknown', approved_at: new Date().toISOString(),
      });
      setTimecards((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (e) {
      toast({ title: 'Unable to approve timecard', variant: 'destructive' });
    } finally {
      setBusyEmployeeId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Select value={periodId} onValueChange={setPeriodId}>
        <SelectTrigger className="w-72"><SelectValue placeholder="Select a pay period" /></SelectTrigger>
        <SelectContent>
          {payPeriods.map((p) => <SelectItem key={p.id} value={p.id}>{p.period_start} — {p.period_end}</SelectItem>)}
        </SelectContent>
      </Select>

      {!period ? (
        <div className="steel-card p-8 text-center text-sm text-muted-foreground">Add a pay period on the calendar first.</div>
      ) : (
        <div className="steel-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-2 px-3">Employee</th>
                  <th className="text-right py-2 px-3">Entries</th>
                  <th className="text-right py-2 px-3">Reg Hrs</th>
                  <th className="text-right py-2 px-3">OT Hrs</th>
                  <th className="text-right py-2 px-3">DT Hrs</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-right py-2 px-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
                ) : activeEmployees.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No active employees</td></tr>
                ) : activeEmployees.map((emp) => {
                  const tc = timecardFor(emp.id);
                  const entryCount = entriesForEmployeeInPeriod(emp.id).length;
                  const busy = busyEmployeeId === emp.id;
                  return (
                    <tr key={emp.id} className="border-b border-border/50">
                      <td className="py-2 px-3 font-medium">{emp.full_name}</td>
                      <td className="py-2 px-3 text-right text-muted-foreground">{entryCount}</td>
                      <td className="py-2 px-3 text-right font-mono">{(tc?.total_regular_hours ?? 0).toFixed(2)}</td>
                      <td className="py-2 px-3 text-right font-mono">{(tc?.total_ot_hours ?? 0).toFixed(2)}</td>
                      <td className="py-2 px-3 text-right font-mono">{(tc?.total_double_time_hours ?? 0).toFixed(2)}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[tc?.status || 'unsubmitted']}`}>{titleCase(tc?.status || 'unsubmitted')}</span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy || entryCount === 0 || tc?.status === 'approved'} onClick={() => generateTimecard(emp)}>
                            <RefreshCw className="w-3 h-3" />{tc ? 'Refresh' : 'Generate'}
                          </Button>
                          {tc && tc.status === 'unsubmitted' && (
                            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => submitTimecard(tc)}><Send className="w-3 h-3" />Submit</Button>
                          )}
                          {tc && tc.status === 'submitted' && (
                            <Button size="sm" className="h-7 gap-1 text-xs steel-gradient text-white border-0" disabled={busy} onClick={() => approveTimecard(tc)}><CheckCircle2 className="w-3 h-3" />Approve</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
