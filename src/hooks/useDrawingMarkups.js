import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '@/api/apiClient';

// IRONSIGHT general markups (pen, shapes, clouds, text, callouts, notes,
// stamps) for the open takeoff session — blueprint_takeoffs.drawing_markups.
// Kept apart from accepted_items on purpose: these are drawing notes, not
// quantities, so they can never reach Push to Estimate.
//
// Saved 600ms after the last change (a drag or a typing burst is one write).
// A save still waiting when the estimator switches drawings or leaves is
// written straight away, to the session it belongs to. Like
// useTakeoffScales, loading or resetting never writes the new state back.
export function useDrawingMarkups(takeoffId) {
  const [markups, setMarkups] = useState([]);
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);
  const pendingRef = useRef(null); // { id, list } not yet written

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p) return;
    db.entities.blueprint_takeoffs.update(p.id, { drawing_markups: p.list }).catch((e) => {
      console.error('Failed to save drawing markups', e);
    });
  }, []);

  useEffect(() => {
    if (!takeoffId || !dirtyRef.current) return;
    dirtyRef.current = false;
    pendingRef.current = { id: takeoffId, list: markups };
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 600);
  }, [markups, takeoffId, flush]);

  useEffect(() => () => flush(), [flush]);

  const loadFrom = useCallback((takeoff) => {
    flush();
    dirtyRef.current = false;
    setMarkups(Array.isArray(takeoff?.drawing_markups) ? takeoff.drawing_markups : []);
  }, [flush]);

  const reset = useCallback(() => {
    flush();
    dirtyRef.current = false;
    setMarkups([]);
  }, [flush]);

  const mutate = useCallback((fn) => {
    dirtyRef.current = true;
    setMarkups((prev) => fn(prev));
  }, []);

  const replaceAll = useCallback((list) => mutate(() => list), [mutate]);
  const add = useCallback((items) => mutate((prev) => [...prev, ...(Array.isArray(items) ? items : [items])]), [mutate]);
  // patches: { [id]: object | (markup) => markup }
  const updateMany = useCallback((patches) => mutate((prev) => prev.map((m) => {
    const p = patches[m.id];
    if (!p) return m;
    const next = typeof p === 'function' ? p(m) : { ...m, ...p };
    return { ...next, updated_at: new Date().toISOString() };
  })), [mutate]);
  const update = useCallback((id, patch) => updateMany({ [id]: patch }), [updateMany]);
  const remove = useCallback((ids) => {
    const set = new Set(ids);
    mutate((prev) => prev.filter((m) => !set.has(m.id)));
  }, [mutate]);
  // Z-order is array order (last drawn = on top).
  const reorder = useCallback((ids, where) => {
    const set = new Set(ids);
    mutate((prev) => {
      const moving = prev.filter((m) => set.has(m.id));
      const rest = prev.filter((m) => !set.has(m.id));
      return where === 'back' ? [...moving, ...rest] : [...rest, ...moving];
    });
  }, [mutate]);

  return { markups, loadFrom, reset, flush, replaceAll, add, update, updateMany, remove, reorder };
}

// Undo/redo for markup changes. Holds whole snapshots ({ markups, rows } —
// both arrays are immutable, so a snapshot is just two references) taken
// right BEFORE each change. undo(current) hands back the snapshot to
// restore and keeps `current` for redo.
export function useUndoHistory(limit = 100) {
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const record = useCallback((snapshot) => {
    undoRef.current = [...undoRef.current.slice(-(limit - 1)), snapshot];
    redoRef.current = [];
    bump();
  }, [limit]);

  const undo = useCallback((current) => {
    if (!undoRef.current.length) return null;
    const prev = undoRef.current[undoRef.current.length - 1];
    undoRef.current = undoRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current, current];
    bump();
    return prev;
  }, []);

  const redo = useCallback((current) => {
    if (!redoRef.current.length) return null;
    const next = redoRef.current[redoRef.current.length - 1];
    redoRef.current = redoRef.current.slice(0, -1);
    undoRef.current = [...undoRef.current, current];
    bump();
    return next;
  }, []);

  const clear = useCallback(() => {
    undoRef.current = [];
    redoRef.current = [];
    bump();
  }, []);

  return { record, undo, redo, clear, canUndo: undoRef.current.length > 0, canRedo: redoRef.current.length > 0, version };
}
