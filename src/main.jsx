import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { STORAGE_KEY } from '@/api/localData'
import '@/index.css'

// Portable/flash-drive persistence bootstrap. localData.js already mirrors
// every save out to db.json (via the dev-only /__db-sync middleware in
// vite.config.js) so the data survives moving the project folder between
// machines. The other half of that: on startup, before this browser's own
// localStorage gets a chance to seed itself fresh, pull whatever's already
// in db.json and hydrate localStorage from it first. Fails silently and
// changes nothing if the endpoint isn't there (production build, or dev
// without our middleware) — this must never block the app from rendering.
async function hydrateFromDbFile() {
  try {
    const res = await fetch('/__db-sync');
    if (!res.ok) return;
    const parsed = await res.json();
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch (e) {
    // no-op — falls back to whatever's already in this browser's localStorage
  }
}

hydrateFromDbFile().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
  );
});
