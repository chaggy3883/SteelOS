// IndexedDB store for PieceMark CNC file attachments (Stage 9 — CNC file
// relationship, explicitly NOT machine communication or G-code generation:
// this only stores/returns the file so a user can hand it to CNC software
// manually). One file per PieceMark, keyed by PieceMark.id — same
// put(file, key)/get-as-object-URL shape as shopDrawingBlobStore.js and
// pdfBlobStore.js, per the existing one-store-file-per-domain convention.
// HONESTY NOTE: no backend — this is per-browser storage. Clearing site data
// clears every CNC file; that's an accepted dev/demo limitation, same as
// every other blob store in this app.
const DB_NAME = 'steelos_cnc_files';
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

export const saveCncFile = async (pieceMarkId, file) => {
  if (!pieceMarkId || !file) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(file, pieceMarkId);

    transaction.oncomplete = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to store CNC file for ${pieceMarkId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to store CNC file for ${pieceMarkId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const getCncFileUrl = async (pieceMarkId) => {
  if (!pieceMarkId) return null;

  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(pieceMarkId);

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
        finish(() => reject(new Error(`Failed to create object URL for CNC file ${pieceMarkId}: ${error?.message || 'unknown error'}`)));
      }
    };

    request.onerror = () => finish(() => reject(new Error(`Failed to load CNC file for ${pieceMarkId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to load CNC file for ${pieceMarkId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const deleteCncFile = async (pieceMarkId) => {
  if (!pieceMarkId) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(pieceMarkId);

    transaction.oncomplete = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to delete CNC file for ${pieceMarkId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to delete CNC file for ${pieceMarkId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};
