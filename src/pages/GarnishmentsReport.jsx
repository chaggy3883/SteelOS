import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Scale, ShieldAlert, Download, Plus } from 'lucide-react';
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

const GARNISHMENT_SUBTYPES = ['child_support_garnishment', 'wage_garnishment', 'tax_levy', 'other'];

const emptyGarnishmentForm = () => ({
  employee_id: '', deduction_subtype: 'child_support_garnishment', amount_or_percent: '', is_percent: false,
  priority_order: '1', effective_date: new Date().toISOString().slice(0, 10), end_date: '',
  case_number: '', issuing_authority: '', order_date: '',
});

// Same audience as the itemized pay stub drill-down this report is built
// on top of (PayrollLineDeduction) — HR/payroll_admin/admin, matching the
// spec's "this is what HR needs to respond to a court order" framing.
const ALLOWED_ROLES = ['admin', 'super_admin', 'payroll_admin', 'hr_admin'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('GarnishmentsReport.jsx: ALLOWED_ROLES references a role name not present in BUILTIN_ROLES.');
}

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);
const isGarnishmentType = (t) => {
  const v = String(t || '').toLowerCase();
  return v.includes('garnishment') || v.includes('child_support');
};

// Compliance report: every PayrollLineDeduction ever withheld under a
// garnishment/child-support type, grouped by employee with a running total —
// exactly the answer HR needs on hand when a court order asks "how much has
// been withheld and remitted so far." Reads only PayrollLineDeduction rows
// created after itemized tracking shipped; pay periods processed before that
// have no itemized rows to show here (see PayrollLine's backfill note).
export default function GarnishmentsReport() {
  useDocumentTitle('SteelOS — Garnishments');
  const { toast } = useToast();
  const [accessChecked, setAccessChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState([]);
  const [rows, setRows] = useState([]);
  const [runsById, setRunsById] = useState({});
  const [periodsById, setPeriodsById] = useState({});
  const [deductionsById, setDeductionsById] = useState({});
  const [garnishmentDeductions, setGarnishmentDeductions] = useState([]);
  const [viewingEmployeeId, setViewingEmployeeId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyGarnishmentForm());
  const [saving, setSaving] = useState(false);
  const [viewingDeduction, setViewingDeduction] = useState(null);

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
      .then((company) => setModuleAllowed(hasModule(company, '/payroll/garnishments')))
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
      setRows(allDeductionLines.filter((d) => isGarnishmentType(d.deduction_type)));
      setEmployees(emps);
      setRunsById(Object.fromEntries(runs.map((r) => [r.id, r])));
      setPeriodsById(Object.fromEntries(periods.map((p) => [p.id, p])));
      setDeductionsById(Object.fromEntries(deductions.map((d) => [d.id, d])));
      setGarnishmentDeductions(deductions.filter((d) => d.deduction_type === 'garnishment'));
    } catch (e) {
      console.error('Failed to load garnishments report', e);
    } finally {
      setLoading(false);
    }
  };

  const openAddGarnishment = () => { setEditId(null); setForm(emptyGarnishmentForm()); setShowForm(true); };
  const openEditGarnishment = (row) => {
    setEditId(row.id);
    setForm({
      employee_id: row.employee_id, deduction_subtype: row.deduction_subtype || 'other',
      amount_or_percent: String(row.amount_or_percent ?? ''), is_percent: !!row.is_percent,
      priority_order: String(row.priority_order ?? 1), effective_date: row.effective_date || new Date().toISOString().slice(0, 10),
      end_date: row.end_date || '', case_number: row.case_number || '', issuing_authority: row.issuing_authority || '', order_date: row.order_date || '',
    });
    setViewingDeduction(null);
    setShowForm(true);
  };

  const handleSaveGarnishment = async () => {
    const amount = Number(form.amount_or_percent);
    if (!form.employee_id || !form.effective_date || !form.amount_or_percent || amount <= 0) {
      toast({ title: 'Employee, amount, and effective date are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        employee_id: form.employee_id,
        deduction_type: 'garnishment',
        deduction_subtype: form.deduction_subtype,
        amount_or_percent: amount,
        is_percent: form.is_percent,
        priority_order: Number(form.priority_order) || 1,
        effective_date: form.effective_date,
        end_date: form.end_date || null,
        case_number: form.case_number || null,
        issuing_authority: form.issuing_authority || null,
        order_date: form.order_date || null,
      };
      if (editId) {
        await db.entities.Deduction.update(editId, payload);
        toast({ title: 'Garnishment updated' });
      } else {
        await db.entities.Deduction.create(payload);
        toast({ title: 'Garnishment added' });
      }
      setShowForm(false);
      setEditId(null);
      setForm(emptyGarnishmentForm());
      await loadData();
    } catch (e) {
      toast({ title: 'Unable to save garnishment', variant: 'destructive' });
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
      if (!groups[r.employee_id]) groups[r.employee_id] = { employee_id: r.employee_id, rows: [], totalApplied: 0, totalRequested: 0, types: new Set() };
      const g = groups[r.employee_id];
      g.rows.push(r);
      g.totalApplied += Number(r.amount_applied) || 0;
      g.totalRequested += Number(r.requested_amount) || 0;
      g.types.add(r.deduction_type);
    });
    return Object.values(groups).sort((a, b) => employeeName(a.employee_id).localeCompare(employeeName(b.employee_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, employees]);

  const viewingGroup = byEmployee.find((g) => g.employee_id === viewingEmployeeId) || null;

  const handleExport = () => {
    exportRowsToCsv({
      filename: 'garnishments-report.csv',
      columns: ['Employee', 'Type', 'Pay Period', 'Requested', 'Applied', 'Fully Withheld', 'Source Deduction'],
      rows: rows.map((r) => [
        employeeName(r.employee_id), titleCase(r.deduction_type), periodLabelForRow(r),
        (Number(r.requested_amount) || 0).toFixed(2), (Number(r.amount_applied) || 0).toFixed(2),
        r.fully_withheld ? 'Yes' : 'No — shortfall', deductionsById[r.source_deduction_id]?.id || '',
      ]),
    });
  };

  if (!accessChecked || checkingModuleAccess) return <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>;

  // Route guard — a direct URL to /payroll/garnishments can't bypass the
  // nav's module-pack filtering. Strictly earlier/coarser than the
  // role-based check below.
  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  if (!(moduleAllowed || isPlatformOperatorView)) {
    return <ModuleLocked modulePath="/payroll/garnishments" title="Payroll Not Included" />;
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="steel-card p-8 text-center max-w-md mx-auto mt-12">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">Access Restricted</h2>
          <p className="text-sm text-muted-foreground">Garnishment records are only available to Admin, Payroll Admin, and HR Admin roles.</p>
        </div>
      </div>
    );
  }

  if (loading) return <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>;

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader title="Garnishments &amp; Child Support" subtitle="Running totals withheld per employee, for compliance with court orders" icon={Scale} />

      <div className="flex justify-between items-center mb-3">
        <Button className="gap-2 steel-gradient text-white border-0" onClick={openAddGarnishment}><Plus className="w-4 h-4" />Add Garnishment</Button>
        <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}><Download className="w-4 h-4 mr-2" />Export CSV</Button>
      </div>

      <h3 className="text-sm font-semibold mb-2">Garnishment Orders on File</h3>
      <div className="steel-card overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left py-2 px-3">Employee</th>
              <th className="text-left py-2 px-3">Type</th>
              <th className="text-left py-2 px-3">Case #</th>
              <th className="text-right py-2 px-3">Amount</th>
              <th className="text-left py-2 px-3">Effective — End</th>
              <th className="text-left py-2 px-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {garnishmentDeductions.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-sm text-muted-foreground">No garnishment orders configured yet — use "Add Garnishment" to set one up.</td></tr>
            ) : garnishmentDeductions.map((d) => {
              const active = !d.end_date || d.end_date >= new Date().toISOString().slice(0, 10);
              return (
                <tr key={d.id} onClick={() => setViewingDeduction(d)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                  <td className="py-2 px-3 font-medium">{employeeName(d.employee_id)}</td>
                  <td className="py-2 px-3">{titleCase(d.deduction_subtype || d.deduction_type)}</td>
                  <td className="py-2 px-3 text-muted-foreground">{d.case_number || '—'}</td>
                  <td className="py-2 px-3 text-right font-mono">{d.is_percent ? `${d.amount_or_percent}%` : money(d.amount_or_percent)}</td>
                  <td className="py-2 px-3 text-muted-foreground">{d.effective_date} — {d.end_date || 'present'}</td>
                  <td className="py-2 px-3"><span className={active ? 'text-green-600' : 'text-muted-foreground'}>{active ? 'Active' : 'Ended'}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className="text-sm font-semibold mb-2">Withholding History</h3>
      <div className="steel-card overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left py-2 px-3">Employee</th>
              <th className="text-left py-2 px-3">Type(s)</th>
              <th className="text-right py-2 px-3">Pay Periods</th>
              <th className="text-right py-2 px-3">Total Requested</th>
              <th className="text-right py-2 px-3">Total Withheld</th>
            </tr>
          </thead>
          <tbody>
            {byEmployee.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-sm text-muted-foreground">No garnishment or child support deductions on file for pay periods processed after itemized tracking was added.</td></tr>
            ) : byEmployee.map((g) => (
              <tr key={g.employee_id} onClick={() => setViewingEmployeeId(g.employee_id)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                <td className="py-2 px-3 font-medium">{employeeName(g.employee_id)}</td>
                <td className="py-2 px-3">{[...g.types].map(titleCase).join(', ')}</td>
                <td className="py-2 px-3 text-right">{g.rows.length}</td>
                <td className="py-2 px-3 text-right font-mono">{money(g.totalRequested)}</td>
                <td className="py-2 px-3 text-right font-mono font-semibold">{money(g.totalApplied)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!viewingDeduction} onOpenChange={(o) => !o && setViewingDeduction(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{viewingDeduction ? employeeName(viewingDeduction.employee_id) : ''} — {titleCase(viewingDeduction?.deduction_subtype || viewingDeduction?.deduction_type)}</DialogTitle></DialogHeader>
          {viewingDeduction && (
            <div className="space-y-1.5 text-sm">
              {[
                ['Case #', viewingDeduction.case_number || '—'],
                ['Issuing Authority', viewingDeduction.issuing_authority || '—'],
                ['Order Date', viewingDeduction.order_date || '—'],
                ['Amount', viewingDeduction.is_percent ? `${viewingDeduction.amount_or_percent}% of gross` : `${money(viewingDeduction.amount_or_percent)} per period`],
                ['Priority Order', viewingDeduction.priority_order],
                ['Effective Date', viewingDeduction.effective_date],
                ['End Date', viewingDeduction.end_date || '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-border/50 py-1 last:border-0">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingDeduction(null)}>Close</Button>
            <Button onClick={() => openEditGarnishment(viewingDeduction)} className="steel-gradient text-white border-0">Edit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Add'} Garnishment</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            <div>
              <Label className="text-xs">Employee</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm((f) => ({ ...f, employee_id: v }))} disabled={!!editId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select an employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Garnishment Type</Label>
              <Select value={form.deduction_subtype} onValueChange={(v) => setForm((f) => ({ ...f, deduction_subtype: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GARNISHMENT_SUBTYPES.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Case / Order #</Label>
                <Input value={form.case_number} onChange={(e) => setForm((f) => ({ ...f, case_number: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Issuing Court / Agency</Label>
                <Input value={form.issuing_authority} onChange={(e) => setForm((f) => ({ ...f, issuing_authority: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Order Date</Label>
              <Input type="date" value={form.order_date} onChange={(e) => setForm((f) => ({ ...f, order_date: e.target.value }))} className="mt-1" />
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
            <Button onClick={handleSaveGarnishment} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingEmployeeId} onOpenChange={(o) => !o && setViewingEmployeeId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{viewingGroup ? employeeName(viewingGroup.employee_id) : ''} — Garnishment History</DialogTitle></DialogHeader>
          <div className="space-y-1.5 text-sm max-h-[60vh] overflow-y-auto">
            {(viewingGroup?.rows || [])
              .slice()
              .sort((a, b) => periodLabelForRow(a).localeCompare(periodLabelForRow(b)))
              .map((r) => (
                <div key={r.id} className="flex justify-between items-center border-b border-border/50 py-1.5">
                  <div>
                    <p className="font-medium">{periodLabelForRow(r)}</p>
                    <p className="text-xs text-muted-foreground">{titleCase(r.deduction_type)}{!r.fully_withheld && <span className="ml-1.5 text-red-600">— shortfall, {money(r.requested_amount - r.amount_applied)} unpaid</span>}</p>
                  </div>
                  <span className="font-mono">{money(r.amount_applied)}</span>
                </div>
              ))}
            <div className="flex justify-between pt-2 font-semibold">
              <span>Total Withheld To Date</span>
              <span className="font-mono">{money(viewingGroup?.totalApplied)}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
