// "Removed from the model" detection for detailer re-imports.
//
// commitBatch (detailerImportCommit.js) only ever creates or updates — a
// piece mark that was in an earlier detailer file but is missing from the new
// one was silently left live, so it could still get cut and shipped. This
// finds those pieces up front so RevisionCompareModal.jsx can ask the
// reviewer, per piece, to Keep / Put on hold / Void before anything commits.
// Nothing here writes; the chosen decisions are applied by commitBatch via
// options.removalDecisions, after the reviewer confirms.
//
// SCOPE — deliberately conservative, because a false "removed" flag on a
// partial export would put good steel on hold. A PieceMark is only a
// candidate when ALL of these hold:
//  1. Same project as the batch.
//  2. It came from a detailer file before: some committed
//     DetailerImportedPiece row (any batch) points at it via piece_mark_id.
//     Manually added parts, bolts, misc pieces never imported from a
//     detailer are never flagged.
//  3. That earlier import was from the SAME detailer (normalized
//     detailer_name) — a project split between a main-steel detailer and a
//     misc-metals detailer must not flag the other detailer's pieces.
//  4. Same sequence/area coverage as the new file: if the batch or any of its
//     staged rows names a sequence_area_id, only pieces currently in one of
//     those areas are candidates. If the whole file is unassigned and the
//     project HAS sequence/areas, only unassigned pieces are candidates (an
//     unassigned upload on a phased job can't be presumed to cover every
//     area). If the project has no sequence/areas at all, the whole project
//     (still limited by 1–3) is in scope.
//  5. Not already voided, and its normalized piece_mark is not on ANY staged
//     row of the new file (error rows included — an error row is still "in
//     the file", just not committable yet).
import { db } from '@/api/apiClient';
import { normalizeScanValue } from '@/lib/pieceScan';

export const REMOVAL_STATUS = { ON_HOLD: 'on_hold', VOIDED: 'voided' };
export const REMOVAL_DECISION = { KEEP: 'keep', HOLD: 'hold', VOID: 'void' };

// The one check list views use to drop voided pieces (Shipping.jsx,
// MaterialOptimization.jsx, etc.). On-hold pieces stay visible on purpose —
// a hold is "don't touch yet", not "gone".
export const isVoidedPieceMark = (pieceMark) => pieceMark?.removal_status === REMOVAL_STATUS.VOIDED;

const normName = (value) => String(value || '').trim().toLowerCase();

// "Already being fabricated" = the office status has moved past
// not_started, OR a shop-floor `pieces` row is bridged to it (the shop has
// physically started tracking it even if PieceMark.status lags behind).
export const isPastNotStarted = (pieceMark, shopPieces = []) => {
  const status = pieceMark.status || 'not_started';
  return status !== 'not_started' || shopPieces.length > 0;
};

// Above this share of in-scope pieces missing, the new file looks like a
// partial export (one sequence, one drawing set) rather than a real model
// change — every default flips to Keep and the modal warns loudly.
const PARTIAL_EXPORT_RATIO = 0.5;

