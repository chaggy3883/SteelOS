import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { PlayCircle, ShieldAlert } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/ui/PageHeader';
import { normalizeRoleName, BUILTIN_ROLES } from '@/components/dashboard/rbacConfig';
import TimeEntryPanel from '@/components/payroll/TimeEntryPanel';
import TimecardsPanel from '@/components/payroll/TimecardsPanel';
import PayrollRunPanel from '@/components/payroll/PayrollRunPanel';

// Same audience as Payroll.jsx's own weekly processing (register/lock/
// export/job-cost-posting) — running payroll is a narrower, more sensitive
// action than the broader payroll/HR/admin Payroll Setup surface.
const PAYROLL_PROCESSING_ALLOWED_ROLES = ['admin', 'super_admin', 'payroll_admin', 'controller'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!PAYROLL_PROCESSING_ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('PayrollProcessing.jsx: PAYROLL_PROCESSING_ALLOWED_ROLES references a role name not present in BUILTIN_ROLES.');
}

// Weekly processing pipeline: Time Entry -> Timecard -> Job Allocation ->
// Gross -> Taxes/Deductions -> Net -> Employer Taxes -> Payroll Journal ->
// Job Costing -> Liabilities. All math lives in src/lib/payrollEngine.js as
// pure functions; this page only fetches shared reference data and hosts the
// three stages as tabs. "Run Payroll" creates a PayrollRun in 'review' —
// the pre-finalization control checks + Review -> Approve -> Lock workflow
// live in PayrollRunPanel.jsx's run-detail dialog (see payrollControls.js).
export default function PayrollProcessing() {
  const [accessChecked, setAccessChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('time');

  const [employees, setEmployees] = useState([]);
  const [projects, setProjects] = useState([]);
  const [costCodes, setCostCodes] = useState([]);
  const [payPeriods, setPayPeriods] = useState([]);
  const [payrollRules, setPayrollRules] = useState([]);

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const me = await db.auth.me();
        const roles = me?.roles || me?.user?.roles || ['user'];
        setAllowed(roles.some((r) => PAYROLL_PROCESSING_ALLOWED_ROLES.includes(normalizeRoleName(r))));
      } catch (e) {
        setAllowed(false);
      } finally {
        setAccessChecked(true);
      }
    };
    checkAccess();
  }, []);

  useEffect(() => {
    if (accessChecked && allowed) loadReferenceData();
  }, [accessChecked, allowed]);

  const loadReferenceData = async () => {
    setLoading(true);
    try {
      const [emps, projs, codes, periods, rules] = await Promise.all([
        db.entities.employees.list('full_name', 1000),
        db.entities.Project.filter({ is_archived: false }, 'name', 300),
        db.entities.CostCode.filter({ is_active: true }, 'code_name', 200),
        db.entities.PayPeriod.list('-period_start', 200),
        db.entities.PayrollRule.list('-effective_date', 500),
      ]);
      setEmployees(emps);
      setProjects(projs);
      setCostCodes(codes);
      setPayPeriods(periods);
      setPayrollRules(rules);
    } catch (e) {
      setEmployees([]); setProjects([]); setCostCodes([]); setPayPeriods([]); setPayrollRules([]);
    } finally {
      setLoading(false);
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
          <p className="text-sm text-muted-foreground">Running payroll is only available to Admin, Payroll Admin, and Controller roles.</p>
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
      <PageHeader title="Run Payroll" subtitle="Time entries, timecard approval, and weekly payroll processing" icon={PlayCircle} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="time">Time Entries</TabsTrigger>
          <TabsTrigger value="timecards">Timecards</TabsTrigger>
          <TabsTrigger value="run">Run Payroll</TabsTrigger>
        </TabsList>

        <TabsContent value="time"><TimeEntryPanel employees={employees} projects={projects} costCodes={costCodes} payPeriods={payPeriods} /></TabsContent>
        <TabsContent value="timecards"><TimecardsPanel employees={employees} payPeriods={payPeriods} payrollRules={payrollRules} /></TabsContent>
        <TabsContent value="run"><PayrollRunPanel employees={employees} projects={projects} costCodes={costCodes} payPeriods={payPeriods} payrollRules={payrollRules} /></TabsContent>
      </Tabs>
    </div>
  );
}
