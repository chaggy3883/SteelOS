import { ListChecks, Calculator, TrendingUp, History, Plus, FolderKanban, FileEdit, Factory, Truck, DollarSign, Activity, PackageCheck, CalendarClock, AlertTriangle } from 'lucide-react';
import { db } from '@/api/apiClient';

export const ALL_MODULES = [
  { path: '/', label: 'Dashboard' },
  { path: '/estimating', label: 'Estimating' },
  { path: '/estimating/analytics', label: 'Historical Analytics' },
  { path: '/estimating/spec-review', label: 'Front-End Spec Review' },
  { path: '/projects', label: 'Projects' },
  { path: '/intelligence', label: 'Intelligence' },
  { path: '/intelligence-signals', label: 'Intelligence Signals' },
  { path: '/crm', label: 'CRM' },
  { path: '/purchasing', label: 'Purchasing' },
  { path: '/purchasing/module', label: 'Procurement Module' },
  { path: '/purchasing/receiving-kiosk', label: 'Receiving Kiosk' },
  { path: '/inventory', label: 'Inventory' },
  { path: '/production', label: 'Production' },
  { path: '/shop-fabrication', label: 'Shop Fabrication' },
  { path: '/shop-operations', label: 'Shop Operations' },
  { path: '/shop-floor-command-center', label: 'Shop Floor Command Center' },
  { path: '/shipping', label: 'Shipping' },
  { path: '/quality', label: 'Quality' },
  { path: '/quality/kpi-builder', label: 'KPI Builder' },
  { path: '/safety', label: 'Safety' },
  { path: '/documents', label: 'Documents' },
  { path: '/rfis', label: 'RFIs' },
  { path: '/accounting', label: 'Accounting' },
  { path: '/reports', label: 'Reports' },
  { path: '/legal', label: 'Legal & Contracts' },
  { path: '/portal/login', label: 'External Gateways (Portal)' },
  { path: '/users', label: 'Users' },
  { path: '/settings', label: 'Settings' },
  { path: '/admin', label: 'Admin Panel' },
  { path: '/admin/commission-setup', label: 'Sales Commission Setup' },
  { path: '/admin/salesman-rates', label: 'Salesman Commission Rates' },
  { path: '/human-resources', label: 'Human Resources' },
  { path: '/payroll', label: 'Payroll' },
  { path: '/payroll/hours', label: 'Hours at a Glance' },
  { path: '/executive-analytics', label: 'Executive Analytics' },
  { path: '/employee-center', label: 'Employee Center' },
  { path: '/super-admin/dashboard', label: 'Super Admin Dashboard' },
  { path: '/system-integrations', label: 'System Integrations' },
  { path: '/field-operations', label: 'Field Operations' },
  { path: '/field-operations/rigging-inspection', label: 'Rigging Inspection' },
  { path: '/field-operations/equipment-service', label: 'Equipment Service' },
  { path: '/meeting-mode', label: 'Meeting Mode' },
  { path: '/sales/dashboard', label: 'Salesman Dashboard' },
];

// Every widget shares the same minW/minH floor (2x2) so the resize handle
// behaves identically no matter which tile a user is dragging — no widget
// gets a smaller minimum than any other.
const WIDGET_MIN_W = 2;
const WIDGET_MIN_H = 2;

