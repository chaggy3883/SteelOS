// Permission catalog — two consumers, two different ages.
//
// 1) LEGACY per-employee tab overrides (still live, frozen to new writes).
// This denylist layer (an employee/user's `permission_overrides` narrowing
// their role's baseline) has been superseded by a roles-only model: role
// determines allowed_modules, period (see rbacConfig.jsx, NavBar.jsx). There
// is no remaining UI anywhere that lets an admin edit `permission_overrides`
// (PermissionsGridPanel.jsx, its Users.jsx/EmployeeProfileDialog.jsx mount
// points, was removed) — module-level enforcement in NavBar.jsx was removed
// with it. What's left, kept only for backward compatibility with
// pre-existing demo data: HumanResources.jsx and EmployeeCenter.jsx still
// read their own `tab:` keys from an employee's `permission_overrides` to
// hide individual tabs. Since nothing can write new values into that array
// anymore, this is effectively frozen/legacy behavior for records that
// already had overrides set — not an active permission-editing feature.
//
// 2) CURRENT CustomRole.granular_permissions (new — see RoleManager.jsx).
// The same module:/tab: keys, PLUS a small new `action:` namespace for
// permissions that don't correspond to any single tab (e.g. "terminate an
// employee", which lives inside a profile dialog, not its own page tab),
// now double as the fine-grained permission picker for building a Custom
// Role. This is additive on top of allowed_modules/allowed_widgets, not a
// replacement — a role still needs module access to reach a page at all;
// granular_permissions narrows what it can specifically DO once there.
// Only a subset of these keys have live enforcement so far (see
// hasGranularPermission's call sites: disciplinaryAccess.js,
// TerminationPanel.jsx, HumanResources.jsx's PTO approval tab) — selecting
// any other key records the admin's intent but has no effect yet.
//
// Three key shapes:
//   module:<path>            - one of ALL_MODULES in rbacConfig.jsx (module-level access is allowed_modules' job — excluded from the granular_permissions picker as redundant)
//   tab:<modulePath>:<tabId>  - a TabsTrigger value inside that module's page
//   action:<name>             - a cross-cutting action not tied to any one tab
//
// Employee Center is permanently on: it's the mobile time-clock/self-service
// surface every worker needs regardless of what else is restricted. It's
// also excluded from the granular_permissions picker — its tabs are an
// employee's own self-service views, not something one role grants over
// another employee.
export const LOCKED_MODULE_KEY = 'module:/employee-center';

// action: keys — see GRANULAR_ACTIONS below for the exported constants.
const ACTION_APPROVE_PTO = 'action:hr.pto.approve';
const ACTION_TERMINATE_EMPLOYEE = 'action:hr.employee.terminate';
const ACTION_MANAGE_DISCIPLINARY = 'action:hr.disciplinary.manage';

export const GRANULAR_ACTIONS = {
  APPROVE_PTO: ACTION_APPROVE_PTO,
  TERMINATE_EMPLOYEE: ACTION_TERMINATE_EMPLOYEE,
  MANAGE_DISCIPLINARY: ACTION_MANAGE_DISCIPLINARY,
};

