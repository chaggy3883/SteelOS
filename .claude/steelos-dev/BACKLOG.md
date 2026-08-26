# SteelOS Backlog

Snapshot as of Aug 26 2026. This file is meant to be kept current —
update it the same way you'd tell Claude "add to the list": move items
between sections as they're started/finished, and add new ones under the
right heading. Ask which section if it's ambiguous.

## Also Closed (2026-08-26)

- **Real AR/AP payment layer** — closes the gap where "payment" was only a
  single status-flag flip (`InvoiceReceivable.payment_status`, and
  `VendorBill.status` had no paid state at all). New `Payment` entity
  (`schema/entities/Payment.jsonc`, `src/lib/paymentEngine.js`): supports
  partial payments, `is_write_off`/`is_unapplied`/`is_retainage_release`
  flags, direction (`receivable`/`payable`), `related_entity_type`
  (`InvoiceReceivable`/`VendorBill`/`SubcontractPayApp`). Transition rule:
  existing single-flip records (already-Released invoices, already-marked
  pay apps) have no fabricated `Payment` history behind them — only payments
  recorded going forward flow through this entity; `payment_status`/`status`
  remain the lifecycle fields, "fully paid" is now derived from summed
  applied `Payment` rows. `VendorBill.status` gained `Paid` (previously
  stopped at `Pending_Match`/`Approved`/`Flagged_Review` despite
  `ReceivingKiosk.jsx` telling users AP would process payment — nothing ever
  did). Both `VendorBillDetailModal.jsx` and `InvoiceReceivableDetailModal.jsx`
  gained a "Record Payment" action (period-lock gated, same override-reason
  pattern as the prior Accounting Controls fix) with a Payment History table;
  a bill/invoice shows "Partially Paid: $X of $Y" in its list row once any
  payment applies without covering it in full. The existing manual
  payment_status dropdown flip in `Accounting.jsx`'s `saveInvoiceNow` is
  UNCHANGED (still works exactly as before for a single-action full payment)
  — the new Record Payment path is additive, and both share the same
  wasReleased/isNowReleased commission-trigger guard via the new
  `recordInvoiceReceivablePayment` (src/lib/paymentEngine.js), so commission
  still fires exactly once at the real moment of full payment no matter
  which path completed the invoice.
  Computed (never stored) **Customer Balances** and **Vendor Balances** tabs
  (`src/lib/balancesReport.js`) and **AR Aging**/**AP Aging** tabs
  (`src/lib/agingReport.js`, standard Current/1-30/31-60/61-90/90+ buckets) —
  every row/cell drills down to the underlying invoices/bills via the new
  `BalanceDrilldownModal.jsx`. The month-end checklist's long-dead "Review AR
  aging" item now links straight to the AR Aging tab
  (`MonthEndClosePanel.jsx` → `/accounting?tab=araging`).
  **Retainage release**: AR side adds a "Release Retainage" action on a
  `complete`-status project (sums `retainage_held` across its Released
  billings into one new `InvoiceReceivable`, `billing_type:
  'retainage_release'` — a real invoice with its own Payment tracking, not a
  status flip); AP side adds "Release Retainage" on a `SubcontractPayApp`
  once its `Subcontract.status` is `complete` (one `Payment`,
  `is_retainage_release: true`, covering every `retention_held` dollar
  across that subcontract's pay apps) — both period-lock gated.
  **Credit/debit memos**: single `Memo` entity (`type:
  'customer_credit'|'vendor_debit'`) rather than two parallel entities —
  "Issue Credit Memo"/"Issue Debit Memo" actions reduce the effective
  balance everywhere (aging, balances, statements, the release/commission
  threshold) without touching the original invoice/bill's own numbers.
  **Write-offs**: "Write Off" on an InvoiceReceivable requires
  Admin/Controller/Super Admin + a mandatory reason (reuses
  `hasFinanceOverrideAccess`) — modeled as a `Payment` with `is_write_off`
  (zeroes the balance everywhere) but excluded from the cash total that
  drives Released/commission, so a write-off can never look like a real
  payment or fire commission.
  **Customer statements**: "Generate Statement" on the Customer Balances tab
  produces a PDF (`src/lib/customerStatementPdf.js`, same manual-jsPDF +
  Blob-download pattern as `certifiedPayrollReportPdf.js`) listing open
  invoices, applied payments (write-offs labeled distinctly), credit memos,
  and total balance due.
  **Unapplied cash**: an overpayment recorded through either detail modal is
  tracked via `Payment.is_unapplied`/`unapplied_amount`; the new "Unapplied
  Cash" tab under Bank & Cash (`UnappliedCashPanel.jsx`) lists them with an
  "Apply to Invoice/Bill" action (`applyUnappliedCash`). `IncomingAchPanel.jsx`'s
  existing "Assign to Invoice" flow previously only wrote a
  `matched_to_entity` string and never actually reduced the invoice's
  balance — it now routes through `recordInvoiceReceivablePayment` too, so
  an ACH deposit assigned to an invoice can complete it (Released +
  commission) exactly like a manually-recorded payment.
  Verified stage-by-stage (Payment entity → VendorBill gap → InvoiceReceivable
  payment recording → balances → aging → retainage → memos → write-offs →
  statements → unapplied cash) with `npm run build`/`npm run lint` passing
  clean after every stage, plus the release/commission math traced by hand
  (partial payment stays Approved with correct remaining balance; second
  payment completing it flips to Released and fires commission exactly
  once; a hand-computed 56-days-past-due invoice lands in the AR Aging
  31-60 bucket as expected). NOT done in this pass, flagged as follow-ups:
  a full multi-invoice memo-application UI (the current Memo is
  intentionally single-invoice/single-bill only), and interactive
  browser click-through testing — this session's environment has no
  browser-automation tool available (per the `browser-testing` skill, this
  project has none of Playwright/Puppeteer/Cypress installed), so the UI
  paths above are unverified by an actual click-through and should get a
  manual pass before being treated as fully signed off.

## Also Closed (2026-08-25)

- **Candidate hiring/archiving workflow (HR → Candidates ATS)** — explicit
  "Hire This Candidate" / "Reject Candidate" confirm modals replace the old
  bare status-dropdown flip for those two terminal statuses (Applied/
  Interviewing/Offer_Extended still change via the dropdown). Hire modal
  (hire_date, position_title) calls the rewritten `hireCandidate()`
  (`src/lib/employeesApi.js`) — now also moves the candidate's documents to
  the new employee record, writes a `StatusHistoryEntry`, and opens the new
  employee's profile on success. Reject modal (reason dropdown + "Other"
  free text, "Keep Documents" switch) calls the new `rejectCandidate()`,
  same file. 2 new entities: `candidate_documents` (resume/application/
  cover letter/other, uploaded per-candidate via the new
  `HiringDocumentsPanel.jsx`, blobs in the new `hiringDocumentStore.js`
  IndexedDB store per standing rule 4 — not localStorage, unlike the older
  `employee_documents`/`ComplianceDocumentCenter.jsx` pattern) and
  `employee_hiring_documents` (landing spot for the moved documents, shown
  alongside `ComplianceDocumentCenter` on `EmployeeProfileDialog.jsx`'s
  Documents tab). `moveCandidateDocumentsToEmployee`/
  `deleteAllCandidateDocuments` (`src/lib/hiringDocumentsApi.js`) do the
  actual move-on-hire / delete-on-reject-without-keep. New read-only
  "Candidate Archive" tab on `/human-resources` lists rejected candidates
  (name/position/rejected date/reason/View Documents); rejected candidates
  no longer show in the working ATS pipeline list. `candidate_profiles`
  gained `hire_date`/`rejection_date`/`rejection_reason` and — along with
  the 2 new entities — was added to `TENANT_SCOPED_ENTITIES`
  (`candidate_profiles` itself was missing from that list before this,
  a pre-existing company_id-scoping gap this closed as a side effect).
  Global Search gained a `candidates` category (HR roles only, matching
  ATS/Archive access), searching name/email/position across every status
  including archived ones.

- **ACH integration (Admin → Integrations)** — configuration/logging layer
  only, per the standing "no real backend" constraint — NOT a real bank/ACH
  processor integration; the actual webhook handlers/batch file
  generation/authentication are deferred to the VPS phase. 4 new entities:
  `BankIntegrationConfig` (admin-only ACH setup — bank name, API
  key/endpoint, company routing/account number, test mode, "Verify API
  Connection" simulated test — `AchConfigPanel.jsx`, mounted into the
  existing `IntegrationsGateway.jsx` alongside the API credential cards),
  `EmployeeBankAccount` (HR-managed, one active primary per employee,
  non-cryptographic obfuscation via `hrSecurity.js`'s new
  `obscureSecret`/`revealSecret` aliases — managed at `/payroll/setup`'s new
  "Direct Deposit" tab, `DirectDepositPanel.jsx`; employee's own view in
  EmployeeCenter.jsx's Profile tab is masked/read-only with a "Request
  Change" notification, mirroring the existing `requestInfoUpdate` pattern —
  never a self-service edit), `AchOutgoing` (payroll → bank; created
  automatically in `PayrollRunPanel.jsx`'s `handleLock` for every employee
  with `employees.direct_deposit_enabled` and an active bank account, one
  row per employee at net pay — guarded against duplicate creation on a
  reopen→re-lock cycle), `AchIncoming` (bank → AR; manual log entry in
  Accounting.jsx's new "Incoming ACH" sub-tab under Bank & Cash,
  `IncomingAchPanel.jsx` — auto-matches to a `purchase_orders` row by exact
  vendor name + amount only, never on amount alone; anything else lands in
  an "Unmatched ACH Deposits" widget with an Assign action (PO/Invoice/
  Customer/Custom) and a role-broadcast `Notification` to
  finance_department/controller/president/ceo via the new
  `src/lib/achEngine.js`). CSV reconciliation export on both the outgoing
  (admin panel) and incoming (Accounting panel) sides via the existing
  `csvExport.js` helper. Bank credential/account-number fields all match
  the existing `AUDIT_SENSITIVE_FIELD_PATTERN` naming convention so they're
  automatically excluded from `AuditLog`.

- **Time & Material project type** — `Bid.pricing_type`/`Project.pricing_type`
  (`fixed_price` | `time_and_material`, carried over on bid-won conversion in
  `createProjectFromWonBid`). 5 new entities: `TmLaborRate` (company-wide
  shop rates by position, effective-dated history, admin-managed at
  `/admin/tm-labor-rates` — mirrors `SalesmanRatesAdmin.jsx`'s pattern),
  `TmLaborEstimateLineItem`, `TmMaterialLineItem`, `TmSubcontractorLineItem`
  (estimate-side, bid_id-scoped), `TmMaterialUsage` (project-side actuals,
  posts `JobCostLedgerEntry` cost_class `MAT` guarded by `job_cost_posted`).
  Deliberately does NOT post a second `LAB` job-cost entry — actual labor
  cost keeps flowing through the existing payroll-period posting
  (`Payroll.jsx`); `TmLaborRate` is a customer bill rate, computed on the fly
  against `TimeEntry.hours` via new `src/lib/tmEngine.js`, never written to
  the ledger. Subcontractor actuals reuse the existing PO→job-cost wiring
  from commit `38ff5bc` entirely (`TmSubcontractorLineItem.purchase_order_id`
  just links to it — no new posting path). New `TmEstimateWorksheet.jsx` tab
  on `BidDetail.jsx` (shown instead of the fixed-price takeoff tabs when
  `pricing_type` is T&M) and `TmTrackingPanel.jsx` tab on `ProjectDetail.jsx`
  (labor/material/sub variance, material usage logging, PO linking).
  `InvoiceReceivableDetailModal`'s create/edit flow (in `Accounting.jsx`)
  gained a "Generate from Actuals" T&M billing mode
  (`InvoiceReceivable.billing_type`) alongside the existing SOV flow.
  Markup %: `Company.default_tm_markup_percentage` (Admin > Company
  Settings) pre-fills `Bid.tm_markup_percentage`, editable per bid/project.
  No demo seed data added for the new entities — matches the existing
  precedent that newer entities (`EmployeePayRate`, `SalesmanCommissionRate`)
  aren't seeded either.

- **Immutable field-level audit trail** — `AuditLog` (already existed as a
  hand-written event log — see AuditLog.jsonc) extended rather than
  replaced with a generic `action`/`field_name`/`old_value`/`new_value`/
  `change_summary`/`is_deleted` shape. Every `db.entities.*.create/update/
  delete/updateMany/bulkCreate` call across the WHOLE app now auto-writes
  AuditLog rows via `buildAuditLogEntries`/`persist()` in
  `src/api/localData.js` — one row per changed field on update, one row
  per populated field on create, one summary row (sanitized full-record
  snapshot) on delete. Excluded from auto-logging: `AuditLog`/
  `FailedAccessLog`/`SystemAuditEvent` themselves (recursion) and
  `UserSessionLog` (60s heartbeat churn would flood the ~5MB localStorage
  quota with zero audit value — see the comment above
  `AUDIT_EXCLUDED_ENTITIES`). Passwords/SSNs/PINs/tokens/secrets are never
  written, even redacted (`AUDIT_SENSITIVE_FIELD_PATTERN`). AuditLog rows
  are write-once — `update()` only permits `{is_deleted, delete_reason}`,
  `delete()` always throws — and are now tenant-scoped
  (`TENANT_SCOPED_ENTITIES`), which they were NOT before this change (a
  real cross-tenant leak this closed as a side effect). A 1-year retention
  purge runs on every app load (`purgeExpiredAuditLogs`, inside
  `migrateStore`) and logs itself to the new `SystemAuditEvent` entity.
  New `FailedAccessLog` entity captures failed logins (both
  `loginViaEmailPassword` and `loginViaEmployeePin`) and permission
  denials; only wired for auth failures and the new Audit Trail page
  itself, NOT retrofitted across every existing role-gated page (that's
  the pre-existing "Accounting tab-level permissions not enforced" gap
  below — out of scope here). New `/audit-trail` page (admin/super_admin
  only, gated the same way `Admin.jsx` is): filters (date range, entity
  type, user, action, entity ID), CSV export, drill-down detail dialog
  with a soft-delete action, and four breakdown cards (most-changed
  records, top changers this month, deletions by entity type, payroll
  changes in the current open/processing `PayPeriod`). The old
  `AuditLogViewer.jsx`/Admin.jsx "Audit Logs" tab was removed and replaced
  with a nav link to `/audit-trail` rather than kept as a second, weaker
  audit UI.

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
