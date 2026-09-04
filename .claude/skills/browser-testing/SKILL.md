---
name: browser-testing
description: >
  This skill should be used before treating a SteelOS UI change as done, or
  when the user asks to "smoke test", "check every route", "test as
  [role]", "verify the build before pushing", or run through the manual
  browser checks by hand — booting the app, walking every major route,
  checking role-gated pages (Accounting tabs, Legal, Employee Center,
  pack-gated sections) per role, and confirming the standing UI rules (no
  new <form> tags, every data point clickable, no text truncation at
  1024/1440/1920 widths) hold. Windows CMD only — no Unix tools, no bash,
  no Playwright/Puppeteer/Cypress (none are installed in this project).
metadata:
  version: "0.1.0"
---

# SteelOS Browser Testing

This project has no test runner and no browser-automation library
installed (`package.json` has no Playwright/Puppeteer/Cypress/WebDriver —
verify that's still true before assuming otherwise, since a future session
could add one). Testing this app has always meant a human clicking around
in a real browser. This skill turns that into a repeatable, ordered
checklist plus a few Windows CMD scripts that automate the boring parts —
it does not pretend to fully automate what genuinely needs a person
looking at a screen. See "What This Cannot Automate" at the bottom before
trusting a clean run as proof of nothing broken.

Detailed reference tables (demo accounts, full route inventory, role/pack
gating specifics, the frozen `<form>` legacy-file list) live in
`reference/testing-reference.md` — this file is the checklist and
workflow; that one is the data it points at.

## Before You Start

1. Start the dev server in its own window and leave it running:
   ```
   npm run dev
   ```
2. Open the printed local URL (default `http://localhost:5173`) in a
   browser.
3. Have `reference/testing-reference.md` open — you'll switch between
   demo accounts by email/password from its Demo Accounts table.

## Step 1 — Build + Lint (automated)

```
.claude\skills\browser-testing\scripts\build-and-lint.cmd
```

Runs `npm run build` then `npm run lint`, stopping at the first failure.
This is the floor, not the finish line — a clean build/lint does not mean
the feature works, only that it doesn't crash and follows style rules.

## Step 2 — App Boots, No Console Errors (manual)

1. With the dev server running, load `/` in a fresh tab.
2. Open DevTools (F12) → Console, before and while the page loads.
3. Confirm: no red errors, no unhandled promise rejections. The one
   known-harmless exception is a `manifest.json` 404 (Vercel's SPA
   rewrite artifact in production — irrelevant locally, but don't
   re-report it if it shows up under `npm run preview`).
4. Log in as `admin@steelos.dev` / `password123` and repeat the console
   check after login completes.

## Step 3 — Every Major Route Renders (manual, admin account)

Logged in as `admin@steelos.dev` (bypasses all role/pack gating via
`allowed_modules: ['*']`), visit every route in the Route Inventory table
in `reference/testing-reference.md`, grouped by section: Dashboard,
Estimating, Projects, Production, Shipping, Accounting, CRM, Field Ops,
HR, Quality, Legal, Settings, Admin.

For each route: it renders without a blank screen, an uncaught error
boundary, or a console error. Routes with a `:id` segment — reach them by
clicking into a record from their list page, not by typing a guessed ID.

Run `scripts\list-routes.cmd` first if you suspect the route list has
drifted from `App.jsx` (a route added/renamed since this checklist was
written).

## Step 4 — Role-Gated Pages Behave Correctly (manual, per role)

Using the Demo Accounts table in `reference/testing-reference.md`, log in
as each role that has a working seeded account and confirm:

- **Accounting** (`/accounting`): the visible tabs match that role's entry
  in the Role Gating Specifics section — e.g. `project_manager` should
  see Job Costing/Job Cost Detail/Budget/AR & Billings/WIP/AI Financial
  Flags but NOT Vendor Bills/Bank & Cash/Month-End Close.
  `hr@hancocksteel.com` should land on the "no accessible tabs" state,
  not an empty Accounting page.
- **Legal** (`/legal`): only `admin@steelos.dev` should get in among the
  seeded accounts (`president`/`ceo` also qualify but have no seeded
  login — see reference file). Every other demo account should see the
  restricted-access message.
- **Employee Center** (`/employee-center`): `admin@steelos.dev` should
  get the admin "view as employee" path with a logged-access notice
  instead of the normal PIN screen. Every other role goes through the
  standard PIN flow.
