# SteelOS Development Rules

Follow AGENTS.md.

## Existing Code First
- Inspect relevant existing code before making changes.
- Prefer modifying or extending existing functionality over creating duplicates.
- Reuse existing components, utilities, data models, APIs, and patterns.
- Only create a new file when an existing file is not appropriate; briefly explain why.
- Check callers/dependencies before changing existing interfaces.
- Preserve existing functionality unless the requested change requires otherwise.
- Keep changes focused and avoid unnecessary refactoring.

## Context Efficiency
- Read only files relevant to the task unless broader investigation is necessary.
- Do not reread unrelated files or the entire project.
- Keep explanations concise.
- Do not repeat information already known from the current conversation.
- Do not perform extensive reviews for trivial changes.

## Verification
- For significant changes, run `npm run lint` and `npm run build`.
- Fix the root cause of errors rather than suppressing them.
- Perform appropriate functional verification.
- Do not claim a feature works solely because build/lint passed.

## Review
For significant changes, briefly review the work for:
- Bugs or regressions
- Security or permission problems
- Data integrity issues
- Multi-user or multi-device problems
- Architecture inconsistencies
- Duplicate or unnecessary code

Report important findings before making additional fixes unless I explicitly ask you to fix them.

## Safety
- Do not modify files outside the SteelOS project unless explicitly authorized.
- Do not expose or commit secrets.
- Do not guess about important business logic or architecture; ask when necessary.
