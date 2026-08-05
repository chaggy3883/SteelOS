# AGENTS.md

## Project Context

This is a self-contained React/Vite SPA. Treat it as user-owned application code, keep changes focused on the user's request, and preserve existing project conventions.

Start with `README.md` for local setup and how persistence works.

## Key Files

- `src/`: frontend application source.
- `src/api/apiClient.js`: the app's data client (`db`) — wraps `src/api/localData.js`, which is the actual implementation (entities in `localStorage`, dev-only file sync to `db.json`).
- `vite.config.js`: Vite config, including the dev-only `/__db-sync` middleware `src/main.jsx`/`src/api/localData.js` use to mirror `localStorage` to `db.json`.
- `schema/entities/*.jsonc`: human/AI-readable documentation of each entity's shape (properties, types, enums, defaults). Not read by any runtime code — keep in sync by hand when `src/api/localData.js` or a component changes what an entity actually saves.
- `.env.local`: local-only environment values; never commit secrets.

## Working Notes

- Use `npm run dev` for local development — it's the only command needed; there is no separate backend to start.
- Data lives in the browser's `localStorage` via `src/api/localData.js`; there is no hosted backend or CLI involved.
- Reuse the existing `db` client (`src/api/apiClient.js`) and entity patterns in `src/api/localData.js` before adding new persistence paths.
- If you add or change a field an entity saves, update the matching `schema/entities/*.jsonc` file so the documented shape doesn't drift from the code.
- Run the relevant checks from `package.json` (`npm run build`, `npm run lint`) before finishing code changes.
