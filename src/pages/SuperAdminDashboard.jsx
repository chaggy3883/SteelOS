import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { isSuperAdmin, getImpersonatingCompanyId, startImpersonation, stopImpersonation } from '@/lib/tenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import { ShieldAlert, LogIn, LogOut, Plus, Webhook } from 'lucide-react';

const SUBSCRIPTION_STATUSES = ['Active', 'Past_Due', 'Inactive'];
const SUBSCRIPTION_PLANS = [
  { value: 'SteelOS_Fab', label: 'SteelOS Fab (Fabricator Pack)' },
  { value: 'SteelOS_Erect', label: 'SteelOS Erect (Erector Pack)' },
  { value: 'Enterprise_Connect', label: 'Enterprise Connect (Unified Suite)' },
];
const STATUS_COLOR = { Active: 'bg-green-500/10 text-green-600', Past_Due: 'bg-yellow-500/10 text-yellow-700', Inactive: 'bg-red-500/10 text-red-600' };
const emptyTenantForm = () => ({ name: '', company_type: 'structural_steel_fabricator', city: '', state: '' });

export default function SuperAdminDashboard() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState([]);
  const [showTenantForm, setShowTenantForm] = useState(false);
  const [tenantForm, setTenantForm] = useState(emptyTenantForm());
  const [creatingTenant, setCreatingTenant] = useState(false);

  useEffect(() => { init(); }, []);

  const init = async () => {
    try {
      const me = await base44.auth.me();
      setCurrentUser(me);
      if (isSuperAdmin(me)) await loadTenants();
    } catch (e) {} finally {
      setLoading(false);
    }
  };

  const loadTenants = async () => {
    const rows = await base44.entities.Company.list('-created_date', 200);
    setTenants(rows);
  };

  const impersonatingCompanyId = getImpersonatingCompanyId();

  const handleLogIntoInstance = (company) => {
    startImpersonation(company.id);
    toast({ title: `Now viewing ${company.name}`, description: 'Session tenant switched — no password required.' });
    navigate('/');
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
    const updated = await base44.entities.Company.update(company.id, { subscription_status: status });
    setTenants((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    toast({ title: `${updated.name} subscription set to ${status.replace('_', ' ')}`, description: 'Simulated webhook — no real Stripe integration exists.' });
  };

  const handlePlanChange = async (company, plan) => {
    const updated = await base44.entities.Company.update(company.id, { subscription_plan: plan });
    setTenants((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    await loadTenants();
    toast({ title: `${updated.name} plan set to ${plan.replace(/_/g, ' ')}` });
  };

  const handleCreateTenant = async () => {
    if (!tenantForm.name.trim()) {
      toast({ title: 'Tenant name is required', variant: 'destructive' });
      return;
    }
    setCreatingTenant(true);
    try {
      const created = await base44.entities.Company.create({
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

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Super Admin Dashboard" subtitle="Tenant impersonation matrix and billing status controls — platform operator only" />

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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left py-3 px-4">Tenant</th>
              <th className="text-left py-3 px-4">Plan</th>
              <th className="text-left py-3 px-4">Subscription Status</th>
              <th className="text-left py-3 px-4">Simulate Webhook</th>
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

      <p className="text-xs text-muted-foreground">
        Tenant isolation here is a client-side data filter, not a real security boundary — this app has no backend, so every tenant's records still live in the same browser storage.
      </p>

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
