---
name: steelos-code-review
description: >
  This skill should be used when reviewing SteelOS code changes, verifying
  a build before calling work done, checking a diff before commit, testing
  a feature, or when the user asks "does this look right", "is this ready
  to push", "review this", or "check my work" in the context of the SteelOS
  repository.
metadata:
  version: "0.1.0"
---

# SteelOS Code Review

Apply this checklist to any SteelOS change before treating it as complete.
The goal is to catch the failure modes that are easy to miss in a
no-backend, localStorage-shim SPA — not generic code review.

## Always Run Before Calling Anything Done

```
npm run build && npm run lint
```

A change that builds and lints clean is not automatically correct — it
means it doesn't crash and doesn't violate style rules. Treat this as the
floor, not the finish line.

## Trace Critical Math By Hand

Do not trust that calculation code "looks right" from reading it. Walk
through it with a concrete example and compute the expected output
manually, for anything involving:

- Overtime/hours splits (daily cap, then weekly cap, in that order —
  check whether "prior minutes used" is read from a stored field or
  recomputed; stored-but-stale values are a common source of silently
  wrong caps)
- Yield/stock quantity calculations (theoretical vs. actual, and whether
  a manual override is supposed to lock the field against being
  overwritten by a live recalculation)
- Variance percentages (three-way match, budget vs. actual, rental burn
  vs. PO) — confirm the denominator is what you think it is
- Any job cost or GL-adjacent posting — trace one full example from
  trigger event to the ledger entry it creates

If you guess at a root cause instead of reading the actual code path,
say so explicitly and go verify — don't present a guess as a finding.

## Guardrails to Check on Every New Feature

- **No new `<form>` tags.** Grep the diff for `<form` if unsure.
- **Every new list row / data point is clickable to a detail view.** This
  is a standing project rule, not optional polish.
- **AI-touching code**: confirm there is an explicit human approval step
  between AI output and any `db.entities.*.create`/`.update` call. If AI
  output can reach a write call without a user clicking something first,
  that's a defect, not a shortcut.
- **New entity fields**: were they added to the actual `schema/entities/
  *.jsonc` file, or only used ad-hoc in the component? Schemas are
  documentation-only at runtime but they're the contract for what the
  entity is supposed to look like — keep them in sync.
- **Status-flip operations** (marking something received, approved,
  closed): confirm the operation updates an *existing* linked record
  rather than creating a new one. Watch for code that should be doing
  `db.entities.X.update(id, {...})` but is accidentally doing `.create()`,
  which silently duplicates records instead of flipping status.
- **Role/permission gates**: if a feature is restricted to certain roles,
  confirm the actual role list used matches real roles in
  `src/components/dashboard/rbacConfig.jsx` — don't invent role names.

## Reading Git History Sanity Checks

When reviewing a batch of commits (e.g. after `git pull`), don't trust
commit messages at face value. Spot-check by running:

```
git show <hash> --stat
git show <hash> --name-only
```

and confirming the changed files actually match what the message claims.
Mislabeled commits happen (e.g. a commit titled "Add project phasing" that
turns out to only touch subcontract-management files) — catching this
early prevents believing a feature shipped when it didn't.

## When Something Looks Broken

Before concluding a feature is buggy, check whether the problem is
actually **thin or missing demo data** rather than broken logic — this
codebase's demo data is hand-seeded and often incomplete for newer
entities. Confirm by checking record counts in `src/api/localData.js`
before diagnosing application logic.

Conversely, don't assume a UX complaint is "just" a demo-data problem —
check whether the primary/visible creation path for a record actually
populates everything downstream features depend on (a real historical
example: a PO-creation UI that never wrote line items, so a
totally-correct receiving feature had nothing to display).
