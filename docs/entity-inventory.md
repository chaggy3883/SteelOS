# SteelOS Entity Inventory

Reference material to prevent the next accidental duplicate entity. Generated
2026-08-18 by auditing every `schema/entities/*.jsonc` file against actual
`db.entities.<Name>.*` call sites in `src/`.

Entity schemas are documentation-only (not read at runtime — see
`AGENTS.md`), which is exactly why this file exists: nothing enforces that a
new entity doesn't duplicate an existing one. Read this before adding a new
entity, especially before naming it.

## Naming convention

**126 entities total: 80 PascalCase, 46 snake_case.**

PascalCase (`PayrollRun`, `TimeEntry`) is the convention for entities added
early in the project. snake_case (`pieces`, `disciplinary_records`) shows up
across a mix of eras — it is not simply "the old convention" or "the new
one," both exist throughout the project's history and both are still being
added to (e.g. `PtoBalance`/`PtoPolicy`/`PtoTransaction` landed 2026-08-18 as
PascalCase; `rigging_inventory_ledger` landed earlier as snake_case).

**Rule going forward: match whichever convention the closest related/sibling
entity already uses.** There is no single project-wide standard to enforce,
so the actual risk isn't "wrong convention" — it's creating a PascalCase
entity that duplicates an existing snake_case one (or vice versa) because a
grep for the "obvious" name didn't find it. **Before creating any new
entity, grep this file for the concept first**, not just for a specific
casing of the name.

### The 46 snake_case entities (check this list first — a PascalCase entity
that duplicates one of these is the actual failure mode to avoid)

```
ai_contract_reviews          field_hook_logs            piece_production_logs
attendance_punches           fleet_repair_logs          piece_timing_events
blueprint_takeoffs           form_layouts               pieces
calendar_events              frontend_contract_reviews  print_label_jobs
candidate_profiles           heavy_equipment_inspections purchase_order_lines
change_orders                issued_assets              purchase_requisitions
company_templates            load_items                 qa_inspections
contract_exception_lines     loads                      quality_inspection_records
credit_card_expenses         login_slideshow_images     receiving_logs
demo_requests                manager_overrides          remnant_inventory
disciplinary_records         payroll_document_mappings  report_templates
employees                    rigging_inventory_ledger
employee_certifications                                 shipping_manifests
employee_disciplinary_files                              shop_schedules
employee_documents                                       station_logs
employee_portal_sessions                                 steel_catalog
erection_fleet_assets                                    time_off_requests
executive_metrics_snapshots
```

## Known parallel/duplicate systems

Status as of this audit (2026-08-18). See git history for prior
consolidations (`PieceMark`/`pieces` bridge, legacy shipping-loads removal).

### 1. Disciplinary records — THREE systems, one authoritative, two dead/thin

| Entity | Schema file | Live write path | Seed data | Status |
|---|---|---|---|---|
| `DisciplinaryAction` | **none — undocumented** | `DisciplinaryActionDialog.jsx` → mounted in `EmployeeProfileDialog.jsx` | 2 realistic records via `demoDataSeeder.js` | **Authoritative.** Full lifecycle (draft → printed → signed_filed), progressive-discipline history, role-gated. |
| `disciplinary_records` | `disciplinary_records.jsonc` | none | 1 hardcoded seed row, never read | **Dead.** No component creates, lists, or reads it. |
| `employee_disciplinary_files` | `employee_disciplinary_files.jsonc` | `EmployeeFilesPanel.jsx` (HR page tab) | 0 seed rows | **Live but a genuine second concept** — free-form scanned-document attachment, not the structured action workflow. |

Recommendation (pending your confirmation, no changes made yet):
- Delete `disciplinary_records` — zero readers/writers, nothing to migrate.
- Write `schema/entities/DisciplinaryAction.jsonc` now, since it's the real
  entity and has no schema documentation at all — this gap is likely why
  the duplicate `.jsonc` files got created in the first place.
