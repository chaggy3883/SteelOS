// Shop drawing revision + approval + release-to-shop helpers.
//
// Pure functions only (no db, no React) so Project Management, Shop
// Fabrication and Production all read the SAME rule for "is this piece safe
// to cut?". Deterministic on purpose — this is a release gate, not an AI
// judgement (see steelos-architecture: detection tasks default to rules).
//
// Data shape (see schema/entities/ShopDrawing.jsonc):
//   ShopDrawing.revisions[]   oldest -> newest; the LAST entry is current.
//   ShopDrawing.current_revision   mirror of revisions[last].rev
//   ShopDrawing.approval_status    one of APPROVAL_STATUSES keys
//   ShopDrawing.released_revision  the rev that was released to the shop
// Legacy drawings saved before revisions existed have no `revisions` array;
// getDrawingRevisions() synthesizes one from the top-level file fields so
// nothing needs a data migration.
//
// Released means: approval_status === 'released' AND released_revision is the
// current revision. Anything else holds the drawing out of the shop.

export const APPROVAL_STATUSES = {
  not_sent: { label: 'Not sent', tone: 'muted' },
  sent_for_approval: { label: 'Sent for approval', tone: 'info' },
  approved: { label: 'Approved', tone: 'good' },
  approved_with_notes: { label: 'Approved with notes', tone: 'good' },
  revise_resubmit: { label: 'Revise & resubmit', tone: 'bad' },
  released: { label: 'Released to shop', tone: 'released' },
};

export const APPROVAL_STATUS_ORDER = ['not_sent', 'sent_for_approval', 'approved', 'approved_with_notes', 'revise_resubmit', 'released'];

export const approvalStatusLabel = (status) => APPROVAL_STATUSES[status]?.label || APPROVAL_STATUSES.not_sent.label;

export const isApprovedStatus = (status) => status === 'approved' || status === 'approved_with_notes';

// Revision letters/numbers compare loosely: " rev b " === "B", "R1" === "r1".
export const normalizeRevision = (value) => String(value ?? '')
  .trim()
  .toUpperCase()
  .replace(/^REV(ISION)?[\s.:-]*/, '');

export const normalizeDrawingNumber = (value) => String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

export const LEGACY_REVISION_ID = 'rev-initial';
export const DEFAULT_FIRST_REVISION = 'A';

export const getDrawingRevisions = (drawing) => {
  if (!drawing) return [];
  if (Array.isArray(drawing.revisions) && drawing.revisions.length > 0) return drawing.revisions;
  return [{
    id: LEGACY_REVISION_ID,
    rev: drawing.current_revision || DEFAULT_FIRST_REVISION,
    change_note: 'First issue',
    revised_by: drawing.uploaded_by || '',
    revised_date: drawing.uploaded_date || drawing.created_date || '',
    file_name: drawing.file_name || '',
  }];
};

export const getCurrentRevision = (drawing) => {
  const revisions = getDrawingRevisions(drawing);
  return revisions[revisions.length - 1] || null;
};

export const getCurrentRevisionLabel = (drawing) => getCurrentRevision(drawing)?.rev || '';

// IndexedDB key for a revision's PDF (src/lib/shopDrawingBlobStore.js). The
// CURRENT revision always lives under the drawing's own id — so every
// existing reader (Submittals' getShopDrawingFileUrl(drawing.id)) keeps
// opening the current PDF — and older revisions are archived under
// `${drawingId}::rev::${revisionId}` when a new revision is added.
export const revisionFileKey = (drawing, revision) => {
  const current = getCurrentRevision(drawing);
  if (!revision || !current || revision.id === current.id) return drawing.id;
  return `${drawing.id}::rev::${revision.id}`;
};

export const allRevisionFileKeys = (drawing) => getDrawingRevisions(drawing).map((revision) => revisionFileKey(drawing, revision));

// Suggest the next rev: A -> B, Z -> AA, 0 -> 1, R2 -> R3, "Rev 4" -> "Rev 5".
export const suggestNextRevision = (current) => {
  const raw = String(current ?? '').trim();
  if (!raw) return DEFAULT_FIRST_REVISION;
  const numeric = raw.match(/^(.*?)(\d+)$/);
  if (numeric) {
    const [, prefix, digits] = numeric;
    const next = String(Number(digits) + 1).padStart(digits.length, '0');
    return `${prefix}${next}`;
  }
  if (/^[A-Za-z]+$/.test(raw)) {
    const upper = raw === raw.toUpperCase();
    const chars = raw.toUpperCase().split('');
    let i = chars.length - 1;
    while (i >= 0) {
      if (chars[i] === 'Z') { chars[i] = 'A'; i -= 1; } else { chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1); break; }
    }
    if (i < 0) chars.unshift('A');
    const next = chars.join('');
    return upper ? next : next.toLowerCase();
  }
  return '';
};