export const PERMISSION_CATALOG = [
  { key: 'module:/', label: 'Dashboard', category: 'General' },
  { key: 'module:/estimating', label: 'Estimating', category: 'Estimating', tabs: [
    { key: 'tab:/estimating:smart-file-dump', label: 'Smart File Dump' },
    { key: 'tab:/estimating:bid-worksheet', label: 'BID Worksheet' },
    { key: 'tab:/estimating:full-takeoff', label: 'Full Takeoff' },
    { key: 'tab:/estimating:vendor-pricing', label: 'Vendor Pricing' },
    { key: 'tab:/estimating:scope-text', label: 'Scope Text' },
    { key: 'tab:/estimating:ai-review', label: 'AI Review' },
    { key: 'tab:/estimating:ai-contract-review', label: 'AI Contract Review' },
  ] },
  { key: 'module:/estimating/analytics', label: 'Historical Analytics', category: 'Estimating' },
  { key: 'module:/estimating/spec-review', label: 'Front-End Spec Review', category: 'Estimating' },
  { key: 'module:/projects', label: 'Projects', category: 'Project Management', tabs: [
    { key: 'tab:/projects:overview', label: 'Overview' },
    { key: 'tab:/projects:documents', label: 'Documents' },
    { key: 'tab:/projects:ai-findings', label: 'AI Findings' },
    { key: 'tab:/projects:rfis', label: 'RFIs' },
    { key: 'tab:/projects:pieces', label: 'Pieces' },
  ] },
  { key: 'module:/intelligence', label: 'Intelligence', category: 'Intelligence', tabs: [
    { key: 'tab:/intelligence:estimating', label: 'Estimating Review' },
    { key: 'tab:/intelligence:quality_assurance', label: 'Quality Assurance Review' },
    { key: 'tab:/intelligence:safety', label: 'Safety Review' },
    { key: 'tab:/intelligence:purchasing', label: 'Purchasing Review' },
    { key: 'tab:/intelligence:accounting', label: 'Accounting Review' },
    { key: 'tab:/intelligence:executive', label: 'Executive Review' },
  ] },
  { key: 'module:/crm', label: 'CRM', category: 'Sales & CRM' },
  { key: 'module:/purchasing', label: 'Purchasing', category: 'Purchasing', tabs: [
    { key: 'tab:/purchasing:reorder-alerts', label: 'Reorder Alerts' },
    { key: 'tab:/purchasing:ai-flags', label: 'AI Purchasing Flags' },
    { key: 'tab:/purchasing:all-inventory', label: 'All Inventory' },
  ] },
  { key: 'module:/purchasing/module', label: 'Procurement Module', category: 'Purchasing', tabs: [
    { key: 'tab:/purchasing/module:mill-buyout', label: 'Mill Buyout Dashboard' },
    { key: 'tab:/purchasing/module:requisitions', label: 'Project Requisitions' },
    { key: 'tab:/purchasing/module:receiving', label: 'Receiving Portal' },
    { key: 'tab:/purchasing/module:three-way-match', label: 'Three-Way Match' },
  ] },
  { key: 'module:/purchasing/receiving-kiosk', label: 'Receiving Kiosk', category: 'Purchasing' },
  { key: 'module:/inventory', label: 'Inventory', category: 'Inventory & Warehouse', tabs: [
    { key: 'tab:/inventory:list', label: 'Inventory List' },
    { key: 'tab:/inventory:3d-warehouse', label: '3D Warehouse' },
  ] },
  { key: 'module:/production', label: 'Production', category: 'Shop Floor' },
  { key: 'module:/shop-fabrication', label: 'Shop Fabrication', category: 'Shop Floor', tabs: [
    { key: 'tab:/shop-fabrication:work-logs', label: 'Work Logs' },
    { key: 'tab:/shop-fabrication:qa-queue', label: 'QA Queue' },
    { key: 'tab:/shop-fabrication:pieces', label: 'Pieces' },
  ] },
  { key: 'module:/shop-operations', label: 'Shop Operations', category: 'Shop Floor', tabs: [
    { key: 'tab:/shop-operations:scheduler-matrix', label: 'Scheduler Matrix' },
    { key: 'tab:/shop-operations:bottleneck-radar', label: 'Bottleneck Radar' },
    { key: 'tab:/shop-operations:material-overrides', label: 'Material & Overrides' },
    { key: 'tab:/shop-operations:label-printing', label: 'Label Printing' },
  ] },
  { key: 'module:/detailer-imports', label: 'Detailer Imports', category: 'Shop Floor' },
  { key: 'module:/shipping', label: 'Shipping', category: 'Shipping & Logistics', tabs: [
    { key: 'tab:/shipping:list', label: 'Shipping List' },
    { key: 'tab:/shipping:load-builder', label: 'Load Builder' },
    { key: 'tab:/shipping:yard-scanning', label: 'Yard Scanning' },
  ] },
  { key: 'module:/quality', label: 'Quality', category: 'Quality & Safety', tabs: [
    { key: 'tab:/quality:ai-findings', label: 'AI QA Findings' },
    { key: 'tab:/quality:checklist', label: 'QA Checklist' },
    { key: 'tab:/quality:certifications', label: 'Certifications' },
  ] },
  { key: 'module:/safety', label: 'Safety', category: 'Quality & Safety', tabs: [
    { key: 'tab:/safety:ai-findings', label: 'AI Safety Findings' },
    { key: 'tab:/safety:checklist', label: 'Safety Checklist' },
  ] },
  { key: 'module:/documents', label: 'Documents', category: 'General' },
  { key: 'module:/rfis', label: 'RFIs', category: 'Project Management' },
  { key: 'module:/subcontracts', label: 'Subcontracts', category: 'Legal & Contracts' },
  { key: 'module:/certified-payroll', label: 'Certified Payroll', category: 'Payroll', tabs: [
    { key: 'tab:/certified-payroll:submissions', label: 'Submissions' },
    { key: 'tab:/certified-payroll:compliance', label: 'Compliance Dashboard' },
    { key: 'tab:/certified-payroll:reports', label: 'Hancock Reports' },
  ] },
  { key: 'module:/accounting', label: 'Accounting', category: 'Accounting', tabs: [
    { key: 'tab:/accounting:job-costing-summary', label: 'Job Costing Summary' },
    { key: 'tab:/accounting:job-cost-detail', label: 'Job Cost Detail' },
    { key: 'tab:/accounting:vendor-bills', label: 'Vendor Bills (AP)' },
    { key: 'tab:/accounting:ar-billings', label: 'AR & Billings' },
    { key: 'tab:/accounting:wip-report', label: 'WIP Report' },
    { key: 'tab:/accounting:ai-financial-flags', label: 'AI Financial Flags' },
  ] },
  { key: 'module:/reports', label: 'Reports', category: 'Accounting' },
  { key: 'module:/legal', label: 'Legal & Contracts', category: 'Legal & Contracts', tabs: [
    { key: 'tab:/legal:contracts', label: 'Contracts' },
    { key: 'tab:/legal:lien-rights-radar', label: 'Lien Rights Radar' },
    { key: 'tab:/legal:audit-log', label: 'Audit Log' },
  ] },
  { key: 'module:/portal/login', label: 'External Gateways (Portal)', category: 'Administration' },
  { key: 'module:/users', label: 'Users', category: 'Administration' },
  { key: 'module:/settings', label: 'Settings', category: 'Administration', tabs: [
    { key: 'tab:/settings:company', label: 'Company' },
    { key: 'tab:/settings:ai-rules', label: 'AI Rules' },
    { key: 'tab:/settings:notifications', label: 'Notifications' },
    { key: 'tab:/settings:integrations', label: 'Integrations' },
    { key: 'tab:/settings:devices', label: 'Devices' },
  ] },
  { key: 'module:/admin', label: 'Admin Panel', category: 'Administration' },
  { key: 'module:/human-resources', label: 'Human Resources', category: 'Human Resources', tabs: [
    { key: 'tab:/human-resources:ats', label: 'Candidates (ATS)' },
    { key: 'tab:/human-resources:archive', label: 'Candidate Archive' },
    { key: 'tab:/human-resources:employees', label: 'Employees' },
    { key: 'tab:/human-resources:timeoff', label: 'Time Off Approvals' },
    { key: 'tab:/human-resources:emergency', label: 'Emergency Contacts' },
    { key: 'tab:/human-resources:safety', label: 'Safety Radar' },
    { key: 'tab:/human-resources:terminal', label: 'Timeclock Terminal' },
    { key: 'tab:/human-resources:addemployee', label: 'Add Employee' },
    { key: 'tab:/human-resources:files', label: 'Employee Files' },
  ] },
  // No tab: entries — Termination and Disciplinary Actions live inside
  // EmployeeProfileDialog.jsx (a per-employee modal), not their own HR page
  // tab, so they can only be expressed as action: keys here.
  { key: ACTION_APPROVE_PTO, label: 'Approve / Decline PTO Requests', category: 'Human Resources', kind: 'action' },
  { key: ACTION_TERMINATE_EMPLOYEE, label: 'Terminate Employees', category: 'Human Resources', kind: 'action' },
  { key: ACTION_MANAGE_DISCIPLINARY, label: 'Create & View Disciplinary Actions', category: 'Human Resources', kind: 'action' },
  { key: 'module:/payroll/hours', label: 'Hours at a Glance', category: 'Payroll' },
  { key: 'module:/payroll/processing', label: 'Run Payroll', category: 'Payroll', tabs: [
    { key: 'tab:/payroll/processing:time', label: 'Time Entries' },
    { key: 'tab:/payroll/processing:timecards', label: 'Timecards' },
    { key: 'tab:/payroll/processing:run', label: 'Run Payroll' },
  ] },
  { key: 'module:/payroll/setup', label: 'Payroll Setup', category: 'Payroll', tabs: [
    { key: 'tab:/payroll/setup:rates', label: 'Pay Rates' },
    { key: 'tab:/payroll/setup:withholding', label: 'Tax Withholding' },
    { key: 'tab:/payroll/setup:deductions', label: 'Deductions' },
    { key: 'tab:/payroll/setup:gl', label: 'GL Mappings' },
    { key: 'tab:/payroll/setup:calendar', label: 'Pay Period Calendar' },
    { key: 'tab:/payroll/setup:rules', label: 'Payroll Rules' },
  ] },
  { key: 'module:/executive-analytics', label: 'Executive Analytics', category: 'Executive' },
  { key: LOCKED_MODULE_KEY, label: 'Employee Center', category: 'Human Resources', locked: true, tabs: [
    { key: 'tab:/employee-center:kiosk', label: 'Time Clock Kiosk' },
    { key: 'tab:/employee-center:profile', label: 'My Profile' },
    { key: 'tab:/employee-center:timeoff', label: 'Time Off' },
    { key: 'tab:/employee-center:payroll', label: 'Payroll' },
  ] },
  // Super-Admin Role Firewall — see RoleManager.jsx's identical exclusion of
  // the super_admin builtin role from the role picker. This module is
  // deliberately left out of the granular_permissions picker too (see
  // GRANULAR_PERMISSION_EXCLUDED_MODULES below).
  { key: 'module:/super-admin/dashboard', label: 'Super Admin Dashboard', category: 'Administration' },
  { key: 'module:/system-integrations', label: 'System Integrations', category: 'Administration', tabs: [
    { key: 'tab:/system-integrations:webhook-console', label: 'Webhook Console' },
    { key: 'tab:/system-integrations:performance-metrics', label: 'Performance Metrics' },
    { key: 'tab:/system-integrations:token-vault', label: 'Token Vault' },
  ] },
  { key: 'module:/field-operations', label: 'Field Operations', category: 'Field Operations', tabs: [
    { key: 'tab:/field-operations:fleet-registry', label: 'Fleet & Rental Registry' },
    { key: 'tab:/field-operations:inspection-radar', label: 'Inspection Radar' },
    { key: 'tab:/field-operations:hook-production', label: 'Hook Production Terminal' },
    { key: 'tab:/field-operations:repair-ledger', label: 'Repair Ledger' },
    { key: 'tab:/field-operations:rigging-matrix', label: 'Rigging Matrix' },
  ] },
];

