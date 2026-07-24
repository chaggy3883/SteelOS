import { ListChecks, Calculator, TrendingUp, History, Plus, FolderKanban, FileEdit, Factory, Truck, DollarSign, Activity } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export const ALL_MODULES = [
  { path: '/', label: 'Dashboard' },
  { path: '/estimating', label: 'Estimating' },
  { path: '/projects', label: 'Projects' },
  { path: '/intelligence', label: 'Intelligence' },
  { path: '/crm', label: 'CRM' },
  { path: '/purchasing', label: 'Purchasing' },
  { path: '/inventory', label: 'Inventory' },
  { path: '/production', label: 'Production' },
  { path: '/shop-fabrication', label: 'Shop Fabrication' },
  { path: '/shipping', label: 'Shipping' },
  { path: '/quality', label: 'Quality' },
  { path: '/safety', label: 'Safety' },
  { path: '/documents', label: 'Documents' },
  { path: '/rfis', label: 'RFIs' },
  { path: '/accounting', label: 'Accounting' },
  { path: '/reports', label: 'Reports' },
  { path: '/users', label: 'Users' },
  { path: '/settings', label: 'Settings' },
  { path: '/admin', label: 'Admin Panel' },
];

export const WIDGET_LIBRARY = [
  { id: 'bid_list', name: 'Bid List', category: 'estimator', icon: ListChecks, minW: 2, minH: 2, defaultW: 2, defaultH: 3, description: 'Recent bids with status' },
  { id: 'active_bids_count', name: 'Active Bids', category: 'estimator', icon: Calculator, minW: 1, minH: 1, defaultW: 1, defaultH: 1, description: 'Count of in-progress bids' },
  { id: 'bid_win_rate', name: 'Bid Win %', category: 'estimator', icon: TrendingUp, minW: 1, minH: 1, defaultW: 1, defaultH: 1, description: 'Win rate percentage' },
  { id: 'bid_history', name: 'Bid History', category: 'estimator', icon: History, minW: 2, minH: 2, defaultW: 2, defaultH: 2, description: 'Won/lost/submitted trends' },
  { id: 'quick_add_bid', name: 'Quick Add Bid', category: 'estimator', icon: Plus, minW: 1, minH: 2, defaultW: 1, defaultH: 2, description: 'Fast bid creation form' },
  { id: 'active_projects', name: 'Active Projects', category: 'pm', icon: FolderKanban, minW: 2, minH: 2, defaultW: 2, defaultH: 3, description: 'Project status overview' },
  { id: 'change_orders', name: 'Change Orders', category: 'pm', icon: FileEdit, minW: 2, minH: 2, defaultW: 2, defaultH: 2, description: 'Approval pipeline' },
  { id: 'fab_progress', name: 'Fab Progress', category: 'pm', icon: Factory, minW: 2, minH: 2, defaultW: 4, defaultH: 2, description: 'Fabrication progress bars' },
  { id: 'shipments_calendar', name: 'Shipments', category: 'pm', icon: Truck, minW: 2, minH: 2, defaultW: 2, defaultH: 3, description: 'Upcoming shipment schedule' },
  { id: 'invoiced_vs_remaining', name: 'Invoiced vs Remaining', category: 'pm', icon: DollarSign, minW: 2, minH: 2, defaultW: 2, defaultH: 2, description: 'Billing status by project' },
  { id: 'project_health_summary', name: 'Active Project Health Summary', category: 'pm', icon: Activity, minW: 2, minH: 2, defaultW: 2, defaultH: 2, description: 'Project ID, status, and tonnage health' },
  { id: 'change_order_pipeline', name: 'Change Order Pipeline', category: 'pm', icon: FileEdit, minW: 2, minH: 2, defaultW: 2, defaultH: 2, description: 'COs grouped by workflow status' },
  { id: 'shipments_calendar_widget', name: 'Logistics & Shipments Calendar', category: 'pm', icon: Truck, minW: 2, minH: 2, defaultW: 2, defaultH: 3, description: 'Upcoming trailer dispatch dates' },
  { id: 'buyout_variance_widget', name: 'Buyout Financial Variance', category: 'pm', icon: DollarSign, minW: 2, minH: 2, defaultW: 2, defaultH: 2, description: 'Budgeted vs actual procurement spend' },
  { id: 'pending_requisition_approvals_widget', name: 'Pending Requisition Approvals', category: 'pm', icon: Activity, minW: 2, minH: 2, defaultW: 2, defaultH: 2, description: 'Requisitions awaiting executive approval' },
];