- Decide on `employee_disciplinary_files`: fold into `DisciplinaryAction`
  as an optional attachment field (no data to migrate), or keep it as a
  distinct lightweight upload path but rename away from "disciplinary"
  terminology so it stops reading as a third copy of the same thing.

### 2. Rigging — legitimate registry + event-log pair, NOT a duplicate

`RiggingInspection` (per-inspection-event record) and
`rigging_inventory_ledger` (per-physical-asset registry) are properly linked
via `RiggingInspection.rigging_asset_id` → `rigging_inventory_ledger.id`.
Commit `fe826b7` ("RiggingAsset registry") extended both existing entities
rather than creating a third — no `RiggingAsset` entity exists. Clean,
migrated, no data loss. Two minor cosmetic loose ends only (a stale
`required` field, one duplicated helper call) — not urgent.

**A different rigging-adjacent overlap was found instead:** `heavy_equipment_
inspections` has an `inspection_type: Rigging_Quarterly` and `erection_
fleet_assets` has `asset_type: Rigging_Equipment`, both reachable from the
"Inspection Radar" tab sitting next to "Rigging Registry" on the same
Field Operations page. Seed data shows this being used for a rented aerial
boom lift — not sling/shackle/hardware gear the dedicated Rigging Registry
already covers. Needs a decision: drop the `Rigging_*` values from the
fleet-inspection system now that the dedicated registry exists, or rename
them to something that doesn't collide in vocabulary with Rigging Registry.

### 3. Two full, unreconciled payroll pipelines (found during the sweep — not part of the original ask, flagging because it's the same failure mode)

- **Pipeline A** (`/payroll`, `Payroll.jsx`): `attendance_punches` (kiosk
  clock stream) → `PayrollRegisterLine` → `JobCostLedgerEntry`.
- **Pipeline B** (`/payroll/processing`, `PayrollProcessing.jsx`): `TimeEntry`
  (manually keyed) → `Timecard` → `PayrollRun`/`PayrollLine` →
  `JobLaborAllocation` → `JobCostLedgerEntry`.

Both compute gross pay for the same employees/periods and post to the same
`JobCostLedgerEntry` sink, with no bridge between a kiosk punch and a
`TimeEntry`, and nothing preventing the same pay period from being run
through both. `demoDataSeeder.js` only seeds Pipeline A's entities, which is
a strong signal Pipeline B was added later without reconciling the two.
This needs a decision on which pipeline is authoritative before it causes a
real double-post — flagging for your call, not touching it.

### 4. Two API-secret vaults

`ApiCredential` (fixed per-service enum: procore/textura/aws_s3/avatax/
vertex/tekla_api/quickbooks — Admin → Integrations) and `ApiTokenVault`
(generic named-key vault — System Integrations page, also reused for AI
provider BYOK keys) both store "this company's encrypted API secret."
`ApiTokenVault` looks like it was created because AI keys didn't fit
`ApiCredential`'s enum, rather than extending it.

### 5. Lower-confidence, needs a human call (not clear-cut duplicates)

- `piece_production_logs` (employee self-typed piece timing) vs.
  `station_logs`/`piece_timing_events` (QR/scan-based station timing,
  documented in code as "the real source of truth"). Not a clean duplicate —
  `piece_production_logs.target_minutes` is the only source of a timing
  target — but it's two independently-populated "how long did this piece
  take" mechanisms with no bridge, and the backlog already flags replacing
  the manual entry with the existing QR system.
- `company_templates` (uploaded template file vault) vs. `report_templates`
  (structured print-layout config) — overlapping category enums
  (Proposal/Invoice/Manifest on both), but one's a file library and the
  other drives live generation logic. Plausibly two legitimate mechanisms.

### Checked and cleared (similar names, genuinely distinct — do not merge)

