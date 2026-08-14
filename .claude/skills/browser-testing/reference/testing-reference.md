# Browser Testing Reference Data

Supporting detail for `SKILL.md`. Regenerate/verify the parts marked
"derived from code" against the actual source before trusting them — this
file is hand-maintained and can drift.

## Demo Accounts

All seeded in `src/api/localData.js`. Password is `password123` for every
one of these unless noted.

| Email | Role(s) | Good for testing |
|---|---|---|
| `admin@steelos.dev` | `admin`, `super_admin` | Everything — `allowed_modules: ['*']` bypasses rbacConfig entirely. Use this account first to confirm every route renders at all, before testing role restrictions. |
| `estimator@steelos.dev` | `estimator` | Estimating-only role view |
| `projectmanager@steelos.dev` | `project_manager` | PM role view |
| `purchasing@steelos.dev` | `purchasing_agent` | Purchasing role view |
| `superadmin@steelos.dev` | `super_admin` | Platform-operator view (no `company_id` — lands on `/super-admin/dashboard`). Use this or the admin account to test pack switching (see below). |
| `controller@hancocksteel.com` | `finance_department` | Despite the email/display name, the actual role is `finance_department`, not `controller` — there is a separate `controller` role in `BUILTIN_ROLES` with no seeded demo user. |
| `estimator@hancocksteel.com` | `estimator` | Tenant-scoped variant of the estimator account |
| `pm@hancocksteel.com` | `project_manager` | Tenant-scoped variant of the PM account |
| `hr@hancocksteel.com` | `hr_admin` | HR role view |
| `shop@hancocksteel.com` | `shop_foreman` | **Broken as seeded** — `shop_foreman` is not a name in `BUILTIN_ROLES` (that list has `shop_manager`, not `shop_foreman`). `getUserPermissions()` in `rbacConfig.jsx` finds no match, falls through to zero granted modules, and defaults to Dashboard-only. This account currently cannot be used to test the shop_manager role view. Flagged here, not fixed — confirm with whoever owns the backlog whether to rename the seed's role to `shop_manager` or add a `shop_foreman` alias. |

**Roles with no seeded demo account at all**: `shop_manager` (working
role, just no matching login above), `inspector`, `warehouse_clerk`,
`payroll_admin`, `president`, `ceo`, `controller`, `user`,
`Maintenance_Manager`. To test one of these, log in as `admin@steelos.dev`,
go to `/users`, and either edit an existing user's role or create a new
one — or add a seed entry to `localData.js` yourself for a repeatable login.

## Route Inventory (derived from `src/App.jsx`)

Grouped under the section names used in the checklist. Routes with a
`:id`/`:param` segment aren't directly typeable — reach them by clicking
through from their parent list page (e.g. click a project row to reach
`/projects/:id`), not by guessing an ID in the URL bar.

| Section | Routes |
|---|---|
| Dashboard | `/` |
| Estimating | `/estimating`, `/estimating/new`, `/estimating/:id`, `/estimating/analytics`, `/estimating/spec-review`, `/estimating/blueprint-takeoff`, `/estimating/blueprint-takeoff/:id` |
| Projects | `/projects`, `/projects/new`, `/projects/:id`, `/projects/:id/management`, `/projects/change-orders`, `/subcontracts`, `/rfis`, `/documents` |
| Production | `/production`, `/inventory`, `/shop-fabrication`, `/shop-operations`, `/shop-floor-command-center`, `/shop-efficiency` |
| Shipping | `/shipping`, `/purchasing`, `/purchasing/module`, `/purchasing/receiving-kiosk` |
| Accounting | `/accounting`, `/reports` |
| CRM | `/crm`, `/crm/directory` |
| Field Ops | `/field-operations`, `/field-operations/rigging-inspection`, `/field-operations/equipment-service` |
| HR | `/human-resources`, `/payroll`, `/payroll/hours`, `/employee-center`, `/certified-payroll` |
| Quality | `/quality`, `/safety` |
| Legal | `/legal` |
| Settings | `/settings`, `/system-integrations` |
| Admin | `/admin`, `/admin/cost-codes`, `/admin/delivery-pricing`, `/admin/intelligence-rules`, `/admin/intelligence-rules/:id`, `/users`, `/super-admin/dashboard`, `/executive-analytics`, `/intelligence`, `/intelligence-signals` |

