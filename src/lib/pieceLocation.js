// Where a shop-floor piece is and what's happening to it, in plain words —
// shown under the piece mark in Shop Fabrication's Pieces list and in Shop
// Management's "Pieces in the shop" tab. Pure: give it the piece and its
// station_logs (any order).
//
// Pieces move between stations only when a worker signed in at the next
// station scans them (ShopFabrication handleScan) — so after work is
// completed a piece sits at that station as "Done — ready for the next
// station" with no timer running.
import { stationName } from '@/lib/shopStations';

const RECEIVING_STATION_ID = 1;

const time = (v) => (v ? new Date(v).getTime() : 0);

// { state, label, since } — state is one of: working, paused, inspection,
// approved, rejected, done, waiting, received.
export function pieceLocation(piece, logs = []) {
  const station = stationName(piece.current_station_id);
  const mine = logs.filter((l) => l.piece_id === piece.id).sort((a, b) => time(b.start_time) - time(a.start_time));
  const active = mine.find((l) => l.status === 'In_Progress');
  const lastHere = mine.find((l) => Number(l.station_id) === Number(piece.current_station_id));
  const lastEvent = mine[0];
  const fallbackSince = piece.updated_date || piece.created_date || null;

  if (active) return { state: 'working', label: `Working at ${station}`, since: active.start_time };
  if (piece.workflow_status === 'Inspector_Queue') return { state: 'inspection', label: `${station} — waiting for inspection`, since: fallbackSince };
  if (piece.workflow_status === 'Rejected') return { state: 'rejected', label: `${station} — failed inspection`, since: fallbackSince };
  if (piece.workflow_status === 'Paused' || lastHere?.status === 'Paused') return { state: 'paused', label: `Paused at ${station}`, since: lastHere?.end_time || fallbackSince };
  if (piece.workflow_status === 'Received') return { state: 'received', label: `Received — ${station}`, since: piece.verified_date || fallbackSince };
  if (lastHere?.status === 'Complete') return { state: 'done', label: `Done at ${station} — ready for the next station`, since: lastHere.end_time || fallbackSince };
  return { state: 'waiting', label: `At ${station} — not started`, since: lastEvent?.end_time || fallbackSince };
}

// "Past receiving": worked anywhere, or now sitting at any station other
// than Receiving.
export function isPastReceiving(piece, logs = []) {
  if (Number(piece.current_station_id || RECEIVING_STATION_ID) !== RECEIVING_STATION_ID) return true;
  return logs.some((l) => l.piece_id === piece.id && Number(l.station_id) !== RECEIVING_STATION_ID);
}

// "3d 4h", "2h 15m", "12m", "just now"
export function formatDuration(fromIso, now = Date.now()) {
  if (!fromIso) return '—';
  const mins = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
