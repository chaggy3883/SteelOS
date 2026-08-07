const DB_NAME = 'ironsight';
const STORE_NAME = 'pdfs';

const getIndexedDb = () => {
  if (typeof window === 'undefined') return null;
  return window.indexedDB || null;
};

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

const closeDatabase = (db) => {
  if (db?.close) db.close();
};

export const savePdf = async (takeoffId, file) => {
  if (!takeoffId || !file) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => {
      if (settled) return;
      settled = true;
      closeDatabase(db);
      handler();
    };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(file, takeoffId);

    request.onsuccess = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to store PDF for takeoff ${takeoffId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to store PDF for takeoff ${takeoffId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const getPdf = async (takeoffId) => {
  if (!takeoffId) return null;

  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => {
      if (settled) return;
      settled = true;
      closeDatabase(db);
      handler();
    };

    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(takeoffId);

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
        finish(() => reject(new Error(`Failed to create object URL for takeoff ${takeoffId}: ${error?.message || 'unknown error'}`)));
      }
    };

    request.onerror = () => finish(() => reject(new Error(`Failed to load PDF for takeoff ${takeoffId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to load PDF for takeoff ${takeoffId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const deletePdf = async (takeoffId) => {
  if (!takeoffId) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => {
      if (settled) return;
      settled = true;
      closeDatabase(db);
      handler();
    };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(takeoffId);

    request.onsuccess = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to delete PDF for takeoff ${takeoffId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to delete PDF for takeoff ${takeoffId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const listPdfIds = async () => {
  const db = await openDatabase();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => {
      if (settled) return;
      settled = true;
      closeDatabase(db);
      handler();
    };

    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();
    const ids = [];

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        ids.push(cursor.key);
        cursor.continue();
        return;
      }
      finish(() => resolve(ids));
    };

    request.onerror = () => finish(() => reject(new Error(`Failed to list stored PDFs: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to list stored PDFs: ${transaction.error?.message || 'unknown error'}`)));
  });
};
