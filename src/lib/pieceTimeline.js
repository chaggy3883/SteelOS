import { db } from '@/api/apiClient';

// Display labels for piece_timing_events.event_type — see shopOpsMetrics.js's
// TIMING_EVENT_TYPES for the full enum this must stay in sync with.
export const PIECE_LIFECYCLE_EVENT_LABELS = {
  qr_created: 'QR Created',
  received: 'Received On Site',
  start_work: 'Started Work',
  ready_for_inspection: 'Sent for Inspection',
  inspection_pass: 'Inspection Passed',
  inspection_fail: 'Inspection Failed',
  scan_generic: 'Scanned',
  start: 'Started Work (Station Clock)',
  complete: 'Completed (Station Clock)',
  hold: 'Held',
  resume: 'Resumed',
};

export function pieceEventLabel(eventType) {
  return PIECE_LIFECYCLE_EVENT_LABELS[eventType] || String(eventType || '').replace(/_/g, ' ');
}

export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

// The one piece-history read: every piece_timing_events row for a piece,
// oldest to newest, each annotated with how long the piece sat in the state
// that event opened (the gap until the next event; null/ongoing for the most
// recent one). Every "open a piece" screen (ShopFabrication, Shop Floor
// Command Center, PieceDetailModal, LoadBuilder via PieceDetailModal) reads
// through this — see PieceTimeline.jsx for the matching render side.
export async function getPieceTimeline(pieceId) {
  if (!pieceId) return [];
  const events = await db.entities.piece_timing_events.filter({ piece_id: pieceId }, 'scanned_at', 500);
  return events.map((event, i) => {
    const next = events[i + 1];
    const durationMs = next ? new Date(next.scanned_at).getTime() - new Date(event.scanned_at).getTime() : null;
    return { ...event, durationMs, isOngoing: !next };
  });
}
