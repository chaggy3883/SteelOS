// Per-employee granular permission catalog — retired.
//
// This denylist layer (an employee/user's `permission_overrides` narrowing
// their role's baseline) has been superseded by a roles-only model: role
// determines allowed_modules, period (see rbacConfig.jsx, NavBar.jsx). There
// is no remaining UI anywhere that lets an admin edit `permission_overrides`
// (PermissionsGridPanel.jsx, its Users.jsx/EmployeeProfileDialog.jsx mount
// points, was removed) — module-level enforcement in NavBar.jsx was removed
// with it.
//
// What's left, kept only for backward compatibility with pre-existing demo
// data: HumanResources.jsx and EmployeeCenter.jsx still read their own
// `tab:` keys from an employee's `permission_overrides` to hide individual
// tabs. Since nothing can write new values into that array anymore, this is
// effectively frozen/legacy behavior for records that already had overrides
// set — not an active permission-editing feature.
//
// Two key shapes:
//   module:<path>            - one of ALL_MODULES in rbacConfig.jsx (no longer enforced)
//   tab:<modulePath>:<tabId>  - a TabsTrigger value inside that module's page
//
// Employee Center is permanently on: it's the mobile time-clock/self-service
// surface every worker needs regardless of what else is restricted.
export const LOCKED_MODULE_KEY = 'module:/employee-center';

