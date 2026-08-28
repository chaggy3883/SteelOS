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
import { db } from '@/api/apiClient';
import { normalizeScanValue } from '@/lib/pieceScan';

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

// Commits every row in stagedRows that isn't already committed and isn't
// validation_status 'error' (those are skipped — left for the source file to
// be fixed and re-parsed). Safe to call repeatedly on the same batch: already
// committed rows are skipped, so a second commit only picks up newly-fixed
// or newly-parsed rows.
export const commitBatch = async (batch, stagedRows) => {
  const existingPieceMarks = await db.entities.PieceMark.filter({ project_id: batch.project_id }, 'piece_mark', 5000);
  const existingByMark = new Map(existingPieceMarks.map((pm) => [normalizeScanValue(pm.piece_mark), pm]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of stagedRows) {
    if (row.committed) continue;
    if (row.validation_status === 'error') {
      skipped += 1;
      continue;
    }

    const key = normalizeScanValue(row.piece_mark);
    const fields = buildPieceMarkFields(row);
    let pieceMark = existingByMark.get(key);

    if (pieceMark) {
      pieceMark = await db.entities.PieceMark.update(pieceMark.id, fields);
      updated += 1;
    } else {
      pieceMark = await db.entities.PieceMark.create({ project_id: batch.project_id, piece_mark: row.piece_mark, ...fields });
      existingByMark.set(key, pieceMark);
      created += 1;
    }

    await db.entities.DetailerImportedPiece.update(row.id, { committed: true, piece_mark_id: pieceMark.id });
  }

  const updatedBatch = await db.entities.DetailerImportBatch.update(batch.id, { import_status: 'committed' });

  return { created, updated, skipped, batch: updatedBatch };
};
