import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

// IRONSIGHT workspace layout + preferences, remembered per user on this
// device (localStorage). Every read and write is wrapped — private windows,
// blocked storage or a full quota just fall back to the defaults.

export const DEFAULT_LAYOUT = {
  leftOpen: true,
  leftWidth: 240,
  leftTab: 'thumbnails',
  rightOpen: true,
  rightWidth: 320,
  rightTab: 'properties',
  bottomOpen: true,
  bottomHeight: 260,
  bottomTab: 'markups',
};

export const DEFAULT_PREFS = {
  snap: true,
  ortho: false,
  grid: false,
  continuous: false,
  units: 'ft-in', // 'ft-in' | 'decimal-ft' | 'metric'
  font_family: 'Helvetica',
  font_size: 12,
  // Last style used per markup tool, so the next one comes out the same.
  toolStyles: {},
};

export const PANEL_LIMITS = {
  leftWidth: [160, 520],
  rightWidth: [220, 560],
  bottomHeight: [110, 640],
};

function readJson(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — keep going with in-memory state */
  }
}

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Number(v) || lo));

export function useWorkspaceLayout(userKey) {
  const layoutKey = `ironsight.layout.${userKey || 'anon'}`;
  const prefsKey = `ironsight.prefs.${userKey || 'anon'}`;
  const [layout, setLayoutState] = useState(() => ({ ...DEFAULT_LAYOUT, ...(readJson(layoutKey) || {}) }));
  const [prefs, setPrefsState] = useState(() => ({ ...DEFAULT_PREFS, ...(readJson(prefsKey) || {}) }));

  // The signed-in user arrives a render or two late — reload once it does.
  const loadedForRef = useRef(userKey);
  useEffect(() => {
    if (loadedForRef.current === userKey) return;
    loadedForRef.current = userKey;
    setLayoutState({ ...DEFAULT_LAYOUT, ...(readJson(layoutKey) || {}) });
    setPrefsState({ ...DEFAULT_PREFS, ...(readJson(prefsKey) || {}) });
  }, [userKey, layoutKey, prefsKey]);

  const setLayout = useCallback((patch) => {
    setLayoutState((prev) => {
      const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
      Object.keys(PANEL_LIMITS).forEach((k) => { next[k] = clamp(next[k], PANEL_LIMITS[k]); });
      writeJson(layoutKey, next);
      return next;
    });
  }, [layoutKey]);

  const resetLayout = useCallback(() => {
    writeJson(layoutKey, DEFAULT_LAYOUT);
    setLayoutState({ ...DEFAULT_LAYOUT });
  }, [layoutKey]);

  const setPrefs = useCallback((patch) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
      writeJson(prefsKey, next);
      return next;
    });
  }, [prefsKey]);

  return { layout, setLayout, resetLayout, prefs, setPrefs };
}

// Last page / zoom / pan / rotation per takeoff session, so reopening a
// drawing lands where the estimator left it.
export const loadViewState = (takeoffId) => (takeoffId ? readJson(`ironsight.view.${takeoffId}`) : null);
export const saveViewState = (takeoffId, state) => { if (takeoffId) writeJson(`ironsight.view.${takeoffId}`, state); };

// A tiny external store for values that change on every mouse move / wheel
// tick (cursor position, live zoom). The status bar subscribes to it
// directly so the whole IRONSIGHT page doesn't re-render 60 times a second.
export function createLiveStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
  };
}

export function useLiveStore(store) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
