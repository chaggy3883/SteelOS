// One way drawings get onto pieces, wherever they're uploaded (Detailer
// Imports, Project → Pieces, Parts & Hardware) and whenever — before or
// after the pieces themselves exist.
//
//  fileDrawings()          each file -> matched piece(s)/assembly/part now,
//                          or a new piece (if asked), or HELD on the project
//                          ("waiting for a piece") with its area/sequence.
//  resolveWaitingDrawings() re-checks held drawings — called whenever pieces
//                          are added (detailer commit, Pieces tab submit,
//                          opening the project's Pieces tab).
//  assign / make piece / keep as project document / delete — what a person
//                          can do with a held drawing nobody can match.
//
// Every filed drawing gets a ProjectDrawing record (the project's drawing
// register): what came in, from where, for which area, and where it went.
// Held drawings keep their file in the detailer-import file store until
// they're attached.
//
// Real-life handling: same file twice -> skipped as a duplicate; a newer
// revision of a drawing -> becomes the current one, the old one is kept but
// marked replaced (and pieces already in the shop are called out); an older
// revision uploaded late doesn't replace a newer one; a file the browser
// can't read (network drive) -> that file errors, the rest carry on.

import { db } from '@/api/apiClient';
import { createDocumentId, getDocumentRecords, saveDocumentRecords, deleteDocumentRecords } from '@/lib/pieceMarkDocumentStore';
import { readFileIntoMemory, saveDetailerImportFile, getDetailerImportFileBlob, deleteDetailerImportFile, createDetailerImportFileId } from '@/lib/detailerImportBlobStore';
import { saveDocumentFile } from '@/lib/documentBlobStore';
import { createPieceFromFile } from '@/lib/pieceFileIntake';
import { buildDrawingIndex, matchDrawing, parseDrawingFileName, compareRevisions } from '@/lib/drawingMatch';
import { isDrawingFile } from '@/lib/detailerImportParser';
import { syncShopPieces } from '@/lib/shopPieceSync';

const CHUNK = 500;
const nowIso = () => new Date().toISOString();

const loadProjectPieces = (projectId) => db.entities.PieceMark.filter({ project_id: projectId }, 'piece_mark', 100000);

const asFile = (blob, name) => {
  if (typeof File === 'function' && blob instanceof File && blob.name === name) return blob;
  return typeof File === 'function' ? new File([blob], name, { type: blob.type || '' }) : blob;
};

const isInShop = (p) => p?.status && p.status !== 'not_started';

// Adds one file to one drawing list (one assembly / piece / part).
// -> { state: 'attached'|'duplicate', replaced: [filenames], older: bool }
export async function attachDrawingToKey(key, blob, { fileName, source = '', partMark = null } = {}) {
  const existing = await getDocumentRecords(key);
  if (existing.some((d) => d.filename === fileName && d.size === blob.size)) return { state: 'duplicate', replaced: [], older: false };

  const { base, revision } = parseDrawingFileName(fileName);
  const sameDrawing = (d) => !d.superseded && parseDrawingFileName(d.filename).base.toUpperCase() === base.toUpperCase();
  const current = existing.filter(sameDrawing);
  const doc = {
    id: createDocumentId(),
    filename: fileName,
    mimetype: blob.type || 'application/pdf',
    size: blob.size,
    uploadDate: nowIso(),
    blob,
    revision: revision || '',
    source,
    ...(partMark ? { part_mark: partMark } : {}),
  };
  // A newer revision is already on file -> this late, older one is kept but
  // doesn't become current.
  const newer = current.find((d) => compareRevisions(d.revision || parseDrawingFileName(d.filename).revision, revision) > 0);
  let next;
  let replaced = [];
  if (newer) {
    next = [...existing, { ...doc, superseded: true, superseded_by: newer.id }];
  } else {
    replaced = current.map((d) => d.filename);
    next = [...existing.map((d) => (sameDrawing(d) ? { ...d, superseded: true, superseded_by: doc.id } : d)), doc];
  }
  await saveDocumentRecords(key, next);
  return { state: 'attached', replaced, older: !!newer };
}

// Moves every drawing from one list into another (a piece made from a
// drawing that a detailer import later takes over as an assembly copy).
export async function mergeDrawingKeys(fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return;
  const from = await getDocumentRecords(fromKey);
  if (!from.length) return;
  const to = await getDocumentRecords(toKey);
  const merged = [...to, ...from.filter((d) => !to.some((t) => t.filename === d.filename && t.size === d.size))];
  await saveDocumentRecords(toKey, merged);
  await deleteDocumentRecords(fromKey);
}

