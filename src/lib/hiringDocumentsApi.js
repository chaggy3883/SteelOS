import { db } from '@/api/apiClient';
import {
  createHiringDocumentId,
  saveHiringDocument,
  getHiringDocument,
  getHiringDocumentBlob,
  deleteHiringDocument as deleteBlob,
} from '@/lib/hiringDocumentStore';

export const HIRING_DOCUMENT_TYPES = ['Resume', 'Application', 'Cover_Letter', 'Other'];

// The one place that knows which entity/id-field/key-prefix a candidate vs.
// an employee's hiring documents use — every function below dispatches off
// this instead of re-deriving it, so the two owners can never drift apart.
const OWNER_CONFIG = {
  candidate: { entity: 'candidate_documents', idField: 'candidate_id', keyPrefix: 'candidate' },
  employee: { entity: 'employee_hiring_documents', idField: 'employee_id', keyPrefix: 'employee' },
};

export async function listHiringDocuments(ownerType, ownerId) {
  if (!ownerId) return [];
  const { entity, idField } = OWNER_CONFIG[ownerType];
  return db.entities[entity].filter({ [idField]: ownerId }, '-created_date', 100);
}

export async function uploadHiringDocument(ownerType, ownerId, documentType, file, uploadedBy) {
  const { entity, idField, keyPrefix } = OWNER_CONFIG[ownerType];
  const blob_key = `${keyPrefix}/${ownerId}/${createHiringDocumentId()}`;
  const created = await db.entities[entity].create({
    [idField]: ownerId,
    document_type: documentType,
    file_name: file.name,
    blob_key,
    uploaded_date: new Date().toISOString().slice(0, 10),
    uploaded_by: uploadedBy || 'Unknown',
  });
  await saveHiringDocument(blob_key, file);
  return created;
}

// Fresh object URL for viewing/downloading — caller owns it (same convention
// as hiringDocumentStore.js's getHiringDocument).
export async function openHiringDocument(doc) {
  return getHiringDocument(doc.blob_key);
}

export async function removeHiringDocument(ownerType, doc) {
  const { entity } = OWNER_CONFIG[ownerType];
  await deleteBlob(doc.blob_key);
  await db.entities[entity].delete(doc.id);
}

// The hire-decision provisioning step for documents: moves every
// candidate_documents row for candidateId into employee_hiring_documents for
// employeeId, re-keying each blob (IndexedDB has no rename), then removes the
// original candidate-side row/blob so this is a move, not a copy. Called by
// hireCandidate() (src/lib/employeesApi.js) — never call this without also
// provisioning the employee record, or documents move with nothing to land on.
export async function moveCandidateDocumentsToEmployee(candidateId, employeeId) {
  const docs = await listHiringDocuments('candidate', candidateId);
  for (const doc of docs) {
    const blob = await getHiringDocumentBlob(doc.blob_key);
    const newKey = `employee/${employeeId}/${createHiringDocumentId()}`;
    if (blob) await saveHiringDocument(newKey, blob);
    await db.entities.employee_hiring_documents.create({
      employee_id: employeeId,
      document_type: doc.document_type,
      file_name: doc.file_name,
      blob_key: newKey,
      uploaded_date: doc.uploaded_date,
      uploaded_by: doc.uploaded_by,
      note: 'Uploaded during hiring',
    });
    await deleteBlob(doc.blob_key);
    await db.entities.candidate_documents.delete(doc.id);
  }
}

// The reject-decision "keep documents = no" path — permanently removes every
// candidate_documents row and blob for candidateId.
export async function deleteAllCandidateDocuments(candidateId) {
  const docs = await listHiringDocuments('candidate', candidateId);
  for (const doc of docs) {
    await deleteBlob(doc.blob_key);
    await db.entities.candidate_documents.delete(doc.id);
  }
}
