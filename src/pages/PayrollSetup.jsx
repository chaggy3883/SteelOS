import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Settings, ShieldAlert } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/ui/PageHeader';
import { normalizeRoleName } from '@/components/dashboard/rbacConfig';
import { PAYROLL_SETUP_ALLOWED_ROLES } from '@/lib/payrollSetupAccess';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';
import PayRatesPanel from '@/components/payroll/PayRatesPanel';
import TaxWithholdingPanel from '@/components/payroll/TaxWithholdingPanel';
import DeductionsPanel from '@/components/payroll/DeductionsPanel';
import DirectDepositPanel from '@/components/payroll/DirectDepositPanel';
import GLMappingsPanel from '@/components/payroll/GLMappingsPanel';
import PayPeriodCalendarPanel from '@/components/payroll/PayPeriodCalendarPanel';
import PayrollRulesPanel from '@/components/payroll/PayrollRulesPanel';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

// Master data only — pay rates, tax withholding, deductions, GL mappings,
// the pay period calendar, and payroll rules. No weekly processing logic
// lives here; that stays in PayrollProcessing.jsx (time entry, timecards,
// run/approve/lock, job cost posting) — the sole payroll pipeline since
// Payroll.jsx's retirement (see App.jsx's /payroll redirect).
export default function PayrollSetup() {
  useDocumentTitle('SteelOS — Payroll Setup');
  const [accessChecked, setAccessChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [activeTab, setActiveTab] = useState('rates');
  const [currentUser, setCurrentUser] = useState(null);
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const me = await db.auth.me();
        setCurrentUser(me || null);
        const roles = me?.roles || me?.user?.roles || ['user'];
        setAllowed(roles.some((r) => PAYROLL_SETUP_ALLOWED_ROLES.includes(normalizeRoleName(r))));
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
      .then((company) => setModuleAllowed(hasModule(company, '/payroll/setup')))
      .catch(() => setModuleAllowed(false))
      .finally(() => setCheckingModuleAccess(false));
  }, []);

  useEffect(() => {
    if (accessChecked && allowed) loadEmployees();
  }, [accessChecked, allowed]);

  const loadEmployees = async () => {
    setLoading(true);
    try {
      const list = await db.entities.employees.list('full_name', 1000);
      setEmployees(list);
    } catch (e) {
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  };

  if (!accessChecked || checkingModuleAccess) {
    return <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>;
  }

  // Route guard — a direct URL to /payroll/setup can't bypass the nav's
  // module-pack filtering. Strictly earlier/coarser than the role-based
  // check below.
  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  if (!(moduleAllowed || isPlatformOperatorView)) {
    return <ModuleLocked modulePath="/payroll/setup" title="Payroll Not Included" />;
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="steel-card p-8 text-center max-w-md mx-auto mt-12">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">Access Restricted</h2>
          <p className="text-sm text-muted-foreground">Payroll setup — pay rates, tax withholding, deductions, and GL mappings — is only available to Admin, Payroll Admin, HR Admin, and Controller roles.</p>
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
      <PageHeader title="Payroll Setup" subtitle="Master data — pay rates, tax withholding, deductions, GL mappings, pay period calendar, and payroll rules" icon={Settings} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 flex-wrap h-auto">
          <TabsTrigger value="rates">Pay Rates</TabsTrigger>
          <TabsTrigger value="withholding">Tax Withholding</TabsTrigger>
          <TabsTrigger value="deductions">Deductions</TabsTrigger>
          <TabsTrigger value="directdeposit">Direct Deposit</TabsTrigger>
          <TabsTrigger value="gl">GL Mappings</TabsTrigger>
          <TabsTrigger value="calendar">Pay Period Calendar</TabsTrigger>
          <TabsTrigger value="rules">Payroll Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="rates"><PayRatesPanel employees={employees} /></TabsContent>
        <TabsContent value="withholding"><TaxWithholdingPanel employees={employees} /></TabsContent>
        <TabsContent value="deductions"><DeductionsPanel employees={employees} /></TabsContent>
        <TabsContent value="directdeposit"><DirectDepositPanel employees={employees} /></TabsContent>
        <TabsContent value="gl"><GLMappingsPanel /></TabsContent>
        <TabsContent value="calendar"><PayPeriodCalendarPanel /></TabsContent>
        <TabsContent value="rules"><PayrollRulesPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