export const WIDGET_LIBRARY = [
  { id: 'bid_list', name: 'Bid List', category: 'estimator', icon: ListChecks, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 3, description: 'Recent bids with status', route: '/estimating' },
  { id: 'active_bids_count', name: 'Active Bids', category: 'estimator', icon: Calculator, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 2, description: 'Count of in-progress bids', route: '/estimating' },
  { id: 'bid_win_rate', name: 'Bid Win %', category: 'estimator', icon: TrendingUp, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 2, description: 'Win rate percentage', route: '/estimating/analytics' },
  { id: 'bid_pricing_hold', name: 'Bid Pricing Hold', category: 'estimator', icon: AlertTriangle, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 2, description: 'Bids expiring or past their pricing hold window', route: '/estimating' },
  { id: 'bid_history', name: 'Bid History', category: 'estimator', icon: History, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 2, description: 'Won/lost/submitted trends', route: '/estimating/analytics' },
  { id: 'quick_add_bid', name: 'Quick Add Bid', category: 'estimator', icon: Plus, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 2, description: 'Fast bid creation form', route: '/estimating' },
  { id: 'active_projects', name: 'Active Projects', category: 'pm', icon: FolderKanban, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 3, description: 'Project status overview', route: '/projects' },
  { id: 'change_orders', name: 'Change Orders', category: 'pm', icon: FileEdit, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 2, description: 'Approval pipeline', route: '/rfis' },
  { id: 'fab_progress', name: 'Fab Progress', category: 'pm', icon: Factory, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 4, defaultH: 2, description: 'Fabrication progress bars', route: '/production' },
  { id: 'shipments_calendar', name: 'Shipments', category: 'pm', icon: Truck, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 3, description: 'Upcoming shipment schedule', route: '/shipping' },
  { id: 'invoiced_vs_remaining', name: 'Invoiced vs Remaining', category: 'pm', icon: DollarSign, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 2, description: 'Billing status by project', route: '/accounting' },
  { id: 'project_health_summary', name: 'Active Project Health Summary', category: 'pm', icon: Activity, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 2, description: 'Project ID, status, and tonnage health', route: '/projects' },
  { id: 'change_order_pipeline', name: 'Change Order Pipeline', category: 'pm', icon: FileEdit, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 2, description: 'COs grouped by workflow status', route: '/projects' },
  { id: 'shipments_calendar_widget', name: 'Logistics & Shipments Calendar', category: 'pm', icon: Truck, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 3, description: 'Upcoming trailer dispatch dates', route: '/shipping' },
  { id: 'buyout_variance_widget', name: 'Buyout Financial Variance', category: 'pm', icon: DollarSign, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 2, description: 'Budgeted vs actual procurement spend', route: '/purchasing/module' },
  { id: 'pending_requisition_approvals_widget', name: 'Pending Requisition Approvals', category: 'pm', icon: Activity, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 2, description: 'Requisitions awaiting executive approval', route: '/purchasing/module' },
  { id: 'material_received_tracker_widget', name: 'Material Received Tracker', category: 'pm', icon: PackageCheck, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 2, description: 'Recent receiving log status by PO', route: '/purchasing/receiving-kiosk' },
  { id: 'interviews_calendar', name: 'Interviews', category: 'hr', icon: CalendarClock, minW: WIDGET_MIN_W, minH: WIDGET_MIN_H, defaultW: 2, defaultH: 3, description: 'Upcoming candidate interview schedule', route: '/human-resources' },
];

