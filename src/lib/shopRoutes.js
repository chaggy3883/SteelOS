// Per-piece routes + the skipped-step check. Pure functions only (no db, no
// React) — rule-based on purpose (steelos-architecture: detection defaults to
// deterministic rules).
//
// A route is an ordered list of station ids saved on the company's
// SystemSetting('production') row (see src/lib/shopStations.js). Which route
// a piece follows:
//   1. PieceMark.route_id (per-piece override), if it names an active route
//   2. else default_route_by_item_type[PieceMark.item_type || 'Piece_Mark']
//   3. else no route -> no skipped-step warning, no progress strip. A company
//      that never sets up routes therefore sees no new warnings at all.
//
// "Been through a station" = a station_logs row for that piece + station with
// status 'Complete' (both ShopFabrication's Complete button/second scan and
// the Command Center's complete scan write exactly that).
import { stationName } from '@/lib/shopStations';

export const findRoute = (routeId, config) => (routeId ? config.routes.find((r) => r.id === routeId) || null : null);

export function resolvePieceRoute(pieceMark, config) {
  if (!pieceMark || !config) return null;
  const override = findRoute(pieceMark.route_id, config);
  if (override && override.is_active) return override;
  const itemType = pieceMark.item_type || 'Piece_Mark';
  const fallback = findRoute(config.defaultRouteByItemType?.[itemType], config);
  return fallback && fallback.is_active ? fallback : null;
}

// Where a resolved route came from, for display ("Plate route (set on this piece)").
export function routeSourceLabel(pieceMark, route) {
  if (!route) return '';
  return pieceMark?.route_id === route.id ? 'set on this piece' : `default for ${String(pieceMark?.item_type || 'Piece_Mark').replace(/_/g, ' ')}`;
}

export const routeLabel = (route, config) => (route
  ? `${route.name}: ${route.station_ids.map((id) => stationName(id, config)).join(' → ')}`
  : '');

export const completedStationIdsFor = (pieceId, stationLogs = []) => new Set(
  stationLogs
    .filter((log) => log.piece_id === pieceId && log.status === 'Complete')
    .map((log) => Number(log.station_id)),
);

// Earlier stations on the route with no completed record, for a piece about
// to start at `stationId`. onRoute=false when the station isn't on the route
// at all. When a station appears twice on a route, the first occurrence
// that hasn't been completed yet is the one being started.
export function getSkippedStations(route, stationId, completedIds) {
  if (!route) return { onRoute: true, skipped: [] };
  const target = Number(stationId);
  const positions = route.station_ids.map((id, i) => (id === target ? i : -1)).filter((i) => i >= 0);
  if (positions.length === 0) return { onRoute: false, skipped: [] };
  const index = positions[0];
  const skipped = route.station_ids.slice(0, index).filter((id) => !completedIds.has(id));
  return { onRoute: true, skipped: Array.from(new Set(skipped)) };
}

const joinOr = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`);

// Plain shop-language warning lines for the start prompt. Empty = no warning.
export function skippedStepWarnings(route, stationId, completedIds, config) {
  if (!route) return [];
  const { onRoute, skipped } = getSkippedStations(route, stationId, completedIds);
  if (!onRoute) {
    return [`${stationName(stationId, config)} isn't on this piece's route (${routeLabel(route, config)}).`];
  }
  if (skipped.length === 0) return [];
  return [`This piece hasn't been through ${joinOr(skipped.map((id) => stationName(id, config)))} yet.`];
}

// Progress strip: one entry per route stop.
//   done    - has a completed record
//   current - the piece's current station
//   next    - the first not-done stop after the current one (or the first
//             not-done stop overall when the current station isn't on the route)
//   todo    - everything else
export function getRouteProgress(route, currentStationId, completedIds) {
  if (!route) return [];
  const current = Number(currentStationId);
  const currentIndex = route.station_ids.indexOf(current);
  let nextIndex = -1;
  route.station_ids.forEach((id, i) => {
    if (nextIndex >= 0 || i <= currentIndex || id === current) return;
    if (!completedIds.has(id)) nextIndex = i;
  });
  return route.station_ids.map((id, i) => {
    let state = 'todo';
    if (i === currentIndex) state = 'current';
    else if (completedIds.has(id)) state = 'done';
    else if (i === nextIndex) state = 'next';
    return { stationId: id, index: i, state };
  });
}

// Next stop on the route after the piece's current station (for the
// "Advance to ..." button). null when off-route or at the end.
export function nextStationOnRoute(route, currentStationId) {
  if (!route) return null;
  const i = route.station_ids.indexOf(Number(currentStationId));
  if (i < 0 || i >= route.station_ids.length - 1) return null;
  return route.station_ids[i + 1];
}

export const newRouteId = () => `route-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// Detailer-import hold (PieceMark.removal_status === 'on_hold', see
// src/lib/detailerImportRemovals.js) — shop pages badge it and include it in
// the one "before you start" prompt alongside drawing + route warnings.
export const ON_HOLD_BADGE_TEXT = 'On hold — removed from detailer file';
export const isOnHoldPieceMark = (pieceMark) => pieceMark?.removal_status === 'on_hold';
export const holdWarningText = (pieceMark) => (isOnHoldPieceMark(pieceMark)
  ? `${ON_HOLD_BADGE_TEXT}.${pieceMark.removal_reason ? ` ${pieceMark.removal_reason}.` : ''} Check with the office before cutting or welding it.`
  : '');
