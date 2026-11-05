// What the top-bar global search looks through, who may see each kind of
// result, and where clicking one goes. A result type shows up only when the
// signed-in role can open the page it links to (the same allowed_modules +
// company module-pack rule the sidebar uses — rbacConfig.jsx,
// moduleEntitlement.js), so search never reveals more than the nav does.
// Everything is tenant-scoped by the data layer (localData.js).
import { db } from '@/api/apiClient';
import { listEmployeesForRole } from '@/lib/employeesApi';

const HR_FULL_ROLES = ['admin', 'super_admin', 'hr_admin', 'payroll_admin'];

const has = (v) => v != null && String(v).trim() !== '';

// Each source: key, label, modules (any one grants it), load(ctx) -> rows,
// fields(row) -> strings searched, title/sub(row), route(row).
export const SEARCH_SOURCES = [
  {
    key: 'projects', label: 'Projects', modules: ['/projects'],
    load: () => db.entities.Project.list('name', 100000),
    fields: (p) => [p.name, p.project_number, p.customer_name, p.city, p.address],
    title: (p) => [p.project_number, p.name].filter(has).join(' — '),
    sub: (p) => [p.customer_name, p.is_archived ? 'Archived' : p.status].filter(has).join(' • '),
    route: (p) => `/projects/${p.id}`,
    salesmanOwned: (p) => p,
  },
  {
    key: 'bids', label: 'Estimates / Bids', modules: ['/estimating'],
    load: () => db.entities.Bid.list('-bid_due_date', 100000),
    fields: (b) => [b.bid_number, b.job_name, b.customer_name, b.city, b.street],
    title: (b) => [b.bid_number, b.job_name].filter(has).join(' — '),
    sub: (b) => [b.customer_name, b.is_archived ? 'Archived' : b.status].filter(has).join(' • '),
    route: (b) => `/estimating/${b.id}`,
    salesmanOwned: (b) => b,
  },
  {
    key: 'pieces', label: 'Pieces', modules: ['/projects', '/production', '/shop-fabrication', '/shop-operations', '/shop-floor-command-center'],
    load: () => db.entities.PieceMark.list('-created_date', 100000),
    fields: (p) => [p.piece_mark, p.part_number, p.serial_number, p.assembly, p.drawing_number, p.qr_payload_string, p.description],
    title: (p) => [p.piece_mark || p.part_number, p.serial_number].filter(has).join(' — '),
    sub: (p, ctx) => [ctx.projectById.get(p.project_id)?.name, p.assembly, (p.status || '').replace(/_/g, ' ')].filter(has).join(' • '),
    route: (p) => `/projects/${p.project_id}?piece=${p.id}`,
    salesmanOwned: (p, ctx) => ctx.projectById.get(p.project_id),
  },
  {
    key: 'purchase_orders', label: 'Purchase Orders', modules: ['/purchasing', '/purchasing/module'],
    load: () => db.entities.purchase_orders.list('-created_date', 100000),
    fields: (po, ctx) => [po.po_number, po.vendor_name, po.material_category, ctx.projectById.get(po.project_id)?.name],
    title: (po) => `PO ${po.po_number || '—'}`,
    sub: (po, ctx) => [po.vendor_name, ctx.projectById.get(po.project_id)?.name, (po.status || '').replace(/_/g, ' ')].filter(has).join(' • '),
    route: (po) => `/purchasing/module?open=${po.id}`,
  },
  {
    key: 'customers', label: 'Customers', modules: ['/crm'],
    load: () => db.entities.Customer.list('name', 100000),
    fields: (c) => [c.name, c.primary_contact, c.email, c.city, c.phone],
    title: (c) => c.name,
    sub: (c) => [c.primary_contact, [c.city, c.state].filter(has).join(', ')].filter(has).join(' • '),
    route: (c) => `/crm?customer=${c.id}`,
  },
  {
    key: 'vendors', label: 'Vendors', modules: ['/crm', '/purchasing', '/purchasing/module'],
    load: () => db.entities.Vendor.list('name', 100000),
    fields: (v) => [v.name, v.contact_name, v.email, v.phone, v.vendor_type],
    title: (v) => v.name,
    sub: (v) => [v.vendor_type, v.contact_name].filter(has).join(' • '),
    route: (v) => `/crm/directory?vendor=${v.id}`,
  },
  {
    key: 'employees', label: 'Employees', modules: ['/human-resources'],
    // Masked to public fields for roles without full HR access.
    load: (ctx) => listEmployeesForRole(ctx.roles, 'full_name', 100000),
    fields: (e) => [e.full_name, e.employee_number, e.classification, e.department, e.personal_email],
    title: (e) => [e.full_name, e.employee_number ? `#${e.employee_number}` : ''].filter(has).join(' '),
    sub: (e) => [e.classification, e.department, e.is_active === false ? 'Inactive' : ''].filter(has).join(' • '),
    route: (e) => `/human-resources?employee=${e.id}`,
  },
  {
    key: 'candidates', label: 'Candidates', modules: ['/human-resources'], roles: HR_FULL_ROLES,
    load: () => db.entities.candidate_profiles.list('-created_date', 100000),
    fields: (c) => [c.candidate_name, c.email, c.position_applied],
    title: (c) => c.candidate_name,
    sub: (c) => [c.position_applied ? `Applied for ${c.position_applied}` : 'Applied', (c.status || '').replace(/_/g, ' ')].filter(has).join(' • '),
    route: (c) => `/human-resources?candidate=${c.id}`,
  },
  {
    key: 'rfis', label: 'RFIs', modules: ['/rfis'],
    load: () => db.entities.RFI.list('-created_date', 100000),
    fields: (r, ctx) => [r.rfi_number, r.subject, ctx.projectById.get(r.project_id)?.name],
    title: (r) => [`RFI ${r.rfi_number || ''}`.trim(), r.subject].filter(has).join(' — '),
    sub: (r, ctx) => [ctx.projectById.get(r.project_id)?.name, (r.status || '').replace(/_/g, ' ')].filter(has).join(' • '),
    route: (r) => `/rfis?open=${r.id}`,
    salesmanOwned: (r, ctx) => ctx.projectById.get(r.project_id),
  },
  {
    key: 'submittals', label: 'Submittals', modules: ['/submittals'],
    load: () => db.entities.Submittal.list('-created_date', 100000),
    fields: (s, ctx) => [s.submittal_number, s.submittal_description, s.spec_section, ctx.projectById.get(s.project_id)?.name],
    title: (s) => [`Submittal ${s.submittal_number || ''}`.trim(), s.submittal_description].filter(has).join(' — '),
    sub: (s, ctx) => [ctx.projectById.get(s.project_id)?.name, (s.status || '').replace(/_/g, ' ')].filter(has).join(' • '),
    route: (s) => `/submittals?open=${s.id}`,
  },
  {
    key: 'change_orders', label: 'Change Orders', modules: ['/projects'],
    load: () => db.entities.change_orders.list('-created_date', 100000),
    fields: (c, ctx) => [c.change_order_id, c.description, ctx.projectById.get(c.project_id)?.name],
    title: (c) => [`CO ${c.change_order_id || ''}`.trim(), c.description].filter(has).join(' — '),
    sub: (c, ctx) => [ctx.projectById.get(c.project_id)?.name, (c.status || '').replace(/_/g, ' ')].filter(has).join(' • '),
    route: (c) => `/projects/change-orders?open=${c.id}`,
    salesmanOwned: (c, ctx) => ctx.projectById.get(c.project_id),
  },
  {
    key: 'loads', label: 'Shipping Loads', modules: ['/shipping'],
    load: () => db.entities.loads.list('-created_date', 100000),
    fields: (l, ctx) => [l.load_number_id, ctx.projectById.get(l.project_id)?.name],
    title: (l) => `Load ${l.load_number_id || ''}`.trim(),
    sub: (l, ctx) => [ctx.projectById.get(l.project_id)?.name, (l.status || '').replace(/_/g, ' ')].filter(has).join(' • '),
    route: (l) => `/shipping?load=${l.id}`,
  },
  {
    key: 'documents', label: 'Documents', modules: ['/documents'],
    load: () => db.entities.Document.list('-created_date', 100000),
    fields: (d) => [d.name, d.file_name, d.description, ...(Array.isArray(d.keywords) ? d.keywords : [])],
    title: (d) => d.name || d.file_name,
    sub: (d) => [(d.document_type || '').replace(/_/g, ' '), d.is_archived ? 'Archived' : ''].filter(has).join(' • '),
    route: (d) => `/documents?doc=${d.id}`,
  },
];

// Which sources this user may search. allowedModules: the role's module list
// ('*' = all); hasModuleFn(path): the company's module pack check.
export function allowedSearchSources({ roles = [], allowedModules = [], hasModuleFn = () => true }) {
  const roleSet = new Set(roles.map((r) => String(r || '').toLowerCase()));
  const canOpen = (path) => (allowedModules.includes('*') || allowedModules.includes(path)) && hasModuleFn(path);
  return SEARCH_SOURCES.filter((s) => {
    if (s.roles && !s.roles.some((r) => roleSet.has(r))) return false;
    return s.modules.some(canOpen);
  });
}

// Case-insensitive; every word typed must appear somewhere in the record
// ("w14 harbor" finds a Harbor Tower piece with a W14 shape).
export function matchesQuery(fields, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const hay = fields.filter(has).map((f) => String(f).toLowerCase()).join(' \u0001 ');
  return words.every((w) => hay.includes(w));
}