Not covered by this skill: `/login`, `/forgot-password`, `/reset-password`
(unauthenticated, low-risk shell pages) and `/portal/*` (the External Data
Portal is a separate auth system for customer/vendor orgs — same
"boots/renders/no console errors" checks apply, but it's a different login
flow than everything above and isn't in the role matrix below).

Run `scripts\list-routes.cmd` to re-extract the live route list from
`App.jsx` and diff it against this table when routes are added or renamed.

## Role Gating Specifics

- **Accounting tabs** (`src/pages/Accounting.jsx`, `TAB_ROLES` around
  line 49): `admin`/`super_admin` bypass entirely via `isAdminUser()`.
  Everyone else needs a role in the per-tab list — `project_manager` gets
  Job Costing/Budget/AR/WIP/AI tabs but not Vendor Bills/Cash/Close;
  `finance_department`/`controller`/`president`/`ceo` get all nine tabs.
  `hr_admin` and `payroll_admin` have module-level `/accounting` access
  (per `rbacConfig.jsx`) but by design match zero tabs here and land on
  the access-denied state — that's intentional, not a bug.
  (Note: this contradicts the older "Accounting tab-level permissions not
  enforced" line in the `steelos-context` skill's Known Bugs list — as of
  this check, tab-level enforcement exists and works as designed. That
  memory entry looks stale; worth updating separately.)
- **Legal** (`src/pages/Legal.jsx`, `LEGAL_ROLES` line 24): only `admin`,
  `president`, `ceo` (plus `is_admin === true`) — everyone else sees the
  restricted-access state.
- **Employee Center** (`src/pages/EmployeeCenter.jsx`): admin/super_admin
  get a support "view as employee" path (`isAdminUser()`) instead of the
  normal PIN gate, and that access is logged. Every other role goes
  through the normal PIN-gated employee flow.
- **Pack-gated sections** (`src/lib/modulePacks.js` /
  `src/lib/moduleEntitlement.js`): independent of role. A company's
  `subscription_plan` (`SteelOS_Fab` / `SteelOS_Erect` / `Enterprise_Connect`)
  controls which of `FAB_ONLY_MODULES` (`/inventory`, `/production`,
  `/shop-fabrication`, `/shop-operations`, `/shop-floor-command-center`,
  `/shop-efficiency`, `/shipping`) and `ERECT_ONLY_MODULES`
  (`/field-operations` and its two sub-routes) are visible — a Fab-only
  plan hides the Erect-only ones and vice versa; Enterprise Connect shows
  both. Change it: log in as `admin@steelos.dev` or
  `superadmin@steelos.dev`, go to `/super-admin/dashboard`, and change the
  plan dropdown for Hancock Steel. A role's `allowed_modules` in
  `rbacConfig.jsx` and the company's pack are two independent gates —
  both must allow a path for it to actually show up in nav for a
  non-admin role.

## Standing Rule: No New Form Tags

Files that legitimately still use `<form>` (pre-existing, do not flag
these unless the tag was moved/changed in a way unrelated to the standing
rule):

- `src/pages/Login.jsx`
- `src/pages/ForgotPassword.jsx`
- `src/pages/ResetPassword.jsx`
- `src/pages/ProjectNew.jsx`
- `src/pages/ProjectManagement.jsx`
- `src/pages/ProcurementModule.jsx`
- `src/pages/portal/PortalLogin.jsx`

Run `scripts\check-new-forms.cmd` and diff its output against this list.
Any `<form` match in a file not on this list is a new violation.