async function addProjectDocument(projectId, fileName, blob, description) {
  const document = await db.entities.Document.create({
    project_id: projectId,
    name: fileName,
    document_type: 'structural_drawing',
    file_name: fileName,
    file_size: blob.size,
    file_type: blob.type,
    status: 'uploaded',
    is_archived: false,
    description,
  });
  await saveDocumentFile(document.id, blob);
  return document;
}

// Attach a blob to every matched target. -> summary for the result line.
async function attachToTargets(match, blob, { fileName, source }) {
  let attached = 0;
  let duplicates = 0;
  const replaced = [];
  let older = false;
  const inShopReplaced = [];
  for (const t of match.targets) {
    const out = await attachDrawingToKey(t.key, blob, { fileName, source, partMark: t.partMark || null });
    if (out.state === 'duplicate') { duplicates += 1; continue; }
    attached += 1;
    if (out.older) older = true;
    if (out.replaced.length) {
      replaced.push(...out.replaced);
      t.pieces.filter(isInShop).forEach((p) => inShopReplaced.push(p.piece_mark));
    }
  }
  return { attached, duplicates, replaced, older, inShopReplaced };
}

const describeTargets = (targets) => targets.map((t) => t.label);

function attachMessage(match, out) {
  const where = describeTargets(match.targets).join(', ');
  if (!out.attached && out.duplicates) return { state: 'duplicate', message: `Already on ${where}` };
  const notes = [];
  if (out.older) notes.push('a newer revision is already on file, so this one is kept as an older revision');
  if (out.replaced.length) notes.push(`replaces ${[...new Set(out.replaced)].join(', ')}`);
  if (out.inShopReplaced.length) notes.push(`already in the shop: ${[...new Set(out.inShopReplaced)].slice(0, 6).join(', ')} — check against the new revision`);
  return { state: 'attached', message: `Attached to ${where}`, note: notes.join('; '), warning: out.inShopReplaced.length > 0 };
}

// Pieces with no area/sequence get the one the drawing was uploaded for.
function collectAreaFill(areaFill, targets, sequenceAreaId) {
  if (!sequenceAreaId) return;
  targets.filter((t) => t.via !== 'part').forEach((t) => t.pieces.forEach((p) => {
    if (!p.sequence_area_id && !areaFill.has(p.id)) areaFill.set(p.id, sequenceAreaId);
  }));
}

async function applyAreaFill(areaFill) {
  if (!areaFill.size) return;
  const updates = [...areaFill.entries()].map(([id, sequence_area_id]) => ({ id, data: { sequence_area_id } }));
  for (let i = 0; i < updates.length; i += CHUNK) await db.entities.PieceMark.bulkUpdate(updates.slice(i, i + CHUNK));
}

async function saveRecords(records) {
  for (let i = 0; i < records.length; i += CHUNK) {
    await db.entities.ProjectDrawing.bulkCreate(records.slice(i, i + CHUNK), { auditSummary: 'drawing upload' });
  }
}

