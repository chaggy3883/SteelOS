// Office pieces (PieceMark — what Project → Pieces adds from drawings, the
// Add Pieces form, or a detailer import) and shop-floor pieces (`pieces` —
// what Shop Fabrication scans, Shop Management / Production / Shipping list)
// are two records joined by pieces.piece_mark_id. Nothing used to create the
// shop-floor row for a real piece (only the demo seeder did), so pieces added
// to a project never showed up on the shop floor or scanned there.
//
// syncShopPieces() makes sure every individually tracked PieceMark has its
// shop-floor row, carrying the same QR payload and serial number (so the
// printed label scans on the shop floor) plus mark / shape / size / weight.
// It's idempotent: run after pieces are added and whenever a shop screen
// loads, so existing pieces are picked up too. It never touches shop status,
// station, or worker on a row that already exists.
import { db } from '@/api/apiClient';
import { normalizeScanValue } from '@/lib/pieceScan';

// Bulk items (bolts, embeds, loose parts …) are counted, not scanned one by
// one, so only Piece_Mark (or untyped, older) pieces go to the shop floor.
export const isShopTrackedPieceMark = (pm) => !pm.item_type || pm.item_type === 'Piece_Mark';

const feetInches = (ft) => {
  const n = Number(ft);
  if (!(n > 0)) return '';
  let feet = Math.floor(n);
  let inches = Math.round((n - feet) * 12 * 16) / 16;
  if (inches >= 12) { feet += 1; inches -= 12; }
  return `${feet}'-${inches}"`;
};

// The fields the shop-floor row copies from its PieceMark.
export function shopFieldsFromPieceMark(pm) {
  return {
    project_id: pm.project_id,
    piece_mark: pm.piece_mark,
    piece_mark_id: pm.id,
    material_shape: pm.material_profile || pm.material_shape || '',
    dimensions: pm.finished_length || feetInches(pm.length_ft) || '',
    weight: Number(pm.weight_lbs) || 0,
    qr_payload_string: pm.qr_payload_string || '',
    serial_number: pm.serial_number || '',
    ...(pm.company_id ? { company_id: pm.company_id } : {}),
  };
}

const COPIED = ['project_id', 'piece_mark', 'piece_mark_id', 'material_shape', 'dimensions', 'weight', 'qr_payload_string', 'serial_number'];

// Pure plan: which shop rows to create, and which existing rows need their
// copied fields refreshed. Exported for tests.
export function planShopPieceSync(pieceMarks, shopPieces) {
  const byPmId = new Map();
  const byMark = new Map();
  shopPieces.forEach((s) => {
    if (s.piece_mark_id) byPmId.set(s.piece_mark_id, s);
    byMark.set(`${s.project_id}|${normalizeScanValue(s.piece_mark)}`, s);
  });
  const creates = [];
  const updates = [];
  pieceMarks.filter(isShopTrackedPieceMark).forEach((pm) => {
    const want = shopFieldsFromPieceMark(pm);
    const existing = byPmId.get(pm.id) || (() => {
      const m = byMark.get(`${pm.project_id}|${normalizeScanValue(pm.piece_mark)}`);
      return m && !m.piece_mark_id ? m : null;
    })();
    if (!existing) {
      creates.push({ ...want, workflow_status: 'In_Fabrication', current_station_id: 1, field_status: 'In_Shop' });
      return;
    }
    const patch = {};
    COPIED.forEach((k) => {
      // Fill gaps and follow office edits, but keep a QR the shop already
      // printed if the office record somehow lacks one.
      if (k === 'qr_payload_string' && !want[k]) return;
      // A QR the shop already exported for labels (qr_sequence_number set)
      // is on steel — never swap it out from under a printed tag.
      if (k === 'qr_payload_string' && existing.qr_sequence_number && existing.qr_payload_string) return;
      if ((existing[k] ?? '') !== (want[k] ?? '')) patch[k] = want[k];
    });
    if (Object.keys(patch).length) updates.push({ id: existing.id, patch });
  });
  return { creates, updates };
}

let running = null;

// Returns { created, updated }. Concurrent calls share one run.
export function syncShopPieces({ projectId } = {}) {
  if (running) return running;
  running = (async () => {
    try {
      const filter = projectId ? { project_id: projectId } : {};
      const [pieceMarks, shopPieces] = await Promise.all([
        db.entities.PieceMark.filter(filter, '-created_date', 100000),
        db.entities.pieces.filter(filter, '-created_date', 100000),
      ]);
      const { creates, updates } = planShopPieceSync(pieceMarks, shopPieces);
      if (creates.length) await db.entities.pieces.bulkCreate(creates, { auditSummary: 'shop-floor record for a project piece' });
      for (const u of updates) {
        await db.entities.pieces.update(u.id, u.patch);
      }
      return { created: creates.length, updated: updates.length };
    } catch (e) {
      console.warn('Shop piece sync failed', e);
      return { created: 0, updated: 0, error: e };
    } finally {
      running = null;
    }
  })();
  return running;
}

// When an office piece is deleted, its shop-floor row goes too — unless the
// shop has already worked it (moved past the first station, logged time,
// shipped), in which case the row stays as history.
export async function removeShopPiecesFor(pieceMarkIds) {
  const ids = new Set(pieceMarkIds);
  if (!ids.size) return 0;
  const rows = await db.entities.pieces.filter({ piece_mark_id: { $in: [...ids] } }, '-created_date', 100000).catch(() => []);
  let removed = 0;
  for (const s of rows) {
    const untouched = (s.workflow_status || 'In_Fabrication') === 'In_Fabrication'
      && Number(s.current_station_id || 1) === 1 && !s.current_worker_id && (s.field_status || 'In_Shop') === 'In_Shop';
    if (!untouched) continue;
    const logs = await db.entities.station_logs.filter({ piece_id: s.id }, '-created_date', 1).catch(() => []);
    if (logs.length) continue;
    await db.entities.pieces.delete(s.id).catch(() => {});
    removed += 1;
  }
  return removed;
}
