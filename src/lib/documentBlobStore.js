// IndexedDB store for Document/company_templates/CompanyProposalTerms file
// blobs. Same shape as shopDrawingBlobStore.js — one store file per domain,
// per the existing convention (pdfBlobStore.js, mtrDocumentStore.js,
// disciplinaryDocumentStore.js, shopDrawingBlobStore.js, cncFileStore.js).
//
// Added 2026-09-11: these three entities previously relied on
// db.integrations.Core.UploadFile's blob: URL directly, which was never
// persisted anywhere durable — the URL string was stored on the entity, but
// the bytes behind it died the moment the tab reloaded or closed. This
// store gives them the same durable, keyed-by-the-owning-record's-own-id
// pattern every other working upload flow in this app already uses.
// UploadFile itself was later fixed the same day to also persist durably
// (see uploadedFileStore.js) — resolveDocumentUrl below falls back to that
// store so a record whose own IndexedDB copy is missing still resolves
// correctly instead of returning an unusable reference as if it were a URL.
//
// HONESTY NOTE: no backend — this is per-browser storage. Clearing site data
// clears every uploaded file; that's an accepted dev/demo limitation, same as
// every other blob store in this app.
import { resolveUploadedFileUrl } from '@/lib/uploadedFileStore';

const DB_NAME = 'steelos_uploaded_documents';
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

export const saveDocumentFile = async (documentId, file) => {
  if (!documentId || !file) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(file, documentId);

    transaction.oncomplete = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to store document ${documentId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to store document ${documentId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const getDocumentFileUrl = async (documentId) => {
  if (!documentId) return null;

  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(documentId);

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
        finish(() => reject(new Error(`Failed to create object URL for document ${documentId}: ${error?.message || 'unknown error'}`)));
      }
    };

    request.onerror = () => finish(() => reject(new Error(`Failed to load document ${documentId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to load document ${documentId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

export const deleteDocumentFile = async (documentId) => {
  if (!documentId) return;

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; closeDatabase(db); handler(); };

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(documentId);

    transaction.oncomplete = () => finish(() => resolve());
    request.onerror = () => finish(() => reject(new Error(`Failed to delete document ${documentId}: ${request.error?.message || 'unknown error'}`)));
    transaction.onerror = () => finish(() => reject(new Error(`Failed to delete document ${documentId}: ${transaction.error?.message || 'unknown error'}`)));
  });
};

// Resolves the best available URL for a {id, file_url} record: the durable
// IndexedDB copy if one was saved (works after any reload), else whatever
// db.integrations.Core.UploadFile's file_url resolves to (a durable
// `steelos-upload:` reference resolves via uploadedFileStore.js; a data:
// URI or real hosted URL passes through unchanged; a dead legacy blob: URL
// resolves to null). Returns null when the file is genuinely unrecoverable
// — a record created before either store existed, whose blob: URL died the
// moment its tab closed.
export const resolveDocumentUrl = async (record) => {
  if (!record) return null;
  const stored = await getDocumentFileUrl(record.id);
  if (stored) return stored;
  return resolveUploadedFileUrl(record.file_url);
};