export const PERMISSION_CATALOG = [
  { key: 'module:/', label: 'Dashboard' },
  { key: 'module:/estimating', label: 'Estimating', tabs: [
    { key: 'tab:/estimating:smart-file-dump', label: 'Smart File Dump' },
    { key: 'tab:/estimating:bid-worksheet', label: 'BID Worksheet' },
    { key: 'tab:/estimating:full-takeoff', label: 'Full Takeoff' },
    { key: 'tab:/estimating:vendor-pricing', label: 'Vendor Pricing' },
    { key: 'tab:/estimating:scope-text', label: 'Scope Text' },
    { key: 'tab:/estimating:ai-review', label: 'AI Review' },
    { key: 'tab:/estimating:ai-contract-review', label: 'AI Contract Review' },
  ] },
  { key: 'module:/estimating/analytics', label: 'Historical Analytics' },
  { key: 'module:/estimating/spec-review', label: 'Front-End Spec Review' },
  { key: 'module:/projects', label: 'Projects', tabs: [
    { key: 'tab:/projects:overview', label: 'Overview' },
    { key: 'tab:/projects:documents', label: 'Documents' },
    { key: 'tab:/projects:ai-findings', label: 'AI Findings' },
    { key: 'tab:/projects:rfis', label: 'RFIs' },
    { key: 'tab:/projects:pieces', label: 'Pieces' },
  ] },
  { key: 'module:/intelligence', label: 'Intelligence', tabs: [
    { key: 'tab:/intelligence:estimating', label: 'Estimating Review' },
    { key: 'tab:/intelligence:quality_assurance', label: 'Quality Assurance Review' },
    { key: 'tab:/intelligence:safety', label: 'Safety Review' },
    { key: 'tab:/intelligence:purchasing', label: 'Purchasing Review' },
    { key: 'tab:/intelligence:accounting', label: 'Accounting Review' },
    { key: 'tab:/intelligence:executive', label: 'Executive Review' },
  ] },
  { key: 'module:/crm', label: 'CRM' },
  { key: 'module:/purchasing', label: 'Purchasing', tabs: [
    { key: 'tab:/purchasing:reorder-alerts', label: 'Reorder Alerts' },
    { key: 'tab:/purchasing:ai-flags', label: 'AI Purchasing Flags' },
    { key: 'tab:/purchasing:all-inventory', label: 'All Inventory' },
  ] },
  { key: 'module:/purchasing/module', label: 'Procurement Module', tabs: [
    { key: 'tab:/purchasing/module:mill-buyout', label: 'Mill Buyout Dashboard' },
    { key: 'tab:/purchasing/module:requisitions', label: 'Project Requisitions' },
    { key: 'tab:/purchasing/module:receiving', label: 'Receiving Portal' },
    { key: 'tab:/purchasing/module:three-way-match', label: 'Three-Way Match' },
  ] },
  { key: 'module:/purchasing/receiving-kiosk', label: 'Receiving Kiosk' },
  { key: 'module:/inventory', label: 'Inventory', tabs: [
    { key: 'tab:/inventory:list', label: 'Inventory List' },
    { key: 'tab:/inventory:3d-warehouse', label: '3D Warehouse' },
  ] },
  { key: 'module:/production', label: 'Production' },
  { key: 'module:/shop-fabrication', label: 'Shop Fabrication', tabs: [
    { key: 'tab:/shop-fabrication:work-logs', label: 'Work Logs' },
    { key: 'tab:/shop-fabrication:qa-queue', label: 'QA Queue' },
    { key: 'tab:/shop-fabrication:pieces', label: 'Pieces' },
  ] },
  { key: 'module:/shop-operations', label: 'Shop Operations', tabs: [
    { key: 'tab:/shop-operations:scheduler-matrix', label: 'Scheduler Matrix' },
    { key: 'tab:/shop-operations:bottleneck-radar', label: 'Bottleneck Radar' },
    { key: 'tab:/shop-operations:material-overrides', label: 'Material & Overrides' },
    { key: 'tab:/shop-operations:label-printing', label: 'Label Printing' },
  ] },
  { key: 'module:/shipping', label: 'Shipping', tabs: [
    { key: 'tab:/shipping:list', label: 'Shipping List' },
    { key: 'tab:/shipping:load-builder', label: 'Load Builder' },
    { key: 'tab:/shipping:yard-scanning', label: 'Yard Scanning' },
  ] },
  { key: 'module:/quality', label: 'Quality', tabs: [
    { key: 'tab:/quality:ai-findings', label: 'AI QA Findings' },
    { key: 'tab:/quality:checklist', label: 'QA Checklist' },
    { key: 'tab:/quality:certifications', label: 'Certifications' },
  ] },
  { key: 'module:/safety', label: 'Safety', tabs: [
    { key: 'tab:/safety:ai-findings', label: 'AI Safety Findings' },
    { key: 'tab:/safety:checklist', label: 'Safety Checklist' },
  ] },
  { key: 'module:/documents', label: 'Documents' },
  { key: 'module:/rfis', label: 'RFIs' },
  { key: 'module:/subcontracts', label: 'Subcontracts' },
  { key: 'module:/certified-payroll', label: 'Certified Payroll', tabs: [
    { key: 'tab:/certified-payroll:submissions', label: 'Submissions' },
    { key: 'tab:/certified-payroll:compliance', label: 'Compliance Dashboard' },
    { key: 'tab:/certified-payroll:reports', label: 'Hancock Reports' },
  ] },
  { key: 'module:/accounting', label: 'Accounting', tabs: [
    { key: 'tab:/accounting:job-costing-summary', label: 'Job Costing Summary' },
    { key: 'tab:/accounting:job-cost-detail', label: 'Job Cost Detail' },
    { key: 'tab:/accounting:vendor-bills', label: 'Vendor Bills (AP)' },
    { key: 'tab:/accounting:ar-billings', label: 'AR & Billings' },
    { key: 'tab:/accounting:wip-report', label: 'WIP Report' },
    { key: 'tab:/accounting:ai-financial-flags', label: 'AI Financial Flags' },
  ] },
  { key: 'module:/reports', label: 'Reports' },
  { key: 'module:/legal', label: 'Legal & Contracts', tabs: [
    { key: 'tab:/legal:contracts', label: 'Contracts' },
    { key: 'tab:/legal:lien-rights-radar', label: 'Lien Rights Radar' },
    { key: 'tab:/legal:audit-log', label: 'Audit Log' },
  ] },
  { key: 'module:/portal/login', label: 'External Gateways (Portal)' },
  { key: 'module:/users', label: 'Users' },
  { key: 'module:/settings', label: 'Settings', tabs: [
    { key: 'tab:/settings:company', label: 'Company' },
    { key: 'tab:/settings:ai-rules', label: 'AI Rules' },
    { key: 'tab:/settings:notifications', label: 'Notifications' },
    { key: 'tab:/settings:integrations', label: 'Integrations' },
    { key: 'tab:/settings:devices', label: 'Devices' },
  ] },
  { key: 'module:/admin', label: 'Admin Panel' },
  { key: 'module:/human-resources', label: 'Human Resources', tabs: [
    { key: 'tab:/human-resources:ats', label: 'Candidates (ATS)' },
    { key: 'tab:/human-resources:employees', label: 'Employees' },
    { key: 'tab:/human-resources:timeoff', label: 'Time Off Approvals' },
    { key: 'tab:/human-resources:emergency', label: 'Emergency Contacts' },
    { key: 'tab:/human-resources:safety', label: 'Safety Radar' },
    { key: 'tab:/human-resources:terminal', label: 'Timeclock Terminal' },
    { key: 'tab:/human-resources:addemployee', label: 'Add Employee' },
    { key: 'tab:/human-resources:files', label: 'Employee Files' },
  ] },
  { key: 'module:/payroll/hours', label: 'Hours at a Glance' },
  { key: 'module:/payroll', label: 'Payroll', tabs: [
    { key: 'tab:/payroll:periods', label: 'Pay Periods' },
    { key: 'tab:/payroll:register', label: 'Register' },
    { key: 'tab:/payroll:jobcost', label: 'Job Cost Posting' },
  ] },
  { key: 'module:/payroll/processing', label: 'Run Payroll', tabs: [
    { key: 'tab:/payroll/processing:time', label: 'Time Entries' },
    { key: 'tab:/payroll/processing:timecards', label: 'Timecards' },
    { key: 'tab:/payroll/processing:run', label: 'Run Payroll' },
  ] },
  { key: 'module:/payroll/setup', label: 'Payroll Setup', tabs: [
    { key: 'tab:/payroll/setup:rates', label: 'Pay Rates' },
    { key: 'tab:/payroll/setup:withholding', label: 'Tax Withholding' },
    { key: 'tab:/payroll/setup:deductions', label: 'Deductions' },
    { key: 'tab:/payroll/setup:gl', label: 'GL Mappings' },
    { key: 'tab:/payroll/setup:calendar', label: 'Pay Period Calendar' },
    { key: 'tab:/payroll/setup:rules', label: 'Payroll Rules' },
  ] },
  { key: 'module:/executive-analytics', label: 'Executive Analytics' },
  { key: LOCKED_MODULE_KEY, label: 'Employee Center', locked: true, tabs: [
    { key: 'tab:/employee-center:kiosk', label: 'Time Clock Kiosk' },
    { key: 'tab:/employee-center:profile', label: 'My Profile' },
    { key: 'tab:/employee-center:timeoff', label: 'Time Off' },
    { key: 'tab:/employee-center:payroll', label: 'Payroll' },
  ] },
  { key: 'module:/super-admin/dashboard', label: 'Super Admin Dashboard' },
  { key: 'module:/system-integrations', label: 'System Integrations', tabs: [
    { key: 'tab:/system-integrations:webhook-console', label: 'Webhook Console' },
    { key: 'tab:/system-integrations:performance-metrics', label: 'Performance Metrics' },
    { key: 'tab:/system-integrations:token-vault', label: 'Token Vault' },
  ] },
  { key: 'module:/field-operations', label: 'Field Operations', tabs: [
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
