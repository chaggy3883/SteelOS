import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Percent, ShieldAlert, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import { normalizeRoleName, BUILTIN_ROLES } from '@/components/dashboard/rbacConfig';
import { exportRowsToCsv } from '@/lib/csvExport';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';

const ALLOWED_ROLES = ['admin', 'super_admin', 'payroll_admin', 'hr_admin'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('Retirement401kReport.jsx: ALLOWED_ROLES references a role name not present in BUILTIN_ROLES.');
}

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Plan-administration / year-end reporting: every PayrollLineDeduction
// withheld under the '401k' subtype, grouped by employee then pay period.
// Same post-itemization-only coverage as the garnishment report — pay
// periods processed before itemized tracking shipped have nothing to show
// here (see PayrollLine's backfill note).
export default function Retirement401kReport() {
  const [accessChecked, setAccessChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState([]);
  const [rows, setRows] = useState([]);
  const [runsById, setRunsById] = useState({});
  const [periodsById, setPeriodsById] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);

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
      const [allDeductionLines, emps, runs, periods] = await Promise.all([
        db.entities.PayrollLineDeduction.list('-created_date', 5000),
        db.entities.employees.list('full_name', 1000),
        db.entities.PayrollRun.list('-run_date', 500),
        db.entities.PayPeriod.list('-period_start', 500),
      ]);
      setRows(allDeductionLines.filter((d) => String(d.deduction_type || '').toLowerCase() === '401k'));
      setEmployees(emps);
      setRunsById(Object.fromEntries(runs.map((r) => [r.id, r])));
      setPeriodsById(Object.fromEntries(periods.map((p) => [p.id, p])));
    } catch (e) {
      console.error('Failed to load 401(k) contributions report', e);
    } finally {
      setLoading(false);
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
        <p className="text-sm text-muted-foreground">Total on file: <span className="font-mono font-semibold text-foreground">{money(grandTotal)}</span></p>
        <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}><Download className="w-4 h-4 mr-2" />Export CSV</Button>
      </div>

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
    </div>
  );
}