export function isCapabilityAllowed(overrides, key) {
  if (!key) return true;
  return !(overrides || []).includes(key);
}

export function toggleCapability(overrides, key, allowed) {
  if (key === LOCKED_MODULE_KEY) return overrides || [];
  const set = new Set(overrides || []);
  if (allowed) set.delete(key); else set.add(key);
  return Array.from(set);
}

// Modules excluded from the granular_permissions picker entirely — their
// own module-level access is either always-on (Employee Center) or firewalled
// off from role-building UI altogether (Super Admin — mirrors RoleManager.jsx
// hiding the super_admin builtin role from the same screen).
const GRANULAR_PERMISSION_EXCLUDED_MODULES = new Set([LOCKED_MODULE_KEY, 'module:/super-admin/dashboard']);

// Builds the grouped picker data for RoleManager.jsx's Custom Role form:
// one section per department/category, each containing every selectable
// tab: key (sub-module granularity) and action: key (cross-cutting actions)
// that belongs to it. Bare module: keys are never included here — that's
// allowed_modules' job, and duplicating it would blur the "reach the page"
// vs. "do this specific thing" line the two fields are meant to keep apart.
export function getGranularPermissionGroups() {
  const groups = new Map();
  const addItem = (category, key, label) => {
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({ key, label });
  };

  PERMISSION_CATALOG.forEach((entry) => {
    if (GRANULAR_PERMISSION_EXCLUDED_MODULES.has(entry.key)) return;
    if (entry.kind === 'action') {
      addItem(entry.category, entry.key, entry.label);
      return;
    }
    (entry.tabs || []).forEach((tab) => addItem(entry.category, tab.key, `${entry.label} — ${tab.label}`));
  });

  return Array.from(groups.entries())
    .map(([category, items]) => ({ category, items }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

// Flat key -> label lookup for the granular_permissions catalog (both tab:
// and action: keys) — used to render a human-readable summary of a role's
// selections instead of raw key strings.
export function granularPermissionLabel(key) {
  for (const entry of PERMISSION_CATALOG) {
    if (entry.key === key) return entry.label;
    const tab = (entry.tabs || []).find((t) => t.key === key);
    if (tab) return `${entry.label} — ${tab.label}`;
  }
  return key;
}

// Does this resolved set of granted permission keys (see
// getUserGranularPermissions in rbacConfig.jsx) include the given key? Safe
// against an unresolved/undefined list — always call alongside a coarse
// builtin-role check, e.g.:
//   hasFullEmployeeAccess(roles) || hasGranularPermission(granularPermissions, GRANULAR_ACTIONS.TERMINATE_EMPLOYEE)
export function hasGranularPermission(granularPermissions, key) {
  if (!key) return false;
  return (granularPermissions || []).includes(key);
}
