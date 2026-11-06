// Where SteelOS's database (the single JSON document localData.js reads and
// writes) is kept in the browser.
//
// It used to be one localStorage value, which browsers cap at about 5 MB —
// far too small for a real job (one detailer BOM can be 2,000+ pieces). It
// now lives in IndexedDB (the browser's own database; hundreds of MB or
// more), with the current copy held in memory so localData.js can keep
// reading and writing it synchronously, exactly as before:
//   getDbString()  -> the stored JSON string (or null)
//   setDbString(s) -> update memory now, save to IndexedDB in the background
// initDbPersistence() must finish before the app renders (main.jsx). On the
// first run it moves an existing localStorage database across and then frees
// that localStorage space.
//
// Other open tabs are told about each save (BroadcastChannel) and reload the
// stored copy, so two tabs don't keep working from different data.
//
// This is still per-browser storage. When SteelOS moves to a server, this
// file (plus localData.js's load/save) is the layer that gets replaced.

const IDB_NAME = 'steelos_database';
const IDB_STORE = 'kv';
const DOC_KEY = 'main';
const CHANNEL_NAME = 'steelos-db';

let memory = null; // the JSON string, or null when nothing is stored yet
let ready = false;
let dbHandle = null;
let channel = null;
const tabId = Math.random().toString(36).slice(2);

// Background save queue: at most one write in flight; a newer value queued
// while one is writing replaces any older queued one (only the latest copy
// matters).
let writing = false;
let queued = null;
const persistErrorListeners = new Set();

export const isDbPersistenceReady = () => ready;

export const onDbPersistError = (fn) => { persistErrorListeners.add(fn); return () => persistErrorListeners.delete(fn); };

const openDb = () => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
  const req = indexedDB.open(IDB_NAME, 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error('Could not open the SteelOS database'));
});

const idbGet = (db) => new Promise((resolve, reject) => {
  const tx = db.transaction(IDB_STORE, 'readonly');
  const req = tx.objectStore(IDB_STORE).get(DOC_KEY);
  req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
  req.onerror = () => reject(req.error);
});

const idbPut = (db, value) => new Promise((resolve, reject) => {
  const tx = db.transaction(IDB_STORE, 'readwrite');
  tx.objectStore(IDB_STORE).put(value, DOC_KEY);
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('Save aborted'));
});

const flush = async () => {
  if (writing || queued == null || !dbHandle) return;
  writing = true;
  const value = queued;
  queued = null;
  try {
    await idbPut(dbHandle, value);
    channel?.postMessage({ type: 'saved', from: tabId });
  } catch (e) {
    console.error('SteelOS: saving the database failed', e);
    persistErrorListeners.forEach((fn) => { try { fn(e); } catch { /* listener error */ } });
  } finally {
    writing = false;
    if (queued != null) flush();
  }
};

// legacyStorage: window.localStorage (or a stand-in); legacyKey: the old key.
export async function initDbPersistence({ legacyStorage, legacyKey } = {}) {
  if (ready) return;
  try {
    dbHandle = await openDb();
    memory = await idbGet(dbHandle);
    // One-time move from the old 5 MB localStorage slot.
    const legacy = legacyStorage?.getItem?.(legacyKey) ?? null;
    if (legacy && !memory) {
      memory = legacy;
      await idbPut(dbHandle, memory);
    }
    if (legacy) {
      try { legacyStorage.removeItem(legacyKey); } catch { /* ignore */ }
    }
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = async (ev) => {
        if (ev?.data?.type !== 'saved' || ev.data.from === tabId) return;
        try { memory = await idbGet(dbHandle); } catch { /* keep ours */ }
      };
    }
  } catch (e) {
    // No IndexedDB (very old browser / locked-down mode): fall back to the
    // legacy localStorage slot so the app still runs, with its old limit.
    console.warn('SteelOS: IndexedDB unavailable — using localStorage (5 MB limit)', e);
    dbHandle = null;
    memory = legacyStorage?.getItem?.(legacyKey) ?? null;
  }
  ready = true;
}

export const getDbString = () => memory;

export function setDbString(value) {
  memory = value;
  if (!dbHandle) return false; // caller falls back to localStorage
  queued = value;
  flush();
  return true;
}

export const hasIndexedDbBackend = () => !!dbHandle;

// Resolves once every queued save has reached IndexedDB (for tests / "save
// before leaving" flows).
export async function flushDbPersistence() {
  while (writing || queued != null) await new Promise((r) => setTimeout(r, 20));
}
