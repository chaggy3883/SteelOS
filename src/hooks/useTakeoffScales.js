import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '@/api/apiClient';
import {
  migrateScaleState, resolveScaleAt, pageHasAnyScale, pageEntryFor,
  withPageScale, withViewport, withViewportPatch, withoutViewport,
} from '@/lib/takeoffScale';

// IRONSIGHT per-page / per-viewport drawing scale state for the open
// takeoff session. Persists `page_scales` onto blueprint_takeoffs right after
// every change (scale edits are rare, so no debounce — nothing is lost if
// the estimator backs out of the session a moment later). The older
// whole-set `px_per_ft` is read once on load as the fallback and never
// written again; see takeoffScale.js migrateScaleState.
export function useTakeoffScales(takeoffId) {
  const [pageScales, setPageScales] = useState({});
  const [legacyPtsPerFt, setLegacyPtsPerFt] = useState(null);
  // Only a change made through one of the setters below is saved — loading
  // a session (or resetting) must never write its own state straight back.
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!takeoffId || !dirtyRef.current) return;
    dirtyRef.current = false;
    db.entities.blueprint_takeoffs.update(takeoffId, { page_scales: pageScales }).catch((e) => {
      console.error('Failed to persist page scales', e);
    });
  }, [pageScales, takeoffId]);

  const loadFrom = useCallback((takeoff) => {
    const { pageScales: loaded, legacyPtsPerFt: legacy } = migrateScaleState(takeoff);
    dirtyRef.current = false;
    setPageScales(loaded);
    setLegacyPtsPerFt(legacy);
  }, []);

  const reset = useCallback(() => {
    dirtyRef.current = false;
    setPageScales({});
    setLegacyPtsPerFt(null);
  }, []);

  const mutate = useCallback((fn) => {
    dirtyRef.current = true;
    setPageScales((prev) => fn(prev));
  }, []);

  const setPageScale = useCallback((pageNumbers, scale) => mutate((prev) => withPageScale(prev, pageNumbers, scale)), [mutate]);
  const addViewport = useCallback((pageNumber, viewport) => mutate((prev) => withViewport(prev, pageNumber, viewport)), [mutate]);
  const updateViewport = useCallback((pageNumber, id, patch) => mutate((prev) => withViewportPatch(prev, pageNumber, id, patch)), [mutate]);
  const removeViewport = useCallback((pageNumber, id) => mutate((prev) => withoutViewport(prev, pageNumber, id)), [mutate]);

  const resolveAt = useCallback((pageNumber, pt) => resolveScaleAt(pageScales, legacyPtsPerFt, pageNumber, pt), [pageScales, legacyPtsPerFt]);
  const pageHasScale = useCallback((pageNumber) => pageHasAnyScale(pageScales, legacyPtsPerFt, pageNumber), [pageScales, legacyPtsPerFt]);
  const pageEntry = useCallback((pageNumber) => pageEntryFor(pageScales, pageNumber), [pageScales]);

  return {
    pageScales, legacyPtsPerFt, loadFrom, reset,
    setPageScale, addViewport, updateViewport, removeViewport,
    resolveAt, pageHasScale, pageEntry,
  };
}
