import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Percent, ShieldAlert, Download, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/ui/PageHeader';
import { normalizeRoleName, BUILTIN_ROLES } from '@/components/dashboard/rbacConfig';
import { exportRowsToCsv } from '@/lib/csvExport';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useToast } from '@/components/ui/use-toast';

const ALLOWED_ROLES = ['admin', 'super_admin', 'payroll_admin', 'hr_admin'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('Retirement401kReport.jsx: ALLOWED_ROLES references a role name not present in BUILTIN_ROLES.');
}

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);

const emptyEnrollmentForm = () => ({
  employee_id: '', amount_or_percent: '', is_percent: true,
  priority_order: '5', effective_date: new Date().toISOString().slice(0, 10), end_date: '',
});

// Plan-administration / year-end reporting: every PayrollLineDeduction
// withheld under the '401k' subtype, grouped by employee then pay period.
// Same post-itemization-only coverage as the garnishment report — pay
// periods processed before itemized tracking shipped have nothing to show
// here (see PayrollLine's backfill note).
export default function Retirement401kReport() {
  useDocumentTitle('SteelOS — 401(k) Contributions');
  const { toast } = useToast();
  const [accessChecked, setAccessChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState([]);
  const [rows, setRows] = useState([]);
  const [runsById, setRunsById] = useState({});
  const [periodsById, setPeriodsById] = useState({});
  const [enrollments, setEnrollments] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyEnrollmentForm());
  const [saving, setSaving] = useState(false);
  const [viewingEnrollment, setViewingEnrollment] = useState(null);

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const me = await db.auth.me();
        setCurrentUser(me || null);
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
    getEffectiveCompany()
      .then((company) => setModuleAllowed(hasModule(company, '/payroll/401k-contributions')))
      .catch(() => setModuleAllowed(false))
      .finally(() => setCheckingModuleAccess(false));
  }, []);

  useEffect(() => { if (accessChecked && allowed) loadData(); }, [accessChecked, allowed]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [allDeductionLines, emps, runs, periods, deductions] = await Promise.all([
        db.entities.PayrollLineDeduction.list('-created_date', 5000),
        db.entities.employees.list('full_name', 1000),
        db.entities.PayrollRun.list('-run_date', 500),
        db.entities.PayPeriod.list('-period_start', 500),
        db.entities.Deduction.list('-effective_date', 1000),
      ]);
      setRows(allDeductionLines.filter((d) => String(d.deduction_type || '').toLowerCase() === '401k'));
      setEmployees(emps);
      setRunsById(Object.fromEntries(runs.map((r) => [r.id, r])));
      setPeriodsById(Object.fromEntries(periods.map((p) => [p.id, p])));
      setEnrollments(deductions.filter((d) => d.deduction_type === 'benefits' && d.deduction_subtype === '401k'));
    } catch (e) {
      console.error('Failed to load 401(k) contributions report', e);
    } finally {
      setLoading(false);
    }
  };

  const openAddEnrollment = () => { setEditId(null); setForm(emptyEnrollmentForm()); setShowForm(true); };
  const openEditEnrollment = (row) => {
    setEditId(row.id);
    setForm({
      employee_id: row.employee_id, amount_or_percent: String(row.amount_or_percent ?? ''), is_percent: !!row.is_percent,
      priority_order: String(row.priority_order ?? 5), effective_date: row.effective_date || new Date().toISOString().slice(0, 10),
      end_date: row.end_date || '',
    });
    setViewingEnrollment(null);
    setShowForm(true);
  };

  const handleSaveEnrollment = async () => {
    const amount = Number(form.amount_or_percent);
    if (!form.employee_id || !form.effective_date || !form.amount_or_percent || amount <= 0) {
      toast({ title: 'Employee, amount, and effective date are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        employee_id: form.employee_id,
        deduction_type: 'benefits',
        deduction_subtype: '401k',
        amount_or_percent: amount,
        is_percent: form.is_percent,
        priority_order: Number(form.priority_order) || 5,
        effective_date: form.effective_date,
        end_date: form.end_date || null,
      };
      if (editId) {
        await db.entities.Deduction.update(editId, payload);
        toast({ title: '401(k) contribution updated' });
      } else {
        await db.entities.Deduction.create(payload);
        toast({ title: 'Employee enrolled in 401(k)' });
      }
      setShowForm(false);
      setEditId(null);
      setForm(emptyEnrollmentForm());
      await loadData();
    } catch (e) {
      toast({ title: 'Unable to save 401(k) enrollment', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const employeeName = (id) => employees.find((e) => e.id === id)?.full_name || id;
  const periodLabelForRow = (row) => {
    const run = runsById[row.payroll_run_id];
    const period = run ? periodsById[run.pay_period_id] : null;
    return period ? `${period.period_start} — ${period.period_end}` : (run?.run_date || '—');
  };

  const byEmployee = useMemo(() => {
    const groups = {};
    rows.forEach((r) => {
      if (!groups[r.employee_id]) groups[r.employee_id] = { employee_id: r.employee_id, rows: [], total: 0 };
      groups[r.employee_id].rows.push(r);
      groups[r.employee_id].total += Number(r.amount_applied) || 0;
    });
    Object.values(groups).forEach((g) => g.rows.sort((a, b) => periodLabelForRow(a).localeCompare(periodLabelForRow(b))));
    return Object.values(groups).sort((a, b) => employeeName(a.employee_id).localeCompare(employeeName(b.employee_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, employees, runsById, periodsById]);

  const grandTotal = byEmployee.reduce((s, g) => s + g.total, 0);

  const handleExport = () => {
    exportRowsToCsv({
      filename: '401k-contributions-report.csv',
      columns: ['Employee', 'Pay Period', 'Contribution Amount'],
      rows: rows.map((r) => [employeeName(r.employee_id), periodLabelForRow(r), (Number(r.amount_applied) || 0).toFixed(2)]),
    });
  };

  if (!accessChecked || checkingModuleAccess) return <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>;

  // Route guard — a direct URL to /payroll/401k-contributions can't bypass
  // the nav's module-pack filtering. Strictly earlier/coarser than the
  // role-based check below.
  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  if (!(moduleAllowed || isPlatformOperatorView)) {
    return <ModuleLocked modulePath="/payroll/401k-contributions" title="Payroll Not Included" />;
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="steel-card p-8 text-center max-w-md mx-auto mt-12">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">Access Restricted</h2>
          <p className="text-sm text-muted-foreground">401(k) contribution records are only available to Admin, Payroll Admin, and HR Admin roles.</p>
        </div>
      </div>
    );
  }

  if (loading) return <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>;

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader title="401(k) Contributions" subtitle="Employee contributions by pay period, for plan administration and year-end reporting" icon={Percent} />

      <div className="flex justify-between items-center mb-3">
        <Button className="gap-2 steel-gradient text-white border-0" onClick={openAddEnrollment}><Plus className="w-4 h-4" />Enroll Employee</Button>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">Total on file: <span className="font-mono font-semibold text-foreground">{money(grandTotal)}</span></p>
          <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}><Download className="w-4 h-4 mr-2" />Export CSV</Button>
        </div>
      </div>

      <h3 className="text-sm font-semibold mb-2">Active Enrollments</h3>
      <div className="steel-card overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left py-2 px-3">Employee</th>
              <th className="text-right py-2 px-3">Contribution</th>
              <th className="text-left py-2 px-3">Effective — End</th>
              <th className="text-left py-2 px-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {enrollments.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-8 text-sm text-muted-foreground">No 401(k) enrollments configured yet — use "Enroll Employee" to set one up.</td></tr>
            ) : enrollments.map((d) => {
              const active = !d.end_date || d.end_date >= new Date().toISOString().slice(0, 10);
              return (
                <tr key={d.id} onClick={() => setViewingEnrollment(d)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                  <td className="py-2 px-3 font-medium">{employeeName(d.employee_id)}</td>
                  <td className="py-2 px-3 text-right font-mono">{d.is_percent ? `${d.amount_or_percent}%` : money(d.amount_or_percent)}</td>
                  <td className="py-2 px-3 text-muted-foreground">{d.effective_date} — {d.end_date || 'present'}</td>
                  <td className="py-2 px-3"><span className={active ? 'text-green-600' : 'text-muted-foreground'}>{active ? 'Active' : 'Ended'}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className="text-sm font-semibold mb-2">Contribution History</h3>
      {byEmployee.length === 0 ? (
        <div className="steel-card p-12 text-center text-sm text-muted-foreground">No 401(k) contributions on file for pay periods processed after itemized tracking was added.</div>
      ) : (
        <div className="space-y-4">
          {byEmployee.map((g) => (
            <div key={g.employee_id} className="steel-card overflow-x-auto">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <h4 className="font-semibold text-sm">{employeeName(g.employee_id)}</h4>
                <span className="font-mono text-sm font-semibold">{money(g.total)}</span>
              </div>
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left py-1.5 px-3">Pay Period</th>
                    <th className="text-right py-1.5 px-3">Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 px-3">{periodLabelForRow(r)}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{money(r.amount_applied)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!viewingEnrollment} onOpenChange={(o) => !o && setViewingEnrollment(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{viewingEnrollment ? employeeName(viewingEnrollment.employee_id) : ''} — 401(k) Enrollment</DialogTitle></DialogHeader>
          {viewingEnrollment && (
            <div className="space-y-1.5 text-sm">
              {[
                ['Contribution', viewingEnrollment.is_percent ? `${viewingEnrollment.amount_or_percent}% of gross` : `${money(viewingEnrollment.amount_or_percent)} per period`],
                ['Priority Order', viewingEnrollment.priority_order],
                ['Effective Date', viewingEnrollment.effective_date],
                ['End Date', viewingEnrollment.end_date || '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-border/50 py-1 last:border-0">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingEnrollment(null)}>Close</Button>
            <Button onClick={() => openEditEnrollment(viewingEnrollment)} className="steel-gradient text-white border-0">Edit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? 'Update' : 'Enroll Employee In'} 401(k)</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Employee</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm((f) => ({ ...f, employee_id: v }))} disabled={!!editId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select an employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <Label className="text-xs">{form.is_percent ? 'Percent of Gross' : 'Amount ($/period)'}</Label>
                <Input type="number" step="0.01" value={form.amount_or_percent} onChange={(e) => setForm((f) => ({ ...f, amount_or_percent: e.target.value }))} className="mt-1" />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch checked={form.is_percent} onCheckedChange={(v) => setForm((f) => ({ ...f, is_percent: v }))} />
                <Label className="text-xs">Is Percent</Label>
              </div>
            </div>
            <div>
              <Label className="text-xs">Priority Order (lower withheld first)</Label>
              <Input type="number" value={form.priority_order} onChange={(e) => setForm((f) => ({ ...f, priority_order: e.target.value }))} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Effective Date</Label>
                <Input type="date" value={form.effective_date} onChange={(e) => setForm((f) => ({ ...f, effective_date: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">End Date (optional)</Label>
                <Input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className="mt-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSaveEnrollment} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
