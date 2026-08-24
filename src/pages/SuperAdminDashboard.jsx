import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { isSuperAdmin, getImpersonatingCompanyId, startImpersonation, stopImpersonation } from '@/lib/tenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import LogoUploader from '@/components/admin/LogoUploader';
import LoginSlideshowManager from '@/components/admin/LoginSlideshowManager';
import { ShieldAlert, LogIn, LogOut, Plus, Webhook, Building2, AlertTriangle, Cpu, Sparkles, Users, Clock } from 'lucide-react';

const SUBSCRIPTION_STATUSES = ['Active', 'Past_Due', 'Inactive'];
const SUBSCRIPTION_PLANS = [
  { value: 'SteelOS_Fab', label: 'SteelOS Fab (Fabricator Pack)' },
  { value: 'SteelOS_Erect', label: 'SteelOS Erect (Erector Pack)' },
  { value: 'Enterprise_Connect', label: 'Enterprise Connect (Unified Suite)' },
];
const STATUS_COLOR = { Active: 'bg-green-500/10 text-green-600', Past_Due: 'bg-yellow-500/10 text-yellow-700', Inactive: 'bg-red-500/10 text-red-600' };
const emptyTenantForm = () => ({ name: '', company_type: 'structural_steel_fabricator', city: '', state: '' });

// Separate from SUBSCRIPTION_PLANS above (which only lists the 3 plans a new
// tenant can be assigned) — the stats breakdown needs all 6 values the
// Company schema actually allows, including the two legacy/generic tiers.
const ALL_SUBSCRIPTION_PLANS = ['starter', 'professional', 'enterprise', 'SteelOS_Fab', 'SteelOS_Erect', 'Enterprise_Connect'];
const PLAN_LABELS = {
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
  SteelOS_Fab: 'SteelOS Fab',
  SteelOS_Erect: 'SteelOS Erect',
  Enterprise_Connect: 'Enterprise Connect',
};
const AI_PROVIDERS = ['local', 'claude', 'openai'];
const AI_PROVIDER_LABELS = { local: 'Local / On-Prem', claude: 'Claude', openai: 'OpenAI' };

// Module entitlement allowlist (Company.enabled_modules) — separate from
// rbacConfig.jsx's per-role module visibility. This is "did the tenant buy
// it," checked at the point of use via src/lib/moduleEntitlement.js's
// hasModule(); this dashboard is the only place it's editable. An empty
// array means everything is on (see hasModule), so unchecking every box
// here is equivalent to leaving it untouched.
const MODULE_ENTITLEMENTS = [
  { key: 'payroll', label: 'Payroll' },
  { key: 'equipment', label: 'Equipment Job Costing' },
  { key: 'ironsight', label: 'IRONSIGHT' },
  { key: 'sales', label: 'Salesman Dashboard' },
];

// Only counts an active session's actual elapsed time — a row with no
// heartbeat yet, or one that (through clock skew or a bad write) ended up
// before its own login_at, contributes 0 rather than a negative or NaN.
const sessionHours = (row) => {
  if (!row.last_heartbeat_at || !row.login_at) return 0;
  const start = new Date(row.login_at).getTime();
  const end = new Date(row.last_heartbeat_at).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return (end - start) / (1000 * 60 * 60);
};

