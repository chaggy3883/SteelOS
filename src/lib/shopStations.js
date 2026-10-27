// Company-configurable shop stations + routes — the pure (no db, no React)
// half. The db/React half (load, save, useShopStationConfig hook) lives in
// src/lib/shopStationsStore.js.
//
// WHERE IT'S STORED: on the company's existing SystemSetting row with
// setting_group 'production' (the same row ShopOperations.jsx already reads
// for stale-piece / bottleneck thresholds) — fields shop_stations,
// shop_routes, default_route_by_item_type. No new entity: this is company
// config, and SystemSetting is already tenant-scoped in localData.js. See
// schema/entities/SystemSetting.jsonc.
//
// BACKWARD COMPATIBILITY: station ids stay the numbers every existing record
// already stores (station_logs.station_id, pieces.current_station_id,
// piece_timing_events.station_id). DEFAULT_SHOP_STATIONS is exactly the six
// stations that used to be hard-coded in shopOpsMetrics.js — same ids, same
// names, same order — and is what every reader gets when a company has never
// saved a station list. New stations get the next unused number (7, 8, ...);
// ids are never reused or deleted, only retired (is_active: false), so old
// history always still resolves to a name.
//
// stationName()/getActiveStations() read a module-level cache so the many
// synchronous callers (PieceTimeline, DwellReportSection, the rule engine)
// keep working unchanged. Until the store has loaded a company's config, the
// cache is the defaults — i.e. exactly the old behavior.

export const DEFAULT_SHOP_STATIONS = Object.freeze([
  { id: 1, name: 'Receiving', short_code: 'RCV', sort_order: 1, is_active: true, shop_floor_zone_id: '' },
  { id: 2, name: 'Shot Blaster', short_code: 'BLAST', sort_order: 2, is_active: true, shop_floor_zone_id: '' },
  { id: 3, name: 'Iron Worker', short_code: 'IRON', sort_order: 3, is_active: true, shop_floor_zone_id: '' },
  { id: 4, name: 'Drill Line', short_code: 'DRILL', sort_order: 4, is_active: true, shop_floor_zone_id: '' },
  { id: 5, name: 'Fab (Layout / Tack)', short_code: 'FAB', sort_order: 5, is_active: true, shop_floor_zone_id: '' },
  { id: 6, name: 'Paint', short_code: 'PAINT', sort_order: 6, is_active: true, shop_floor_zone_id: '' },
].map((s) => Object.freeze(s)));

// PieceMark.item_type values a default route can be assigned to (mirrors the
// enum in schema/entities/PieceMark.jsonc). Blank item_type reads as Piece_Mark.
export const ROUTE_ITEM_TYPES = [
  { value: 'Piece_Mark', label: 'Main steel pieces' },
  { value: 'Loose_Part', label: 'Loose parts / plates' },
  { value: 'Embed', label: 'Embeds' },
  { value: 'Misc_Metal', label: 'Misc metals' },
  { value: 'Lintel', label: 'Lintels' },
  { value: 'Bolt', label: 'Bolts' },
];

const normalizeStation = (raw, index) => ({
  id: Number(raw?.id),
  name: String(raw?.name || '').trim() || `Station ${raw?.id}`,
  short_code: String(raw?.short_code || '').trim().toUpperCase(),
  sort_order: Number.isFinite(Number(raw?.sort_order)) ? Number(raw.sort_order) : index + 1,
  is_active: raw?.is_active !== false,
  shop_floor_zone_id: raw?.shop_floor_zone_id || '',
});

const byOrder = (a, b) => (a.sort_order - b.sort_order) || (a.id - b.id);

// Turns a SystemSetting('production') row (or null) into the config every
// reader uses. A missing/empty shop_stations list -> the defaults. Any
// default station id missing from a saved list is appended (retired) so it
// can never stop resolving — saved lists are only ever added to, but this
// guards hand-edited data.
export function buildShopStationConfig(settingRow) {
  const saved = Array.isArray(settingRow?.shop_stations) ? settingRow.shop_stations : [];
  let stations = saved
    .map(normalizeStation)
    .filter((s) => Number.isInteger(s.id) && s.id > 0);
  const isConfigured = stations.length > 0;
  if (!isConfigured) {
    stations = DEFAULT_SHOP_STATIONS.map((s) => ({ ...s }));
  } else {
    const ids = new Set(stations.map((s) => s.id));
    DEFAULT_SHOP_STATIONS.forEach((d) => {
      if (!ids.has(d.id)) stations.push({ ...d, is_active: false, sort_order: 1000 + d.id });
    });
  }
  stations.sort(byOrder);
  const stationIds = new Set(stations.map((s) => s.id));

  const routes = (Array.isArray(settingRow?.shop_routes) ? settingRow.shop_routes : [])
    .map((r) => ({
      id: String(r?.id || ''),
      name: String(r?.name || '').trim() || 'Unnamed route',
      station_ids: (Array.isArray(r?.station_ids) ? r.station_ids : []).map(Number).filter((id) => stationIds.has(id)),
      is_active: r?.is_active !== false,
    }))
    .filter((r) => r.id);

  const routeIds = new Set(routes.map((r) => r.id));
  const defaults = {};
  Object.entries(settingRow?.default_route_by_item_type || {}).forEach(([itemType, routeId]) => {
    if (routeId && routeIds.has(routeId)) defaults[itemType] = routeId;
  });

  return { isConfigured, stations, routes, defaultRouteByItemType: defaults, settingId: settingRow?.id || null };
}

let cachedConfig = buildShopStationConfig(null);

export const getShopStationConfig = () => cachedConfig;
export const setShopStationConfigCache = (config) => { cachedConfig = config || buildShopStationConfig(null); };

// Every station (active + retired), in shop order.
export const getAllStations = (config = cachedConfig) => config.stations;
// The live station list — what tiles/dropdowns show. With no config this is
// the old six, ids 1-6, in id order.
export const getActiveStations = (config = cachedConfig) => config.stations.filter((s) => s.is_active);

export const findStation = (id, config = cachedConfig) => {
  const n = Number(id);
  return config.stations.find((s) => s.id === n) || DEFAULT_SHOP_STATIONS.find((s) => s.id === n) || null;
};

// Same signature + fallback text as the old hard-coded helper. Retired
// stations still resolve (history keeps its names).
export const stationName = (id, config = cachedConfig) => findStation(id, config)?.name || `Station ${id}`;

// Next station id for a newly added station — never reuses a number, never
// collides with the six defaults even if they were somehow absent.
export const nextStationId = (stations) => Math.max(6, ...stations.map((s) => Number(s.id) || 0)) + 1;

// Next station in shop order after `currentId` (active only). Used for the
// "Advance to ..." button when a piece has no route.
export const nextStationInShopOrder = (currentId, config = cachedConfig) => {
  const all = config.stations;
  const idx = all.findIndex((s) => s.id === Number(currentId));
  if (idx < 0) return null;
  return all.slice(idx + 1).find((s) => s.is_active) || null;
};
