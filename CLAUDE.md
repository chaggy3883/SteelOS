# See AGENTS.md

Follow the instructions in `AGENTS.md`.

# SteelOS Claude Development Rules

Follow all instructions in `AGENTS.md`.

## Development Approach

Before making changes:

1. Understand the user's requested outcome.
2. Inspect the existing implementation and architecture before modifying code.
3. Identify all files, components, data models, and functionality affected by the change.
4. Reuse existing SteelOS components, patterns, utilities, and data access methods whenever possible.
5. Do not create duplicate functionality when an existing implementation can be extended.
6. Keep changes focused on the requested task.
7. Preserve existing functionality unless the requested change explicitly requires changing it.
8. Do not remove functionality simply to make a build or lint check pass.
9. Do not introduce mock, placeholder, or temporary implementations unless explicitly requested.
10. If the requested change conflicts with the existing architecture, explain the conflict before making architectural changes.

## Data and Architecture Protection

- Treat the existing SteelOS architecture as intentional unless there is evidence it needs to change.
- Reuse the existing `db` client and established entity patterns.
- Before changing an entity or saved data structure, identify all existing code that depends on it.
- Keep entity schemas synchronized with saved-field changes.
- Do not create a new persistence mechanism without first explaining why the existing approach is insufficient.
- Protect existing authentication, authorization, session, and user/device behavior.
- Consider multi-user and multi-device behavior when modifying shared application state.
- Do not silently change data formats or migration behavior.

## Security

Review all changes for:

- Authentication vulnerabilities
- Authorization/permission bypasses
- Exposure of sensitive data
- Unsafe handling of user input
- Injection vulnerabilities
- Insecure file handling
- Client-side security weaknesses
- Secrets accidentally exposed or committed
- Improper session handling

Never expose or commit secrets from `.env.local` or other local configuration files.

## Mandatory Senior Engineer Review

After completing any significant code change, feature, bug fix, refactor, data-model change, authentication/authorization change, or change affecting multiple files, perform a separate senior-engineer review.

Review the implementation as if you did not write it.

Specifically check for:

- Bugs and logic errors
- Regressions to existing functionality
- Broken or incomplete functionality
- Security vulnerabilities
- Authentication and authorization issues
- Data integrity problems
- Race conditions and state-management issues
- Incorrect assumptions about the existing architecture
- Inconsistencies with existing SteelOS architecture
- Duplicate or unnecessary code
- Error-handling weaknesses
- Edge cases
- Performance problems
- Multi-user problems
- Multi-device problems
- Problems with real production data
- Problems caused by browser localStorage persistence
- Problems caused by the current lack of a hosted backend

Do NOT immediately make changes during the review.

First provide a findings report containing:

1. Finding
2. Severity: Critical / High / Medium / Low
3. Why it is a problem
4. Files/components affected
5. Recommended fix

Only make changes after presenting the findings and receiving approval, unless the user explicitly instructs Claude to automatically fix the review findings.

## Verification

Before considering significant work complete:

1. Run the appropriate tests.
2. Run `npm run lint`.
3. Run `npm run build`.
4. Review the build and lint results.
5. If errors occur, diagnose the root cause and fix them rather than suppressing or bypassing the error.
6. After fixes, run the affected checks again.

A successful build or lint run does NOT prove the feature works correctly. Perform appropriate functional verification as well.

## Change Discipline

Before modifying multiple files, explain the intended approach when the change is complex.

For significant changes:

- Identify the files you intend to modify.
- Explain the architectural impact.
- Make the smallest reasonable change.
- Verify existing functionality was not unintentionally broken.
- Report what was changed and what was verified.

Do not modify files outside the SteelOS project unless explicitly authorized.

## When Requirements Are Unclear

Do not guess about important business logic.

If a requirement is ambiguous and guessing could result in incorrect data, security behavior, workflow behavior, or architecture, stop and ask for clarification.

For minor implementation details where the existing project conventions clearly establish the correct approach, follow those conventions without unnecessary questions.
