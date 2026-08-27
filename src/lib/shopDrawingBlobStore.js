// IndexedDB store for ShopDrawing PDF blobs (Project Management's Shop
// Drawings section). Same shape as pdfBlobStore.js — one store file per
// domain, per the existing convention (pdfBlobStore.js,
// pieceMarkDocumentStore.js, mtrDocumentStore.js, disciplinaryDocumentStore.js).
// HONESTY NOTE: no backend — this is per-browser storage. Clearing site data
// clears every drawing file; that's an accepted dev/demo limitation, same as
// every other blob store in this app.
const DB_NAME = 'steelos_shop_drawings';
const STORE_NAME = 'drawings';

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

export const saveShopDrawingFile = async (drawingId, file) => {
  if (!drawingId || !file) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(file, drawingId);

    transaction.oncomplete = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to store shop drawing ${drawingId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to store shop drawing ${drawingId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const getShopDrawingFileUrl = async (drawingId) => {
  if (!drawingId) return null;

  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(drawingId);

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
        finish(() => reject(new Error(`Failed to create object URL for shop drawing ${drawingId}: ${error?.message || 'unknown error'}`)));
      }
    };

    request.onerror = () => finish(() => reject(new Error(`Failed to load shop drawing ${drawingId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to load shop drawing ${drawingId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const deleteShopDrawingFile = async (drawingId) => {
  if (!drawingId) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(drawingId);

    transaction.oncomplete = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to delete shop drawing ${drawingId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to delete shop drawing ${drawingId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};
