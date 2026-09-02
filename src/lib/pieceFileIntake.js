// Shared "dropped file -> PieceMark" logic used by PieceMarkPdfIntake.jsx
// (Pieces section, item_type Piece_Mark), PartsHardwarePdfIntake.jsx (Parts &
// Hardware section, item_type Loose_Part/Bolt/Embed/Misc_Metal), and
// detailerImportCommit.js (Detailer Import's drawing-to-piece matching at
// commit time) — one matching/creation/QR algorithm instead of three
// divergent copies.
import { db } from '@/api/apiClient';
import { scanValueMatches } from '@/lib/pieceScan';
import { generatePiecePayload } from '@/lib/qrSerialization';
import { createDocumentId, pieceDocumentsKey, getDocumentRecords, saveDocumentRecords } from '@/lib/pieceMarkDocumentStore';

// Strips a trailing file extension to recover the piece/part mark a detailer
// or shop drawing file is conventionally named after (e.g. "3B3.pdf" ->
// "3B3"). Generic (not PDF-specific) so it also works for whatever file type
// Detailer Import's drawing-matching hands it.
export const stripFileExtension = (filename) => String(filename || '').replace(/\.[^./\\]+$/, '');

// Matches a dropped/uploaded file to an EXISTING PieceMark within one
// project's piece list by filename stem — the piece_mark uniqueness scope is
// (project_id, piece_mark), and `pieces` here is always pre-filtered to one
// project, so no explicit project check is needed on top of this.
export function matchFilenameToPiece(pieces, filename) {
  const stem = stripFileExtension(filename);
  return pieces.find((p) => scanValueMatches([p.piece_mark], stem)) || null;
}

// Attaches a file blob to a PieceMark's drawing/document store — same
// mechanism regardless of which surface (Pieces, Parts & Hardware, Detailer
// Import commit) triggered the attach.
export async function attachFileToPiece(piece, file) {
  const key = pieceDocumentsKey(piece.id);
  const existing = await getDocumentRecords(key);
  const doc = {
    id: createDocumentId(),
    filename: file.name,
    mimetype: file.type || 'application/pdf',
    size: file.size,
    uploadDate: new Date().toISOString(),
    blob: file,
  };
  await saveDocumentRecords(key, [...existing, doc]);
  return doc;
}

// Creates a brand-new PieceMark from a dropped file with no existing match —
// extracts the piece/part mark from the filename (or an explicit override),
// generates a real unique QR payload string at creation time (matching the
// fix already applied to the Detailer Import commit path — a piece must
// never be created without one, see detailerImportCommit.js), and attaches
// the dropped file as its first drawing.
//
// quantity is only meaningful for the bulk item_types (Loose_Part/Bolt/
// Embed/Misc_Metal) — a Piece_Mark is individually tracked by its own QR, so
// its quantity always stays at the schema default (1) regardless of what's
// passed in.
export async function createPieceFromFile({ project, file, itemType = 'Piece_Mark', markOverride, quantity, sequenceAreaId }) {
  const mark = (markOverride ?? stripFileExtension(file.name)).trim();
  const projectLabel = project?.project_number || project?.id;
  const isPieceMark = itemType === 'Piece_Mark';

  const created = await db.entities.PieceMark.create({
    project_id: project.id,
    piece_mark: mark,
    item_type: itemType,
    ...(isPieceMark ? {} : { part_number: mark, quantity: Number(quantity) || 1 }),
    sequence_area_id: sequenceAreaId || null,
    // Globally unique independent of piece_mark (which repeats across
    // projects by design) — see generatePiecePayload in qrSerialization.js.
    qr_payload_string: generatePiecePayload(projectLabel, mark),
    status: 'not_started',
  });
  await attachFileToPiece(created, file);
  return created;
}
