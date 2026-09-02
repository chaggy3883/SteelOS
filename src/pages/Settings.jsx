import React, { useState, useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useOutletContext } from 'react-router-dom';
import { Building2, Brain, Bell, Layers, Tablet, Loader2, FileSpreadsheet, Sparkles, ListChecks, FileText } from 'lucide-react';
import TemplateVaultPanel from '@/components/settings/TemplateVaultPanel';
import ProposalTermsPanel from '@/components/settings/ProposalTermsPanel';
import AiPlatformConfigPanel from '@/components/settings/AiPlatformConfigPanel';
import DemoDataPanel from '@/components/settings/DemoDataPanel';
import PlatformDetectionPanel from '@/components/settings/PlatformDetectionPanel';
import ReviewChecklistPanel from '@/components/settings/ReviewChecklistPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import { db } from '@/api/apiClient';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { enableKioskMode } from '@/lib/kioskMode';
import { DEFAULT_BID_PRICING_HOLD_DAYS } from '@/lib/bidPricingHold';

const emptyCompanyForm = () => ({
  name: '', company_type: 'structural_steel_fabricator', address: '', city: '', state: '', zip: '',
  aisc_certification: '', phone: '', email: '', website: '',
  aisc_certified: false, aisc_badge_url: '', proposal_validity_days: 7, terms_last_updated_date: '',
  bid_pricing_hold_days: DEFAULT_BID_PRICING_HOLD_DAYS,
});

// Per-user preference — stored on the User/employees record (see
// notification_preferences below), NOT on Company. Each entry's `key` is the
// object key persisted inside that JSON field; `default` is only the
// fallback shown before a saved value exists.
const NOTIFICATION_TYPES = [
  { key: 'ai_analysis_complete', label: 'AI Analysis Complete', desc: 'When document analysis finishes', default: true },
  { key: 'critical_risk_findings', label: 'Critical Risk Findings', desc: 'When AI finds critical or high risk items', default: true },
  { key: 'review_assignments', label: 'Review Assignments', desc: 'When you are assigned a review task', default: true },
  { key: 'rfi_updates', label: 'RFI Updates', desc: 'When RFIs are updated or answered', default: true },
  { key: 'document_updates', label: 'Document Updates', desc: 'When project documents are revised', default: false },
  { key: 'weekly_summary', label: 'Weekly Summary', desc: 'Weekly project health summary email', default: true },
];

const AI_RULES = [
  { id: 1, rule: 'Always verify AISC Fabricator Certification requirement', active: true },
  { id: 2, rule: 'Always identify Liquidated Damages clauses and dollar amounts', active: true },
  { id: 3, rule: 'Always verify Delegated Design requirements', active: true },
  { id: 4, rule: 'Always identify Buy America / Domestic Steel requirements', active: true },
  { id: 5, rule: 'Always verify paint system and surface preparation requirements', active: true },
  { id: 6, rule: 'Always identify galvanizing requirements and specifications', active: true },
  { id: 7, rule: 'Always verify AWS D1.1 welding code requirements', active: true },
  { id: 8, rule: 'Always identify required insurance limits', active: false },
  { id: 9, rule: 'Always check for Certified Payroll / Davis-Bacon requirements', active: true },
  { id: 10, rule: 'Always identify connection design responsibility', active: true },
];

