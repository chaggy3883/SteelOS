// Single source of truth for the app shell's navigation (AppSidebar.jsx).
// Groups, items and routes mirror .claude/steelos-dev/NAV_INVENTORY.md, plus
// the previously orphaned pages that were approved for the redesign
// (Submittals, Intelligence Signals, Material Optimization and the Core
// "Admin Setup" section). Every path must be a real route in src/App.jsx —
// scratchpad nav checks assert that.
//
// This file stays plain data (no '@/' imports) so a node script can load it.
// Visibility is NOT decided here: AppSidebar runs each item through the same
// filters the old NavBar used — isModuleAllowed(path, roleModules),
// hasModule(company, path), the real-super_admin-only rule and the kiosk PIN
// group hide — plus, where an item sets `access`, the page's own role guard
// (see ITEM_ACCESS_CHECKS in AppSidebar.jsx). Those only ever narrow.
//
// Item fields:
//   path            router path (used for gating and active matching)
//   query           optional '?tab=…' appended to the link; the item is only
//                   active when the URL's params match it
//   section         optional sub-heading inside the group
//   superAdminOnly  shown only to a real super_admin session
//   access          optional page-guard key, AND-ed with the filters above
//   moduleKey       optional module-pack key for hasModule() when the path
//                   itself isn't in modulePacks.js. Only the Admin Setup
//                   items use it ('/admin'): those pages are already linked
//                   from Admin Panel (Admin.jsx NAV_LINKS) for every tenant
//                   whose pack grants '/admin', with no further pack check,
//                   so this exposes nothing new. Role gating
//                   (isModuleAllowed) still uses the item's own path.
import {
  Calculator, FolderKanban, Brain, Building2,
  ShoppingCart, Package, Factory, Truck, CheckSquare, Shield, Wrench,
  FileText, MessageSquare, BarChart3, DollarSign, Users, Settings,
  ShieldCheck, Zap, House, Scale, ClipboardList, PackageCheck,
  Globe, Handshake, UserCog, Gauge, KeyRound, ShieldAlert, HardHat, FileSearch, FileEdit, FileSignature, FileCheck2, Crosshair, CalendarClock, Monitor, Presentation, PlayCircle, LineChart, Percent, FileStack,
  Radar, Scissors, ScrollText, Tags, Wallet, Briefcase, TrendingUp, LayoutGrid,
} from 'lucide-react';

export const HOME_ITEM = { icon: House, label: 'Home', path: '/' };

export const ADMIN_SETUP_SECTION = 'Admin Setup';