// items: [{ file? | blobId?, fileName?, markOverride?, sequenceAreaId?,
//           action?: 'hold' | 'create', create?: { itemType, quantity } }]
//   file: a dropped File (read into memory first); blobId: a file already in
//   the detailer-import file store (Detailer Imports batches).
//   action 'create': no match -> make a new piece from it (Pieces tab's
//   choice); default 'hold' -> keep it waiting on the project.
// -> { results: [{ fileName, state, message, note?, warning? }], created: [PieceMark], counts }
export async function fileDrawings({ project, projectId, items, source = '', batchId = null, uploadedBy = '', alsoProjectDocument = false, onProgress } = {}) {
  const pid = projectId || project?.id;
  if (!pid) throw new Error('Pick a project first.');
  const pieces = await loadProjectPieces(pid);
  let index = buildDrawingIndex(pieces, pid);
  const records = [];
  const results = [];
  const created = [];
  const areaFill = new Map();
  const counts = { attached: 0, waiting: 0, created: 0, duplicate: 0, error: 0 };

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const fileName = item.fileName || item.file?.name || 'drawing';
    onProgress?.(i + 1, items.length);
    const base = {
      project_id: pid,
      file_name: fileName,
      source,
      batch_id: batchId,
      batch_file_id: item.blobId || null,
      sequence_area_id: item.sequenceAreaId || null,
      mark_override: item.markOverride || '',
      uploaded_by: uploadedBy,
      uploaded_at: nowIso(),
      also_project_document: !!alsoProjectDocument,
    };
    try {
      const blob = item.file ? await readFileIntoMemory(item.file) : await getDetailerImportFileBlob(item.blobId);
      if (!blob) throw new Error('The uploaded file is missing from this browser.');
      base.file_size = blob.size;
      base.file_type = blob.type || '';
      base.revision = parseDrawingFileName(fileName).revision;
      const match = matchDrawing(index, fileName, item.markOverride);

      if (match.targets.length) {
        const out = await attachToTargets(match, blob, { fileName, source });
        const msg = attachMessage(match, out);
        collectAreaFill(areaFill, match.targets, item.sequenceAreaId);
        if (alsoProjectDocument && out.attached) await addProjectDocument(pid, fileName, blob, `Drawing for ${describeTargets(match.targets).join(', ')}`).catch(() => {});
        records.push({ ...base, status: msg.state === 'duplicate' ? 'duplicate' : 'attached', attached_to: describeTargets(match.targets), attached_keys: match.targets.map((t) => t.key), attached_at: nowIso(), note: msg.note || '' });
        results.push({ fileName, ...msg });
        counts[msg.state === 'duplicate' ? 'duplicate' : 'attached'] += 1;
      } else if (item.action === 'create') {
        const mark = String(item.markOverride || parseDrawingFileName(fileName).base).trim();
        if (!mark) throw new Error('Enter a piece mark.');
        const piece = await createPieceFromFile({
          project: project || { id: pid },
          file: asFile(blob, fileName),
          itemType: item.create?.itemType || 'Piece_Mark',
          markOverride: mark,
          quantity: item.create?.quantity,
          sequenceAreaId: item.sequenceAreaId,
        });
        pieces.push(piece);
        index = buildDrawingIndex(pieces, pid);
        created.push(piece);
        records.push({ ...base, status: 'attached', attached_to: [piece.piece_mark], attached_at: nowIso(), note: 'New piece made from this drawing' });
        results.push({ fileName, state: 'created', message: `New piece ${piece.piece_mark}` });
        counts.created += 1;
      } else {
        let blobId = item.blobId;
        let owns = false;
        if (!blobId) {
          blobId = createDetailerImportFileId();
          await saveDetailerImportFile(blobId, asFile(blob, fileName));
          owns = true;
        }
        records.push({ ...base, status: 'waiting', blob_id: blobId, owns_blob: owns });
        const looked = item.markOverride ? item.markOverride : parseDrawingFileName(fileName).base;
        results.push({ fileName, state: 'waiting', message: `Waiting for piece ${looked}` });
        counts.waiting += 1;
      }
    } catch (e) {
      results.push({ fileName, state: 'error', message: e?.message || 'Could not save this file.' });
      counts.error += 1;
    }
  }

  await saveRecords(records);
  await applyAreaFill(areaFill);
  return { results, created, counts };
}

// Detailer Imports: file every drawing in a batch that hasn't been filed
// yet (drawings ride in the batch's file store; nothing is copied while they
// wait). Safe to call again — already-filed files are skipped.
export async function fileBatchDrawings(batch, { uploadedBy = '' } = {}) {
  const files = (batch?.uploaded_files || []).filter((f) => isDrawingFile(f.file_name));
  if (!files.length) return { results: [], created: [], counts: { attached: 0, waiting: 0, created: 0, duplicate: 0, error: 0 } };
  const filed = await db.entities.ProjectDrawing.filter({ batch_id: batch.id }, '-created_date', 100000);
  const done = new Set(filed.map((r) => r.batch_file_id));
  const items = files.filter((f) => !done.has(f.file_id)).map((f) => ({ blobId: f.file_id, fileName: f.file_name, sequenceAreaId: batch.sequence_area_id || null }));
  if (!items.length) return { results: [], created: [], counts: { attached: 0, waiting: 0, created: 0, duplicate: 0, error: 0 } };
  return fileDrawings({ projectId: batch.project_id, items, source: 'detailer_import', batchId: batch.id, uploadedBy, alsoProjectDocument: true });
}

// Try one held drawing against the current pieces. -> update data or null.
async function tryAttachWaiting(rec, index, areaFill) {
  const match = matchDrawing(index, rec.file_name, rec.mark_override);
  if (!match.targets.length) return null;
  const blob = await getDetailerImportFileBlob(rec.blob_id);
  if (!blob) return { status: 'error', note: 'The held file is no longer in this browser — upload it again.' };
  const out = await attachToTargets(match, blob, { fileName: rec.file_name, source: rec.source });
  const msg = attachMessage(match, out);
  collectAreaFill(areaFill, match.targets, rec.sequence_area_id);
  if (rec.also_project_document && out.attached) await addProjectDocument(rec.project_id, rec.file_name, blob, `Drawing for ${describeTargets(match.targets).join(', ')}`).catch(() => {});
  if (rec.owns_blob) await deleteDetailerImportFile(rec.blob_id).catch(() => {});
  return {
    status: msg.state === 'duplicate' ? 'duplicate' : 'attached',
    attached_to: describeTargets(match.targets),
    attached_keys: match.targets.map((t) => t.key),
    attached_at: nowIso(),
    note: msg.note || '',
    blob_id: rec.owns_blob ? null : rec.blob_id,
  };
}

