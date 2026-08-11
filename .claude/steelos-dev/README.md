# SteelOS Dev

Claude Code plugin for developing SteelOS — a structural steel fabrication
ERP (React 18 + Vite, no backend, localStorage/IndexedDB data layer).

## Components

**Skills** (load automatically when relevant):

- `steelos-context` — project architecture, standing UI/code rules,
  established patterns (AI extraction, job cost posting, entity bridging),
  known parallel/legacy systems to avoid building on, IRONSIGHT phase
  history, Foundation Software gap status, git workflow convention.
- `steelos-code-review` — checklist for verifying a change before calling
  it done: build/lint, hand-tracing calculations, guardrail checks
  (no `<form>` tags, drill-down rule, AI-write approval gate, role name
  accuracy), and how to tell a data problem from a logic problem.
- `steelos-architecture` — decision framework for AI-vs-deterministic
  logic, new-entity-vs-extend-existing, module/plan gating, cross-tenant
  data sharing, and sequencing dependencies between features.

**Agents:**

- `steelos-debugger` — structured root-cause isolation for bugs that
  aren't obvious on first read. Traces code paths end-to-end, distinguishes
  data problems from logic problems, hand-verifies calculations, and
  reports root cause + fix + a concrete verification step rather than a
  guess.

**Also included:**

- `BACKLOG.md` — the living backlog (Foundation gaps, closed work,
  queued items, known bugs, deferred items). This is a real file, not a
  skill — edit it directly as items move between sections. `steelos-
  context` points to it as the source of truth for "what's next."

## Setup

No environment variables or external services required — this plugin is
pure context and reasoning guidance, no MCP servers.

## Usage

These trigger automatically based on what you're doing:

- Say anything referencing SteelOS, IRONSIGHT, the backlog, or any
  SteelOS page/entity by name → `steelos-context` loads, which reads
  `BACKLOG.md` for current status.
- Ask "is this ready to push", "review this", or similar → `steelos-code-
  review` loads.
- Ask "where should this go" / "should this be its own entity" → `steelos-
  architecture` loads.
- Report a bug that isn't a one-line fix → invoke the `steelos-debugger`
  agent, or Claude Code will suggest it.

## Keeping This Current

`BACKLOG.md` is meant to be edited every session — move items between
Closed / In Progress / Queued as work lands, and add new items under the
right heading when they come up. Say "add to the list" the same way you
would in chat, and have Claude Code edit the file directly.

If a new standing rule, architecture pattern, or known-gotcha gets
established (not just a backlog item — an actual rule or pattern), update
`skills/steelos-context/SKILL.md` (or the relevant skill) directly rather
than letting it live only in chat history.
