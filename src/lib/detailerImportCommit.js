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
import { isDrawingFile } from '@/lib/detailerImportParser';
import { getDetailerImportFileBlob } from '@/lib/detailerImportBlobStore';
import { matchFilenameToPiece, attachFileToPiece } from '@/lib/pieceFileIntake';
import { saveDocumentFile } from '@/lib/documentBlobStore';
import { findWholePieceRemnantMatches } from '@/lib/materialOptimizer';
import { propagateHeatNumberToPieces } from '@/lib/heatPropagation';
import { applyRemovalDecisions } from '@/lib/detailerImportRemovals';
import { syncShopPieces } from '@/lib/shopPieceSync';
import { expandAssemblyRows } from '@/lib/assemblyBom';

const PIECE_MARK_TEXT_FIELDS = ['assembly', 'material_grade', 'material_profile', 'finished_length', 'revision', 'drawing_number', 'assembly_mark', 'assembly_type', 'finish', 'sequence'];

const buildPieceMarkFields = (row) => {
  const fields = {};
  PIECE_MARK_TEXT_FIELDS.forEach((field) => {
    if (row[field]) fields[field] = row[field];
  });
  if (row.quantity != null) fields.quantity = row.quantity;
  if (row.weight != null) fields.weight_lbs = row.weight;
  // Only ever set when the reviewer explicitly picked one on this row (see
  // BatchReviewModal.jsx) — leaving it unset here means an existing
  // PieceMark's current sequence_area_id is left untouched on update, rather
  // than an unassigned staged row silently clearing it.
  if (row.sequence_area_id) fields.sequence_area_id = row.sequence_area_id;
  // Assembly BOM pieces (assemblyBom.js): which copy this is, plus the main
  // member and attached parts, carried on every copy.
  if (row.record_kind === 'assembly') {
    fields.item_type = 'Piece_Mark';
    fields.copy_number = row.copy_number || 1;
    fields.copy_count = row.copy_count || 1;
    if (row.main_member) fields.main_member = row.main_member;
    fields.parts = Array.isArray(row.parts) ? row.parts : [];
  }
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
export const detectRevisions = async (batch, stagedRowsIn) => {
  const stagedRows = expandAssemblyRows(stagedRowsIn);
  const existingPieceMarks = await db.entities.PieceMark.filter({ project_id: batch.project_id }, 'piece_mark', 100000);
  const existingByMark = new Map(existingPieceMarks.map((pm) => [normalizeScanValue(pm.piece_mark), pm]));

  const revisions = [];
  stagedRows.forEach((row) => {
    if (row.committed || row.validation_status === 'error') return;
    const existing = existingByMark.get(normalizeScanValue(row.piece_mark));
    if (!existing) return;

    const changes = REVISION_TRACKED_FIELDS
      .filter(({ key }) => row[key] != null && row[key] !== '' && valuesDiffer(existing[key], row[key]))
      .map(({ key, label }) => ({ field: key, label, oldValue: existing[key] ?? null, newValue: row[key] }));

    // A piece earlier put on hold / voided because it dropped out of a
    // detailer file (detailerImportRemovals.js) is back in this one —
    // never silently un-void it: surface it as a revision so the reviewer
    // confirms it, and commitBatch clears the hold/void only if confirmed.
    if (existing.removal_status) {
      changes.push({
        field: 'removal_status',
        label: 'Hold / Void',
        oldValue: existing.removal_status === 'voided' ? 'Voided (was removed from job)' : 'On hold',
        newValue: 'Back in the file — clear it',
      });
    }

    if (changes.length > 0) revisions.push({ row, pieceMark: existing, changes });
  });
  return revisions;
};

// QR lifecycle: for every staged row that's about to become a BRAND-NEW
// PieceMark (an existing-mark update never needs this — it already has a
// QR), check whether an on-hand unassigned remnant_inventory row is a close
// enough whole-piece match (materialOptimizer.js's findWholePieceRemnantMatches
// — shape+grade+length, reusing the same search this app already built for
// cut-plan remnant matching). Returns one candidate per matchable row —
// never two rows offered the same remnant — for BatchReviewModal.jsx to
// surface and let the reviewer accept or decline per piece before anything
// commits. skipRowIds (declined revisions) are excluded up front since those
// rows won't be committed at all this pass.
export const findInventoryMatches = async (batch, stagedRowsIn, skipRowIds = new Set()) => {
  // Copies of one assembly share a staged row id, so only single-copy
  // assemblies are offered a remnant match (matches are keyed by row id).
  const stagedRows = expandAssemblyRows(stagedRowsIn).filter((r) => !(r.copy_count > 1));
  const existingPieceMarks = await db.entities.PieceMark.filter({ project_id: batch.project_id }, 'piece_mark', 100000);
  const existingByMark = new Map(existingPieceMarks.map((pm) => [normalizeScanValue(pm.piece_mark), pm]));
  // status and is_assigned can drift apart (see findMatchingRemnants in
  // materialOptimizer.js) — filter on both here too rather than trusting
  // status alone, even though findWholePieceRemnantMatches below re-checks
  // is_assigned itself.
  const remnants = await db.entities.remnant_inventory.filter({ status: 'available', is_assigned: false }, '-created_date', 1000);

  const claimed = new Set();
  const matches = [];
  stagedRows.forEach((row) => {
    if (row.committed || row.validation_status === 'error' || skipRowIds.has(row.id)) return;
    if (existingByMark.has(normalizeScanValue(row.piece_mark))) return; // updates to an existing piece already have a QR

    const candidates = findWholePieceRemnantMatches(row, remnants.filter((r) => !claimed.has(r.id)));
    const best = candidates[0];
    if (best) {
      claimed.add(best.id);
      matches.push({ row, remnant: best });
    }
  });
  return matches;
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
// options.inventoryMatches (QR lifecycle): Map<DetailerImportedPiece.id,
// remnant_inventory.id> of matches from findInventoryMatches above that the
// reviewer explicitly accepted (BatchReviewModal.jsx's InventoryMatchModal).
// A row present here never calls generatePiecePayload — its new PieceMark
// inherits the remnant's existing qr_payload_string instead, and the remnant
// is flipped to assigned/consumed. A row absent here (no match found, or a
// match was found but declined) gets a normal freshly generated QR exactly
// as before this feature existed.
// options.removalDecisions: Map<PieceMark.id, 'keep'|'hold'|'void'> from
// detailerImportRemovals.js's detectRemovedPieces, as chosen by the reviewer
// in RevisionCompareModal.jsx — pieces in the job but missing from this
// file. Applied after the row loop via applyRemovalDecisions; 'keep' (and
// an empty map, the default) writes nothing. options.removalNote is an
// optional reviewer note appended to removal_reason.
export const commitBatch = async (batch, stagedRowsIn, options = {}) => {
  const { skipRowIds = new Set(), changedBy = 'Detailer Import', inventoryMatches = new Map(), removalDecisions = new Map(), removalNote = '' } = options;
  // Assembly BOM rows become one row per physical piece (2B2-1, 2B2-2 …).
  const stagedRows = expandAssemblyRows(stagedRowsIn);
  const existingPieceMarks = await db.entities.PieceMark.filter({ project_id: batch.project_id }, 'piece_mark', 100000);
  // New assembly pieces are saved in batches (one save per BATCH_SIZE, one
  // audit line per piece) — a BOM can add 2,000+ pieces at once.
  const pendingCreates = [];
  const stagedUpdates = new Map(); // staged row id -> { committed, piece_mark_id, piece_mark_ids }
  const noteStaged = (rowId, pieceMarkId) => {
    const entry = stagedUpdates.get(rowId) || { committed: true, piece_mark_id: pieceMarkId, piece_mark_ids: [] };
    if (pieceMarkId) entry.piece_mark_ids.push(pieceMarkId);
    stagedUpdates.set(rowId, entry);
  };
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
  let inventoryMatchesApplied = 0;

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
      const changedFields = Object.entries(fields).filter(([field, value]) => valuesDiffer(previous[field], value));
      // Only reachable for a held/voided piece when the reviewer confirmed
      // it as a revision (detectRevisions always flags one; unconfirmed rows
      // are in skipRowIds and never get here). Clearing is recorded by the
      // automatic AuditLog on this update — not a StatusHistoryEntry.
      const clearRemoval = previous.removal_status
        ? { removal_status: null, removal_reason: null, removal_decided_by: null, removal_decided_at: null, removal_batch_id: null }
        : {};
      pieceMark = await db.entities.PieceMark.update(pieceMark.id, { ...fields, ...clearRemoval });
      updated += 1;

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
      const matchedRemnantId = row.copy_count > 1 ? null : inventoryMatches.get(row.id);
      const matchedRemnant = matchedRemnantId ? await db.entities.remnant_inventory.get(matchedRemnantId).catch(() => null) : null;

      if (row.record_kind === 'assembly' && !matchedRemnant) {
        pendingCreates.push({
          rowId: row.id,
          key,
          data: { project_id: batch.project_id, piece_mark: row.piece_mark, qr_payload_string: generatePiecePayload(projectLabel, row.piece_mark), status: 'not_started', detailer_batch_id: batch.id, ...fields },
        });
        continue;
      }

      pieceMark = await db.entities.PieceMark.create({
        project_id: batch.project_id,
        piece_mark: row.piece_mark,
        // Globally unique independent of piece_mark (which repeats across
        // projects by design) — see generatePiecePayload in qrSerialization.js.
        // QR lifecycle: an accepted inventory match means this physical piece
        // already exists (it's the matched remnant) and already has a label
        // on it — carry that same payload forward instead of generating a
        // new one, which would leave two QR codes claiming the same steel.
        qr_payload_string: matchedRemnant ? matchedRemnant.qr_payload_string : generatePiecePayload(projectLabel, row.piece_mark),
        ...fields,
      });
      existingByMark.set(key, pieceMark);
      created += 1;

      if (matchedRemnant) {
        await db.entities.remnant_inventory.update(matchedRemnant.id, {
          is_assigned: true,
          assigned_project_id: batch.project_id,
          assigned_piece_mark_id: pieceMark.id,
          // Reuses the same 'consumed' status the older Stage 10 cut-plan
          // flow sets (materialOptimizationCommit.js) so this remnant drops
          // out of BOTH search paths at once — consumed_by_material_optimization_run_id
          // stays null here since no cut-plan run consumed it, is_assigned
          // is what distinguishes a whole-piece reuse from a cut-plan one.
          status: 'consumed',
          consumed_date: new Date().toISOString(),
        });
        // Same heat-propagation this remnant would get if a cut-plan run had
        // consumed it instead (materialOptimizationCommit.js) — its heat is
        // already known from when it was logged, unlike a freshly fabricated
        // piece whose heat isn't known until received/welded.
        if (matchedRemnant.heat_number_string) {
          await propagateHeatNumberToPieces([pieceMark.id], matchedRemnant.heat_number_string, {
            changedBy,
            source: { label: `inventory match — remnant ${matchedRemnant.id}` },
          });
        }
        inventoryMatchesApplied += 1;
      }
    }

    noteStaged(row.id, pieceMark.id);
  }

  const BATCH_SIZE = 500;
  for (let i = 0; i < pendingCreates.length; i += BATCH_SIZE) {
    const chunk = pendingCreates.slice(i, i + BATCH_SIZE);
    const made = await db.entities.PieceMark.bulkCreate(chunk.map((c) => c.data), { auditSummary: `detailer import ${batch.detailer_name || batch.id}` });
    made.forEach((pm, j) => {
      existingByMark.set(chunk[j].key, pm);
      noteStaged(chunk[j].rowId, pm.id);
    });
    created += made.length;
  }
  // A BOM row and a KSS row for the same assembly were merged into one —
  // mark both staged rows committed.
  stagedRows.forEach((r) => {
    const entry = stagedUpdates.get(r.id);
    if (!entry || !r._merged_row_ids) return;
    r._merged_row_ids.forEach((otherId) => { if (otherId !== r.id && !stagedUpdates.has(otherId)) stagedUpdates.set(otherId, entry); });
  });
  if (stagedUpdates.size) {
    await db.entities.DetailerImportedPiece.bulkUpdate([...stagedUpdates.entries()].map(([id, data]) => ({ id, data })));
  }

  // Drawing files uploaded alongside the BOM data in this same batch (PDFs,
  // or anything else non-parsable and not a CNC file — see isDrawingFile in
  // detailerImportParser.js) never produce staged rows of their own, so they
  // ride along here instead: match each to a PieceMark by filename using the
  // exact same algorithm PieceMarkPdfIntake.jsx uses for a standalone drop
  // (matchFilenameToPiece in pieceFileIntake.js), against the piece list this
  // same commit just created/updated — a piece created earlier in this loop
  // is matchable by a drawing later in the same batch. Best-effort: a file
  // that fails to load or attach is skipped rather than failing the commit.
  //
  // attachFileToPiece only writes into that PieceMark's own drawing store
  // (pieceMarkDocumentStore.js) — it never touched the project-wide Document
  // entity, so a committed drawing never showed up in the project's
  // Documents tab (FileExplorer.jsx/Documents.jsx both read db.entities
  // .Document, not a piece's attached-file list). Creating a Document row
  // here too, backed by the same already-fetched blob via documentBlobStore,
  // is additive — it doesn't change what's attached to the piece.
  const drawingFiles = (batch.uploaded_files || []).filter((f) => isDrawingFile(f.file_name));
  let drawingsMatched = 0;
  if (drawingFiles.length > 0) {
    const allPieceMarks = Array.from(existingByMark.values());
    for (const fileEntry of drawingFiles) {
      const matched = matchFilenameToPiece(allPieceMarks, fileEntry.file_name);
      if (!matched) continue;
      try {
        const blob = await getDetailerImportFileBlob(fileEntry.file_id);
        if (!blob) continue;
        await attachFileToPiece(matched, blob);
        const document = await db.entities.Document.create({
          project_id: batch.project_id,
          name: fileEntry.file_name,
          document_type: 'structural_drawing',
          file_name: fileEntry.file_name,
          file_size: blob.size,
          file_type: blob.type,
          status: 'uploaded',
          is_archived: false,
          description: `Detailer import drawing matched to piece mark ${matched.piece_mark}`,
        });
        await saveDocumentFile(document.id, blob);
        drawingsMatched += 1;
      } catch (error) {
        console.error(error);
      }
    }
  }

  const { held: removalsHeld, voided: removalsVoided } = await applyRemovalDecisions(batch, removalDecisions, { changedBy, note: removalNote });

  const updatedBatch = await db.entities.DetailerImportBatch.update(batch.id, { import_status: 'committed' });
  // New / renamed pieces get their shop-floor rows (Shop Fabrication scanning).
  await syncShopPieces({ projectId: batch.project_id });

  return { created, updated, skipped, revisionsSkipped, drawingsMatched, inventoryMatchesApplied, removalsHeld, removalsVoided, batch: updatedBatch };
};