// Re-check every held drawing on a project against its pieces now.
// -> { attached, still: number waiting, results: [{ fileName, message }] }
export async function resolveWaitingDrawings(projectId) {
  if (!projectId) return { attached: 0, still: 0, results: [] };
  const waiting = await db.entities.ProjectDrawing.filter({ project_id: projectId, status: 'waiting' }, '-created_date', 100000);
  if (!waiting.length) return { attached: 0, still: 0, results: [] };
  const pieces = await loadProjectPieces(projectId);
  if (!pieces.length) return { attached: 0, still: waiting.length, results: [] };
  const index = buildDrawingIndex(pieces, projectId);
  const areaFill = new Map();
  const updates = [];
  const results = [];
  for (const rec of waiting) {
    try {
      const data = await tryAttachWaiting(rec, index, areaFill);
      if (!data) continue;
      updates.push({ id: rec.id, data });
      results.push({ fileName: rec.file_name, message: data.status === 'error' ? data.note : `Attached to ${(data.attached_to || []).join(', ')}` });
    } catch (e) {
      results.push({ fileName: rec.file_name, message: e?.message || 'Could not attach' });
    }
  }
  for (let i = 0; i < updates.length; i += CHUNK) await db.entities.ProjectDrawing.bulkUpdate(updates.slice(i, i + CHUNK));
  await applyAreaFill(areaFill);
  const attached = updates.filter((u) => u.data.status === 'attached' || u.data.status === 'duplicate').length;
  return { attached, still: waiting.length - attached, results };
}

// A person says which piece(s) a held drawing is for ("2B9" or "2B9, 2B10").
export async function assignWaitingDrawing(rec, marks) {
  const pieces = await loadProjectPieces(rec.project_id);
  const index = buildDrawingIndex(pieces, rec.project_id);
  const areaFill = new Map();
  const data = await tryAttachWaiting({ ...rec, mark_override: marks }, index, areaFill);
  if (!data) {
    // Remember the mark: it attaches by itself once that piece is added.
    return db.entities.ProjectDrawing.update(rec.id, { mark_override: marks, note: `No piece "${marks}" yet — will attach when it's added` });
  }
  await applyAreaFill(areaFill);
  return db.entities.ProjectDrawing.update(rec.id, { ...data, mark_override: marks });
}

// Make a new piece from a held drawing (a piece that won't come from a detailer file).
export async function createPieceFromWaiting(rec, project, mark) {
  const blob = await getDetailerImportFileBlob(rec.blob_id);
  if (!blob) throw new Error('The held file is no longer in this browser — upload it again.');
  const piece = await createPieceFromFile({ project, file: asFile(blob, rec.file_name), itemType: 'Piece_Mark', markOverride: mark || parseDrawingFileName(rec.file_name).base, sequenceAreaId: rec.sequence_area_id });
  if (rec.owns_blob) await deleteDetailerImportFile(rec.blob_id).catch(() => {});
  await db.entities.ProjectDrawing.update(rec.id, { status: 'attached', attached_to: [piece.piece_mark], attached_at: nowIso(), note: 'New piece made from this drawing', blob_id: rec.owns_blob ? null : rec.blob_id });
  syncShopPieces({ projectId: rec.project_id }); // shop-floor row for scanning
  return piece;
}

// Not a piece drawing (erection drawing, general notes, a combined set) —
// file it with the project's documents instead.
export async function keepWaitingAsProjectDocument(rec) {
  const blob = await getDetailerImportFileBlob(rec.blob_id);
  if (!blob) throw new Error('The held file is no longer in this browser — upload it again.');
  await addProjectDocument(rec.project_id, rec.file_name, blob, 'Project drawing (not a piece drawing)');
  if (rec.owns_blob) await deleteDetailerImportFile(rec.blob_id).catch(() => {});
  return db.entities.ProjectDrawing.update(rec.id, { status: 'kept_as_document', attached_at: nowIso(), blob_id: rec.owns_blob ? null : rec.blob_id });
}

export async function deleteWaitingDrawing(rec) {
  if (rec.owns_blob && rec.blob_id) await deleteDetailerImportFile(rec.blob_id).catch(() => {});
  await db.entities.ProjectDrawing.delete(rec.id);
}
