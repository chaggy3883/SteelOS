import { BUILTIN_ROLES, normalizeRoleName } from '@/components/dashboard/rbacConfig';

// Restoring an archived Document undoes another user's "Remove" action
// across every module that surfaces documents (Documents page, RFI/
// Submittal/Bid attachment lists) — kept to the same elevated, HR-adjacent
// tier as disciplinaryAccess.js's gate rather than opened to every role that
// can remove a document in the first place. Names are checked against
// BUILTIN_ROLES so this can never silently drift from the roles that
// actually exist, matching materialCatalogAccess.js's convention.
export const DOCUMENT_ARCHIVE_ALLOWED_ROLES = ['admin', 'super_admin', 'hr_admin'];

const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!DOCUMENT_ARCHIVE_ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('documentArchiveAccess.js: DOCUMENT_ARCHIVE_ALLOWED_ROLES references a role name not present in BUILTIN_ROLES.');
}

export const hasDocumentArchiveAccess = (roles) =>
  (roles || []).some((r) => DOCUMENT_ARCHIVE_ALLOWED_ROLES.includes(normalizeRoleName(r)));