export const BUILTIN_ROLES = [
  { name: 'admin', label: 'Admin', is_system: true, description: 'Full system access', allowed_modules: ['*'], allowed_widgets: ['*'] },
  { name: 'estimator', label: 'Estimator', is_system: true, description: 'Estimating, BID Worksheet, CRM', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder','/estimating', '/estimating/analytics', '/estimating/spec-review', '/projects', '/crm', '/intelligence', '/intelligence-signals', '/documents', '/rfis', '/portal/login'], allowed_widgets: ['bid_list', 'active_bids_count', 'bid_win_rate', 'bid_pricing_hold', 'bid_history', 'quick_add_bid'] },
  { name: 'project_manager', label: 'Project Manager', is_system: true, description: 'Job Tracking, Change Orders, Logistics, Billing', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder','/projects', '/production', '/shipping', '/field-operations', '/field-operations/rigging-inspection', '/field-operations/equipment-service', '/accounting', '/documents', '/rfis', '/reports', '/payroll/hours', '/intelligence-signals', '/meeting-mode', '/portal/login'], allowed_widgets: ['active_projects', 'change_orders', 'fab_progress', 'shipments_calendar', 'invoiced_vs_remaining', 'project_health_summary', 'change_order_pipeline', 'shipments_calendar_widget', 'pending_requisition_approvals_widget', 'material_received_tracker_widget'] },
  { name: 'purchasing_agent', label: 'Purchasing Agent', is_system: true, description: 'Purchasing & vendor management', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder','/purchasing', '/purchasing/module', '/purchasing/receiving-kiosk', '/crm', '/inventory', '/portal/login'], allowed_widgets: ['buyout_variance_widget', 'pending_requisition_approvals_widget'] },
  { name: 'shop_manager', label: 'Shop Manager', is_system: true, description: 'Production & quality oversight', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder','/production', '/quality', '/safety', '/inventory', '/shop-operations', '/shop-floor-command-center', '/field-operations', '/field-operations/rigging-inspection', '/field-operations/equipment-service', '/payroll/hours', '/intelligence-signals', '/meeting-mode'], allowed_widgets: ['fab_progress'] },
  { name: 'inspector', label: 'Inspector', is_system: true, description: 'Quality inspection', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder','/quality', '/documents'], allowed_widgets: [] },
  { name: 'warehouse_clerk', label: 'Warehouse Clerk', is_system: true, description: 'Inventory & shipping', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder','/inventory', '/shipping'], allowed_widgets: ['shipments_calendar'] },
  { name: 'hr_admin', label: 'HR Admin', is_system: true, description: 'User management, accounting, and personnel records', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder','/users', '/accounting', '/admin', '/admin/salesman-rates', '/human-resources', '/payroll/setup', '/portal/login'], allowed_widgets: ['interviews_calendar'] },
  { name: 'payroll_admin', label: 'Payroll Admin', is_system: true, description: 'Payroll and personnel compensation records', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder','/accounting', '/human-resources', '/payroll', '/payroll/hours', '/payroll/setup', '/payroll/processing', '/admin/salesman-rates', '/certified-payroll', '/portal/login'], allowed_widgets: ['interviews_calendar'] },
  { name: 'president', label: 'President', is_system: true, description: 'Executive visibility', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder','/estimating', '/estimating/analytics', '/estimating/spec-review', '/projects', '/crm', '/accounting', '/reports', '/executive-analytics', '/admin', '/legal', '/intelligence-signals', '/meeting-mode', '/portal/login'], allowed_widgets: ['bid_list', 'active_bids_count', 'bid_history', 'active_projects', 'invoiced_vs_remaining', 'pending_requisition_approvals_widget'] },
  { name: 'ceo', label: 'CEO', is_system: true, description: 'Executive visibility', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder','/estimating', '/estimating/analytics', '/estimating/spec-review', '/projects', '/crm', '/accounting', '/reports', '/executive-analytics', '/admin', '/legal', '/intelligence-signals', '/meeting-mode', '/portal/login'], allowed_widgets: ['bid_list', 'active_bids_count', 'bid_history', 'active_projects', 'invoiced_vs_remaining', 'pending_requisition_approvals_widget'] },
  { name: 'finance_department', label: 'Finance Department', is_system: true, description: 'Financial review access', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder','/accounting', '/estimating', '/estimating/analytics', '/estimating/spec-review', '/reports', '/executive-analytics', '/intelligence-signals', '/meeting-mode', '/portal/login'], allowed_widgets: ['bid_list', 'active_bids_count', 'bid_history', 'invoiced_vs_remaining'] },
  // No /human-resources: Controller is an accounting role (month-end close,
  // cost accounting) with payroll approve/lock authority (see
  // payrollApprovalAccess.js) — that doesn't extend to editing employee HR
  // records (ATS, employee files, emergency contacts), which stays with
  // hr_admin/payroll_admin.
  { name: 'controller', label: 'Controller', is_system: true, description: 'Month-end close, budgeting, cash management, and cost accounting oversight', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder', '/accounting', '/payroll', '/payroll/hours', '/payroll/setup', '/payroll/processing', '/certified-payroll', '/reports', '/executive-analytics', '/intelligence-signals', '/meeting-mode'], allowed_widgets: ['invoiced_vs_remaining', 'buyout_variance_widget', 'pending_requisition_approvals_widget'] },
  { name: 'user', label: 'General User', is_system: true, description: 'Basic dashboard access', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder','/documents', '/inventory'], allowed_widgets: [] },
  { name: 'super_admin', label: 'Super Admin', is_system: true, description: 'Platform operator — cross-tenant support access, no home tenant', allowed_modules: ['/super-admin/dashboard', '/employee-center'], allowed_widgets: [] },
  { name: 'Maintenance_Manager', label: 'Maintenance Manager', is_system: true, description: 'Exclusive write access to the Field Operations fleet, repair, and rigging ledgers', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder', '/field-operations', '/field-operations/rigging-inspection', '/field-operations/equipment-service'], allowed_widgets: [] },
  { name: 'salesman', label: 'Salesman', is_system: true, description: 'Personal sales pipeline, commission tracking, and RFI/CO/addenda visibility on projects they sold', allowed_modules: ['/', '/employee-center', '/quality/kpi-builder', '/sales/dashboard', '/portal/login'], allowed_widgets: [] },
];

export function isModuleAllowed(path, allowedModules) {
  if (allowedModules.includes('*')) return true;
  return allowedModules.includes(path);
}

export function isWidgetAllowed(widgetId, allowedWidgets) {
  if (allowedWidgets.includes('*')) return true;
  return allowedWidgets.includes(widgetId);
}

export function getWidgetById(id) {
  return WIDGET_LIBRARY.find(w => w.id === id);
}

// Native CSS grid layout (see src/pages/Dashboard.jsx) — every widget starts
// at the baseline 1x1 footprint; users size up to 2x2/3x2 via the per-widget
// size-snap tray in edit mode. No x/y pixel positioning: items just flow in
// array order through a plain `grid-cols-4` container, which is what makes
// this consistent across different machines/screen sizes (the thing
// react-grid-layout's JS-calculated pixel positioning was not).
export function getDefaultLayout(widgetIds) {
  return widgetIds.map((id) => {
    const w = getWidgetById(id);
    if (!w) return null;
    return { i: id, size: '1x1' };
  }).filter(Boolean);
}

export function normalizeRoleName(roleName) {
  if (!roleName) return 'user';
  const normalized = String(roleName).toLowerCase().trim();
  const aliases = {
    'system_administrator': 'admin',
    'demo_admin': 'admin',
    'demo admin': 'admin',
    'demo-admin': 'admin',
    'projectmanager': 'project_manager',
    'project manager': 'project_manager',
    'project-manager': 'project_manager',
    'purchasingagent': 'purchasing_agent',
    'purchasing agent': 'purchasing_agent',
    'purchasing-agent': 'purchasing_agent',
    'shopmanager': 'shop_manager',
    'shop manager': 'shop_manager',
    'shop-manager': 'shop_manager',
    // BUILTIN_ROLES.name for this one is 'Maintenance_Manager' (mixed case,
    // as explicitly specified), but this function always lowercases its
    // input first — this alias maps that lowercased form back to the exact
    // stored casing so getUserPermissions' `r.name === normalizedRole` match
    // actually succeeds instead of silently granting zero permissions.
    'maintenance_manager': 'Maintenance_Manager',
    'maintenance manager': 'Maintenance_Manager',
    'maintenance-manager': 'Maintenance_Manager',
  };
  return aliases[normalized] || normalized;
}

// Accepts a single role name or an array of role names (multi-role users) and
// returns the UNION of every matching role's allowed modules/widgets.
export async function getUserPermissions(roleNames) {
  const names = Array.isArray(roleNames) ? roleNames : [roleNames];
  const modules = new Set();
  const widgets = new Set();

  for (const roleName of names) {
    const normalizedRole = normalizeRoleName(roleName);
    const builtin = BUILTIN_ROLES.find(r => r.name === normalizedRole);
    if (builtin) {
      builtin.allowed_modules.forEach(m => modules.add(m));
      builtin.allowed_widgets.forEach(w => widgets.add(w));
      continue;
    }
    try {
      const custom = await db.entities.CustomRole.filter({ role_name: normalizedRole }, '-created_date', 1);
      if (custom.length > 0) {
        (custom[0].allowed_modules || ['/']).forEach(m => modules.add(m));
        (custom[0].allowed_widgets || []).forEach(w => widgets.add(w));
      }
    } catch (e) {}
  }

  if (modules.size === 0) modules.add('/');
  return { modules: Array.from(modules), widgets: Array.from(widgets) };
}

export async function getAllRoles() {
  const builtin = BUILTIN_ROLES.map(r => ({ value: r.name, label: r.label, color: 'bg-blue-500/10 text-blue-500' }));
  try {
    const custom = await db.entities.CustomRole.filter({ is_active: true }, '-created_date', 50);
    const customRoles = custom.map(r => ({ value: r.role_name, label: r.label, color: 'bg-indigo-500/10 text-indigo-500' }));
    return [...builtin, ...customRoles];
  } catch (e) {
    return builtin;
  }
}