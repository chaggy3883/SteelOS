// Promotes staged DetailerImportedPiece rows onto real PieceMark records.
// Mirrors this app's existing "staging -> real entity" idiom (hireCandidate
// in employeesApi.js, createProjectFromWonBid in BidDetail.jsx): manual
// field-by-field mapping, a back-reference written onto the staging row
// (piece_mark_id/committed, same role as candidate_profiles.hired_employee_id),
// and no rollback on partial failure (no transactions exist anywhere in this
// app — same posture as those two precedents).
//
// Uniqueness: PieceMark.piece_mark has no schema-level uniqueness constraint
// anywhere in this app; the one existing enforcement point (ProjectDetail.jsx's
// manual "Add Part" form) hard-blocks a case/whitespace-insensitive duplicate
// within the same project rather than auto-renaming it — there is no
// "-2"/"-R1" suffix convention to mirror. For an import-commit flow
// specifically, blocking outright would make re-importing a revised detailer
// file useless, so a normalized piece_mark match against an existing PieceMark
// in the same project is treated as an update target instead of a rejected
// duplicate.
//
// Stage 11: that update-target case is exactly a REVISION — a detailer
// re-exporting the same project can silently change a piece's dimensions,
// material, or quantity. detectRevisions surfaces those diffs up front so
// BatchReviewModal.jsx/RevisionCompareModal.jsx can require an explicit
// per-piece confirmation before commitBatch is allowed to touch them.
import { db } from '@/api/apiClient';
import { normalizeScanValue } from '@/lib/pieceScan';
import { logStatusChange } from '@/lib/statusHistory';
import { generatePiecePayload } from '@/lib/qrSerialization';

const PIECE_MARK_TEXT_FIELDS = ['assembly', 'material_grade', 'material_profile', 'finished_length', 'revision', 'drawing_number'];

const buildPieceMarkFields = (row) => {
  const fields = {};
  PIECE_MARK_TEXT_FIELDS.forEach((field) => {
    if (row[field]) fields[field] = row[field];
  });
  if (row.quantity != null) fields.quantity = row.quantity;
  if (row.weight != null) fields.weight_lbs = row.weight;
  return fields;
};

// Fields Stage 11 treats as a meaningful revision worth stopping for —
// "old vs new dimensions/material/quantity" per the prompt. Cosmetic fields
// (assembly, drawing_number, revision letter) are still updated by commit as
// before, just without gating on confirmation, since they were never part of
// the ask and gating on them too would make every routine re-export trigger
// the compare view.
export const REVISION_TRACKED_FIELDS = [
  { key: 'finished_length', label: 'Dimensions (Finished Length)' },
  { key: 'material_profile', label: 'Material Profile' },
  { key: 'material_grade', label: 'Material Grade' },
  { key: 'quantity', label: 'Quantity' },
];

const valuesDiffer = (a, b) => {
  const na = a == null ? '' : String(a).trim();
  const nb = b == null ? '' : String(b).trim();
  return na !== nb;
};

// Finds every staged row that matches an EXISTING PieceMark (same normalized
// piece_mark in this project — the same lookup commitBatch itself uses) AND
// differs from it on at least one tracked field. Rows with no existing match
// (brand new pieces) never appear here — only a genuinely changed existing
// piece needs the explicit confirmation this drives.
export const detectRevisions = async (batch, stagedRows) => {
  const existingPieceMarks = await db.entities.PieceMark.filter({ project_id: batch.project_id }, 'piece_mark', 5000);
  const existingByMark = new Map(existingPieceMarks.map((pm) => [normalizeScanValue(pm.piece_mark), pm]));

  const revisions = [];
  stagedRows.forEach((row) => {
    if (row.committed || row.validation_status === 'error') return;
    const existing = existingByMark.get(normalizeScanValue(row.piece_mark));
    if (!existing) return;

    const changes = REVISION_TRACKED_FIELDS
      .filter(({ key }) => row[key] != null && row[key] !== '' && valuesDiffer(existing[key], row[key]))
      .map(({ key, label }) => ({ field: key, label, oldValue: existing[key] ?? null, newValue: row[key] }));

    if (changes.length > 0) revisions.push({ row, pieceMark: existing, changes });
  });
  return revisions;
};

// Commits every row in stagedRows that isn't already committed and isn't
// validation_status 'error' (those are skipped — left for the source file to
// be fixed and re-parsed). Safe to call repeatedly on the same batch: already
// committed rows are skipped, so a second commit only picks up newly-fixed
// or newly-parsed rows.
//
// options.skipRowIds (Stage 11): DetailerImportedPiece ids identified by
// detectRevisions as changed but NOT confirmed by the user — left uncommitted
// entirely (same as an error row) rather than silently applied, so a later
// commit can revisit them once/if confirmed. options.changedBy feeds the
// StatusHistoryEntry logged for every tracked field that actually changes on
// an existing PieceMark (new PieceMark creates aren't "changes" and don't log
// one) — the automatic per-field AuditLog entry from PieceMark.update() still
// fires regardless, unconditionally, same as everywhere else in this app.
export const commitBatch = async (batch, stagedRows, options = {}) => {
  const { skipRowIds = new Set(), changedBy = 'Detailer Import' } = options;
  const existingPieceMarks = await db.entities.PieceMark.filter({ project_id: batch.project_id }, 'piece_mark', 5000);
  const existingByMark = new Map(existingPieceMarks.map((pm) => [normalizeScanValue(pm.piece_mark), pm]));
  // generatePiecePayload's projectLabel prefers project_number over a raw id
  // (see qrSerialization.js) — fall back to project_id if the project can't
  // be loaded so a QR code is still generated rather than blocking commit.
  const project = await db.entities.Project.get(batch.project_id).catch(() => null);
  const projectLabel = project?.project_number || batch.project_id;

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let revisionsSkipped = 0;

  for (const row of stagedRows) {
    if (row.committed) continue;
    if (row.validation_status === 'error') {
      skipped += 1;
      continue;
    }
    if (skipRowIds.has(row.id)) {
      revisionsSkipped += 1;
      continue;
    }

    const key = normalizeScanValue(row.piece_mark);
    const fields = buildPieceMarkFields(row);
    let pieceMark = existingByMark.get(key);

    if (pieceMark) {
      const previous = pieceMark;
      pieceMark = await db.entities.PieceMark.update(pieceMark.id, fields);
      updated += 1;

      const changedFields = Object.entries(fields).filter(([field, value]) => valuesDiffer(previous[field], value));
      await Promise.all(changedFields.map(([field, value]) => logStatusChange({
        entityType: 'PieceMark',
        entityId: pieceMark.id,
        fieldName: field,
        fromValue: previous[field] ?? null,
        toValue: value,
        changedBy,
        note: `Revised via detailer import batch — ${batch.detailer_name || batch.id}`,
      })));
    } else {
      pieceMark = await db.entities.PieceMark.create({
        project_id: batch.project_id,
        piece_mark: row.piece_mark,
        // Globally unique independent of piece_mark (which repeats across
        // projects by design) — see generatePiecePayload in qrSerialization.js.
        qr_payload_string: generatePiecePayload(projectLabel, row.piece_mark),
        ...fields,
      });
      existingByMark.set(key, pieceMark);
      created += 1;
    }

    await db.entities.DetailerImportedPiece.update(row.id, { committed: true, piece_mark_id: pieceMark.id });
  }

  const updatedBatch = await db.entities.DetailerImportBatch.update(batch.id, { import_status: 'committed' });

  return { created, updated, skipped, revisionsSkipped, batch: updatedBatch };
};
