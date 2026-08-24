# SteelOS Backlog

Snapshot as of Aug 11 2026. This file is meant to be kept current —
update it the same way you'd tell Claude "add to the list": move items
between sections as they're started/finished, and add new ones under the
right heading. Ask which section if it's ambiguous.

## Foundation Software Gaps — Closed

- Subcontract management
- Equipment job costing
- Certified payroll tracking
- Payroll

## Also Closed

- Payroll nav group + hours-at-a-glance view
- HR section rebuild (add-employee wizard, employee files/disciplinary
  storage, interview scheduling + widgets calendar hook, application PDF
  export/print)
- Equipment rental (PO column linked to PurchaseOrderDetailModal,
  PO-vendor-mismatch hard block w/ accounting-only override, asset edit
  path, off-rent overdue flags, rental burn vs PO)
- Equipment maintenance (PM-due reset-on-service fix, repair drill-down,
  job cost + AP bill posting)
- Parts/bolts/embeds + per-part yield tracking added to PieceMark (stock
  qty calc, bolt-vs-inventory comparison, pieces<->PieceMark FK bridge via
  piece_mark_id)
- Jobsite Receiving tab in Field Operations (erector-facing per-piece
  check-in, phase-broken-out tally, field rejections, inbound loads —
  additive to existing Yard Scanning master-receipt flow, not a
  replacement)
- Legacy shipping system cleanup — consolidated onto `loads` + `load_items`
  + `shipping_manifests` only. Removed `PieceMark.shipping_load_id` +
  `shipping_loads` (Shipping.jsx's Trailer Matrix tab, ProjectManagement.jsx's
  shipping form, and the dashboard shipments widget all touched it). A
  one-time `migrateLegacyShippingLoads` migration in `src/api/localData.js`
  folds any pre-existing legacy records/assignments forward on load rather
  than dropping them.
