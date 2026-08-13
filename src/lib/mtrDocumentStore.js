// IndexedDB store for Mill Test Report source files (PDF or image). Separate
// database from pdfBlobStore.js's `ironsight` DB and from
// inspectionDocumentStore.js's inspection/service DB — one blob per key here,
// same shape as pdfBlobStore.js, just a dedicated DB so MTR certs don't share
// a store with unrelated features. MillTestReport.cert_document_id holds the
// key used here; the entity itself never stores the blob.
// HONESTY NOTE: no backend — this is per-browser storage. Clearing site data
// clears every attachment; that's an accepted dev/demo limitation, same as
// every other blob store in this app.
const DB_NAME = 'steelos_mtr_documents';
const STORE_NAME = 'documents';

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

export const createMtrDocumentId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `mtr-doc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const saveMtrDocument = async (key, file) => {
  if (!key || !file) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(file, key);

    transaction.oncomplete = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to store MTR document for ${key}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to store MTR document for ${key}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

// Returns a fresh object URL each call — callers own it and should revoke it
// when done (same convention as pdfBlobStore.js's getPdf).
export const getMtrDocument = async (key) => {
  if (!key) return null;

  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

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
        finish(() => reject(new Error(`Failed to create object URL for MTR document ${key}: ${error?.message || 'unknown error'}`)));
      }
    };

    request.onerror = () => finish(() => reject(new Error(`Failed to load MTR document for ${key}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to load MTR document for ${key}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const deleteMtrDocument = async (key) => {
  if (!key) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);

    transaction.oncomplete = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to delete MTR document for ${key}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to delete MTR document for ${key}: ${transaction.error?.message || 'unknown error'}`)));
  });
};
