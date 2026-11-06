import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { STORAGE_KEY } from '@/api/localData'
import { initDbPersistence, setDbString, isDbPersistenceReady, hasIndexedDbBackend, onDbPersistError } from '@/api/dbPersistence'
import '@/index.css'

// The database now lives in IndexedDB (src/api/dbPersistence.js) instead of
// the 5 MB localStorage slot. It has to be loaded before anything reads it,
// so the app renders only after this — the first run also moves an existing
// localStorage database across.
async function initDatabase() {
  const legacyStorage = typeof window !== 'undefined' ? window.localStorage : null;
  await initDbPersistence({ legacyStorage, legacyKey: STORAGE_KEY });
  // Saves happen in the background; if one ever fails (browser storage
  // blocked or the disk full), say so once instead of failing silently.
  let warned = false;
  onDbPersistError(() => {
    if (warned) return;
    warned = true;
    window.alert('SteelOS could not save to this browser\'s database. Recent changes may be lost if you close the browser — check free disk space and that site storage is allowed.');
  });
}

// Portable/flash-drive persistence bootstrap. localData.js already mirrors
// every save out to db.json (via the dev-only /__db-sync middleware in
// vite.config.js) so the data survives moving the project folder between
// machines. The other half of that: on startup, pull whatever's already in
// db.json and load it into this browser's database first. Fails silently and
// changes nothing if the endpoint isn't there (production build, or dev
// without our middleware) — this must never block the app from rendering.
async function hydrateFromDbFile() {
  try {
    const res = await fetch('/__db-sync');
    if (!res.ok) return;
    const parsed = await res.json();
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
      const raw = JSON.stringify(parsed);
      if (isDbPersistenceReady() && hasIndexedDbBackend()) setDbString(raw);
      else window.localStorage.setItem(STORAGE_KEY, raw);
    }
  } catch (e) {
    // no-op — falls back to whatever's already in this browser's database
  }
}

initDatabase()
  .catch((e) => console.error('SteelOS: database init failed', e))
  .then(() => hydrateFromDbFile())
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <App />
    );
  });
