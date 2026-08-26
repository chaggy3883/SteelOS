import { db } from '@/api/apiClient';

// Every db.entities.*.create/update/delete call already gets an automatic,
// immutable, field-level AuditLog row written by logAuditChange() in
// src/api/localData.js — that already covers "what changed and who changed
// it" for every VendorBill, InvoiceReceivable, ProjectJobCostSummary, and
// Project write in the app. This helper is NOT a replacement for that; it
// exists only to capture the one thing the generic per-field differ cannot:
// *why* a gated financial override happened. Call it only at those
// reason-bearing gate points (a closed-period bypass, a paid invoice's
// dollar fields changing, a job-cost row's soft-delete) — not on every
// ordinary save, or every mutation would get logged twice.
export async function logFinancialOverride({ entityType, entityId, action, reason, changedBy }) {
  return db.entities.AuditLog.create({
    entity_type: entityType,
    entity_id: entityId,
    action,
    change_summary: reason,
    user_id: changedBy?.id || null,
    user_name: changedBy?.full_name || changedBy?.email || 'Unknown',
    user_email: changedBy?.email || null,
  });
}
