---
name: steelos-context
description: >
  This skill should be used any time work touches the SteelOS repository —
  when the user asks to "build a feature for SteelOS", references IRONSIGHT,
  Foundation Software gaps, the backlog, module packs (Fab/Erect/Enterprise),
  or any SteelOS page/entity by name, or when starting a new SteelOS session
  and orienting to the current state of the project.
metadata:
  version: "0.1.0"
---

# SteelOS Project Context

Load this before making changes to the SteelOS repo. It orients you to what
the project is, how it's built, and what state it's in — so you don't
relearn architecture decisions that have already been made, or contradict
constraints the user has already set.

## What SteelOS Is

A full-stack structural steel fabrication ERP, built by Justin Chagnon
(Hancock Structural Steel LLC, Findlay OH) as sole developer, replacing
Tekla, QuickBooks, Procore, and Bluebeam Revu for steel fabricators.

**Stack**: React 18 + Vite SPA. No backend, no real database.
`src/api/localData.js` is a localStorage shim emulating a DB.
`src/api/apiClient.js` exposes `db.entities.*`, `db.auth`, `db.integrations`.
Entity schemas in `schema/entities/*.jsonc` are documentation only — not
read at runtime, but they are the source of truth for what fields an entity
is supposed to have. Always read the schema file before adding fields to an
entity.

## Standing Rules — Do Not Violate These

1. **Every data point displayed anywhere must be clickable to drill down**
   to the full underlying record. Apply this to any new list, table, or
   summary card the same way Bid/Bid History already works.