export const detectRemovedPieces = async (batch, stagedRows) => {
  const [existingPieceMarks, projectBatches, committedRows, sequenceAreas] = await Promise.all([
    db.entities.PieceMark.filter({ project_id: batch.project_id }, 'piece_mark', 5000),
    db.entities.DetailerImportBatch.filter({ project_id: batch.project_id }, '-created_date', 500),
    db.entities.DetailerImportedPiece.filter({ project_id: batch.project_id, committed: true }, 'piece_mark', 20000),
    db.entities.ProjectSequenceArea.filter({ project_id: batch.project_id }, 'sort_order', 200).catch(() => []),
  ]);

  const detailer = normName(batch.detailer_name);
  const sameDetailerBatchIds = new Set(projectBatches.filter((b) => normName(b.detailer_name) === detailer).map((b) => b.id));
  sameDetailerBatchIds.add(batch.id);
  const importedPieceMarkIds = new Set(
    committedRows.filter((r) => r.piece_mark_id && sameDetailerBatchIds.has(r.batch_id)).map((r) => r.piece_mark_id),
  );

  const coveredAreaIds = new Set([batch.sequence_area_id, ...stagedRows.map((r) => r.sequence_area_id)].filter(Boolean));
  const projectHasAreas = sequenceAreas.length > 0;
  const inAreaScope = (pm) => {
    if (coveredAreaIds.size > 0) return coveredAreaIds.has(pm.sequence_area_id);
    if (projectHasAreas) return !pm.sequence_area_id;
    return true;
  };

  const marksInFile = new Set(stagedRows.map((r) => normalizeScanValue(r.piece_mark)).filter(Boolean));

  const inScope = existingPieceMarks.filter((pm) => importedPieceMarkIds.has(pm.id) && !isVoidedPieceMark(pm) && inAreaScope(pm));
  const missing = inScope.filter((pm) => !marksInFile.has(normalizeScanValue(pm.piece_mark)));

  const shopPieces = missing.length > 0
    ? await db.entities.pieces.filter({ piece_mark_id: { $in: missing.map((pm) => pm.id) } }, '-created_date', 5000).catch(() => [])
    : [];
  const shopByMarkId = new Map();
  shopPieces.forEach((p) => {
    if (!shopByMarkId.has(p.piece_mark_id)) shopByMarkId.set(p.piece_mark_id, []);
    shopByMarkId.get(p.piece_mark_id).push(p);
  });

  const partialSuspected = inScope.length > 0 && missing.length / inScope.length > PARTIAL_EXPORT_RATIO;

  const removed = missing.map((pieceMark) => {
    const shop = shopByMarkId.get(pieceMark.id) || [];
    const inShop = isPastNotStarted(pieceMark, shop);
    const alreadyOnHold = pieceMark.removal_status === REMOVAL_STATUS.ON_HOLD;
    // Keep for anything the shop has touched, anything already on hold
    // (Keep leaves the hold in place), and everything when the file looks
    // partial. Otherwise Put on hold — never Void by default: void is the
    // reviewer's explicit call, hold is reversible.
    const defaultDecision = inShop || alreadyOnHold || partialSuspected ? REMOVAL_DECISION.KEEP : REMOVAL_DECISION.HOLD;
    return { pieceMark, shopPieces: shop, inShop, alreadyOnHold, defaultDecision };
  });

  const areaNames = sequenceAreas.filter((a) => coveredAreaIds.has(a.id)).map((a) => a.name);
  let scopeLabel;
  if (coveredAreaIds.size > 0) scopeLabel = `pieces from ${batch.detailer_name || 'this detailer'} in ${areaNames.join(', ') || 'the same sequence/area'}`;
  else if (projectHasAreas) scopeLabel = `unassigned pieces from ${batch.detailer_name || 'this detailer'}`;
  else scopeLabel = `pieces from ${batch.detailer_name || 'this detailer'} on this job`;

  return { removed, inScopeCount: inScope.length, partialSuspected, scopeLabel };
};

// Applied by commitBatch only — decisions is Map<PieceMark.id, 'keep'|'hold'|'void'>.
// Keep writes nothing. Hold/Void write the removal_* fields via a single
// PieceMark.update, whose per-field AuditLog rows come from localData.js
// automatically. PieceMark.status is left untouched so the shop's real
// progress (e.g. "fabricated") is preserved alongside the hold/void.
export const applyRemovalDecisions = async (batch, decisions, { changedBy, note } = {}) => {
  let held = 0;
  let voided = 0;
  const fileNames = (batch.uploaded_files || []).map((f) => f.file_name).filter(Boolean).join(', ');
  const reason = [
    `Not in detailer file from ${batch.detailer_name || 'detailer'}${fileNames ? ` (${fileNames})` : ''}`,
    note ? note.trim() : null,
  ].filter(Boolean).join(' — ');

  for (const [pieceMarkId, decision] of decisions) {
    if (decision !== REMOVAL_DECISION.HOLD && decision !== REMOVAL_DECISION.VOID) continue;
    const removalStatus = decision === REMOVAL_DECISION.VOID ? REMOVAL_STATUS.VOIDED : REMOVAL_STATUS.ON_HOLD;
    await db.entities.PieceMark.update(pieceMarkId, {
      removal_status: removalStatus,
      removal_reason: reason,
      removal_decided_by: changedBy || 'Unknown',
      removal_decided_at: new Date().toISOString(),
      removal_batch_id: batch.id,
    });
    if (removalStatus === REMOVAL_STATUS.VOIDED) voided += 1; else held += 1;
  }
  return { held, voided };
};
