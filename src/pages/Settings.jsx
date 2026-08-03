import React, { useState } from 'react';
import { Building2, Brain, Bell, Layers, Tablet, Loader2, FileSpreadsheet } from 'lucide-react';
import TemplateVaultPanel from '@/components/settings/TemplateVaultPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { enableKioskMode } from '@/lib/kioskMode';

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
  const { toast } = useToast();
  const [aiRules, setAiRules] = useState(AI_RULES);
  const [newRule, setNewRule] = useState('');
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);

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

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => { setSaving(false); toast({ title: 'Settings saved!' }); }, 800);
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
          <TabsTrigger value="devices"><Tablet className="w-4 h-4 mr-1.5" /> Devices</TabsTrigger>
        </TabsList>

        {/* Company Settings */}
        <TabsContent value="company">
          <div className="space-y-4">
            <div className="steel-card p-6">
              <h3 className="font-semibold mb-4">Company Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Label>Company Name</Label>
                  <Input defaultValue="My Steel Fabricators, Inc." className="mt-1" />
                </div>
                <div>
                  <Label>Company Type</Label>
                  <Select defaultValue="structural_steel_fabricator">
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
                  <Input placeholder="e.g. FA-1234" className="mt-1" />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input placeholder="(555) 000-0000" className="mt-1" />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input type="email" placeholder="info@yourcompany.com" className="mt-1" />
                </div>
                <div>
                  <Label>Website</Label>
                  <Input placeholder="https://yourcompany.com" className="mt-1" />
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0 min-w-32">
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
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
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications">
          <div className="steel-card p-6">
            <h3 className="font-semibold mb-4">Notification Preferences</h3>
            <div className="space-y-4">
              {[
                { label: 'AI Analysis Complete', desc: 'When document analysis finishes', default: true },
                { label: 'Critical Risk Findings', desc: 'When AI finds critical or high risk items', default: true },
                { label: 'Review Assignments', desc: 'When you are assigned a review task', default: true },
                { label: 'RFI Updates', desc: 'When RFIs are updated or answered', default: true },
                { label: 'Document Updates', desc: 'When project documents are revised', default: false },
                { label: 'Weekly Summary', desc: 'Weekly project health summary email', default: true },
              ].map(({ label, desc, default: def }) => (
                <div key={label} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                  <Switch defaultChecked={def} />
                </div>
              ))}
            </div>
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

        {/* Devices */}
        <TabsContent value="devices">
          <div className="steel-card p-6">
            <h3 className="font-semibold mb-1 flex items-center gap-2"><Tablet className="w-4 h-4 text-primary" /> Shop Floor Kiosk Provisioning</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Locks THIS physical device to your company permanently. Every future visit skips straight to a touch-friendly
              3-Digit Badge + 5-Digit PIN keypad — no email login, no company code screen. Only provision a device you
              intend to leave on the shop floor as a shared terminal.
            </p>
            <Button onClick={handleProvisionKiosk} disabled={provisioning} className="gap-2 steel-gradient text-white border-0">
              {provisioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tablet className="w-4 h-4" />}
              {provisioning ? 'Provisioning…' : 'Provision Local Shop Floor Kiosk Tablet'}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}