export default function SuperAdminDashboard() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState([]);
  const [showTenantForm, setShowTenantForm] = useState(false);
  const [tenantForm, setTenantForm] = useState(emptyTenantForm());
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [apiIntegrationLogs, setApiIntegrationLogs] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [allSessionLogs, setAllSessionLogs] = useState([]);
  const [loadingUsage, setLoadingUsage] = useState(true);

  useEffect(() => { init(); }, []);

  const init = async () => {
    try {
      const me = await db.auth.me();
      setCurrentUser(me);
      if (isSuperAdmin(me)) await Promise.all([loadTenants(), loadPlatformStats()]);
    } catch (e) {} finally {
      setLoading(false);
    }
  };

  const loadTenants = async () => {
    const rows = await db.entities.Company.list('-created_date', 200);
    setTenants(rows);
  };

  // Platform-operator (non-impersonating super_admin) reads here are
  // unfiltered across every tenant — see applyTenantScope in localData.js —
  // which is exactly what these cross-company stats and the Usage table need.
  const loadPlatformStats = async () => {
    setLoadingUsage(true);
    try {
      const [logs, users, sessions] = await Promise.all([
        db.entities.ApiIntegrationLog.list('-processed_at', 2000),
        db.entities.User.list('-created_date', 2000),
        db.entities.UserSessionLog.list('-login_at', 5000),
      ]);
      setApiIntegrationLogs(logs);
      setAllUsers(users);
      setAllSessionLogs(sessions);
    } catch (e) {
      setApiIntegrationLogs([]);
      setAllUsers([]);
      setAllSessionLogs([]);
    } finally {
      setLoadingUsage(false);
    }
  };

  const impersonatingCompanyId = getImpersonatingCompanyId();

  // Direct Teleport Route — a soft SPA navigate() left NavBar's permission
  // set stale (it only resolves allowedModules on mount), landing on a
  // crippled nav for the impersonated tenant. A hard redirect forces every
  // piece of app chrome to remount fresh against the new runtime company
  // context this just wrote to the auth cache.
  const handleLogIntoInstance = (company) => {
    startImpersonation(company.id);
    window.location.href = '/';
  };

  const handleExitImpersonation = () => {
    stopImpersonation();
    toast({ title: 'Exited impersonation — back to your own session' });
    navigate('/super-admin/dashboard');
  };

  // Simulated billing webhook — there is no real Stripe integration in this
  // app (no backend to receive a webhook at all). This manually flips the
  // same flag a real webhook handler would, so the Subscription Guard Rail
  // is demonstrable end-to-end.
  const simulateSubscriptionChange = async (company, status) => {
    const updated = await db.entities.Company.update(company.id, { subscription_status: status });
    setTenants((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    toast({ title: `${updated.name} subscription set to ${status.replace('_', ' ')}`, description: 'Simulated webhook — no real Stripe integration exists.' });
  };

  const handleToggleModule = async (company, moduleKey, checked) => {
    const current = company.enabled_modules || [];
    // A tenant with an empty list has "everything on" (hasModule's default),
    // so the first uncheck must seed the full allowlist minus that one key —
    // otherwise it'd instantly look like every OTHER module got disabled too.
    const baseline = current.length > 0 ? current : MODULE_ENTITLEMENTS.map((m) => m.key);
    const next = checked ? Array.from(new Set([...baseline, moduleKey])) : baseline.filter((k) => k !== moduleKey);
    const updated = await db.entities.Company.update(company.id, { enabled_modules: next });
    setTenants((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handlePlanChange = async (company, plan) => {
    const updated = await db.entities.Company.update(company.id, { subscription_plan: plan });
    setTenants((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    await loadTenants();
    toast({ title: `${updated.name} plan set to ${plan.replace(/_/g, ' ')}` });
  };

  // Super-Admin Logo Master Controller — this page is already 100%
  // super_admin-gated (see the clearance check below), so no extra role
  // check is needed here: a standard tenant admin can never reach this row.
  const handleLogoChange = async (company, logoUrl, scalePct) => {
    const updated = await db.entities.Company.update(company.id, { logo_url: logoUrl, logo_scale_pct: scalePct });
    setTenants((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    toast({ title: `${updated.name} logo asset URL updated` });
  };

  const handleCreateTenant = async () => {
    if (!tenantForm.name.trim()) {
      toast({ title: 'Tenant name is required', variant: 'destructive' });
      return;
    }
    setCreatingTenant(true);
    try {
      const created = await db.entities.Company.create({
        ...tenantForm,
        subscription_plan: 'starter',
        subscription_status: 'Active',
        brand_color_hex: '#2563eb',
        is_active: true,
      });
      setTenants((prev) => [created, ...prev]);
      setShowTenantForm(false);
      setTenantForm(emptyTenantForm());
      toast({ title: `${created.name} provisioned` });
    } catch (e) {
      toast({ title: 'Unable to create tenant', variant: 'destructive' });
    } finally {
      setCreatingTenant(false);
    }
  };

  if (loading) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;

  if (!currentUser || !isSuperAdmin(currentUser)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldAlert className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Executive System-Level Clearance Required</h2>
        <p className="text-sm text-muted-foreground">This route is restricted to the super_admin platform role.</p>
      </div>
    );
  }

  const activeCompaniesCount = tenants.filter((t) => t.subscription_status === 'Active').length;
  const pastDueCount = tenants.filter((t) => t.subscription_status === 'Past_Due').length;
  const plansBreakdown = ALL_SUBSCRIPTION_PLANS.map((plan) => ({
    plan,
    count: tenants.filter((t) => (t.subscription_plan || 'starter') === plan).length,
  })).filter((p) => p.count > 0);
  const aiProviderBreakdown = AI_PROVIDERS.map((provider) => ({
    provider,
    count: tenants.filter((t) => (t.ai_provider || 'local') === provider).length,
  }));
  const currentYearMonth = new Date().toISOString().slice(0, 7);
  const newCompaniesThisMonth = tenants.filter((t) => String(t.created_date || '').startsWith(currentYearMonth)).length;

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const integrationErrors24h = apiIntegrationLogs.filter(
    (log) => (log.response_status || 0) >= 400 && String(log.processed_at || '') >= twentyFourHoursAgo
  ).length;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const usageByCompany = tenants
    .map((company) => {
      const userCount = allUsers.filter((u) => u.company_id === company.id && u.is_active).length;
      const totalHours = allSessionLogs
        .filter((s) => s.company_id === company.id && String(s.login_at || '') >= thirtyDaysAgo)
        .reduce((sum, s) => sum + sessionHours(s), 0);
      return { company, userCount, totalHours };
    })
    .sort((a, b) => b.totalHours - a.totalHours);

  return (
    <div className="p-6 w-full max-w-none space-y-4">
      <PageHeader title="Super Admin Dashboard" subtitle="Tenant impersonation matrix and billing status controls — platform operator only" />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="steel-card p-4">
          <div className="flex items-center gap-2 mb-1"><Building2 className="w-4 h-4 text-green-500" /><p className="text-xs text-muted-foreground">Active Companies</p></div>
          <p className="text-xl font-bold text-green-500">{loading ? '—' : activeCompaniesCount}</p>
        </div>

        <div className={`steel-card p-4 ${pastDueCount > 0 ? 'border-amber-500/40 bg-amber-500/10' : ''}`}>
          <div className="flex items-center gap-2 mb-1"><AlertTriangle className={`w-4 h-4 ${pastDueCount > 0 ? 'text-amber-600' : 'text-muted-foreground'}`} /><p className="text-xs text-muted-foreground">Past Due</p></div>
          <p className={`text-xl font-bold ${pastDueCount > 0 ? 'text-amber-600' : ''}`}>{loading ? '—' : pastDueCount}</p>
        </div>

        <div className="steel-card p-4">
          <div className="flex items-center gap-2 mb-1"><Sparkles className="w-4 h-4 text-blue-500" /><p className="text-xs text-muted-foreground">New Companies This Month</p></div>
          <p className="text-xl font-bold text-blue-500">{loading ? '—' : newCompaniesThisMonth}</p>
        </div>

        <div className="steel-card p-4">
          <div className="flex items-center gap-2 mb-2"><Building2 className="w-4 h-4 text-primary" /><p className="text-xs text-muted-foreground">Companies by Plan</p></div>
          <div className="space-y-1">
            {plansBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground">No companies yet.</p>
            ) : plansBreakdown.map(({ plan, count }) => (
              <div key={plan} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{PLAN_LABELS[plan] || plan}</span>
                <span className="font-mono font-semibold">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="steel-card p-4">
          <div className="flex items-center gap-2 mb-2"><Cpu className="w-4 h-4 text-primary" /><p className="text-xs text-muted-foreground">AI Provider Adoption</p></div>
          <div className="space-y-1">
            {aiProviderBreakdown.map(({ provider, count }) => (
              <div key={provider} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{AI_PROVIDER_LABELS[provider]}</span>
                <span className="font-mono font-semibold">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={`steel-card p-4 ${integrationErrors24h > 0 ? 'border-amber-500/40 bg-amber-500/10' : ''}`}>
          <div className="flex items-center gap-2 mb-1"><AlertTriangle className={`w-4 h-4 ${integrationErrors24h > 0 ? 'text-amber-600' : 'text-muted-foreground'}`} /><p className="text-xs text-muted-foreground">Integration Errors (24h)</p></div>
          <p className={`text-xl font-bold ${integrationErrors24h > 0 ? 'text-amber-600' : ''}`}>{loadingUsage ? '—' : integrationErrors24h}</p>
        </div>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-primary" />Usage — Last 30 Days</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Active user count and total session hours per company, sorted by hours descending.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-3 px-4">Company</th>
                <th className="text-right py-3 px-4">Active Users</th>
                <th className="text-right py-3 px-4">Total Hours (30d)</th>
              </tr>
            </thead>
            <tbody>
              {loadingUsage ? (
                <tr><td colSpan={3} className="py-6 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
              ) : usageByCompany.length === 0 ? (
                <tr><td colSpan={3} className="py-12 text-center text-muted-foreground">No companies yet.</td></tr>
              ) : (
                usageByCompany.map(({ company, userCount, totalHours }) => (
                  <tr key={company.id} className="border-b border-border/50">
                    <td className="py-3 px-4 font-medium">{company.name}</td>
                    <td className="py-3 px-4 text-right font-mono">{userCount}</td>
                    <td className="py-3 px-4 text-right font-mono flex items-center justify-end gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />{totalHours.toFixed(1)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {impersonatingCompanyId && (
        <div className="steel-card p-3 border-yellow-500/40 bg-yellow-500/10 flex items-center justify-between">
          <span className="text-sm font-medium">Currently impersonating a tenant instance.</span>
          <Button size="sm" variant="outline" className="gap-2" onClick={handleExitImpersonation}>
            <LogOut className="w-3.5 h-3.5" />Exit Impersonation
          </Button>
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" className="gap-2 steel-gradient text-white border-0" onClick={() => setShowTenantForm(true)}>
          <Plus className="w-4 h-4" />New Tenant
        </Button>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left py-3 px-4">Tenant</th>
              <th className="text-left py-3 px-4">Plan</th>
              <th className="text-left py-3 px-4">Subscription Status</th>
              <th className="text-left py-3 px-4">Simulate Webhook</th>
              <th className="text-left py-3 px-4">Modules</th>
              <th className="text-left py-3 px-4">Logo</th>
              <th className="text-right py-3 px-4">Action</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((company) => (
              <tr key={company.id} className="border-b border-border/50">
                <td className="py-3 px-4 font-medium">{company.name}</td>
                <td className="py-3 px-4 text-muted-foreground capitalize">{company.subscription_plan}</td>
                <td className="py-3 px-4">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[company.subscription_status] || ''}`}>{(company.subscription_status || 'Active').replace('_', ' ')}</span>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <Select value={company.subscription_status || 'Active'} onValueChange={(v) => simulateSubscriptionChange(company, v)}>
                      <SelectTrigger className="h-8 w-36 text-xs"><Webhook className="w-3.5 h-3.5 mr-1" /><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SUBSCRIPTION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <select
                      value={company.subscription_plan || ''}
                      onChange={(e) => handlePlanChange(company, e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium"
                    >
                      {SUBSCRIPTION_PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <div className="flex flex-col gap-1.5">
                    {MODULE_ENTITLEMENTS.map((m) => {
                      const isEnabled = !company.enabled_modules || company.enabled_modules.length === 0 || company.enabled_modules.includes(m.key);
                      return (
                        <label key={m.key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <Checkbox checked={isEnabled} onCheckedChange={(c) => handleToggleModule(company, m.key, !!c)} />
                          {m.label}
                        </label>
                      );
                    })}
                  </div>
                </td>
                <td className="py-3 px-4">
                  <LogoUploader
                    value={company.logo_url}
                    savedScalePct={company.logo_scale_pct}
                    onSave={(dataUri, scalePct) => handleLogoChange(company, dataUri, scalePct)}
                  />
                </td>
                <td className="py-3 px-4 text-right">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleLogIntoInstance(company)}>
                    <LogIn className="w-3.5 h-3.5" />Log into Instance
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Tenant isolation here is a client-side data filter, not a real security boundary — this app has no backend, so every tenant's records still live in the same browser storage.
      </p>

      <LoginSlideshowManager />

      <Dialog open={showTenantForm} onOpenChange={setShowTenantForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Tenant</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Company Name</Label>
              <Input value={tenantForm.name} onChange={(e) => setTenantForm((f) => ({ ...f, name: e.target.value }))} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>City</Label>
                <Input value={tenantForm.city} onChange={(e) => setTenantForm((f) => ({ ...f, city: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>State</Label>
                <Input value={tenantForm.state} onChange={(e) => setTenantForm((f) => ({ ...f, state: e.target.value }))} className="mt-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTenantForm(false)}>Cancel</Button>
            <Button onClick={handleCreateTenant} disabled={creatingTenant} className="steel-gradient text-white border-0">
              {creatingTenant ? 'Provisioning…' : 'Create Tenant'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
