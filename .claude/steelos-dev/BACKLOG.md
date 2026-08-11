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
- **Legacy shipping system cleanup** — three parallel shipping systems
  exist; `PieceMark.shipping_load_id` + `shipping_loads` (drag-drop tab)
  is legacy/undocumented vs. `loads` + `load_items` + `shipping_manifests`
  (the maintained system Jobsite Receiving was built on) — should
  deprecate the legacy one eventually

## Known Bugs

- `Settings.jsx` save button is fake — shows "Settings saved!" but
  persists nothing
- Accounting tab-level permissions not enforced — any role with
  `/accounting` sees Cash Management + Budget
- Demo employee PIN collision — all PINs resolve to `00001`

## Deferred — Needs Real Backend/VPS

- File sharing / cloud storage
- VPS setup (unlocks ADP sync + AI proxy + file storage together)
