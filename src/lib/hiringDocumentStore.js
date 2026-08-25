// IndexedDB store for candidate/employee hiring documents (resumes,
// applications, cover letters). Dedicated database, same shape as
// disciplinaryDocumentStore.js/mtrDocumentStore.js — one blob per key.
// candidate_documents.blob_key / employee_hiring_documents.blob_key hold only
// the key (candidate/{candidateId}/{docId} or employee/{employeeId}/{docId});
// the blob itself lives here. Moving a candidate's documents to the employee
// record on hire re-keys the blob via getHiringDocumentBlob + saveHiringDocument
// rather than moving it in place, since IndexedDB has no rename primitive.
// HONESTY NOTE: no backend — this is per-browser storage. Clearing site data
// clears every attachment; that's an accepted dev/demo limitation, same as
// every other blob store in this app.
const DB_NAME = 'steelos_hiring_documents';
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

export const createHiringDocumentId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `hiring-doc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const saveHiringDocument = async (key, file) => {
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
    request.onerror = () => finish(() => reject(new Error(`Failed to store hiring document for ${key}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to store hiring document for ${key}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

const readRaw = async (key) => {
  if (!key) return null;

  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => finish(() => resolve(request.result || null));
    request.onerror = () => finish(() => reject(new Error(`Failed to load hiring document for ${key}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to load hiring document for ${key}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

// Returns the raw stored File/Blob — used when re-keying a document from
// candidate to employee storage on hire. Callers that just need to display
// the file should use getHiringDocument below instead.
export const getHiringDocumentBlob = async (key) => readRaw(key);

// Returns a fresh object URL each call — callers own it and should revoke it
// when done (same convention as pdfBlobStore.js's getPdf).
export const getHiringDocument = async (key) => {
  const result = await readRaw(key);
  if (!result) return null;
  try {
    return URL.createObjectURL(result);
  } catch (error) {
    throw new Error(`Failed to create object URL for hiring document ${key}: ${error?.message || 'unknown error'}`);
  }
};

export const deleteHiringDocument = async (key) => {
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
    request.onerror = () => finish(() => reject(new Error(`Failed to delete hiring document for ${key}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to delete hiring document for ${key}: ${transaction.error?.message || 'unknown error'}`)));
  });
};
