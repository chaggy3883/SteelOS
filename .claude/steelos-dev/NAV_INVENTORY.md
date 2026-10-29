# SteelOS navigation inventory (2026-10-29, before the UI redesign)

## Shell and access, as it works today
- **Stack:** React 18 + Vite, react-router-dom, Tailwind with shadcn/Radix (53 components in `src/components/ui`). Design tokens are HSL variables in `src/index.css` (light and `.dark`); dark mode is saved under the `steelos-dark` localStorage key.
- **Data:** a localStorage database (`src/api/localData.js`, accessed through `db` in `src/api/apiClient.js`). `src/lib/supabase.js` exists but nothing imports it, so there is no live Supabase auth, row-level security or API to keep.
- **AppLayout** (`src/components/layout/AppLayout.jsx`): TopBar, then NavBar (a horizontal row of dropdowns), then `<main>`. It also runs the session heartbeat, the dark-mode switch and the SubscriptionGate (blocks Past_Due/Inactive tenants; `/super-admin` is exempt).
- **TopBar:** SteelOS mark, tenant logo (sized by `logo_scale_pct`), GlobalSearchPalette, an "Impersonating … Exit" chip, the dark-mode toggle, Notifications (unread `Notification` rows; clicking one marks it read and opens its link), and the user menu (Settings, Sign Out).
- **Who sees which nav item:** an item shows when all of these pass:
  - `isModuleAllowed(path, roleModules)` from `rbacConfig`. While impersonating, the role check is skipped (`['*']`).
  - `hasModule(company, path)`, the company's module pack.
  - The Super Admin link shows only for a real `super_admin`.
  - A kiosk PIN session hides the Inventory and Quality & Safety groups.
- **NavBar opens every item in a new browser tab** (`target="_blank"`).
- **Route guards:** `ProtectedRoute` (sends logged-out users to /login) wraps AppLayout, Meeting Mode and the Document Viewer. `PortalProtectedRoute` plus `PortalLayout` wrap the customer and vendor portals. Individual pages also run their own role and pack checks.
- **`src/components/layout/Sidebar.jsx` is dead code** (nothing imports it). It has an older, different grouping.

## NavBar hierarchy (live): group → item → route → component
| Group | Item | Route | Component |
|---|---|---|---|
| (top level) | Home | `/` | Dashboard |
| Core | Admin Panel | `/admin` | Admin |
| Core | Users | `/users` | Users |
| Core | Human Resources | `/human-resources` | HumanResources |
| Core | Employee Center | `/employee-center` | EmployeeCenter |
| Core | Settings | `/settings` | Settings |
| Core | Super Admin (super_admin only) | `/super-admin/dashboard` | SuperAdminDashboard |
| Core | System Integrations | `/system-integrations` | SystemIntegrations |
| Estimating | Estimating | `/estimating` | Estimating |
| Estimating | Historical Analytics | `/estimating/analytics` | EstimatingAnalytics |
| Estimating | Front-End Spec Review | `/estimating/spec-review` | FrontEndReview |
| Estimating | IRONSIGHT | `/estimating/blueprint-takeoff` | BlueprintTakeoff |
| Estimating | CRM | `/crm` | CRM |
| Estimating | Relationship Manager | `/crm/directory` | CrmDirectories |
| Estimating | Intelligence | `/intelligence` | Intelligence |
| Production & Project Management | Projects | `/projects` | Projects |
| Production & Project Management | Change Orders | `/projects/change-orders` | ChangeOrders |
| Production & Project Management | Subcontracts | `/subcontracts` | Subcontracts |
| Production & Project Management | RFIs | `/rfis` | RFIs |
| Production & Project Management | Production | `/production` | Production |
| Production & Project Management | Shipping | `/shipping` | Shipping |
| Production & Project Management | Shop Fabrication | `/shop-fabrication` | ShopFabrication |
| Production & Project Management | Shop Operations | `/shop-operations` | ShopOperations |
| Production & Project Management | Shop Floor Command Center | `/shop-floor-command-center` | ShopFloorCommandCenter |
| Production & Project Management | Shop Efficiency | `/shop-efficiency` | ShopEfficiency |
| Production & Project Management | Detailer Imports | `/detailer-imports` | DetailerImports |
| Production & Project Management | Field Operations | `/field-operations` | FieldOperations |
| Insights | Executive Analytics | `/executive-analytics` | ExecutiveAnalytics |
| Insights | Meeting Mode (outside AppLayout) | `/meeting-mode` | MeetingMode |
| Payroll | Hours at a Glance | `/payroll/hours` | PayrollHours |
| Payroll | Run Payroll | `/payroll/processing` | PayrollProcessing |
| Payroll | Payroll Setup | `/payroll/setup` | PayrollSetup |
| Payroll | Certified Payroll | `/certified-payroll` | CertifiedPayroll |
| Payroll | Garnishments | `/payroll/garnishments` | GarnishmentsReport |
| Payroll | 401(k) Contributions | `/payroll/401k-contributions` | Retirement401kReport |
| Payroll | PTO Policies | `/admin/pto-policies` | PtoPoliciesAdmin |
| Purchasing & Procurement | Purchasing | `/purchasing` | Purchasing |
| Purchasing & Procurement | Procurement Module | `/purchasing/module` | ProcurementModule |
| Purchasing & Procurement | Receiving Kiosk | `/purchasing/receiving-kiosk` | ReceivingKiosk |
| Accounting & Job Costing | Accounting | `/accounting` | Accounting |
| Accounting & Job Costing | Legal & Contracts | `/legal` | Legal |
| Accounting & Job Costing | Reports | `/reports` | Reports |
| External Gateways | Customer Portal Setup | `/admin?tab=integrations` | Admin |
| External Gateways | Vendor Portal Setup | `/admin?tab=crm` | Admin |
| External Gateways | Portal Access Links | `/admin?tab=integrations` (same as Customer Portal Setup) | Admin |
| Inventory | Inventory (kiosk-hidden) | `/inventory` | Inventory |
| Quality & Safety (kiosk-hidden) | Quality | `/quality` | Quality |
| Quality & Safety (kiosk-hidden) | KPI Builder | `/quality/kpi-builder` | QualityKpiBuilder |
| Quality & Safety (kiosk-hidden) | Safety | `/safety` | Safety |
| Quality & Safety (kiosk-hidden) | Documents | `/documents` | Documents |
| Sales | My Sales Dashboard | `/sales/dashboard` | SalesDashboard |

