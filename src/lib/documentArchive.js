import { db } from '@/api/apiClient';

// Soft-delete only, mirroring the is_archived convention already used for
// Project/Bid archiving (Projects.jsx's archiveProject) — the Document
// record, its AuditLog trail, and its underlying blob (documentBlobStore)
// are never destroyed. An admin/hr_admin can restore via Documents.jsx's
// "Show Archived" toggle (see documentArchiveAccess.js).
//
// Submittal.other_attachment_ids is the only array-of-Document-id field in
// the schema (checked schema/entities/*.jsonc) — RFI/PurchaseOrder/VendorBill
// instead link back via a single FK stored ON the Document itself
// (rfi_id/po_id/vendor_bill_id), and every place that lists a Document by
// one of those FKs already filters out is_archived rows, so archiving the
// Document alone is enough to drop it from those lists without touching
// anything on the other side.
export async function archiveDocument(doc) {
  await db.entities.Document.update(doc.id, { is_archived: true });

  if (doc.project_id) {
    const submittals = await db.entities.Submittal.filter({ project_id: doc.project_id }, '-created_date', 500);
    const affected = submittals.filter((s) => (s.other_attachment_ids || []).includes(doc.id));
    for (const s of affected) {
      await db.entities.Submittal.update(s.id, {
        other_attachment_ids: s.other_attachment_ids.filter((id) => id !== doc.id),
      });
    }
  }
}

export async function restoreDocument(doc) {
  await db.entities.Document.update(doc.id, { is_archived: false });
}
