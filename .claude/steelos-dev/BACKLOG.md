# SteelOS Backlog

Snapshot as of Sep 2 2026. This file is meant to be kept current —
update it the same way you'd tell Claude "add to the list": move items
between sections as they're started/finished, and add new ones under the
right heading. Ask which section if it's ambiguous.

## Also Closed (2026-09-15) — IRONSIGHT Count tool: fraction precision, Plate dims, push-to-estimate field loss, weight calc

- **Five related fixes to the Count/Bolt Count engine, all traced by hand
  against a concrete W12x26 example before/after.**
  (1) **1/16" fraction precision**: `CountSetupModal.jsx`'s Length field was
  whole-number feet/inches only. New shared `src/lib/fractionInches.js`
  (`FRACTION_OPTIONS`, `feetInchesFractionToDecimal`,
  `decimalFeetToFeetInchesFraction`, `formatFeetInchesFraction`) extracted
  from `BlueprintTakeoff.jsx`'s pre-existing Set Scale calibration pattern —
  that screen now imports from the shared lib instead of defining its own
  copy — and reused verbatim in `CountSetupModal.jsx`'s new `DimensionFields`
  sub-component (feet Input + inches Input + fraction Select), applied to
  both Length and the new Width field.
  (2) **Plate Length + Width**: Plate's material requirement depends on all
  three dimensions, not thickness (the existing Size dropdown) alone. Added
  a Width field (same 1/16" `DimensionFields`), shown only when the selected
  shape's `shape_code` is `PL`/`PLGA` — new `width_ft` on the saved row
  (`schema/entities/blueprint_takeoffs.jsonc`).
  (3) **Push-to-estimate field loss (confirmed bug)** — root cause was in
  `MarkupsList.jsx`'s `buildPayload`/`buildGroups`
  (`handleSaveCountSession` itself was already correct), not one bug but
  three: `length_ft` was hardcoded to `0` for every Count group regardless
  of the real length captured in Count Setup; `grade` was never read at all
  (and Count Setup never captured a grade for beam counts to begin with —
  only bolt counts had a Grade field); and `shape_class` was written
  directly from the master catalog's free-text description (e.g.
  "Wideflange Beams") instead of `MaterialTakeoffLine`'s real 5-value enum
  (`W-Beam`/`HSS Tube`/`C-Channel`/`L-Angle`/`PL-Plate`) — an invalid enum
  value that would have made the Bid Worksheet's Shape/Size Selects and its
  own independent weight estimator silently blank/zero after push. Fixed by
  capturing `shape_code` (the catalog's short code) on every Count/Bolt
  Count row alongside the existing `shape_type` description, adding a Grade
  field to Count Setup for beam counts too (not just bolts), and a new
  shared `src/lib/countShapeProfile.js` (`shapeCodeToShapeClass`,
  `buildCompactShapeProfile`) that bridges `shape_code` to the real enum and
  builds a compact AISC-style profile string (e.g. "W12X26") from the
  master catalog's spaced size format ("12 x 26") — used for both the
  pushed `shape_class`/`material_size` and IRONSIGHT's own weight lookup
  (see below), not two divergent implementations.
  `MarkupsList.jsx`'s count-group `length_ft` now comes from the "Typical
  length" setting, whose default is fixed to seed from the group's real
  captured length instead of `0` (still editable/overridable, unchanged
  UI).
  (4) **Takeoff grid Length column truncation**: same `min-w`-instead-of-
  fixed-`w` fix already applied to the Bid Worksheet's cell sizing earlier
  this session, applied to the grid's read-only Length column/cell
  (`BlueprintTakeoff.jsx`), which also now renders the real fraction
  (`formatFeetInchesFraction`) instead of rounding to the nearest whole
  inch.
  (5) **No weight calculation for counted items (confirmed gap)** — Count
  rows always hardcoded `unit_weight_lbs_per_ft: 0`. Fixed by computing it
  at save time (`handleSaveCountSession`) via the exact same
  weight-resolution Detailer Import already uses
  (`detailerImportWeight.js`'s `resolveWeightPerFt`, now exporting its
  `SHAPE_CODE_TO_CATALOG_CLASS` map so it's one shared table, not a second
  copy) — catalog match first (`steel_catalog`), geometric estimate
  fallback (`estimateWeightPerFt`) otherwise, fed the compact profile string
  from `countShapeProfile.js`. The existing takeoff-grid weight/tonnage
  math (`unit_weight_lbs_per_ft × length_ft × quantity`) already displayed
  this once populated — no second total-weight calculation added.
  `MarkupsList.jsx`'s own weight-settings panel now also prefers this
  already-resolved row weight over its separate (and format-mismatched)
  `SHAPE_CATALOG` guess.
  Verified by full hand-trace (no browser-automation tool in this project —
  per standing feedback, code trace + build/lint first): a W12x26 beam count
  at 20'-6 3/16" (→ 20.515625 ft) marked 5 times resolves
  `unit_weight_lbs_per_ft` to 26 (AISC self-encoded W-beam weight, matched
  both via `estimateWeightPerFt`'s regex and, if seeded, `steel_catalog`),
  giving a grid Total Wt of ≈2,667 lb; pushed to the Bid Worksheet, the
  `MaterialTakeoffLine` lands with `shape_class: 'W-Beam'` (valid enum,
  bridged from `shape_code: 'W'`), `material_size: 'W12X26'`,
  `length_ft: 20.515625`, `quantity: 5`, `weight_per_ft: 26` — shape, size,
  and length all confirmed arriving correctly (previously `length_ft` would
  have landed as `0` and `shape_class` as the invalid string "Wideflange
  Beams"). `npm run build && npm run lint` clean.

## Also Closed (2026-09-15) — Excel export for tabular report PDFs

- **Excel (.xlsx) export added alongside "Export PDF" across 25 report
  files** (24 named tabular-data reports plus `monthEndClosePdf`, a
  judgment-call inclusion — the close checklist is tabular enough to be
  worth tracking completion across cycles in a spreadsheet). Every new
  `<name>Xlsx.js` reuses the exact `detailerImportBatchReviewXlsx.js`
  pattern (array-of-arrays → `XLSX.utils.aoa_to_sheet` → `book_new` →
  `book_append_sheet` → `XLSX.write(..., {type:'array', bookType:'xlsx'})`),
  downloaded via the shared `downloadWorkbook` helper
  (`bidRecapXlsxExport.js`). No letterhead image (SheetJS community build
  can't embed images) — company name/address/phone written as plain text
  header rows instead, matching the existing precedent. Money/numeric
  columns are written as real JS numbers, not the PDF's formatted
  `$1,234.56` strings, so the export is actually usable in Excel (sum/sort).
  Every Excel function takes the identical parameter object as its PDF
  sibling and is called with the same already-fetched data the PDF button
  uses — no requerying, so the two exports can never disagree.
  `aiFinancialFlagsPdf`'s Excel version deliberately excludes the narrative
  fields the PDF renders as cards (`ai_explanation`, `quoted_text`,
  `recommendation`, `review_notes`) and exports only a lightweight
  structured table (finding ID, project, severity/`risk_level`,
  `created_date`, `status`) — narrative text doesn't belong in a
  spreadsheet cell.
  New lib files (`src/lib/`): `aiFinancialFlagsXlsx`, `arBillingXlsx`,
  `bidInternalBreakdownXlsx`, `budgetXlsx`, `cashForecastXlsx`,
  `cashReconciliationXlsx`, `customerStatementXlsx`,
  `estimatingActiveBidsXlsx`, `estimatingBidHistoryXlsx`,
  `estimatingDidNotBidXlsx`, `estimatingShopHoursVarianceXlsx`,
  `execArApAgingXlsx`, `execBidWinLossXlsx`, `execCashPositionXlsx`,
  `execQuarterlyTaxExposureXlsx`, `incomingAchXlsx`, `jobCostDetailXlsx`
  (covers both `generateProjectJobCostPdf` and
  `generateCompanyWideJobCostPdf`), `jobCostingSummaryXlsx`,
  `materialOptimizationReportXlsx`, `monthEndCloseXlsx`,
  `qualityKpiReportXlsx`, `requisitionXlsxExport` (mirrors
  `requisitionPdfExport.js`'s `exportXToPdf` naming, not `generateXXlsx`;
  wired into all 3 of its callers — `BlueprintTakeoff.jsx`,
  `MarkupsList.jsx`, `FullTakeoff.jsx`), `unappliedCashXlsx`,
  `vendorBillsXlsx`, `wipOverUnderBillingXlsx`, `wipRadarXlsx`,
  `wipReportXlsx`. UI buttons added next to each existing "Export PDF"
  button (`FileSpreadsheet` icon from lucide-react, same busy-state/
  try-catch/toast pattern as the adjacent PDF handler) across
  `Accounting.jsx`, `ExecutiveAnalytics.jsx`, `Estimating.jsx`,
  `EstimatingAnalytics.jsx`, `BidDetail.jsx`, `QualityKpiBuilder.jsx`,
  `BlueprintTakeoff.jsx`, `MarkupsList.jsx`, `FullTakeoff.jsx`, and 6
  standalone accounting panels (`BudgetPanel`, `UnappliedCashPanel`,
  `IncomingAchPanel`, `CashManagementPanel`, `CashForecastPanel`,
  `MonthEndClosePanel`).
  **Deliberately excluded** (per explicit scope): document/legal/
  signature-bearing PDFs (`bolPdf`, `bidProposalPdf`,
  `submittalTransmittalPdf`, `scopeReviewPdf`, `delayNoticePdf`,
  `candidateApplicationPdf`, `proposalTermsPdfMerge`,
  `certifiedPayrollReportPdf`, `turnoverReviewPdf`) and 4 ambiguous
  flat-KPI executive cards (`execEstimatingPerformancePdf`,
  `execHeadcountPdf`, `execShopProductionPdf`,
  `execSalesPipelineCommissionPdf`) — confirmed none of these gained an
  Xlsx sibling or button.
  Built via 5 parallel subagents, each owning a disjoint set of
  page/component files to avoid concurrent-edit conflicts (one hit the
  session's rate limit right after finishing its wiring, before its own
  build/lint self-check — verified directly afterward instead).
  Verified by full hand-trace + spot-reading 6 of the new lib files across
  Accounting, Estimating, Executive Analytics, and Quality (data shape
  matches each PDF sibling's fields, numeric cells are real numbers, AI
  Financial Flags export correctly drops narrative columns) — no
  Playwright/browser-automation tool in this project (see
  `browser-testing` skill; per standing feedback, code trace + build/lint
  first, browser verification only on request). `npm run build && npm run
  lint` clean across the full repo (4052 modules, 0 lint errors).

## Also Closed (2026-09-15) — Documents rebuild, Smart File Dump removed

- **Unified Documents system on both Project and Bid pages, drag-drop +
  confirmed manual type selection, much larger category list, filter/search,
  link-don't-duplicate for categories with a real dedicated system.**
  `Document.document_type` grew from 24 to 40 values
  (`schema/entities/Document.jsonc`) — added `accounting`, `legal_general`,
  `close_out`, `contract_review_aisc`, `drawing_joist_deck`, `leed`,
  `notice_of_commencement`, `notice_of_furnishing`, `photo`,
  `request_for_change`, `safety`, `schedule`, `vendor_pricing`,
  `front_end_review`, `previous_recap_proposal`, `bulletin`; every value in
  the requested 29-category cross-reference list maps to one (several
  many-to-one, e.g. "Plans & Specifications"/"Specs" both → `specification`).
  Deliberately no document_type value exists for Change Orders, Purchase
  Orders, or Certified Payroll — those three have no manual-upload path at
  all, by design, so a disconnected duplicate record can never be created for
  them. `required` relaxed from `[project_id, name, document_type]` to
  `[name, document_type]` since a bid-stage Document has `bid_id` instead
  (schema files are documentation only, not runtime-enforced, so this is a
  doc-accuracy fix).
  New `src/lib/documentCategories.js` — single source of truth
  (`DOCUMENT_TYPE_OPTIONS`, all 40 human-labeled) fixing two pre-existing enum
  drift bugs found while exploring (`Documents.jsx`'s stale 10-value list,
  `Intelligence.jsx`'s stale 8-value list — both now import the shared list),
  plus `LINKED_DOCUMENT_CATEGORIES` (7 entries: Change Orders, RFI, Purchase
  Orders, Certified Payroll, Schedule, Safety, Contract Review Records AISC)
  each mapping to the real owning entity/query/detail-link. New
  `src/components/documents/DocumentsPanel.jsx`: drag-drop (the established
  window-level preventDefault backstop from `PieceMarkPdfIntake.jsx`, applied
  from the start rather than re-discovering the browser's native file-open
  fallback bug) opens a confirm-type modal per dropped file — Add stays
  disabled until every file has an explicit, manually-picked type (never
  auto-detected) — plus a document_type filter and name/description search.
  Selecting one of the 7 linked categories queries that system's real records
  instead of a disconnected upload bucket (only when that category is
  active, not merged into the default view) — Change Orders/RFI already had
  a `?open=<id>` deep-link convention (`ChangeOrders.jsx`, `RFIs.jsx`), added
  the same to `ProcurementModule.jsx` (wired to existing `setDetailPoId`/
  `setDetailOpen`), `CertifiedPayroll.jsx` (existing `selectedSubmission`),
  and `SafetyMeetingLog.jsx` (existing `setViewingMeeting`); Contract Review
  AISC switches to `ProjectDetail.jsx`'s own Handoff tab in-page (no route —
  `TurnoverReviewPanel` lives there); Schedule links to `/shop-fabrication`
  at the page level only since no per-record detail view exists anywhere for
  `shop_schedules` today (a real, stated limitation, not fabricated).
  Mounted on `ProjectDetail.jsx`'s Documents tab (`projectId`, replacing
  `FileExplorer.jsx` there only — `FileExplorer.jsx`/`PathBreadcrumb.jsx`
  stay in place for `CustomerHub.jsx`'s customer-portal view, untouched) and
  on `BidDetail.jsx`'s first tab (`bidId`, renamed `'files'` → `'documents'`
  including the `activeTab` default fallback — confirmed no deep link
  anywhere targeted `tab=files`).
  **Smart File Dump eliminated**: deleted `SmartFileDump.jsx` entirely —
  both its Document-creation side and its independent AI-parse-to-
  cost-breakdown/TakeoffLine-bulk-create flow, per explicit instruction; not
  preserved elsewhere. Removed its `BidDetail.jsx` import/mount; updated the
  3 comment-only mentions elsewhere (`MtrReader.jsx`, `Accounting.jsx`,
  `Purchasing.jsx`) plus `downloadFile.js`'s caller-list comment and
  `docs/entity-inventory.md`'s call-site lists to stop pointing at a deleted
  file; repointed the two `steelos-context`/`steelos-architecture` skill docs'
  "AI extraction reference implementation" citation to `Intelligence.jsx`
  (still alive, same UploadFile→InvokeLLM→human-review shape) so a future
  session isn't guided toward a file that no longer exists.
  **Bid → Project carryover**: verified, not changed — `createProjectFromWonBid`
  (`BidDetail.jsx`) already copies every Document with the bid's `bid_id`
  onto the new project (re-created with both `project_id` and `bid_id` set),
  predating this task; traced by hand that file resolution still works after
  the copy despite the new copy getting a fresh `id` — `documentBlobStore`'s
  IndexedDB entry stays keyed by the *original* Document's id, but
  `resolveDocumentUrl` falls back to `uploadedFileStore` via the `file_url`
  string (which carries UploadFile's own generated id, independent of the
  Document record's id), so the copy still resolves correctly. Not changed:
  the pre-existing copy-not-move tradeoff (original bid-stage rows stay
  visible if the bid page is revisited post-win) — same accepted tradeoff
  already in place for `TakeoffLine` copying, not new here.
  `npm run build && npm run lint` clean. No Playwright run (per standing
  feedback — code trace + build/lint first, browser verification only on
  request).

## Also Closed (2026-09-15) — Build Areas (Bid → SOV → Project)

- **Build Areas as a first-class concept spanning Bid → SOV → Project** —
  extended the existing `ProjectSequenceArea` entity (piece-assignment/Shop-
  Drawing-grouping, added weeks earlier — not created this pass) rather than
  building a second parallel system. Added `bid_id` (nullable FK, set during
  estimating before a bid is won), `contract_value_pct` (estimator-entered %
  of total contract value), and `production_priority` (explicit, freely
  reorderable shop sequence — deliberately a new field, not a reuse of the
  existing `sort_order`, since `sort_order` already drives an unrelated
  display order in `ProjectManagement.jsx`'s Shop Drawing grouping).
  New **Areas** tab on `BidDetail.jsx` (`BidAreaManager.jsx`): estimator
  creates/names Areas, sets `contract_value_pct` against a running-total
  banner (green at 100%, amber/red flag otherwise — non-blocking), and
  reorders `production_priority` via adjacent-swap Up/Down buttons (same
  pattern as `MaterialShapeTypeDetailModal.jsx`'s `sort_order` swap).
  `createProjectFromWonBid` (`BidDetail.jsx`) now carries each Area forward
  onto the won project **in place** (same record/id, `project_id` set —
  matching the existing `pricing_type`/`is_prevailing_wage` carryover
  convention) and auto-generates one linked `SovLine` per Area
  (`area_id` × `contract_value_pct` × `project.contract_value`), reusing the
  existing SOV entity/Accounting system rather than a parallel one. A bid
  with zero Areas (every pre-existing bid) creates zero SOV lines
  automatically — SOV stays fully manual for it, exactly as before.
  Accounting's SOV table (`Accounting.jsx`) now shows a traceback line
  ("↳ Area: Monumental Stairs (25%)") under any SOV line with an `area_id`.
  **Role-gated visibility**: new `src/lib/areaVisibility.js`
  (`canSeeAreaPricing`, self-validated against `BUILTIN_ROLES`, mirrors
  `financeAccess.js`'s pattern) — `contract_value_pct` and any $ figure
  derived from it is conditionally rendered (not CSS-hidden) for
  admin/super_admin/estimator/project_manager/controller/finance_department
  only. `ProjectDetail.jsx`'s Pieces-tab Sequence/Area Assignment section
  (the shop-facing production view) now loads/sorts Areas by
  `production_priority` instead of `sort_order`, shows each Area's ordinal
  position (`#1`, `#2`...) to everyone, and shows the `%` badge only when
  `canSeeAreaPricing` passes. Audited every other place Areas render —
  `ProjectManagement.jsx`'s Lifecycle Sequence/Area section (Shop Drawing
  grouping) and `Production.jsx` show no Area $ figures today, so neither
  needed a gate. **Note on this session's BACKLOG.md**: the "Queued" section
  below previously said Project phasing was "NOT yet actually built" — that
  was stale; ground-truth verification (git history + live code read) before
  starting this pass confirmed `ProjectSequenceArea`, the Phasing/Sequence-
  Area piece-assignment UI, the `pricing_type`/`is_prevailing_wage`
  carryover, the consolidated `Project.contract_value`, and the SOV system
  all already existed (landed 2026-08-05 through 2026-09-12) — corrected
  below.
  Verified by full hand-trace (no browser-automation tool in this project):
  traced 3-Area reorder (Up-arrow swaps landing Monumental Stairs/A1/A2 in
  the requested 1/2/3 order), traced `createProjectFromWonBid` against a
  concrete $100,000 contract value (25%/40%/35% → $25,000/$40,000/$35,000,
  summing exactly to contract value since the Areas summed to 100%), traced
  `canSeeAreaPricing(['shop_manager'])` → `false` (badge renders `null`) vs.
  `project_manager`/`estimator`/etc. → `true`, and confirmed carried-forward
  Areas keep their original `id` so any future piece-to-area assignment
  resolves against the same records (no PieceMark rows exist pre-win, so
  there was nothing to reconcile). `npm run build && npm run lint` clean.

## Also Closed (2026-09-15) — Inventory QR lifecycle

- **Full inventory QR lifecycle: unassigned → searchable → transferred on
  consumption, never regenerated.** Extended `remnant_inventory` (not a new
  entity — it already modeled shape/grade/length/source-project leftover
  tracking for Stage 10 cut-plan matching) with `qr_payload_string`,
  `is_assigned` (default false), `assigned_project_id`,
  `assigned_piece_mark_id`, `notes`. New **Leftover Material** tab on
  `Inventory.jsx` (`LeftoverInventoryPanel.jsx`): "Add Leftover to
  Inventory" (`AddLeftoverDialog.jsx`) captures shape/grade/length-or-
  dimensions/heat/source project/condition-notes, generates a real QR via
  `generatePiecePayload()` while the leftover is still unassigned, and opens
  the print sheet immediately (reuses `PrintableLabelSheet`/`buildZplPayload`/
  `print_label_jobs`, the same pipeline `LabelPrintingPanel.jsx` uses,
  scoped here to `remnant_inventory` records under the `Material_Stock`
  label type that already existed but had nothing wired to trigger it).
  Existing `InventoryItem` list rows on `Inventory.jsx` gained click-to-detail
  (`InventoryItemDetailModal.jsx`) — location/quantity/notes edit, "move" =
  changing warehouse zone/rack/bin — closing the standing-rule-1 gap noted
  in this feature's own prompt (no select/edit path existed at all before).
  **QR transfer on consumption**: `materialOptimizer.js` gained
  `findWholePieceRemnantMatches` — reuses `findMatchingRemnants` (the #9D
  shape+grade search already driving cut-plan remnant matching) plus a
  length window (remnant ≥ needed length, ≤ needed + 3", since steel can't
  be stretched and a bigger excess belongs in the cut-plan system instead)
  and a `qr_payload_string`-present guard (a remnant with no QR, e.g. logged
  through the older "Log Remnant" action, is cut-plan stock only, never a
  whole-piece candidate). `detailerImportCommit.js` gained
  `findInventoryMatches` (greedy, one remnant never offered to two rows in
  the same batch) and `commitBatch` now checks it for every BRAND-NEW piece
  before calling `generatePiecePayload` — an accepted match transfers the
  remnant's existing `qr_payload_string` onto the new `PieceMark` instead of
  minting a new one, flips the remnant to `is_assigned: true` / `status:
  'consumed'` (dropping it out of the older cut-plan search too) with
  `assigned_project_id`/`assigned_piece_mark_id` for traceability, and
  propagates the remnant's heat number the same way a cut-plan-consumed
  remnant already does (`propagateHeatNumberToPieces`). New
  `InventoryMatchModal.jsx` mirrors `RevisionCompareModal.jsx`'s per-row
  explicit-accept pattern (Stage 11) and sits in the same commit pipeline
  in `BatchReviewModal.jsx`, right after revisions are resolved — but unlike
  a revision, declining every match never blocks the commit; an unmatched or
  declined piece just gets a normal freshly generated QR exactly as before.
  Fixed a sequencing bug caught during this pass: `RevisionCompareModal` now
  explicitly closes (`setPendingRevisions(null)`) the instant its own
  revisions are resolved, before the inventory-match check runs — it
  previously stayed mounted/open underneath `InventoryMatchModal` whenever
  both modals had something to show in the same commit.
  **Verified by full hand-trace** (no browser-automation tool in this
  project — see `browser-testing` skill; per standing feedback, code trace +
  build/lint first, browser verification only on request): traced
  add-leftover → QR generation → print-sheet-opens-immediately; traced
  Detailer Import commit for a second project with a compatible-length same-
  shape/grade piece → `findInventoryMatches` correctly surfaces the
  candidate → accepted → `commitBatch`'s new-piece branch takes the
  `matchedRemnant.qr_payload_string` branch (never calls
  `generatePiecePayload` for that row) → remnant flips to
  assigned/consumed; traced the no-match path (empty `matches` array) to
  confirm it falls straight through to `runCommit` with an empty Map,
  producing the exact same `generatePiecePayload(...)` call as before this
  feature existed. `npm run build && npm run lint` clean.

## Also Closed (2026-09-15)

- **Distinct company/work email field on employees** — new `company_email`
  (`schema/entities/employees.jsonc`), separate from `personal_email` which
  stays emergency-contact-only. `bidProposalPdf.js`'s `estimatorEmail` now
  reads `estimator?.company_email` instead of `personal_email`;
  `bidProposalPdfLayout.js`'s `drawSincerelyBlock` already omitted any blank
  line gracefully (no code change needed there — confirmed by reading it,
  not assumed). Required and prompted in the HR "Add Employee" wizard
  (`AddEmployeeWizard.jsx`, same step-1 validation pattern as `full_name`)
  and persisted via `provisionEmployee` (`employeesApi.js`). Existing
  employees (all of them, pre-dating this field) get a visible, amber-
  flagged empty `company_email` field with inline edit-and-save directly on
  the HR profile (`EmployeeProfileDialog.jsx`'s new `CompanyEmailField`,
  gated by the same `hasFullEmployeeAccess` edit permission as the other
  profile panels) — not fabricated, left blank until HR fills it in.
  `npm run build && npm run lint` clean.

## Also Closed (2026-09-12)

- **Bid Worksheet default rate demo data + mileage calculator debounce fix**
  — two unrelated fixes. (1) The 5 `CostCategoryDefaultRate` categories
  (Field Rigging, Erection Labor Hours, Load/Unload Material, Shop Priming,
  Structural Fabrication) closed 2026-09-08 below were deliberately left
  unseeded, matching the `TmLaborRate` precedent — but that meant every new
  Bid Worksheet line for these categories pre-filled at $0.00 in the demo
  environment with nothing configured to demonstrate the auto-populate
  feature actually working. Seeded reasonable Hancock demo rates in
  `buildSeedData()` (`src/api/localData.js`): field_rigging $92/hr,
  erection_labor_hours $85/hr, load_unload_material $68/hr, shop_priming
  $72/hr, structural_fabrication $78/hr — real companies still edit these
  at `/admin/bid-worksheet-rates`, unaffected. Confirmed the admin page is
  already correctly reachable (`Admin.jsx` NAV_LINKS `roles: ['estimator']`
  combines with `isAdmin` in `hasTabAccess`, same pattern as Material
  Catalog) — not a hunting problem, no change needed there.
  (2) Mileage calculator (`mileageService.js`'s Nominatim geocode + OSRM
  route, called from `TakeoffEngine.jsx`) traced by hand end-to-end with
  the real Hancock company address (813 E Bigelow Avenue, Findlay, OH
  45840) against a real complete job address — both geocoded correctly and
  OSRM returned the correct real-world driving distance (~44.3 mi to
  downtown Toledo), so the calculation/geocoding logic itself was not the
  bug. Root cause traced to `BidDetail.jsx`'s `liveTaxBid` (built
  intentionally so tax calc reacts instantly to Base Information address
  edits) also feeding `TakeoffEngine`'s mileage `useEffect` with a new
  address on every keystroke, since Base Information is rendered above the
  tabs and stays mounted alongside the BID Worksheet tab — firing a live
  Nominatim geocode + OSRM call per keystroke, well past Nominatim's public
  ~1 req/sec limit, so the address the user actually finished typing would
  often surface a rate-limit/geocode error from the pile-up of stale
  in-flight lookups for partial addresses typed a moment earlier. Fixed by
  debouncing the calculation 800ms after the address stops changing;
  `mileageService.js` itself was not touched since it traced as correct.
  Verified `npm run build && npm run lint` clean after both fixes.

## Also Closed (2026-09-08)

- **Company-configurable default hourly rates for 5 Bid Worksheet
  categories** (Field Rigging, Erection Labor Hours, Load/Unload Material,
  Shop Priming, Structural Fabrication) — new `CostCategoryDefaultRate`
  entity, effective-dated history same convention as `TmLaborRate` (not
  reused directly — `TmLaborRate` is keyed by free-text position/trade and
  feeds T&M actual-labor-cost matching against `employees.job_title`;
  conflating the two would have pulled worksheet category rates into that
  unrelated matching logic). Admin page `CostCategoryRatesAdmin.jsx` at
  `/admin/bid-worksheet-rates` (admin/super_admin/estimator, mirrors
  `materialCatalogAccess.js`'s role-gating convention via the new
  `bidWorksheetRateAccess.js`) — fixed list of the 5 categories (no
  add/remove, unlike `TmLaborRatesAdmin.jsx`'s open-ended positions), rate +
  effective date + history per category. `TakeoffEngine.jsx`'s `loadLines`
  now pre-fills a brand-new line's `unit_cost` from the current admin-set
  rate for these 5 categories (`RATE_DEFAULT_CATEGORY_KEYS`, resolved via
  the new `src/lib/bidWorksheetRateEngine.js`) instead of 0 — same
  never-created-yet-only semantics as the existing `default_markup_pct`
  pre-fill: a saved line's value is never overwritten by a later default
  change, and it stays fully editable per-line. No demo seed data added,
  matching the `TmLaborRate` precedent.

## Also Closed (2026-09-02)

- **Master material catalog (shape types + sizes/grades), admin-extensible**
  — imported a cleaned real-world catalog (`src/data/materialCatalogSeed.json`:
  95 shape types, 3,986 sizes, 221 grades) into 3 new entities:
  `MaterialShapeType` (shape_code/description/category/is_active),
  `MaterialSizeOption` and `MaterialGradeOption` (both FK'd to
  `shape_type_id`, resolved from the seed file's shared shape_code at seed
  time — not stored redundantly). Seeded once via `buildSeedData()`
  (`src/api/localData.js`'s `buildMaterialCatalogSeedData`), same
  fills-only-if-empty contract as every other seeded entity, so it
  backfills automatically into any existing browser store that predates
  this change. New admin page `/admin/material-catalog`
  (`MaterialCatalogAdmin.jsx`): list/filter-by-category/search/toggle-active/
  add shape type; every shape type row is clickable (standing rule) into
  `MaterialShapeTypeDetailModal.jsx`, which manages that shape's sizes and
  grades (add/toggle-active/delete/reorder via adjacent sort_order swap)
  plus a "Bulk Add Sizes" paste-or-upload panel for shapes with 300+ sizes
  (HSS has 367, MB 332, W 317) — dedupes against what's already there.
  Access: `admin`/`super_admin`/`estimator` (`materialCatalogAccess.js`) —
  there's no distinct `estimating_admin` BUILTIN_ROLE, so `estimator` was
  admitted as the closest existing role, matching how PTO/salesman-rate
  admin pages admit `hr_admin`/`payroll_admin` alongside full admin.
  **Wired the original ask**: `FullTakeoff.jsx`'s Material Grade field is
  now a dropdown sourced live from `MaterialGradeOption`, bridged from
  `MaterialTakeoffLine`'s own 5-value `shape_class` enum
  (W-Beam/HSS Tube/C-Channel/L-Angle/PL-Plate) to the catalog's matching
  `W`/`HSS`/`C`/`L`/`PL` shape_codes — chosen because those 5 catalog
  entries' descriptions match the enum 1:1, not an arbitrary mapping. Kept
  the existing "Other" free-text escape hatch; a shape with zero grades
  configured falls back to a plain free-text input with a note instead of
  showing an empty dropdown. Verified live in a real (Playwright-driven,
  since this project has no browser-automation tool installed — see
  `browser-testing` skill) Chromium session logged in as
  `estimator@steelos.dev`: 95 shape types listed, category filter (22 for
  Bolts/Fasteners), shape detail modal, bulk-add (317→319 sizes on W), and
  the Grade dropdown on a real bid's Full Takeoff tab correctly showing
  A992/A572-50/A588/A992-GR50/Other for a W-Beam row — screenshotted at
  1024/1440/1920px with no truncation. Note: testing as `admin@steelos.dev`
  specifically shows an empty catalog list, because that seeded account
  also holds `super_admin` and a non-impersonating super_admin session
  reads every tenant-scoped entity as empty by design (see
  `applyTenantScope` in `localData.js`) — not a bug in this feature, just
  use a non-super-admin account (or impersonate a tenant) to see real data.
  **Not built this pass (reported only, per the request)**: whether
  `steel_catalog` (IRONSIGHT's AISC weight-per-foot reference, keyed to
  MaterialTakeoffLine's 5-value shape_class enum) and/or `StockLengthOption`
  (material optimizer's purchasable lengths, FK'd to a `steel_catalog` row)
  should eventually be superseded by or linked to this new master catalog.
  They currently serve different, narrower purposes — `steel_catalog` also
  carries engineering data this catalog doesn't (dimension1/dimension2,
  wall_thickness_in, weight_per_ft) needed for tonnage/weight math, and
  `StockLengthOption` is about purchasable bar/plate lengths, not
  shape/size/grade taxonomy — so a straight merge would lose fields real
  workflows depend on. The cleanest eventual path is probably linking
  rather than replacing: give `steel_catalog` an optional
  `material_shape_type_id`/`material_size_option_id` FK pair so its 5
  broad classes point at this catalog's `W`/`HSS`/`C`/`L`/`PL` entries
  (mirroring the bridge map added to `FullTakeoff.jsx`), while
  `steel_catalog` keeps owning the weight/dimension data this catalog was
  never designed to hold.

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