2. **No `<form>` tags in new code.** Use `onClick`/`onChange` handlers only.
   (Some legacy files still use `<form>` with `event.preventDefault()` —
   don't rip those out unless asked, but never add new ones.)
3. **AI output is always human-reviewed and editable before it writes
   anything.** Never auto-commit AI-extracted or AI-generated data. This
   applies to document extraction (quotes, invoices, MTRs) and generated
   content (RFI drafts) alike.
4. **PDFs and large binary blobs go in IndexedDB**, not localStorage —
   localStorage's ~5MB quota is already tight. Use the existing
   `src/lib/pdfBlobStore.js` pattern; don't introduce a new storage library.
5. **No real GL, no payroll tax calculation.** These are deliberate scope
   cuts (legal risk, months of work). Export to QuickBooks/Sage via
   `src/lib/glExport.js` instead of building double-entry bookkeeping.
   Payroll register + CSV export only — let ADP/Gusto do tax withholding.
6. **Windows CMD only.** No `tail`, `grep`, or other Unix tools in the
   user's terminal. Don't suggest shell scripts that assume a Unix shell.
7. **Verify before calling anything done**: run `npm run build && npm run
   lint`. For anything involving calculated fields (OT splits, yield,
   job cost postings, variance percentages), trace the math by hand against
   a concrete example rather than trusting that the code "looks right."

## Architecture Patterns Already Established

- **AI document extraction**: upload → `db.integrations.Core.UploadFile` →
  `db.integrations.Core.InvokeLLM` with a `response_json_schema` → human
  reviews/edits in a table → explicit approve action writes the records.
  Reference implementation: `src/components/estimating/SmartFileDump.jsx`.
  Follow this shape exactly for any new AI-extraction feature rather than
  inventing a different flow.
- **Job cost posting**: creating a `JobCostLedgerEntry` with `cost_class`,
  `cost_code`, `amount`, `transaction_date`, `source_type`, `source_id`,
  `description`. Reference: `src/components/field-operations/
  EquipmentUsagePanel.jsx` handleSubmit.
- **Module/entitlement gating**: `src/lib/moduleEntitlement.js`
  (`hasModule`) and `src/lib/planGating.js` (`isErectPlan`) are two
  separate, currently uncoordinated systems. `ALL_MODULES` is the module
  registry — a page not in it can't be gated by plan.
- **Entity bridges**: when two parallel entities need to relate (e.g.
  `pieces` shop-floor records and office-side `PieceMark` records), add an
  explicit foreign key field rather than joining on inferred string matches.

## Known Parallel/Duplicate Systems — Don't Build On The Wrong One

- **Two piece entities**: `PieceMark` (office/project side — phase,
  sequence, quantity, item_type) and `pieces` (shop floor — QR payload,
  workflow_status, field_status). Bridged via `pieces.piece_mark_id`.
- **Three shipping systems**: (1) `PieceMark.shipping_load_id` +
  `shipping_loads` — legacy drag-drop, no schema file, should eventually be
  deprecated; (2) `loads` + `load_items` + `shipping_manifests` — the
  maintained system with real manifest/QR/receiving logic, build new
  shipping/receiving features on this one; (3) jobsite receiving (Field
  Operations) — erector-facing, built on top of (2).
- **Two receiving flows**: `receiving_logs` (shop-floor PO receiving,
  vendor material arriving at the shop) is unrelated to jobsite receiving
  (erector checking off pieces arriving on site). Never conflate them.

## Foundation Software Gaps — Status

All four originally identified gaps are closed: subcontract management,
equipment job costing, certified payroll tracking, and payroll. Hancock has
no field labor of its own — subs handle field crews, so payroll/certified
payroll never needed a field-labor calculation path. Retainage is
customer-contract-driven, not sub-retainage.

## IRONSIGHT (Bluebeam Revu Competitor)

Named after researching real Bluebeam complaints (instability with large
tool chests, poor scaling consistency, subscription-only pricing since
2023). SteelOS's edge: takeoff feeds the estimate directly, no Excel
round-trip, plus a built-in AISC catalog.

- Phase 1: PDF viewer (pan/zoom/page-nav) via `pdfjs-dist`
- Phase 2A: Resumable sessions, IndexedDB PDF storage
- Phase 2B: Two-point scale calibration (feet-inches-fractions to 1/16")
- Phase 2C: Length + Count tools, Tool Chest presets
- Phase 2D: Area (shoelace formula) + VisualSearch (local VLM)
- Phase 3: MarkupsList → Push to Estimate → MaterialTakeoffLine
- Phase 4: AISC weight auto-lookup, tonnage summary, variance vs. bid

**Critical measurement rule**: all IRONSIGHT measurement is in PDF-space
units, never screen pixels — screen-pixel scale breaks on zoom change.
Click coords from `e.offsetX/offsetY` are already canvas-local; `pdfX =
offsetX / scale`. Draw coords are `pdfX * scale`. Never use a
`pdfToScreen()` helper for this — it double-counts pan.

## Known Bugs (check before assuming something works)

- `Settings.jsx` — save button shows "Settings saved!" but persists nothing.
- Accounting tab-level permissions not enforced — any role with
  `/accounting` access sees Cash Management + Budget regardless of role.
- Demo employee PIN collision — all seeded employees have
  `ssn_last4: '0000'` and employee numbers ending in a pattern that
  resolves every PIN to `00001`. This is a demo-data artifact; the pattern
  must never ship for real payroll.
- `manifest.json` console error — harmless, Vercel's SPA rewrite returns
  HTML for it.

## Git Workflow

The user runs Claude Code directly against their machine and pushes
manually. Always give git commands as one copy-paste block of exactly
three lines, Windows CMD, not chained with `&&`:

```
git add -A
git commit -m "..."
git push origin main
```

Write commit messages that describe what actually changed, matched to the
work just done — not a generic message.

## Where To Get The Current Backlog

This skill's content is stable (architecture, rules, patterns). The
day-to-day backlog (what's queued, in progress, closed) lives in
`BACKLOG.md` at this plugin's root — read it when the user references
"the list," asks what's next, or asks you to add something to it. That
file is meant to be edited directly as items move between sections; treat
it as the current source of truth over anything from earlier chat
history, since it's the one place both you and the user update.