export default function Settings() {
  useDocumentTitle('SteelOS — Settings');
  const { toast } = useToast();
  const { user } = useOutletContext() || {};
  const [aiRules, setAiRules] = useState(AI_RULES);
  const [newRule, setNewRule] = useState('');
  const [provisioning, setProvisioning] = useState(false);

  const [company, setCompany] = useState(null);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm());
  const [loadingCompany, setLoadingCompany] = useState(true);
  const [saving, setSaving] = useState(false);

  // Notification toggles are a per-user preference, not a company setting —
  // each logged-in person gets their own values, persisted on their own
  // User/employees record (see the entity/id resolution in
  // loadNotificationPrefs, mirroring Dashboard.jsx's page_layouts_json
  // pattern) rather than on the shared Company row.
  const [notifTargetEntity, setNotifTargetEntity] = useState('User');
  const [notifTargetId, setNotifTargetId] = useState(null);
  const [notifPrefs, setNotifPrefs] = useState({});
  const [loadingNotifs, setLoadingNotifs] = useState(true);
  const [savingNotifs, setSavingNotifs] = useState(false);

  useEffect(() => { loadCompany(); }, []);
  useEffect(() => { if (user?.id) loadNotificationPrefs(); }, [user?.id]);

  const loadNotificationPrefs = async () => {
    setLoadingNotifs(true);
    try {
      const entity = user?.employee_id ? 'employees' : 'User';
      const id = user?.employee_id || user?.id;
      setNotifTargetEntity(entity);
      setNotifTargetId(id);
      // Always re-fetch the live row rather than trusting the `user` object
      // from useOutletContext/db.auth.me() — that's a snapshot captured at
      // login time and never refreshed, so it would still show pre-save
      // values after a reload even though the write below succeeded.
      const record = await db.entities[entity].get(id);
      setNotifPrefs(record?.notification_preferences || {});
    } catch (e) {
      setNotifPrefs({});
    } finally {
      setLoadingNotifs(false);
    }
  };

  const toggleNotificationPref = (key, value) => setNotifPrefs((p) => ({ ...p, [key]: value }));

  const handleSaveNotifications = async () => {
    if (!notifTargetId) {
      toast({ title: 'No signed-in user to save preferences for', variant: 'destructive' });
      return;
    }
    setSavingNotifs(true);
    try {
      await db.entities[notifTargetEntity].update(notifTargetId, { notification_preferences: notifPrefs });
      toast({ title: 'Notification preferences saved!' });
    } catch (e) {
      toast({ title: 'Unable to save notification preferences', description: e?.message, variant: 'destructive' });
    } finally {
      setSavingNotifs(false);
    }
  };

  const loadCompany = async () => {
    setLoadingCompany(true);
    try {
      const row = await getEffectiveCompany();
      setCompany(row);
      setCompanyForm({
        name: row?.name || '',
        company_type: row?.company_type || 'structural_steel_fabricator',
        address: row?.address || '',
        city: row?.city || '',
        state: row?.state || '',
        zip: row?.zip || '',
        aisc_certification: row?.aisc_certification || '',
        phone: row?.phone || '',
        email: row?.email || '',
        website: row?.website || '',
        aisc_certified: row?.aisc_certified ?? false,
        aisc_badge_url: row?.aisc_badge_url || '',
        proposal_validity_days: row?.proposal_validity_days || 7,
        terms_last_updated_date: row?.terms_last_updated_date || '',
        bid_pricing_hold_days: row?.bid_pricing_hold_days || DEFAULT_BID_PRICING_HOLD_DAYS,
      });
    } finally {
      setLoadingCompany(false);
    }
  };

  const updateCompanyField = (field, value) => setCompanyForm((f) => ({ ...f, [field]: value }));

  // Kiosk provisioning is device-local, on purpose: it locks THIS physical
  // browser/tablet into kiosk mode by writing to its own localStorage (see
  // src/lib/kioskMode.js) — it is never written to Company or User, since a
  // shared shop-floor tablet's kiosk lock must not follow the admin who
  // provisioned it, or apply to any other device.
  //
  // Isolated Caching Portal — writes the admin's own effective tenant into
  // THIS physical device's localStorage (see src/lib/kioskMode.js), then
  // reloads straight into KioskKeypadLogin. This is now the only place a
  // device can be locked into kiosk mode — the public login screen no
  // longer exposes a company-code-driven kiosk setup shortcut of its own.
  const handleProvisionKiosk = async () => {
    setProvisioning(true);
    try {
      const company = await getEffectiveCompany();
      if (!company) {
        toast({ title: 'No active tenant to provision this device for', variant: 'destructive' });
        return;
      }
      enableKioskMode(company.company_code, company.name);
      window.location.href = '/login';
    } finally {
      setProvisioning(false);
    }
  };

  const toggleRule = (id) => {
    setAiRules(r => r.map(rule => rule.id === id ? { ...rule, active: !rule.active } : rule));
  };

  const addRule = () => {
    if (!newRule.trim()) return;
    setAiRules(r => [...r, { id: Date.now(), rule: newRule.trim(), active: true }]);
    setNewRule('');
    toast({ title: 'AI Rule Added', description: 'This rule will be applied to all future document analyses.' });
  };

  // Company Information + Company Address are company-level fields, shared
  // by every user at this tenant — persisted on the Company entity itself
  // (tenant-scoped via getEffectiveCompany/db.entities.Company), not on the
  // signed-in user's own record.
  const handleSave = async () => {
    if (!company) {
      toast({ title: 'No active tenant to save settings for', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const holdDays = Number(companyForm.bid_pricing_hold_days);
      const validityDays = Number(companyForm.proposal_validity_days);
      const payload = {
        ...companyForm,
        bid_pricing_hold_days: Number.isFinite(holdDays) && holdDays > 0 ? holdDays : DEFAULT_BID_PRICING_HOLD_DAYS,
        proposal_validity_days: Number.isFinite(validityDays) && validityDays > 0 ? validityDays : 7,
      };
      const updated = await db.entities.Company.update(company.id, payload);
      setCompany(updated);
      setCompanyForm(f => ({ ...f, bid_pricing_hold_days: payload.bid_pricing_hold_days, proposal_validity_days: payload.proposal_validity_days }));
      toast({ title: 'Settings saved!' });
    } catch (e) {
      toast({ title: 'Unable to save settings', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 animate-fade-in w-full max-w-none">
      <PageHeader title="Settings" subtitle="Configure SteelOS for your organization" />

      <Tabs defaultValue="company">
        <TabsList className="mb-6">
          <TabsTrigger value="company"><Building2 className="w-4 h-4 mr-1.5" /> Company</TabsTrigger>
          <TabsTrigger value="ai"><Brain className="w-4 h-4 mr-1.5" /> AI Rules</TabsTrigger>
          <TabsTrigger value="notifications"><Bell className="w-4 h-4 mr-1.5" /> Notifications</TabsTrigger>
          <TabsTrigger value="integrations"><Layers className="w-4 h-4 mr-1.5" /> Integrations</TabsTrigger>
          <TabsTrigger value="templates"><FileSpreadsheet className="w-4 h-4 mr-1.5" /> Templates</TabsTrigger>
          <TabsTrigger value="proposal-terms"><FileText className="w-4 h-4 mr-1.5" /> Proposal Terms</TabsTrigger>
          <TabsTrigger value="review-checklist"><ListChecks className="w-4 h-4 mr-1.5" /> Review Checklist</TabsTrigger>
          <TabsTrigger value="devices"><Tablet className="w-4 h-4 mr-1.5" /> Devices</TabsTrigger>
          <TabsTrigger value="demo-data"><Sparkles className="w-4 h-4 mr-1.5" /> Demo Data</TabsTrigger>
        </TabsList>

        {/* Company Settings */}
        <TabsContent value="company">
          {loadingCompany ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : !company ? (
            <p className="text-sm text-muted-foreground p-4">No tenant profile found for this session — nothing to configure.</p>
          ) : (
          <div className="space-y-4">
            <div className="steel-card p-6">
              <h3 className="font-semibold mb-4">Company Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Label>Company Name</Label>
                  <Input value={companyForm.name} onChange={e => updateCompanyField('name', e.target.value)} placeholder="My Steel Fabricators, Inc." className="mt-1" />
                </div>
                <div>
                  <Label>Company Type</Label>
                  <Select value={companyForm.company_type} onValueChange={v => updateCompanyField('company_type', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['structural_steel_fabricator','steel_erector','bridge_fabricator','miscellaneous_metals','detailing_company','steel_service_center'].map(t => (
                        <SelectItem key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>AISC Certification Number</Label>
                  <Input value={companyForm.aisc_certification} onChange={e => updateCompanyField('aisc_certification', e.target.value)} placeholder="e.g. FA-1234" className="mt-1" />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-input px-3 py-2 mt-1 sm:mt-6">
                  <div>
                    <Label className="text-sm">AISC Certified Fabricator</Label>
                    <p className="text-xs text-muted-foreground">Shows the AISC badge on proposal PDFs</p>
                  </div>
                  <Switch checked={companyForm.aisc_certified} onCheckedChange={v => updateCompanyField('aisc_certified', v)} />
                </div>
                {companyForm.aisc_certified && (
                  <div className="sm:col-span-2">
                    <Label>AISC Badge Image URL</Label>
                    <Input value={companyForm.aisc_badge_url} onChange={e => updateCompanyField('aisc_badge_url', e.target.value)} placeholder="/uploads/aisc-badge.png" className="mt-1" />
                  </div>
                )}
                <div>
                  <Label>Phone</Label>
                  <Input value={companyForm.phone} onChange={e => updateCompanyField('phone', e.target.value)} placeholder="(555) 000-0000" className="mt-1" />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input type="email" value={companyForm.email} onChange={e => updateCompanyField('email', e.target.value)} placeholder="info@yourcompany.com" className="mt-1" />
                </div>
                <div>
                  <Label>Website</Label>
                  <Input value={companyForm.website} onChange={e => updateCompanyField('website', e.target.value)} placeholder="https://yourcompany.com" className="mt-1" />
                </div>
              </div>
            </div>

            <div className="steel-card p-6">
              <h3 className="font-semibold mb-1">Company Address</h3>
              <p className="text-xs text-muted-foreground mb-4">Used as the origin point for all mileage/distance calculations (e.g. delivery cost coding).</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Label>Street</Label>
                  <Input value={companyForm.address} onChange={e => updateCompanyField('address', e.target.value)} placeholder="123 Main St" className="mt-1" />
                </div>
                <div>
                  <Label>City</Label>
                  <Input value={companyForm.city} onChange={e => updateCompanyField('city', e.target.value)} placeholder="Findlay" className="mt-1" />
                </div>
                <div>
                  <Label>State</Label>
                  <Input value={companyForm.state} onChange={e => updateCompanyField('state', e.target.value)} placeholder="OH" className="mt-1" />
                </div>
                <div>
                  <Label>Zip</Label>
                  <Input value={companyForm.zip} onChange={e => updateCompanyField('zip', e.target.value)} placeholder="45840" className="mt-1" />
                </div>
              </div>
            </div>

            <div className="steel-card p-6">
              <h3 className="font-semibold mb-1">Business Rules</h3>
              <p className="text-xs text-muted-foreground mb-4">Company-wide thresholds used across SteelOS.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Bid Follow-Up Window (days)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={companyForm.bid_pricing_hold_days}
                    onChange={e => updateCompanyField('bid_pricing_hold_days', e.target.value === '' ? '' : Number(e.target.value))}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    How many days after a bid is marked "Bid Submitted" it's flagged as needing follow-up with no Won/Lost/Did Not Bid decision logged. Defaults to {DEFAULT_BID_PRICING_HOLD_DAYS}.
                  </p>
                </div>
                <div>
                  <Label>Proposal Validity Period (days)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={companyForm.proposal_validity_days}
                    onChange={e => updateCompanyField('proposal_validity_days', e.target.value === '' ? '' : Number(e.target.value))}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    How many days a customer-facing proposal PDF remains valid — sets its "Proposal Expires" date. Defaults to 7.
                  </p>
                </div>
                <div>
                  <Label>Terms Last Updated</Label>
                  <Input
                    type="date"
                    value={companyForm.terms_last_updated_date}
                    onChange={e => updateCompanyField('terms_last_updated_date', e.target.value)}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Shown in the "Last Updated" line of every proposal PDF page footer.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0 min-w-32">
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
          )}
        </TabsContent>

        {/* AI Rules */}
        <TabsContent value="ai">
          <div className="steel-card p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-semibold flex items-center gap-2"><Brain className="w-4 h-4 text-primary" /> AI Company Rules</h3>
                <p className="text-sm text-muted-foreground mt-0.5">These rules are applied to every AI document analysis. The AI will always check for these items.</p>
              </div>
            </div>

            {/* Add Rule */}
            <div className="flex gap-2 mb-6 p-4 bg-muted/50 rounded-lg border border-border">
              <Input
                placeholder="e.g. Always verify temporary bracing requirements..."
                value={newRule}
                onChange={e => setNewRule(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addRule()}
                className="flex-1"
              />
              <Button onClick={addRule} disabled={!newRule.trim()}>Add Rule</Button>
            </div>

            {/* Rules List */}
            <div className="space-y-3">
              {aiRules.map(rule => (
                <div key={rule.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <Switch checked={rule.active} onCheckedChange={() => toggleRule(rule.id)} />
                    <span className={`text-sm ${rule.active ? 'text-foreground' : 'text-muted-foreground line-through'}`}>{rule.rule}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${rule.active ? 'bg-green-500/10 text-green-500' : 'bg-gray-500/10 text-gray-400'}`}>
                    {rule.active ? 'Active' : 'Disabled'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <AiPlatformConfigPanel />
          </div>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications">
          <div className="steel-card p-6">
            <h3 className="font-semibold mb-4">Notification Preferences</h3>
            {loadingNotifs ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : (
            <>
            <div className="space-y-4">
              {NOTIFICATION_TYPES.map(({ key, label, desc, default: def }) => (
                <div key={key} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                  <Switch checked={notifPrefs[key] ?? def} onCheckedChange={(v) => toggleNotificationPref(key, v)} />
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <Button onClick={handleSaveNotifications} disabled={savingNotifs} className="steel-gradient text-white border-0 min-w-32">
                {savingNotifs ? 'Saving...' : 'Save Preferences'}
              </Button>
            </div>
            </>
            )}
          </div>
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations">
          <div className="steel-card p-6">
            <h3 className="font-semibold mb-4">Integrations & Connections</h3>
            <div className="space-y-3">
              {[
                { name: 'Tekla Structures', desc: 'Import piece marks, assemblies, and material lists', status: 'coming_soon' },
                { name: 'Microsoft Teams', desc: 'Send notifications and updates to Teams channels', status: 'coming_soon' },
                { name: 'QuickBooks', desc: 'Sync job costing and financial data', status: 'coming_soon' },
                { name: 'Procore', desc: 'Sync RFIs, submittals, and project data', status: 'coming_soon' },
                { name: 'AISC Database', desc: 'Verify certifications in real-time', status: 'coming_soon' },
              ].map(({ name, desc, status }) => (
                <div key={name} className="flex items-center justify-between p-4 rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                      <Layers className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{name}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground">Coming Soon</span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Templates */}
        <TabsContent value="templates">
          <TemplateVaultPanel />
        </TabsContent>

        {/* Proposal Terms */}
        <TabsContent value="proposal-terms">
          <ProposalTermsPanel />
        </TabsContent>

        {/* Review Checklist */}
        <TabsContent value="review-checklist">
          <ReviewChecklistPanel />
        </TabsContent>

        {/* Devices */}
        <TabsContent value="devices">
          <div className="steel-card p-6">
            <h3 className="font-semibold mb-1 flex items-center gap-2"><Tablet className="w-4 h-4 text-primary" /> Shop Floor Kiosk Provisioning</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Locks THIS physical device to your company permanently. Every future visit skips straight to a touch-friendly
              3-Digit Employee Number + 4-Digit PIN (last 4 of SSN) keypad — no email login, no company code screen. Only
              provision a device you intend to leave on the shop floor as a shared terminal.
            </p>
            <Button onClick={handleProvisionKiosk} disabled={provisioning} className="gap-2 steel-gradient text-white border-0">
              {provisioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tablet className="w-4 h-4" />}
              {provisioning ? 'Provisioning…' : 'Provision Local Shop Floor Kiosk Tablet'}
            </Button>
          </div>

          <div className="mt-6">
            <PlatformDetectionPanel />
          </div>
        </TabsContent>

        {/* Demo Data */}
        <TabsContent value="demo-data">
          <DemoDataPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}