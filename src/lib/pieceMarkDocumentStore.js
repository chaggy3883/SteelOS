// IndexedDB store for PieceMark drawing/PDF attachments (bulk intake in
// ProjectDetail.jsx's Piece Marks section). Same shape as
// inspectionDocumentStore.js — one key holds the whole array of
// blobs+metadata for a given piece, per the piece_documents_{pieceMarkId}
// key convention — kept as its own file rather than reusing that one
// because the two are unrelated domains (inspection attachments vs.
// piece-mark drawings), matching the existing one-store-file-per-domain
// convention (pdfBlobStore.js, mtrDocumentStore.js, disciplinaryDocumentStore.js).
// HONESTY NOTE: no backend — this is per-browser storage. Clearing site data
// clears every attachment; that's an accepted dev/demo limitation, same as
// every other blob store in this app.
const DB_NAME = 'steelos_piece_mark_documents';
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

export const createDocumentId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const pieceDocumentsKey = (pieceMarkId) => `piece_documents_${pieceMarkId}`;

// documents: array of { id, filename, mimetype, size, uploadDate, blob }
export const saveDocumentRecords = async (key, documents) => {
  if (!key) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(documents, key);

    transaction.oncomplete = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to store documents for ${key}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to store documents for ${key}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

// Returns [] rather than null when nothing is on file, so callers can spread
// it straight into a list without a null check.
export const getDocumentRecords = async (key) => {
  if (!key) return [];

  const db = await openDatabase();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => finish(() => resolve(Array.isArray(request.result) ? request.result : []));
    request.onerror = () => finish(() => reject(new Error(`Failed to load documents for ${key}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to load documents for ${key}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const deleteDocumentRecords = async (key) => {
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
    request.onerror = () => finish(() => reject(new Error(`Failed to delete documents for ${key}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to delete documents for ${key}: ${transaction.error?.message || 'unknown error'}`)));
  });
};
