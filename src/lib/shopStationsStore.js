// db + React half of the configurable shop stations/routes (pure half:
// src/lib/shopStations.js). Reads/writes the company's existing
// SystemSetting row with setting_group 'production' — the same row
// ShopOperations.jsx / ShopFloorCommandCenter.jsx already load — and keeps
// the shopStations.js cache in sync so stationName() everywhere reflects the
// saved list.
import { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { buildShopStationConfig, getShopStationConfig, setShopStationConfigCache } from '@/lib/shopStations';

const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(getShopStationConfig()));

const findProductionSetting = async () => {
  const rows = await db.entities.SystemSetting.filter({ setting_group: 'production' }, '-created_date', 1);
  return rows[0] || null;
};

export async function loadShopStationConfig() {
  try {
    const row = await findProductionSetting();
    setShopStationConfigCache(buildShopStationConfig(row));
  } catch {
    // Keep whatever is cached (defaults on first load) — never blank the list.
  }
  notify();
  return getShopStationConfig();
}

// Saves any of { shop_stations, shop_routes, default_route_by_item_type }
// onto the production settings row (creating it if this company has none
// yet, same as ShopOperations.jsx does) and refreshes the cache.
export async function saveShopStationConfig(updates, changedBy = '') {
  const row = await findProductionSetting();
  const payload = { ...updates, last_updated_by: changedBy || row?.last_updated_by || '' };
  const saved = row
    ? await db.entities.SystemSetting.update(row.id, payload)
    : await db.entities.SystemSetting.create({ setting_group: 'production', ...payload });
  setShopStationConfigCache(buildShopStationConfig(saved));
  notify();
  return getShopStationConfig();
}

// Any shop page that shows station names calls this once: it loads the
// company's config on mount and re-renders when it changes. Until the load
// finishes it returns the cached config (the six defaults the first time).
export function useShopStationConfig() {
  const [config, setConfig] = useState(getShopStationConfig());
  useEffect(() => {
    listeners.add(setConfig);
    loadShopStationConfig();
    return () => { listeners.delete(setConfig); };
  }, []);
  return config;
}
