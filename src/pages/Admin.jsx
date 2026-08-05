import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { ShieldCheck, Users, ScrollText, Calculator, MapPin, Database, Plug, Loader2, Boxes, Palette, LayoutTemplate, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import UserManagement from '@/components/admin/UserManagement';
import AuditLogViewer from '@/components/admin/AuditLogViewer';
import CostVariables from '@/components/admin/CostVariables';
import TaxZoneLookup from '@/components/admin/TaxZoneLookup';
import CRMSync from '@/components/admin/CRMSync';
import IntegrationsGateway from '@/components/admin/IntegrationsGateway';
import RoleManager from '@/components/admin/RoleManager';
import ShopFloorLayoutEditor from '@/components/admin/ShopFloorLayoutEditor';
import CompanyBrandingPanel from '@/components/admin/CompanyBrandingPanel';
import FormReportSettingsPanel from '@/components/admin/FormReportSettingsPanel';
import SteelCatalogPanel from '@/components/settings/SteelCatalogPanel';

const TABS = [
  { id: 'users', label: 'User Management', icon: Users, Component: UserManagement },
  { id: 'audit', label: 'Audit Logs', icon: ScrollText, Component: AuditLogViewer },
  { id: 'cost', label: 'Cost Variables', icon: Calculator, Component: CostVariables },
  { id: 'tax', label: 'Tax Zone Lookup', icon: MapPin, Component: TaxZoneLookup },
  { id: 'crm', label: 'CRM Sync', icon: Database, Component: CRMSync },
  { id: 'integrations', label: 'Integrations', icon: Plug, Component: IntegrationsGateway },
  { id: 'roles', label: 'Roles & Permissions', icon: ShieldCheck, Component: RoleManager },
  { id: 'shopfloor', label: '3D Shop Floor Layout', icon: Boxes, Component: ShopFloorLayoutEditor },
  { id: 'branding', label: 'Company Settings', icon: Palette, Component: CompanyBrandingPanel },
  { id: 'form-report-settings', label: 'Form & Report Settings', icon: LayoutTemplate, Component: FormReportSettingsPanel },
  { id: 'steel-catalog', label: 'Steel Inventory Catalog', icon: Layers, Component: SteelCatalogPanel },
];

export default function Admin() {
  const [activeTab, setActiveTab] = useState('users');
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.auth.me().then(u => { setCurrentUser(u); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <Loader2 className="w-8 h-8 text-primary animate-spin" />
    </div>
  );

  const userRoles = currentUser?.roles || [];
  const isAdmin = userRoles.includes('admin') || userRoles.includes('system_administrator') || userRoles.includes('super_admin') || currentUser?.is_admin === true || userRoles.includes('Demo Admin') || userRoles.includes('Admin');

  if (!isAdmin) return (
    <div className="flex flex-col items-center justify-center h-96 gap-3">
      <ShieldCheck className="w-12 h-12 text-muted-foreground" />
      <h2 className="text-lg font-semibold">Admin Access Required</h2>
      <p className="text-sm text-muted-foreground">You need administrator privileges to access this module.</p>
    </div>
  );

  const Active = TABS.find(t => t.id === activeTab)?.Component;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader title="Admin & System Configuration" subtitle="Centralized master control panel for SteelOS" />
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto scrollbar-thin">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              <Icon className="w-4 h-4" />{tab.label}
            </button>
          );
        })}
      </div>
      <Active />
    </div>
  );
}