export const BUILTIN_ROLES = [
  { name: 'admin', label: 'Admin', is_system: true, description: 'Full system access', allowed_modules: ['*'], allowed_widgets: ['*'] },
  { name: 'estimator', label: 'Estimator', is_system: true, description: 'Estimating, BID Worksheet, CRM', allowed_modules: ['/', '/estimating', '/projects', '/crm', '/intelligence', '/documents', '/rfis'], allowed_widgets: ['bid_list', 'active_bids_count', 'bid_win_rate', 'bid_history', 'quick_add_bid'] },
  { name: 'project_manager', label: 'Project Manager', is_system: true, description: 'Job Tracking, Change Orders, Logistics, Billing', allowed_modules: ['/', '/projects', '/production', '/shipping', '/accounting', '/documents', '/rfis', '/reports'], allowed_widgets: ['active_projects', 'change_orders', 'fab_progress', 'shipments_calendar', 'invoiced_vs_remaining', 'project_health_summary', 'change_order_pipeline', 'shipments_calendar_widget', 'pending_requisition_approvals_widget'] },
  { name: 'purchasing_agent', label: 'Purchasing Agent', is_system: true, description: 'Purchasing & vendor management', allowed_modules: ['/', '/purchasing', '/crm', '/inventory'], allowed_widgets: ['buyout_variance_widget', 'pending_requisition_approvals_widget'] },
  { name: 'shop_manager', label: 'Shop Manager', is_system: true, description: 'Production & quality oversight', allowed_modules: ['/', '/production', '/quality', '/safety', '/inventory'], allowed_widgets: ['fab_progress'] },
  { name: 'inspector', label: 'Inspector', is_system: true, description: 'Quality inspection', allowed_modules: ['/', '/quality', '/documents'], allowed_widgets: [] },
  { name: 'warehouse_clerk', label: 'Warehouse Clerk', is_system: true, description: 'Inventory & shipping', allowed_modules: ['/', '/inventory', '/shipping'], allowed_widgets: ['shipments_calendar'] },
  { name: 'hr_admin', label: 'HR Admin', is_system: true, description: 'User management & accounting', allowed_modules: ['/', '/users', '/accounting', '/admin'], allowed_widgets: [] },
  { name: 'president', label: 'President', is_system: true, description: 'Executive visibility', allowed_modules: ['/', '/estimating', '/projects', '/crm', '/accounting', '/reports', '/admin'], allowed_widgets: ['bid_list', 'active_bids_count', 'bid_history', 'active_projects', 'invoiced_vs_remaining'] },
  { name: 'ceo', label: 'CEO', is_system: true, description: 'Executive visibility', allowed_modules: ['/', '/estimating', '/projects', '/crm', '/accounting', '/reports', '/admin'], allowed_widgets: ['bid_list', 'active_bids_count', 'bid_history', 'active_projects', 'invoiced_vs_remaining'] },
  { name: 'finance_department', label: 'Finance Department', is_system: true, description: 'Financial review access', allowed_modules: ['/', '/accounting', '/estimating', '/reports'], allowed_widgets: ['bid_list', 'active_bids_count', 'bid_history', 'invoiced_vs_remaining'] },
  { name: 'user', label: 'General User', is_system: true, description: 'Basic dashboard access', allowed_modules: ['/'], allowed_widgets: [] },
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

export function getDefaultLayout(widgetIds) {
  return widgetIds.map((id, i) => {
    const w = getWidgetById(id);
    if (!w) return null;
    return { i: id, x: (i % 2) * 2, y: Math.floor(i / 2) * 2, w: w.defaultW, h: w.defaultH };
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
  };
  return aliases[normalized] || normalized;
}

export async function getUserPermissions(roleName) {
  const normalizedRole = normalizeRoleName(roleName);
  const builtin = BUILTIN_ROLES.find(r => r.name === normalizedRole);
  if (builtin) return { modules: builtin.allowed_modules, widgets: builtin.allowed_widgets };
  try {
    const custom = await base44.entities.CustomRole.filter({ role_name: normalizedRole }, '-created_date', 1);
    if (custom.length > 0) {
      return { modules: custom[0].allowed_modules || ['/'], widgets: custom[0].allowed_widgets || [] };
    }
  } catch (e) {}
  return { modules: ['/'], widgets: [] };
}

export async function getAllRoles() {
  const builtin = BUILTIN_ROLES.map(r => ({ value: r.name, label: r.label, color: 'bg-blue-500/10 text-blue-500' }));
  try {
    const custom = await base44.entities.CustomRole.filter({ is_active: true }, '-created_date', 50);
    const customRoles = custom.map(r => ({ value: r.role_name, label: r.label, color: 'bg-indigo-500/10 text-indigo-500' }));
    return [...builtin, ...customRoles];
  } catch (e) {
    return builtin;
  }
}