export const isDrawingReleased = (drawing) => Boolean(drawing)
  && drawing.approval_status === 'released'
  && normalizeRevision(drawing.released_revision) === normalizeRevision(getCurrentRevisionLabel(drawing));

// Next release number for a project: R-001, R-002, ... based on the highest
// R-### already used on any drawing (or in any drawing's history).
export const suggestNextReleaseNumber = (drawings = []) => {
  let max = 0;
  drawings.forEach((drawing) => {
    const numbers = [drawing.release_number, ...(drawing.status_history || []).map((entry) => entry.release_number)];
    numbers.forEach((value) => {
      const match = String(value || '').match(/(\d+)\s*$/);
      if (match) max = Math.max(max, Number(match[1]));
    });
  });
  return `R-${String(max + 1).padStart(3, '0')}`;
};

// Map of `${project_id}|${DRAWING NUMBER}` -> drawing. When the same number
// was uploaded twice (the old "upload again + mark superseded" habit), the
// non-superseded, most recently uploaded record wins.
export const buildDrawingIndex = (drawings = []) => {
  const index = new Map();
  const rank = (drawing) => [drawing.status === 'superseded' ? 0 : 1, String(drawing.uploaded_date || drawing.created_date || '')];
  drawings.forEach((drawing) => {
    const number = normalizeDrawingNumber(drawing.drawing_number);
    if (!number) return;
    const key = `${drawing.project_id || ''}|${number}`;
    const existing = index.get(key);
    if (!existing) { index.set(key, drawing); return; }
    const [a1, a2] = rank(drawing);
    const [b1, b2] = rank(existing);
    if (a1 > b1 || (a1 === b1 && a2 > b2)) index.set(key, drawing);
  });
  return index;
};

export const findDrawingForPiece = (piece, drawingIndex) => {
  if (!piece || !drawingIndex) return null;
  const number = normalizeDrawingNumber(piece.drawing_number);
  if (!number) return null;
  return drawingIndex.get(`${piece.project_id || ''}|${number}`) || null;
};

// Release status of ONE PieceMark (office-side record — it carries
// drawing_number + revision). Returns:
//   { state: 'untracked' }  no drawing number, or no ShopDrawing on file for it
//                           -> no badge (we can't gate what isn't tracked)
//   { state: 'released', ... } clean
//   { state: 'not_released' | 'old_revision', label, detail, ... } -> badge
// A blank PieceMark.revision is treated as "on the current rev" — there's no
// evidence it's old, and releasing the drawing backfills it.
export const getPieceDrawingStatus = (piece, drawingIndex) => {
  const drawing = findDrawingForPiece(piece, drawingIndex);
  if (!drawing) return { state: 'untracked', drawing: null, issues: [] };

  const currentRev = getCurrentRevisionLabel(drawing);
  const pieceRev = String(piece.revision || '').trim();
  const released = isDrawingReleased(drawing);
  const onOldRev = Boolean(pieceRev) && normalizeRevision(pieceRev) !== normalizeRevision(currentRev);
  const issues = [];
  if (onOldRev) issues.push(`Piece is on rev ${pieceRev}, drawing ${drawing.drawing_number} is now rev ${currentRev}`);
  if (!released) {
    const statusText = approvalStatusLabel(drawing.approval_status);
    issues.push(`Drawing ${drawing.drawing_number} rev ${currentRev} is "${statusText}" — not released to shop`);
  }

  if (onOldRev) {
    return { state: 'old_revision', label: `Old revision — current is ${currentRev}`, detail: issues.join('. '), drawing, currentRev, pieceRev, issues };
  }
  if (!released) {
    return { state: 'not_released', label: 'Drawing not released', detail: issues.join('. '), drawing, currentRev, pieceRev, issues };
  }
  return { state: 'released', label: `Released rev ${currentRev}`, detail: `Released ${drawing.released_date ? drawing.released_date.slice(0, 10) : ''}${drawing.release_number ? ` (${drawing.release_number})` : ''}`.trim(), drawing, currentRev, pieceRev, issues };
};

export const pieceNeedsDrawingWarning = (status) => status?.state === 'not_released' || status?.state === 'old_revision';

// Text for the confirm-before-starting prompt on the shop floor. Not a hard
// block — the foreman can still go ahead (e.g. a verbal release).
export const drawingStartWarningText = (pieceMarkLabel, status) => {
  if (!pieceNeedsDrawingWarning(status)) return '';
  return `${status.label}\n\n${status.detail}.\n\nStart work on ${pieceMarkLabel || 'this piece'} anyway?`;
};

// Tailwind classes for the warning badge, shared so both shop pages match.
export const DRAWING_BADGE_CLASSES = {
  not_released: 'bg-amber-500/15 text-amber-700 border border-amber-500/30',
  old_revision: 'bg-red-500/15 text-red-700 border border-red-500/30',
};
