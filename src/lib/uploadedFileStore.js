// IndexedDB store backing db.integrations.Core.UploadFile itself (see
// localData.js's createIntegrationsApi). Same shape as every other blob
// store in this app (pdfBlobStore.js, mtrDocumentStore.js,
// documentBlobStore.js, etc.) — one blob per generated key, own dedicated
// database.
//
// Added 2026-09-11: UploadFile previously returned a bare
// `URL.createObjectURL(file)` blob: URL and persisted nothing — a blob: URL
// is only ever valid inside the browser tab that created it, so any code
// that stored that string and read it back after a reload got a dead link.
// Several callers (documentBlobStore.js's 3 entities, mtrDocumentStore.js,
// pdfBlobStore.js, inspectionDocumentStore.js) already worked around this
// individually by persisting the file themselves, keyed by their OWN
// entity's id, and treating UploadFile's return value as disposable. This
// store fixes the shared function itself so every caller — including ones
// that never built a workaround — gets a durable reference for free.
//
// UploadFile now returns `file_url` as an opaque `steelos-upload:<id>`
// reference instead of a blob: URL. IMPORTANT: this is NOT a fetchable URL
// — it cannot be passed directly to <img src>, <a href>, window.open(), or
// fetch(). Any code that needs to actually display/download/read the file
// must resolve it first via `resolveUploadedFileUrl` below, which returns a
// real (session-scoped) blob: URL asynchronously. This trade-off is
// intentional: it forces a caller that wants a real URL to go through an
// async resolve step rather than silently holding a blob: URL that happens
// to work today and breaks invisibly on the next reload.
//
// HONESTY NOTE: no backend — this is per-browser storage. Clearing site data
// clears every uploaded file; that's an accepted dev/demo limitation, same as
// every other blob store in this app.
const DB_NAME = 'steelos_uploaded_files';
const STORE_NAME = 'files';
const REF_PREFIX = 'steelos-upload:';

const getIndexedDb = () => (typeof window === 'undefined' ? null : window.indexedDB || null);

const openDatabase = async () => {
  const indexedDB = getIndexedDb();
  if (!indexedDB) return null;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`Unable to open ${DB_NAME} IndexedDB: ${request.error?.message || 'unknown error'}`));
  });
};

const closeDatabase = (db) => { if (db?.close) db.close(); };

export const createUploadedFileId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const makeUploadedFileRef = (id) => `${REF_PREFIX}${id}`;

const parseUploadedFileRef = (ref) => (
  typeof ref === 'string' && ref.startsWith(REF_PREFIX) ? ref.slice(REF_PREFIX.length) : null
);

export const saveUploadedFile = async (id, file) => {
  if (!id || !file) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(file, id);

    transaction.oncomplete = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to store uploaded file ${id}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to store uploaded file ${id}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

const getUploadedFileBlobUrl = async (id) => {
  if (!id) return null;

  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const result = request.result;
      if (!result) {
        finish(() => resolve(null));
        return;
      }
      try {
        const objectUrl = URL.createObjectURL(result);
        finish(() => resolve(objectUrl));
      } catch (error) {
        finish(() => reject(new Error(`Failed to create object URL for uploaded file ${id}: ${error?.message || 'unknown error'}`)));
      }
    };

    request.onerror = () => finish(() => reject(new Error(`Failed to load uploaded file ${id}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to load uploaded file ${id}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const deleteUploadedFile = async (id) => {
  if (!id) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    transaction.oncomplete = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to delete uploaded file ${id}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to delete uploaded file ${id}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

// Resolves any value that may have come from UploadFile's `file_url` at some
// point in this app's history into a real, usable URL:
// - a `steelos-upload:<id>` reference (current format) -> a fresh blob: URL
//   from this store, or null if the bytes are missing.
// - a legacy `blob:` URL (created before this fix shipped) -> null; that
//   blob was only ever valid in the tab that created it and cannot be
//   recovered.
// - anything else (a real hosted URL, a data: URI, an empty string) -> the
//   value unchanged, since there's nothing this store can do for it.
export const resolveUploadedFileUrl = async (ref) => {
  const id = parseUploadedFileRef(ref);
  if (id) return getUploadedFileBlobUrl(id);
  if (typeof ref === 'string' && ref.startsWith('blob:')) return null;
  return ref || null;
};
