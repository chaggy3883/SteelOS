---
name: steelos-architecture
description: >
  This skill should be used when making a SteelOS architecture decision —
  choosing where a new entity or field should live, deciding whether
  something needs AI vs. deterministic logic, evaluating module/plan
  gating changes, or when the user asks "where should this go", "should
  this be its own entity", or "what's the right way to build this".
metadata:
  version: "0.1.0"
---

# SteelOS Architecture Decisions

Reasoning framework for structural decisions in a no-backend, single-
developer SPA. The constraint that shapes almost everything: there is no
server, so anything requiring persistent server-side state, scheduled
jobs, or secrets is deferred, not built as a workaround.

## AI vs. Deterministic Logic — Default to Deterministic

For **detection/monitoring** tasks (flagging anomalies, checking
thresholds, validating a business rule): use plain rule-based checks, not
an LLM call. Reasons: no backend means nothing can run "continuously"
except a page load or an on-demand button — an LLM check adds cost,
latency, and hallucination risk for a task a boolean expression already
solves correctly and auditably. Examples already in the codebase: PO
budget variance (`src/lib/threeWayMatch.js`), PM-due thresholds, off-rent
overdue flags.

For **extraction/drafting** tasks (reading an unstructured document into
structured fields, drafting response text a human will edit): AI is the
right tool, because there's no deterministic way to parse an arbitrary
vendor quote layout or draft prose. Use the established pattern —
`InvokeLLM` with a `response_json_schema`, followed by mandatory human
review before any write. Reference: `src/components/estimating/
SmartFileDump.jsx`.

If a request sounds like "have AI watch X and tell me when something's
wrong," decompose it: what specific conditions should trigger a flag?
Build those as rules first. An LLM narrative layer summarizing what the
rules found can sit on top of that later — it should not be the detector
itself.

## New Entity vs. Extend an Existing One

Extend an existing entity when the new data needs to flow through
workflows the existing entity already participates in (fabrication →
shipping → manifest → receiving, for example). A new parallel entity
means duplicating every downstream integration point it needs to pass
through — schema fields, list views, detail dialogs, job cost postings,
receiving logic. This has already produced real technical debt in this
codebase (`PieceMark` vs `pieces`, and three parallel shipping systems) —
don't add a fourth kind of split entity without a specific reason a shared
entity can't satisfy.

Prefer a discriminator field (`item_type`, `event_type`) over a new entity
when the differences between "kinds" of the thing are mostly about which
fields are populated, not about which workflows apply.

## Module / Plan Gating

Two systems currently coexist and are not reconciled:
`subscription_plan` (drives `src/lib/planGating.js`) and `enabled_modules`
(drives `src/lib/moduleEntitlement.js`'s `hasModule`). Before adding a new
gated module, check `ALL_MODULES` — a module missing from that registry
cannot be gated regardless of what other code assumes.

When deciding pack assignment (Fab / Erect / Enterprise / Universal), the
operative question is not "which pack was this built for" but "which
tenants have a workflow reason to need this" — e.g., an erector still
needs visibility into inbound shipments even though shipping is
conceptually a Fab-side operation.

Any pack-gating change must account for super-admin impersonation: a
platform super admin impersonating a tenant needs to see everything
regardless of that tenant's plan, or the impersonation feature becomes
useless for support/QA. Build the bypass check explicitly rather than
assuming impersonation naturally sits outside plan gating.

## Cross-Tenant Data Sharing

Any workflow where one company's data needs to be visible to a different
company (e.g., a fab shop's parts manifest visible to an independent
erector's account) is a real multi-tenant data-sharing problem, not a
UI problem — it requires the deferred backend. Within a single tenant
that does both fab and erection, this is not an issue since it's all one
company's data. Identify which case is actually being built before
scoping a cross-company workflow.

## Sequencing Dependencies

Before scoping a new feature, check whether it depends on something still
unbuilt. Two known dependency chains in this project:

- Field/jobsite receiving broken out **by phase or section** depends on
  project phasing (Sequence vs. Area) actually being built — phasing
  fields may exist on an entity already without any UI managing them,
  which is not the same as the feature being done.
- Cross-tenant manifest sharing between a fab shop and an independent
  erector depends on the VPS/backend, not just UI work.

When a request implies a workflow spanning multiple modules, trace the
dependency chain before writing the prompt for the piece that was asked
about — building the dependent piece first, out of order, produces work
that has to be reconciled later.