- **Pack-gated sections**: see the walkthrough in
  `reference/testing-reference.md`'s Role Gating Specifics — switch
  Hancock Steel's plan from `/super-admin/dashboard` and confirm
  Production/Inventory/Shipping/Shop-* (Fab-only) and Field Operations
  (Erect-only) show/hide correctly for a role that isn't otherwise
  restricted from them by `rbacConfig.jsx`.
- For any role without a working seeded account, either skip it and note
  the gap, or create one via `/users` while logged in as admin.

## Step 5 — Standing UI Rules

**No new `<form>` tags:**
```
.claude\skills\browser-testing\scripts\check-new-forms.cmd
```
Diff the output against the frozen legacy-file list in
`reference/testing-reference.md`. Anything not on that list is a new
violation — new interactive UI must use `onClick`/`onChange` handlers, not
a `<form>`.

**Every data point is clickable to its detail record:** on each route you
visited in Step 3, spot-check the lists/tables/summary cards — clicking a
row or a number should navigate to (or open a modal for) that record's
full detail, the same way Bid/Bid History already works. This is a
standing project rule (see the `steelos-context` skill), not optional
polish — flag any new list/card that was added without it.

**No text truncation at 1024 / 1440 / 1920 px widths:** resize the browser
window (or DevTools' responsive mode) to each width and check labels,
table headers, and card text for unwanted ellipsis/clipping/overlap. To
capture screenshots at all three widths without manually resizing, see
"Optional: Scripted Screenshot Capture" below — it still requires you to
look at the images, it just automates getting them.

## Optional: Scripted Screenshot Capture

This project has no browser-automation library, but Windows ships with
Microsoft Edge, and Edge's headless CLI flags can capture screenshots of
an already-logged-in session without adding any dependency. One-time setup
per role you want to test this way:

```
.claude\skills\browser-testing\scripts\setup-profile.cmd admin
```

This opens a dedicated Edge window with its own profile folder. Log in as
that role (e.g. `admin@steelos.dev` / `password123`), then just close the
window — its session persists in the profile folder on disk.

Then, with the dev server running and that Edge window closed (a profile
folder can't be read by two Edge processes at once), capture a route at
all three widths:

```
.claude\skills\browser-testing\scripts\screenshot-widths.cmd admin /production
```

Screenshots land in `.claude\skills\browser-testing\.screenshots\` (this
folder and the profile folder are gitignored — they're local test
artifacts, not source). Open them yourself; the script only captures, it
does not judge truncation. If a screenshot shows the login page instead
of the expected route, the profile's session expired or wasn't saved —
re-run `setup-profile.cmd` for that role.

This is genuinely optional — treat it as a time-saver for the width check
in Step 5, not a required part of the workflow, and don't invest effort
troubleshooting it if it misbehaves on a given Edge version; fall back to
manually resizing a real browser window.

## What This Cannot Automate

Be upfront about these when reporting results — a clean run through this
skill is not proof they're fine:

- **Visual judgment calls**: truncation, overlap, awkward wrapping, and
  "does this look right" always need a human looking at the screen (or at
  a captured screenshot). Nothing here renders that verdict for you.
- **IndexedDB blob persistence across devices**: PDFs and large binary
  blobs live in IndexedDB (`src/lib/pdfBlobStore.js`), which is per-browser
  and per-device, same as localStorage. There is no automated way from
  this skill to verify a blob uploaded on one machine/browser is visible
  on another — that has to be checked by hand on the actual two devices in
  question, and it's expected to fail (there's no backend to sync it).
- **Freight mileage calculator hitting public OSRM/Nominatim servers**:
  the Bid Worksheet's mileage lookup (`src/lib/mileageService.js`) calls
  free public demo servers with no API key — no config to check, but
  expect occasional failures/rate-limiting from those public services that
  aren't a code regression, and this skill has no way to tell the two
  apart automatically.
- **Anything behind the External Data Portal's separate login**
  (`/portal/*`) — different auth system from everything in the role
  matrix above; walk it manually if it's in scope for a given change.
- **Whether a role without a seeded demo account behaves correctly** —
  the reference file lists which `BUILTIN_ROLES` entries have no working
  login; testing those requires manually creating a user first.
