# SteelOS

A self-contained React + Vite single-page app. There is no separate backend server and no hosted platform dependency — everything runs from `npm run dev`.

## Prerequisites

1. Clone the repository.
2. Navigate to the project directory.
3. Install dependencies: `npm install`.

## Run Locally

```bash
npm run dev
```

Open the local URL printed by Vite.

## How data persistence works

All app data (`src/api/apiClient.js` → `src/api/localData.js`) lives in the browser's `localStorage` — there is no real backend to call. That's normally tied to a single browser profile on one machine, which doesn't travel with the project folder if it's moved (e.g. on a USB drive) between computers.

To make the project itself portable, `vite.config.js` registers a dev-only Vite middleware (`/__db-sync`) that mirrors the current `localStorage` snapshot out to `db.json` in the project root on every save, and hydrates `localStorage` from that file on startup. This only runs under `npm run dev` — it's not part of the production build and does nothing in a static/hosted deployment. `db.json` is gitignored; it's local data, not source.

## Schema documentation

`schema/entities/*.jsonc` describes the shape of every entity `src/api/localData.js` manages — properties, types, enums, and defaults. These files are documentation for humans and AI assistants working in this codebase; nothing at runtime reads them. When you add or change a field an entity actually saves, keep the matching `.jsonc` file in sync so the documented shape doesn't drift from what the code really does.

## Build

```bash
npm run build
```

## Lint

```bash
npm run lint
```