export const NAV_GROUPS = [
  {
    id: 'core',
    label: 'Core',
    icon: LayoutGrid,
    items: [
      { icon: ShieldCheck, label: 'Admin Panel', path: '/admin' },
      { icon: Users, label: 'Users', path: '/users' },
      { icon: UserCog, label: 'Human Resources', path: '/human-resources' },
      { icon: KeyRound, label: 'Employee Center', path: '/employee-center' },
      { icon: Settings, label: 'Settings', path: '/settings' },
      { icon: ShieldAlert, label: 'Super Admin', path: '/super-admin/dashboard', superAdminOnly: true },
      { icon: Zap, label: 'System Integrations', path: '/system-integrations' },
      // Admin subpages — previously reachable only from Admin Panel's link
      // list (Admin.jsx NAV_LINKS). Same routes, same page guards. Shown
      // only when the role passes isModuleAllowed on the exact path (so
      // in practice admin '*' roles and impersonating super_admins) AND the
      // page's own guard; hr_admin/payroll_admin/estimator still reach the
      // ones their pages admit through Admin Panel, as before.
      { icon: ScrollText, label: 'Audit Trail', path: '/audit-trail', section: ADMIN_SETUP_SECTION, moduleKey: '/admin', access: 'admin' },
      { icon: UserCog, label: 'Employees', path: '/admin/employees', section: ADMIN_SETUP_SECTION, moduleKey: '/admin', access: 'admin' },
      { icon: Tags, label: 'Cost Codes', path: '/admin/cost-codes', section: ADMIN_SETUP_SECTION, moduleKey: '/admin', access: 'admin' },
      { icon: Radar, label: 'Intelligence Rules', path: '/admin/intelligence-rules', section: ADMIN_SETUP_SECTION, moduleKey: '/admin', access: 'admin' },
      { icon: Wrench, label: 'Service Schedules', path: '/admin/service-schedules', section: ADMIN_SETUP_SECTION, moduleKey: '/admin', access: 'admin' },
      { icon: DollarSign, label: 'Commission Setup', path: '/admin/commission-setup', section: ADMIN_SETUP_SECTION, moduleKey: '/admin', access: 'admin' },
      { icon: Percent, label: 'Salesman Rates', path: '/admin/salesman-rates', section: ADMIN_SETUP_SECTION, moduleKey: '/admin', access: 'salesmanRates' },
      { icon: HardHat, label: 'T&M Labor Rates', path: '/admin/tm-labor-rates', section: ADMIN_SETUP_SECTION, moduleKey: '/admin', access: 'tmLaborRates' },
      { icon: Package, label: 'Material Catalog', path: '/admin/material-catalog', section: ADMIN_SETUP_SECTION, moduleKey: '/admin', access: 'materialCatalog' },
      { icon: Truck, label: 'Bid Worksheet Rates', path: '/admin/bid-worksheet-rates', section: ADMIN_SETUP_SECTION, moduleKey: '/admin', access: 'bidWorksheetRates' },
    ]
  },
  {
    id: 'estimating',
    label: 'Estimating',
    icon: Calculator,
    items: [
      { icon: Calculator, label: 'Estimating', path: '/estimating' },
      { icon: BarChart3, label: 'Historical Analytics', path: '/estimating/analytics' },
      { icon: FileSearch, label: 'Front-End Spec Review', path: '/estimating/spec-review' },
      { icon: Crosshair, label: 'IRONSIGHT', path: '/estimating/blueprint-takeoff' },
      { icon: Building2, label: 'CRM', path: '/crm' },
      { icon: Users, label: 'Relationship Manager', path: '/crm/directory' },
      { icon: Brain, label: 'Intelligence', path: '/intelligence' },
      { icon: Radar, label: 'Intelligence Signals', path: '/intelligence-signals' },
    ]
  },
  {
    id: 'production',
    label: 'Production & Project Management',
    icon: FolderKanban,
    items: [
      { icon: FolderKanban, label: 'Projects', path: '/projects' },
      { icon: FileEdit, label: 'Change Orders', path: '/projects/change-orders' },
      { icon: FileSignature, label: 'Subcontracts', path: '/subcontracts' },
      { icon: MessageSquare, label: 'RFIs', path: '/rfis' },
      { icon: ClipboardList, label: 'Submittals', path: '/submittals' },
      { icon: Factory, label: 'Production', path: '/production' },
      { icon: Truck, label: 'Shipping', path: '/shipping' },
      { icon: Wrench, label: 'Shop Fabrication', path: '/shop-fabrication' },
      { icon: Gauge, label: 'Shop Operations', path: '/shop-operations' },
      { icon: Monitor, label: 'Shop Floor Command Center', path: '/shop-floor-command-center' },
      { icon: Gauge, label: 'Shop Efficiency', path: '/shop-efficiency' },
      { icon: FileStack, label: 'Detailer Imports', path: '/detailer-imports' },
      { icon: Scissors, label: 'Material Optimization', path: '/material-optimization' },
      { icon: HardHat, label: 'Field Operations', path: '/field-operations' },
    ]
  },
  {
    // Executive Analytics and Meeting Mode both live in TRUE_MINIMAL_SHARED
    // (see modulePacks.js) — every pack, including Shop Fab, gets them, so
    // they get their own group rather than stranding them under back-office
    // functions a Shop Fab tenant doesn't have.
    id: 'insights',
    label: 'Insights',
    icon: TrendingUp,
    items: [
      { icon: Gauge, label: 'Executive Analytics', path: '/executive-analytics' },
      // Renders outside AppLayout (full-bleed presentation surface); its own
      // Exit link returns to '/'.
      { icon: Presentation, label: 'Meeting Mode', path: '/meeting-mode' },
    ]
  },
  {
    id: 'payroll',
    label: 'Payroll',
    icon: Wallet,
    items: [
      { icon: CalendarClock, label: 'Hours at a Glance', path: '/payroll/hours' },
      { icon: PlayCircle, label: 'Run Payroll', path: '/payroll/processing' },
      { icon: Settings, label: 'Payroll Setup', path: '/payroll/setup' },
      { icon: FileCheck2, label: 'Certified Payroll', path: '/certified-payroll' },
      { icon: Scale, label: 'Garnishments', path: '/payroll/garnishments' },
      { icon: Percent, label: '401(k) Contributions', path: '/payroll/401k-contributions' },
      { icon: CalendarClock, label: 'PTO Policies', path: '/admin/pto-policies' },
    ]
  },
  {
    id: 'purchasing',
    label: 'Purchasing & Procurement',
    icon: ShoppingCart,
    items: [
      { icon: ShoppingCart, label: 'Purchasing', path: '/purchasing' },
      { icon: ClipboardList, label: 'Procurement Module', path: '/purchasing/module' },
      { icon: PackageCheck, label: 'Receiving Kiosk', path: '/purchasing/receiving-kiosk' },
    ]
  },
  {
    id: 'accounting',
    label: 'Accounting & Job Costing',
    icon: DollarSign,
    items: [
      { icon: DollarSign, label: 'Accounting', path: '/accounting' },
      { icon: Scale, label: 'Legal & Contracts', path: '/legal' },
      { icon: BarChart3, label: 'Reports', path: '/reports' },
    ]
  },
  {
    id: 'gateways',
    label: 'External Gateways',
    icon: Globe,
    items: [
      { icon: Globe, label: 'Customer Portal Setup', path: '/admin', query: '?tab=integrations' },
      { icon: Handshake, label: 'Vendor Portal Setup', path: '/admin', query: '?tab=crm' },
      { icon: ShieldCheck, label: 'Portal Access Links', path: '/admin', query: '?tab=integrations' },
    ]
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: Package,
    items: [
      { icon: Package, label: 'Inventory', path: '/inventory' },
    ]
  },
  {
    id: 'quality',
    label: 'Quality & Safety',
    icon: Shield,
    items: [
      { icon: CheckSquare, label: 'Quality', path: '/quality' },
      { icon: LineChart, label: 'KPI Builder', path: '/quality/kpi-builder' },
      { icon: Shield, label: 'Safety', path: '/safety' },
      { icon: FileText, label: 'Documents', path: '/documents' },
    ]
  },
  {
    id: 'sales',
    label: 'Sales',
    icon: Briefcase,
    items: [
      { icon: Percent, label: 'My Sales Dashboard', path: '/sales/dashboard' },
    ]
  },
];

// Sandboxed Kiosk Navigation Block — an Employee-PIN session (the local
// auth mock's synthetic session from loginViaEmployeePin) is a shared
// shop-floor terminal identity, not a real app account. Its 'user' role
// still legitimately grants /inventory and /documents for non-kiosk general
// users, so this can't be fixed in rbacConfig — it's hard-removed by group
// label regardless of role-derived modules.
export const KIOSK_SESSION_HIDDEN_GROUPS = ['Inventory', 'Quality & Safety'];

export const itemHref = (item) => item.path + (item.query || '');

export const itemKey = (group, item) => `${group?.id || 'top'}|${item.label}`;
