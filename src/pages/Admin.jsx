import React, { useState, useEffect } from 'react';
import { useSearchParams, Link, useLocation } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { ShieldCheck, Users, ScrollText, Calculator, MapPin, Database, Plug, Loader2, Boxes, Palette, LayoutTemplate, Layers, Tags, Truck, Radar, Wrench, CalendarClock, Percent, DollarSign, UserCog } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isAdminUser } from '@/lib/tenantContext';
import PageHeader from '@/components/ui/PageHeader';
import UserManagement from '@/components/admin/UserManagement';
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
  { id: 'cost', label: 'Cost Variables', icon: Calculator, Component: CostVariables },
  { id: 'tax', label: 'Tax Zone Lookup', icon: MapPin, Component: TaxZoneLookup },
  { id: 'crm', label: 'CRM Sync', icon: Database, Component: CRMSync },
  { id: 'integrations', label: 'Integrations', icon: Plug, Component: IntegrationsGateway },
  { id: 'roles', label: 'Roles & Permissions', icon: ShieldCheck, Component: RoleManager, roles: ['admin', 'super_admin', 'hr_admin'] },
  { id: 'shopfloor', label: '3D Shop Floor Layout', icon: Boxes, Component: ShopFloorLayoutEditor },
  // hr_admin needs this alongside full admin — it's also where the default
  // new-hire equipment kit policy lives (issuedAssetsApi.js), an HR-owned
  // setting, not just branding.
  { id: 'branding', label: 'Company Settings', icon: Palette, Component: CompanyBrandingPanel, roles: ['admin', 'super_admin', 'hr_admin'] },
  { id: 'form-report-settings', label: 'Form & Report Settings', icon: LayoutTemplate, Component: FormReportSettingsPanel },
  { id: 'steel-catalog', label: 'Steel Inventory Catalog', icon: Layers, Component: SteelCatalogPanel },
];

// Standalone routed pages (not query-param tabs) that still belong in the
// Admin nav — rendered as Link items alongside the tab buttons above. Most
// require full admin (see hasLinkAccess), but a link can opt into a narrower
// `roles` allowlist the same way TABS above can — PTO Policies also admits
// hr_admin/payroll_admin, since it's an HR-owned configuration, not a
// platform-admin one.
const NAV_LINKS = [
  { path: '/audit-trail', label: 'Audit Trail', icon: ScrollText },
  { path: '/admin/employees', label: 'Employees', icon: UserCog },
  { path: '/admin/cost-codes', label: 'Cost Codes', icon: Tags },
  { path: '/admin/delivery-pricing', label: 'Delivery Pricing', icon: Truck },
  { path: '/admin/intelligence-rules', label: 'Intelligence Rules', icon: Radar },
  { path: '/admin/service-schedules', label: 'Equipment Service Schedules', icon: Wrench },
  { path: '/admin/pto-policies', label: 'PTO Policies', icon: CalendarClock, roles: ['hr_admin', 'payroll_admin'] },
  { path: '/admin/commission-setup', label: 'Sales Commission Setup', icon: DollarSign },
  { path: '/admin/salesman-rates', label: 'Salesman Commission Rates', icon: Percent, roles: ['hr_admin', 'payroll_admin'] },
];

export default function Admin() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const requestedTab = searchParams.get('tab') || 'users';
  const setActiveTab = (id) => setSearchParams({ tab: id });
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.auth.me().then(u => { setCurrentUser(u); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <Loader2 className="w-8 h-8 text-primary animate-spin" />
    </div>
  );

  const userRoles = currentUser?.roles || [];
  const normalizedRoles = userRoles.map(r => String(r).toLowerCase());
  const isAdmin = isAdminUser(currentUser);

  // Most tabs require full admin access. A tab can opt into a narrower
  // `roles` allowlist (case-insensitive) to also admit users who aren't
  // full admins — e.g. hr_admin viewing only "Roles & Permissions".
  const hasTabAccess = (tab) => isAdmin || (tab.roles || []).some(r => normalizedRoles.includes(r.toLowerCase()));
  const visibleTabs = TABS.filter(hasTabAccess);
  const visibleNavLinks = NAV_LINKS.filter(hasTabAccess);

  if (visibleTabs.length === 0 && visibleNavLinks.length === 0) return (
    <div className="flex flex-col items-center justify-center h-96 gap-3">
      <ShieldCheck className="w-12 h-12 text-muted-foreground" />
      <h2 className="text-lg font-semibold">Admin Access Required</h2>
      <p className="text-sm text-muted-foreground">You need administrator privileges to access this module.</p>
    </div>
  );

  const activeTabObj = visibleTabs.find(t => t.id === requestedTab) || visibleTabs[0];
  const Active = activeTabObj?.Component;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader title="Admin & System Configuration" subtitle="Centralized master control panel for SteelOS" />
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto scrollbar-thin">
        {visibleTabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTabObj?.id === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              <Icon className="w-4 h-4" />{tab.label}
            </button>
          );
        })}
        {visibleNavLinks.map(link => {
          const Icon = link.icon;
          return (
            <Link key={link.path} to={link.path}
              className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                location.pathname === link.path ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              <Icon className="w-4 h-4" />{link.label}
            </Link>
          );
        })}
      </div>
      {Active && <Active />}
    </div>
  );
}