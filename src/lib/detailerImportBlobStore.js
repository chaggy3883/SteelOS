// IndexedDB store for DetailerImportBatch source files (Detailer Imports
// page). A batch can hold multiple files, so unlike shopDrawingBlobStore.js
// (one file keyed by its own record id) each file here gets its own
// generated id, stored on DetailerImportBatch.uploaded_files[].file_id.
// Same one-store-file-per-domain convention as pdfBlobStore.js,
// mtrDocumentStore.js, pieceMarkDocumentStore.js, shopDrawingBlobStore.js.
// HONESTY NOTE: no backend — this is per-browser storage. Clearing site data
// clears every uploaded file; that's an accepted dev/demo limitation, same as
// every other blob store in this app.
const DB_NAME = 'steelos_detailer_imports';
const STORE_NAME = 'files';

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

export const createDetailerImportFileId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `dif-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const saveDetailerImportFile = async (fileId, file) => {
  if (!fileId || !file) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(file, fileId);

    transaction.oncomplete = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to store detailer import file ${fileId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to store detailer import file ${fileId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const getDetailerImportFileUrl = async (fileId) => {
  if (!fileId) return null;

  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(fileId);

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
        finish(() => reject(new Error(`Failed to create object URL for detailer import file ${fileId}: ${error?.message || 'unknown error'}`)));
      }
    };

    request.onerror = () => finish(() => reject(new Error(`Failed to load detailer import file ${fileId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to load detailer import file ${fileId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const deleteDetailerImportFile = async (fileId) => {
  if (!fileId) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(fileId);

    transaction.oncomplete = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to delete detailer import file ${fileId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to delete detailer import file ${fileId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};
