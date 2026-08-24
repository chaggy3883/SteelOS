import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { getEffectiveCompany, isAdminUser } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import { Loader2, Settings2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/ui/PageHeader';
import ModuleLocked from '@/components/shared/ModuleLocked';
import { SALES_WIDGETS } from '@/lib/salesDashboardData';
import PipelineWidget from '@/components/sales/PipelineWidget';
import MyProjectsWidget from '@/components/sales/MyProjectsWidget';
import CommissionWidget from '@/components/sales/CommissionWidget';
import RecentRfisWidget from '@/components/sales/RecentRfisWidget';
import ChangeOrdersWidget from '@/components/sales/ChangeOrdersWidget';
import AddendaWidget from '@/components/sales/AddendaWidget';
import QuickStatsWidget from '@/components/sales/QuickStatsWidget';

const PAGE_KEY = 'sales_dashboard';
const REFRESH_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 60, label: 'Every minute' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 900, label: 'Every 15 minutes' },
];

// "admin/payroll_admin can view anyone" (commission strict gate) is
// deliberately broader than the page's own base access rule ("'salesman'
// role only, but allow admin to view for support") — payroll_admin needs
// the same support-view ability specifically to check a salesman's
// commission, so it's folded into the same picker/bypass here.
const canImpersonateSalesman = (roles) => {
  const normalized = (roles || []).map((r) => String(r).toLowerCase());
  return normalized.includes('admin') || normalized.includes('super_admin') || normalized.includes('payroll_admin');
};