- Termination access-revocation cascade — `src/lib/employeeAuth.js`'s
  `isEmployeeActive()` is now checked by every employee-linked login path
  (kiosk PIN, Employee Center's manual PIN card, and `db.auth.me()`'s
  per-call re-validation for any already-open session). `User` accounts can
  now optionally link to an `employees` row via `employee_id` (Users.jsx's
  "Link to Employee" picker), so a portal (email/password) login is also
  revoked the instant that linked employee is terminated — not just kiosk
  access. `TerminationPanel.jsx` writes a `StatusHistoryEntry` on both
  termination ("Access Revoked") and the new Reinstate Employee action
  ("Access Restored"), and a forced logout mid-session shows "Your account
  has been deactivated. Please contact HR." on next auth check (route change
  or the existing 60s heartbeat). Kiosk-only nav/UI (NavBar's hidden groups,
  Employee Center's "Exit Terminal" button) now keys off an explicit
  `is_kiosk_pin_session` flag rather than employee_id presence, since
  employee_id no longer implies a shared shop-floor terminal.
- Kiosk/timeclock PIN scheme changed from a derived 5-digit formula to the
  employee's own last-4 SSN, entered directly as a 4-digit PIN (see
  `src/lib/pinFormula.js`'s security caveat). Demo seed employees now have
  distinct `ssn_last4` values, which also fixes the PIN-collision bug below.
- Sales & Commission system — 5 new entities (`SalesCommissionConfig`,
  `SalesmanCommissionRate`, `ProjectCommission`, `ProjectCommissionPayment`,
  `SalesCommissionPayout`) plus `src/lib/commissionEngine.js`
  (`calculateProjectCommission`, `triggerCommissionOnPayment`,
  `queueCommissionsForPayroll`). Admin config at `/admin/commission-setup`
  (profit %/bid amount %/flat rate, admin-only) and per-salesman rate
  history at `/admin/salesman-rates` (admin/payroll_admin/hr_admin), mirroring
  `EmployeePayRate`'s effective-dated-history convention. `employees.is_salesman`
  and `Bid.salesman_id`/`Project.salesman_id` added — salesman assigned on the
  bid (`BidDetail.jsx`, next to Estimator) and carried onto the won project.
  Wired end-to-end: `Accounting.jsx` triggers commission on an
  `InvoiceReceivable` payment-status flip to Released; `PayrollRunPanel.jsx`
  sweeps queued payouts into a run as `PayrollAdjustment` rows
  (`adjustment_type: 'commission'`, new GL-mappable cost type) when the run is
  created, and flips payouts/payments to `paid_out` when the run locks.
- Salesman Dashboard + RFI/CO/Addenda notification routing — new
  `salesman` BUILTIN_ROLE and `sales` company add-on module key, route
  `/sales/dashboard` (`src/pages/SalesDashboard.jsx`), 7 toggleable widgets
  (`src/components/sales/*Widget.jsx`, data helpers in
  `src/lib/salesDashboardData.js`): Sales Pipeline, My Active Projects
  (issues = pieces.workflow_status 'Rejected', open RFIs, Failed QA —
  pieces has no distinct "rework" state), Commission YTD (reuses
  `commissionEngine.js`'s `getSalesmanCommissionSummary`), Recent RFIs,
  Change Orders, Addenda/Bulletins (new `ProjectBulletin` entity — no
  addendum/bulletin entity existed before this), Quick Stats. Admin sets
  default widgets + `allow_salesmen_see_pipeline` in Commission Setup;
  each salesman's own on/off + refresh-rate choice persists via the
  existing `page_layouts_json` convention (`Dashboard.jsx`'s mechanism),
  not a new entity. Admin/payroll_admin can pick any salesman to view for
  support. Notification routing lives in `src/lib/salesNotifications.js`
  (RFI created by salesman → PM/QA/Shop/Estimating; by anyone else →
  salesman; CO marked "received from customer" → PM/Estimating; bulletin
  → PM/Shop/salesman) — extends the existing `Notification` entity
  (`entity_type`/`entity_id`/`creator_id` added) rather than a new one;
  `RFI.created_by_role`/`pending_salesman_response` and
  `change_orders.received_from_customer` added to drive it. `TopBar.jsx`'s
  notification bell is now clickable (marks read, navigates via `link`) —
  previously dead. Real-time cross-session toast delivery is not possible
  here (no backend/push) — a notification is created and visible on next
  load/navigation, not pushed live into an already-open other session.

## Given As Prompts — Not Yet Confirmed Landed

Verify these actually pushed and passed build/lint before treating as
closed:

- AI quote-to-PO reader + receiving kiosk one-click checkbox + fixed
  manual PO creation to generate real line items + expanded demo PO data
- AI invoice reader for VendorBill creation (feeds existing
  `runThreeWayMatch`, does not replace it)
- AI-drafted RFI responses (uses existing `ai_generated` flag, steel-
  expert prompt persona)
- AI MTR/heat-number reader at receiving (creates MillTestReport records)

## In Progress

- IRONSIGHT real-drawing-set testing (ongoing, done between other tasks)

## Queued

- **Project phasing (Sequence vs. Area)** — prompt drafted/ready, NOT yet
  actually built despite misleading commit `89832c6` title (that commit's
  message says phasing but its diff is subcontract-management work)
- **Meeting Mode** (Manpower + Executive) — blocked on 2 open questions:
  (a) does the manpower meeting include scheduling specific crews to
  jobs, or just workload/sequence, (b) should job cost be visible in the
  executive meeting screen or only as a pre-read
- **Mac flash drive chip auto-detect** (node-mac-arm64 / node-mac-x64 via
  `uname -m`)
- **RFI open/review workflow** — open individual RFIs, mark
  answered/unanswered; demo data shows status but Production+PM tab has
  no way to change it (note: distinct from the AI-drafted-response prompt
  above — that adds drafting, this adds status-change UI in a different
  tab)
- **IRONSIGHT bid link** — must be able to link a takeoff to a bid
  name/number; flagged as required for the module to function
- **Bid list 21-day flag** — bright red day-count badge in status column
  after 21+ days since bid submitted; preserve all existing status
  markers
- **Widgets panel click-outside-to-close** — currently stays open until
  page navigation
- **Super Admin employee center full access**
- **Landing page slideshow replace** — needs a real picture slideshow
- **Rigging inspection documentation** — NCCCO certifies people; OSHA
  1926.251 / ASME B30.9 covers equipment. Two separate record types;
  needs clarification before building.
- **Fab/Erect/Enterprise pack module-gating build** — module split
  largely agreed:
  - Fab only: shop-fabrication, shop-operations, shop-efficiency,
    production, inventory, quality (fab AISC content),
    receiving-kiosk, shipping*, IRONSIGHT
  - Erect only: field-operations, quality (erector AISC content)
  - Universal: core, estimating, accounting, HR, payroll, intelligence,
    shipping*, and the rest of the back office
  - Enterprise only: executive-analytics, system-integrations
  - *shipping ended up universal, not Fab-only, since erectors need
    inbound visibility — resolve this against whatever's actually
    implemented
  - Still needed: plan-vs-`enabled_modules` architecture decision (which
    one is the source of truth / which overrides which), super-admin-
    impersonation bypass of pack gating, `shop-efficiency` registration
    in `ALL_MODULES` (currently missing, which is why it's ungated today)
- **AISC Fab vs. Erector certification content split** in `Quality.jsx` —
  currently only has generic hardcoded Fab AISC cert content, no
  erector-specific section
- **AI Intelligence rework** — build a rule-based/deterministic anomaly
  engine across accounting/HR/equipment/etc. as the real-time monitor
  (see `steelos-architecture` skill: no backend exists for a truly
  always-on AI check, so detection should be rules; an LLM narrative
  layer on top is deferred to the VPS)
- **QR scan tie-in for piece production timing** — currently the
  employee types the piece mark manually in `EmployeeCenter.jsx`; a
  barcode-printing system already exists but nothing reads it back
- **`target_minutes` integrity fix** — currently employee-entered per
  piece, which is gameable; needs to come from a standards table instead

## Known Bugs

- `Settings.jsx` save button is fake — shows "Settings saved!" but
  persists nothing
- Accounting tab-level permissions not enforced — any role with
  `/accounting` sees Cash Management + Budget
- **`Project` vs `projects` entity split** (found while building the
  Salesman Dashboard) — two separate registered entities in
  `src/api/apiClient.js`, both seeded with the same `project-harbor` id at
  startup so they coincidentally line up for demo data. `Projects.jsx` /
  `ProjectDetail.jsx` / `RFIs.jsx` / bid-to-project auto-creation
  (`BidDetail.jsx`) all use PascalCase `Project`; `ProjectManagement.jsx`
  and `ChangeOrders.jsx` (the Change Order Hub) use lowercase `projects`.
  A project created going forward via a won bid exists in `Project` only,
  so it will not appear in the Change Order Hub's project picker or
  `ProjectManagement.jsx` until this is reconciled. Not fixed as part of
  the commission/sales-dashboard work — too large/risky a refactor to
  bundle into that scope.

## Deferred — Needs Real Backend/VPS

- File sharing / cloud storage
- VPS setup (unlocks ADP sync + AI proxy + file storage together)