`qa_inspections` / `quality_inspection_records` / `heavy_equipment_
inspections` (three different inspection domains) · `CertifiedPayrollReport`
/ `CertifiedPayrollSubmission` (outgoing vs. incoming) · `ai_contract_
reviews` / `frontend_contract_reviews` (different data shapes and pages) ·
`AIFinding` / `IntelligenceRule` (different domains) · `TaxRate` /
`TaxWithholding` / `EmployerTax` (three distinct tax concepts) ·
`MaterialTakeoffLine` / `TakeoffLine` / `blueprint_takeoffs` (properly
bridged) · fleet cluster (`fleet_repair_logs`, `EquipmentService`,
`ServiceSchedule`, `erection_fleet_assets`) — already consolidated by the
A/B/C/D restructure · audit cluster (`manager_overrides`, `AuditLog`,
`LegalAuditEvent`, `UserSessionLog`, `StatusHistoryEntry`) — five genuinely
different log purposes · `Document` / `employee_documents` /
`report_templates` · `issued_assets` / `erection_fleet_assets` ·
`InventoryItem` / `remnant_inventory` / `steel_catalog` · `purchase_
requisitions` → `purchase_order_lines` (sequential workflow) ·
`candidate_profiles` → `employees` (bridged via `hired_employee_id`) ·
`PtoBalance` / `PtoTransaction` / `time_off_requests` (balance + ledger +
request pattern) · `PayrollAdjustment` / `PayrollJournal` /
`PayrollGLMapping` / `Deduction` (coherent GL-export subsystem) ·
`SovLine` vs. `BudgetLine` · `VendorPricingLink` / `MillPricing` /
`DeliveryPricingTier` · `ProjectJobCostSummary` vs. `HistoricalVariance`.

### Orphaned / unused entities (not duplicates, but zero live read or write path anywhere in `src/` — flagging since they're candidates for either deletion or finishing)

`disciplinary_records` (see above), `MillPricing`, `UserDashboardConfig`,
`demo_requests`, `issued_assets`. Each has a schema file and/or seed data in
`localData.js` but no component ever calls `db.entities.<Name>.*` on it.

### Not exhaustively deep-dived

`BankAccount`/`BankTransaction`, `Bid`/`Contract`/`Subcontract`,
`InvoiceReceivable`/`VendorBill`, `CustomRole`, `PayrollRule`,
`Notification`, `calendar_events`, `ProjectMeetingNote`, `receiving_logs`/
`shop_schedules`, `employee_certifications`, `LienWaiver`/`StatutoryNotice`/
`SubcontractPayApp`/`Submittal`, `MillTestReport`, `EquipmentUsageLog`,
`UserDashboardConfig`/`SystemSetting`, `RecurringCashItem`, `ShopFloorZone`,
`demo_requests`, `login_slideshow_images`, `payroll_document_mappings`,
`employee_portal_sessions` — skimmed, nothing suspicious surfaced, but not
given the same file-by-file treatment as the clusters above.

## Full entity list

Convention, and every file found calling `db.entities.<Name>.*` directly
(via grep for the literal call — dynamic/generic access such as an
entity-name-driven admin table would not show up here). `demoDataSeeder.js`
and `localData.js` (seed data) are omitted from this column when other real
call sites exist, to keep the signal on what actually reads/writes the
entity in the live app; where `demoDataSeeder.js` is the *only* hit it is
listed, since that itself is informative (seeded but nothing else touches
it — see `piece_production_logs` etc. above for read context, or "orphaned"
list for zero hits).

**`DisciplinaryAction` is not in this table** — it exists only in code
(`src/api/apiClient.js`), with no `schema/entities/DisciplinaryAction.jsonc`
file. Written by `DisciplinaryActionDialog.jsx`, read by
`DisciplinaryActionsPanel.jsx`. Add its schema file as part of the
disciplinary consolidation above.