export default function SalesDashboard() {
  const [currentUser, setCurrentUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [config, setConfig] = useState(null);

  const [canImpersonate, setCanImpersonate] = useState(false);
  const [allSalesmen, setAllSalesmen] = useState([]);
  const [viewingEmployeeId, setViewingEmployeeId] = useState(null);

  const [settingsTarget, setSettingsTarget] = useState(null);
  const [enabledWidgets, setEnabledWidgets] = useState(null);
  const [refreshRateSeconds, setRefreshRateSeconds] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    Promise.all([db.auth.me().catch(() => null), getEffectiveCompany().catch(() => null)])
      .then(async ([user, comp]) => {
        setCurrentUser(user);
        setCompany(comp);
        const impersonate = isAdminUser(user) || canImpersonateSalesman(user?.roles);
        setCanImpersonate(impersonate);
        const roles = (user?.roles || []).map((r) => String(r).toLowerCase());

        if (impersonate) {
          const employees = await db.entities.employees.list('full_name', 1000).catch(() => []);
          const salesmen = employees.filter((e) => e.is_salesman);
          setAllSalesmen(salesmen);
          const defaultId = user?.employee_id && salesmen.some((s) => s.id === user.employee_id) ? user.employee_id : salesmen[0]?.id || null;
          setViewingEmployeeId(defaultId);
        } else if (roles.includes('salesman')) {
          setViewingEmployeeId(user?.employee_id || null);
        }
      })
      .finally(() => setCheckingAccess(false));
  }, []);

  useEffect(() => {
    db.entities.SalesCommissionConfig.list('-created_date', 1).then((rows) => setConfig(rows[0] || null)).catch(() => setConfig(null));
  }, []);

  // Per-viewer widget toggle + refresh rate, mirroring Dashboard.jsx's
  // page_layouts_json convention (a generic per-page JSON dict already on
  // both User and employees) rather than a new entity — this is the admin
  // viewer's OWN preference across whichever salesman they're impersonating,
  // separate from that salesman's own preference when they log in directly.
  useEffect(() => {
    if (!currentUser || !config) return;
    const targetEntity = currentUser.employee_id ? 'employees' : 'User';
    const targetId = currentUser.employee_id || currentUser.id;
    setSettingsTarget({ entity: targetEntity, id: targetId });
    db.entities[targetEntity].get(targetId)
      .then((record) => {
        const saved = record?.page_layouts_json?.[PAGE_KEY];
        setEnabledWidgets(saved?.enabledWidgets || config.default_dashboard_widgets || SALES_WIDGETS.map((w) => w.id));
        setRefreshRateSeconds(saved?.refreshRateSeconds || 0);
      })
      .catch(() => setEnabledWidgets(config.default_dashboard_widgets || SALES_WIDGETS.map((w) => w.id)));
  }, [currentUser, config]);

  const persistSettings = async (next) => {
    if (!settingsTarget) return;
    try {
      const record = await db.entities[settingsTarget.entity].get(settingsTarget.id);
      const nextLayouts = { ...(record?.page_layouts_json || {}), [PAGE_KEY]: next };
      await db.entities[settingsTarget.entity].update(settingsTarget.id, { page_layouts_json: nextLayouts });
    } catch (e) {}
  };

  const toggleWidget = (id) => {
    setEnabledWidgets((prev) => {
      const next = prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id];
      persistSettings({ enabledWidgets: next, refreshRateSeconds });
      return next;
    });
  };

  const changeRefreshRate = (seconds) => {
    setRefreshRateSeconds(seconds);
    persistSettings({ enabledWidgets, refreshRateSeconds: seconds });
  };

  useEffect(() => {
    if (!refreshRateSeconds) return;
    const interval = setInterval(() => setRefreshTick((t) => t + 1), refreshRateSeconds * 1000);
    return () => clearInterval(interval);
  }, [refreshRateSeconds]);

  if (checkingAccess || enabledWidgets === null) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  const roles = (currentUser?.roles || []).map((r) => String(r).toLowerCase());
  const isSalesman = roles.includes('salesman');

  if (!canImpersonate && !isSalesman) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Access Restricted</h2>
        <p className="text-sm text-muted-foreground">The Salesman Dashboard is available to the Salesman role only.</p>
      </div>
    );
  }

  if (!hasModule(company, 'sales')) {
    return <ModuleLocked modulePath="/sales/dashboard" title="Salesman Dashboard Not Included" description="Ask your platform admin to enable the Salesman Dashboard module for this company." />;
  }

  if (!viewingEmployeeId) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <PageHeader title="Salesman Dashboard" />
        <div className="steel-card p-8 text-center text-muted-foreground">
          {canImpersonate ? 'No salesmen on file yet — add one in Salesman Commission Rates first.' : "Your account isn't linked to a salesman employee record — contact your admin."}
        </div>
      </div>
    );
  }

  const isWidgetOn = (id) => enabledWidgets.includes(id);
  const showPipeline = isWidgetOn('pipeline') && (canImpersonate || config?.allow_salesmen_see_pipeline !== false);
  const viewingSalesman = allSalesmen.find((s) => s.id === viewingEmployeeId);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Salesman Dashboard"
        subtitle={canImpersonate && viewingSalesman ? `Viewing ${viewingSalesman.full_name}'s dashboard` : 'Your pipeline, projects, commission, and project activity.'}
        actions={<Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowSettings(true)}><Settings2 className="w-3.5 h-3.5" />Widgets</Button>}
      />

      {canImpersonate && (
        <div className="steel-card p-3 flex items-center gap-3">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground flex-shrink-0">Viewing Salesman</Label>
          <select value={viewingEmployeeId || ''} onChange={(e) => setViewingEmployeeId(e.target.value)} className="rounded-md border border-input bg-input/40 px-2 py-1.5 text-sm">
            {allSalesmen.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {isWidgetOn('quick_stats') && <QuickStatsWidget key={`qs-${refreshTick}`} salesmanId={viewingEmployeeId} />}
        {showPipeline && <PipelineWidget key={`pl-${refreshTick}`} salesmanId={viewingEmployeeId} />}
        {isWidgetOn('my_projects') && <MyProjectsWidget key={`mp-${refreshTick}`} salesmanId={viewingEmployeeId} />}
        {isWidgetOn('commission') && <CommissionWidget key={`cm-${refreshTick}`} salesmanId={viewingEmployeeId} />}
        {isWidgetOn('recent_rfis') && <RecentRfisWidget key={`rf-${refreshTick}`} salesmanId={viewingEmployeeId} />}
        {isWidgetOn('change_orders') && <ChangeOrdersWidget key={`co-${refreshTick}`} salesmanId={viewingEmployeeId} />}
        {isWidgetOn('addenda') && <AddendaWidget key={`ad-${refreshTick}`} salesmanId={viewingEmployeeId} />}
      </div>

      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent>
          <DialogHeader><DialogTitle>Dashboard Widgets</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {SALES_WIDGETS.map((w) => (
              <div key={w.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{w.label}</p>
                  <p className="text-xs text-muted-foreground">{w.description}</p>
                </div>
                <Switch checked={isWidgetOn(w.id)} onCheckedChange={() => toggleWidget(w.id)} />
              </div>
            ))}
            <div className="pt-3 border-t border-border">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Auto-Refresh</Label>
              <select value={refreshRateSeconds} onChange={(e) => changeRefreshRate(Number(e.target.value))} className="mt-1 w-full rounded-md border border-input bg-input/40 px-2 py-1.5 text-sm">
                {REFRESH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter><Button onClick={() => setShowSettings(false)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