## Routes with no NavBar item (reached from inside pages, or orphaned)
- **Detail and child pages:**
  - Projects: `/projects/new`, `/projects/:id`, `/projects/:id/management`.
  - Estimating: `/estimating/new`, `/estimating/:id`, `/estimating/blueprint-takeoff/:id`.
  - Field Operations: `/field-operations/rigging-inspection`, `/field-operations/equipment-service`.
  - Human Resources: `/human-resources/new-employee`, `/human-resources/new-candidate`.
  - Admin: `/admin/intelligence-rules/:id`, `/admin/service-schedules/:id`.
  - Meeting Mode: `/meeting-mode/:meetingId`.
- **Admin subpages:** `/audit-trail`, `/admin/employees`, `/admin/cost-codes`, `/admin/intelligence-rules`, `/admin/service-schedules`, `/admin/commission-setup`, `/admin/salesman-rates`, `/admin/tm-labor-rates`, `/admin/material-catalog`, `/admin/bid-worksheet-rates`.
- **In the dead Sidebar only, not in NavBar:** `/submittals`, `/intelligence-signals`, `/material-optimization`. These may only be reachable by URL or links inside pages. To verify.
- **Redirects:** `/payroll` → `/payroll/processing`; `/admin/delivery-pricing` → `/admin/bid-worksheet-rates#delivery-pricing`.
- **Duplicate route:** `/sales` and `/sales/dashboard` both render SalesDashboard.
- **Outside AppLayout:** `/document-viewer`, the `/meeting-mode` routes, `/login`, `/forgot-password`, `/reset-password`, `/portal/login`, `/portal/customer`, `/portal/vendor`, and `*` (PageNotFound).

## Inconsistencies found (documented, not fixed)
1. Customer Portal Setup and Portal Access Links go to the same URL.
2. NavBar's `isActive` uses `startsWith`, so `/projects/change-orders` also lights up Projects, and `/admin/pto-policies` also lights up Admin Panel.
3. Sidebar.jsx is unused and out of date.
4. Every nav click opens a new tab. Keeping or changing this is a decision for the redesign.
5. The "AI Active" pulsing badge in NavBar shows no real status.
6. The `supabase.js` client is unused.
