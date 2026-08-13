export const SYSTEM_ROLES = [
  { value: 'admin', label: 'Admin', color: 'bg-red-500/10 text-red-500' },
  { value: 'estimator', label: 'Estimator', color: 'bg-blue-500/10 text-blue-500' },
  { value: 'project_manager', label: 'Project Manager', color: 'bg-purple-500/10 text-purple-500' },
  { value: 'purchasing_agent', label: 'Purchasing Agent', color: 'bg-orange-500/10 text-orange-500' },
  { value: 'shop_manager', label: 'Shop Manager', color: 'bg-green-500/10 text-green-500' },
  { value: 'inspector', label: 'Inspector', color: 'bg-cyan-500/10 text-cyan-500' },
  { value: 'warehouse_clerk', label: 'Warehouse Clerk', color: 'bg-amber-500/10 text-amber-500' },
  { value: 'hr_admin', label: 'HR Admin', color: 'bg-pink-500/10 text-pink-500' },
  { value: 'payroll_admin', label: 'Payroll Admin', color: 'bg-yellow-500/10 text-yellow-500' },
  { value: 'president', label: 'President', color: 'bg-indigo-500/10 text-indigo-500' },
  { value: 'ceo', label: 'CEO', color: 'bg-violet-500/10 text-violet-500' },
  { value: 'finance_department', label: 'Finance Department', color: 'bg-teal-500/10 text-teal-500' },
  { value: 'controller', label: 'Controller', color: 'bg-emerald-500/10 text-emerald-500' },
  { value: 'user', label: 'General User', color: 'bg-gray-500/10 text-gray-500' },
  { value: 'super_admin', label: 'Super Admin', color: 'bg-rose-500/10 text-rose-500' },
  { value: 'Maintenance_Manager', label: 'Maintenance Manager', color: 'bg-sky-500/10 text-sky-500' },
  { value: 'suspended', label: 'Suspended', color: 'bg-red-500/10 text-red-500' },
];

export const ACTION_TYPES = [
  'CREATE_BID', 'UPDATE_BID', 'DELETE_BID', 'SUBMIT_BID', 'WIN_BID', 'LOSE_BID',
  'CREATE_PROJECT', 'UPDATE_PROJECT', 'DELETE_PROJECT',
  'APPROVE_WELD', 'APPROVE_FINDING', 'REJECT_FINDING',
  'EDIT_TIMECARD', 'SUBMIT_TIMECARD',
  'CREATE_USER', 'UPDATE_USER', 'DELETE_USER', 'SUSPEND_USER', 'INVITE_USER',
  'UPDATE_SETTINGS', 'CREATE_TAX_RATE', 'UPDATE_TAX_RATE', 'DELETE_TAX_RATE',
  'UPLOAD_DOCUMENT', 'SHIP_PIECE', 'CREATE_INVOICE', 'APPROVE_INVOICE',
  'LOGIN', 'LOGOUT', 'VIEW_EMPLOYEE_CENTER', 'OTHER',
];

export const INTEGRATIONS = [
  { value: 'procore', label: 'Procore', description: 'Construction project management platform' },
  { value: 'textura', label: 'Textura', description: 'Construction payment management & SOV routing' },
  { value: 'aws_s3', label: 'AWS S3', description: 'Cloud file storage for drawings & MTRs' },
  { value: 'avatax', label: 'AvaTax', description: 'Automated tax calculation & compliance' },
  { value: 'vertex', label: 'Vertex', description: 'Enterprise tax compliance platform' },
  { value: 'tekla_api', label: 'Tekla API', description: 'BIM model integration & takeoff sync' },
  { value: 'quickbooks', label: 'QuickBooks', description: 'Accounting & financial sync' },
];

export function getRoleLabel(role) {
  return SYSTEM_ROLES.find(r => r.value === role)?.label || role;
}

export function getRoleColor(role) {
  return SYSTEM_ROLES.find(r => r.value === role)?.color || 'bg-gray-500/10 text-gray-500';
}