| Entity | Convention | Primary files (`db.entities.X.*` call sites, top 3) |
|---|---|---|
| `AIFinding` | PascalCase | src/pages/Accounting.jsx, src/pages/Intelligence.jsx, src/pages/ProjectDetail.jsx |
| `AIReviewSkill` | PascalCase | src/pages/BidDetail.jsx |
| `ai_contract_reviews` | snake_case | src/components/estimating/AIContractReviewPanel.jsx, src/lib/aiIntelligenceEngine.js |
| `ApiCredential` | PascalCase | src/components/admin/IntegrationCard.jsx, src/components/admin/IntegrationsGateway.jsx |
| `ApiIntegrationLog` | PascalCase | src/pages/SuperAdminDashboard.jsx, src/pages/SystemIntegrations.jsx |
| `ApiTokenVault` | PascalCase | src/components/settings/AiPlatformConfigPanel.jsx, src/components/system-integrations/TokenVaultManager.jsx, src/pages/SystemIntegrations.jsx |
| `attendance_punches` | snake_case | src/lib/demoDataSeeder.js, src/pages/EmployeeCenter.jsx, src/pages/Payroll.jsx |
| `AuditLog` | PascalCase | src/components/admin/AuditLogViewer.jsx, src/lib/terminalSession.js, src/pages/EmployeeCenter.jsx |
| `BankAccount` | PascalCase | src/components/accounting/CashForecastPanel.jsx, src/components/accounting/CashManagementPanel.jsx, src/components/accounting/MonthEndClosePanel.jsx |
| `BankTransaction` | PascalCase | src/components/accounting/CashForecastPanel.jsx, src/components/accounting/CashManagementPanel.jsx, src/components/accounting/MonthEndClosePanel.jsx |
| `BidReviewReport` | PascalCase | src/lib/aiReviewSkills.js, src/pages/BidDetail.jsx |
| `Bid` | PascalCase | src/components/admin/CRMSync.jsx, src/components/dashboard/widgetContent.jsx, src/components/estimating/DNBReasonModal.jsx |
| `blueprint_takeoffs` | snake_case | src/components/estimating/MarkupsList.jsx, src/pages/BlueprintTakeoff.jsx |
| `BudgetLine` | PascalCase | src/components/accounting/BudgetPanel.jsx, src/lib/demoDataSeeder.js |
| `calendar_events` | snake_case | src/components/dashboard/widgetContent.jsx, src/pages/HumanResources.jsx |
| `candidate_profiles` | snake_case | src/lib/employeesApi.js, src/pages/HumanResources.jsx |
| `CertifiedPayrollReport` | PascalCase | src/pages/CertifiedPayroll.jsx |
| `CertifiedPayrollSubmission` | PascalCase | src/lib/demoDataSeeder.js, src/pages/CertifiedPayroll.jsx, src/pages/Subcontracts.jsx |
| `change_orders` | snake_case | src/components/dashboard/widgetContent.jsx, src/lib/demoDataSeeder.js, src/pages/ChangeOrders.jsx |
| `CloseChecklistItem` | PascalCase | src/components/accounting/MonthEndClosePanel.jsx, src/lib/demoDataSeeder.js |
| `company_templates` | snake_case | src/components/settings/TemplateVaultPanel.jsx, src/pages/BlueprintTakeoff.jsx |
| `Company` | PascalCase | src/components/admin/CompanyBrandingPanel.jsx, src/components/auth/KioskKeypadLogin.jsx, src/components/estimating/BidProposalPrintView.jsx |
| `contract_exception_lines` | snake_case | src/lib/aiIntelligenceEngine.js, src/pages/FrontEndReview.jsx |
| `Contract` | PascalCase | src/lib/demoDataSeeder.js, src/pages/Legal.jsx, src/pages/RFIs.jsx |
| `CostCode` | PascalCase | src/components/estimating/TakeoffEngine.jsx, src/components/payroll/GLMappingsPanel.jsx, src/components/payroll/PayrollRunPanel.jsx |
| `credit_card_expenses` | snake_case | src/lib/demoDataSeeder.js, src/pages/EmployeeCenter.jsx |
| `CrewAssignment` | PascalCase | src/components/meeting-mode/ManpowerSection.jsx, src/lib/manpowerData.js |
| `Customer` | PascalCase | src/components/admin/CRMSync.jsx, src/components/estimating/VendorPricing.jsx, src/components/search/GlobalSearchPalette.jsx |
| `CustomRole` | PascalCase | src/components/admin/RoleManager.jsx, src/components/dashboard/rbacConfig.jsx |
| `Deduction` | PascalCase | src/components/payroll/DeductionsPanel.jsx, src/components/payroll/PayrollRunPanel.jsx, src/pages/CertifiedPayroll.jsx |
| `DeliveryPricingTier` | PascalCase | src/components/estimating/TakeoffEngine.jsx, src/pages/DeliveryPricingAdmin.jsx |
| `demo_requests` | snake_case | *(none found — orphaned)* |
| `disciplinary_records` | snake_case | *(none found — orphaned)* |
| `Document` | PascalCase | src/components/documents/FileExplorer.jsx, src/components/estimating/SmartFileDump.jsx, src/components/estimating/TakeoffEngine.jsx |
| `EmployeePayRate` | PascalCase | src/components/payroll/PayRatesPanel.jsx, src/components/payroll/PayrollRunPanel.jsx, src/components/payroll/TimecardsPanel.jsx |
| `employees` | snake_case | src/components/hr/EmergencyContactPanel.jsx, src/components/hr/SystemAccessPortal.jsx, src/components/layout/NavBar.jsx |
| `employee_certifications` | snake_case | src/lib/demoDataSeeder.js, src/lib/intelligenceRuleEngine.js, src/lib/manpowerData.js |
| `employee_disciplinary_files` | snake_case | src/components/hr/EmployeeFilesPanel.jsx |
| `employee_documents` | snake_case | src/components/hr/ComplianceDocumentCenter.jsx |
| `employee_portal_sessions` | snake_case | src/lib/terminalSession.js |
| `EmployerTax` | PascalCase | src/components/payroll/PayrollRunPanel.jsx |
| `EquipmentService` | PascalCase | src/pages/EquipmentServiceForm.jsx |
| `EquipmentUsageLog` | PascalCase | src/components/field-operations/EquipmentUsagePanel.jsx, src/lib/demoDataSeeder.js, src/pages/FieldOperations.jsx |
| `erection_fleet_assets` | snake_case | src/components/field-operations/FleetRentalRegistry.jsx, src/components/field-operations/RepairLedger.jsx, src/lib/demoDataSeeder.js |
| `executive_metrics_snapshots` | snake_case | src/pages/ExecutiveAnalytics.jsx |
| `field_hook_logs` | snake_case | src/components/field-operations/HookProductionTerminal.jsx, src/pages/FieldOperations.jsx |
| `fleet_repair_logs` | snake_case | src/components/field-operations/RepairLedger.jsx, src/pages/FieldOperations.jsx |
| `form_layouts` | snake_case | src/components/admin/FormLayoutBuilder.jsx |
| `frontend_contract_reviews` | snake_case | src/lib/aiIntelligenceEngine.js |
| `heavy_equipment_inspections` | snake_case | src/components/field-operations/InspectionRadar.jsx, src/lib/intelligenceRuleEngine.js, src/pages/FieldOperations.jsx |
| `HistoricalVariance` | PascalCase | src/lib/demoDataSeeder.js, src/pages/EstimatingAnalytics.jsx |
| `IntelligenceRule` | PascalCase | src/lib/intelligenceRuleEngine.js, src/pages/IntelligenceRuleDetail.jsx, src/pages/IntelligenceRulesAdmin.jsx |
| `InventoryItem` | PascalCase | src/pages/Inventory.jsx, src/pages/Production.jsx, src/pages/Purchasing.jsx |
| `InvoiceReceivable` | PascalCase | src/components/accounting/BudgetPanel.jsx, src/components/accounting/CashForecastPanel.jsx, src/components/accounting/InvoiceReceivableDetailModal.jsx |
| `issued_assets` | snake_case | *(none found — orphaned)* |
| `JobCostLedgerEntry` | PascalCase | src/components/accounting/BudgetPanel.jsx, src/components/accounting/VendorBillDetailModal.jsx, src/components/estimating/TakeoffEngine.jsx |
| `JobLaborAllocation` | PascalCase | src/components/payroll/PayrollRunPanel.jsx, src/pages/CertifiedPayroll.jsx |
| `LegalAuditEvent` | PascalCase | src/pages/Legal.jsx, src/pages/ProjectDetail.jsx, src/pages/RFIs.jsx |
| `LienWaiver` | PascalCase | src/lib/demoDataSeeder.js, src/pages/Subcontracts.jsx |
| `loads` | snake_case | src/components/dashboard/widgetContent.jsx, src/components/field-operations/JobsiteReceiving.jsx, src/components/shipping/CallInspectionModal.jsx |
| `load_items` | snake_case | src/components/field-operations/JobsiteReceiving.jsx, src/components/shipping/LoadBuilder.jsx, src/components/shipping/LoadDetailModal.jsx |
| `login_slideshow_images` | snake_case | src/components/admin/LoginSlideshowManager.jsx, src/components/auth/LoginVaultBackdrop.jsx, src/lib/demoDataSeeder.js |
| `manager_overrides` | snake_case | src/pages/ShopFabrication.jsx, src/pages/ShopOperations.jsx |
| `MaterialTakeoffLine` | PascalCase | src/components/estimating/FullTakeoff.jsx, src/components/estimating/MarkupsList.jsx, src/lib/demoDataSeeder.js |
| `MillPricing` | PascalCase | *(none found — orphaned)* |
| `MillTestReport` | PascalCase | src/components/receiving/MtrReader.jsx, src/pages/portal/VendorPanel.jsx |
| `MonthEndClose` | PascalCase | src/components/accounting/MonthEndClosePanel.jsx, src/lib/demoDataSeeder.js |
| `Notification` | PascalCase | src/components/layout/TopBar.jsx, src/lib/demoDataSeeder.js, src/pages/EmployeeCenter.jsx |
| `PayPeriod` | PascalCase | src/components/payroll/PayPeriodCalendarPanel.jsx, src/lib/demoDataSeeder.js, src/pages/CertifiedPayroll.jsx |
| `PayrollAdjustment` | PascalCase | src/components/payroll/PayrollRunPanel.jsx |
| `PayrollGLMapping` | PascalCase | src/components/payroll/GLMappingsPanel.jsx, src/components/payroll/PayrollRunPanel.jsx |
| `PayrollJournal` | PascalCase | src/components/payroll/PayrollRunPanel.jsx |
| `PayrollLiability` | PascalCase | src/components/payroll/PayrollRunPanel.jsx |
| `PayrollLine` | PascalCase | src/components/payroll/PayrollRunPanel.jsx, src/pages/CertifiedPayroll.jsx |
| `PayrollRegisterLine` | PascalCase | src/lib/demoDataSeeder.js, src/pages/Payroll.jsx |
| `PayrollRule` | PascalCase | src/components/payroll/PayrollRulesPanel.jsx, src/pages/PayrollProcessing.jsx |
| `PayrollRun` | PascalCase | src/components/payroll/PayrollRunPanel.jsx, src/components/payroll/TimeEntryPanel.jsx, src/components/payroll/TimecardsPanel.jsx |
| `payroll_document_mappings` | snake_case | src/pages/EmployeeCenter.jsx |
| `PieceMark` | PascalCase | src/components/dashboard/widgetContent.jsx, src/components/field-operations/JobsiteReceiving.jsx, src/components/shipping/PieceDetailModal.jsx |
| `pieces` | snake_case | src/components/field-operations/JobsiteReceiving.jsx, src/components/shipping/LoadDetailModal.jsx, src/components/shipping/PieceDetailModal.jsx |
| `piece_production_logs` | snake_case | src/lib/intelligenceRuleEngine.js, src/pages/EmployeeCenter.jsx, src/pages/ShopEfficiency.jsx |
| `piece_timing_events` | snake_case | src/components/field-operations/JobsiteReceiving.jsx, src/lib/pieceTimeline.js, src/pages/ShopFabrication.jsx |
| `print_label_jobs` | snake_case | src/components/barcode-printing/LabelPrintingPanel.jsx, src/components/shipping/ManifestDetailModal.jsx, src/components/shipping/YardScanning.jsx |
| `ProjectJobCostSummary` | PascalCase | src/lib/jobCostAnalysis.js, src/lib/meetingModeData.js, src/pages/Accounting.jsx |
| `ProjectMeetingNote` | PascalCase | src/components/meeting-mode/ProjectReviewNotesPanel.jsx, src/pages/ProjectDetail.jsx |
| `Project` | PascalCase | src/components/accounting/InvoiceReceivableDetailModal.jsx, src/components/accounting/VendorBillDetailModal.jsx, src/components/admin/CRMSync.jsx |
| `PtoBalance` | PascalCase | src/lib/ptoEngine.js, src/pages/HumanResources.jsx |
| `PtoPolicy` | PascalCase | src/lib/ptoEngine.js, src/pages/PtoPoliciesAdmin.jsx |
| `PtoTransaction` | PascalCase | src/lib/ptoEngine.js |
| `purchase_order_lines` | snake_case | src/components/purchasing/PurchaseOrderDetailModal.jsx, src/pages/Purchasing.jsx, src/pages/ReceivingKiosk.jsx |
| `purchase_requisitions` | snake_case | src/components/dashboard/widgetContent.jsx, src/pages/ProcurementModule.jsx |
| `qa_inspections` | snake_case | src/lib/demoDataSeeder.js, src/pages/ShopFabrication.jsx, src/pages/ShopOperations.jsx |
| `quality_inspection_records` | snake_case | src/pages/Quality.jsx |
| `receiving_logs` | snake_case | src/components/dashboard/widgetContent.jsx, src/components/purchasing/PurchaseOrderDetailModal.jsx, src/pages/Accounting.jsx |
| `RecurringCashItem` | PascalCase | src/components/accounting/CashForecastPanel.jsx, src/lib/demoDataSeeder.js |
| `remnant_inventory` | snake_case | src/pages/ShopOperations.jsx |
| `report_templates` | snake_case | src/components/admin/ReportTemplateBuilder.jsx, src/lib/reportTemplates.js |
| `ReviewChecklistItem` | PascalCase | src/components/settings/ReviewChecklistPanel.jsx, src/lib/aiIntelligenceEngine.js, src/lib/demoDataSeeder.js |
| `RFI` | PascalCase | src/components/dashboard/widgetContent.jsx, src/lib/demoDataSeeder.js, src/pages/ProjectDetail.jsx |
| `RiggingInspection` | PascalCase | src/pages/FieldOperations.jsx, src/pages/RiggingInspectionForm.jsx |
| `rigging_inventory_ledger` | snake_case | src/components/field-operations/RiggingMatrix.jsx, src/pages/FieldOperations.jsx, src/pages/RiggingInspectionForm.jsx |
| `ServiceSchedule` | PascalCase | src/lib/intelligenceRuleEngine.js, src/pages/EquipmentServiceForm.jsx, src/pages/ServiceScheduleAdmin.jsx |
| `shipping_manifests` | snake_case | src/components/field-operations/JobsiteReceiving.jsx, src/components/shipping/LoadDetailModal.jsx, src/components/shipping/ManifestDetailModal.jsx |
| `ShopFloorZone` | PascalCase | src/components/admin/ShopFloorLayoutEditor.jsx, src/components/warehouse/Warehouse3D.jsx, src/pages/Inventory.jsx |
| `shop_schedules` | snake_case | src/pages/ShopFabrication.jsx, src/pages/ShopOperations.jsx |
| `SovLine` | PascalCase | src/components/accounting/InvoiceReceivableDetailModal.jsx, src/lib/demoDataSeeder.js, src/pages/Accounting.jsx |
| `station_logs` | snake_case | src/lib/intelligenceRuleEngine.js, src/pages/ShopFabrication.jsx, src/pages/ShopFloorCommandCenter.jsx |
| `StatusHistoryEntry` | PascalCase | src/lib/statusHistory.js |
| `StatutoryNotice` | PascalCase | src/pages/Legal.jsx, src/pages/ProjectDetail.jsx |
| `steel_catalog` | snake_case | src/components/estimating/FullTakeoff.jsx, src/components/settings/SteelCatalogPanel.jsx, src/pages/BlueprintTakeoff.jsx |
| `SubcontractPayApp` | PascalCase | src/lib/demoDataSeeder.js, src/lib/meetingModeData.js, src/pages/Subcontracts.jsx |
| `Subcontract` | PascalCase | src/lib/demoDataSeeder.js, src/lib/meetingModeData.js, src/pages/CertifiedPayroll.jsx |
| `Submittal` | PascalCase | src/lib/demoDataSeeder.js, src/pages/portal/CustomerHub.jsx |
| `SystemSetting` | PascalCase | src/components/admin/CostVariables.jsx, src/lib/burdenedLabor.js, src/lib/legalBaselines.js |
| `TakeoffLine` | PascalCase | src/components/estimating/BidProposalPrintView.jsx, src/components/estimating/SmartFileDump.jsx, src/components/estimating/TakeoffEngine.jsx |
| `TaxRate` | PascalCase | src/components/admin/TaxZoneLookup.jsx |
| `TaxWithholding` | PascalCase | src/components/payroll/PayrollRunPanel.jsx, src/components/payroll/TaxWithholdingPanel.jsx, src/pages/CertifiedPayroll.jsx |
| `Timecard` | PascalCase | src/components/payroll/PayrollRunPanel.jsx, src/components/payroll/TimecardsPanel.jsx |
| `TimeEntry` | PascalCase | src/components/payroll/PayrollRunPanel.jsx, src/components/payroll/TimeEntryPanel.jsx, src/components/payroll/TimecardsPanel.jsx |
| `time_off_requests` | snake_case | src/components/hr/PtoPanel.jsx, src/lib/manpowerData.js, src/lib/ptoEngine.js |
| `UserDashboardConfig` | PascalCase | *(none found — orphaned)* |
| `UserSessionLog` | PascalCase | src/lib/userSessionTracking.js, src/pages/SuperAdminDashboard.jsx |
| `User` | PascalCase | src/components/admin/UserManagement.jsx, src/pages/ProjectDetail.jsx, src/pages/SuperAdminDashboard.jsx |
| `VendorBill` | PascalCase | src/components/accounting/CashForecastPanel.jsx, src/components/accounting/MonthEndClosePanel.jsx, src/components/accounting/VendorBillDetailModal.jsx |
| `VendorPricingLink` | PascalCase | src/components/admin/CRMSync.jsx, src/components/estimating/VendorPricing.jsx |
| `Vendor` | PascalCase | src/components/accounting/VendorBillDetailModal.jsx, src/components/dashboard/widgetContent.jsx, src/components/purchasing/PurchaseOrderDetailModal.jsx |
