import { useCallback, useEffect, useRef, useState } from 'react';
import { MEASURE_TOOLS, circlePointsNeeded, circleFromDraft, cutoutFitsInside } from '@/lib/takeoffGeometry';

const EMPTY = { points: [], outer: null, cutouts: [] };

const isTypingTarget = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

// The click-collecting engine behind every drawn IRONSIGHT measuring tool
// (Length, Polylength, Perimeter, Area, Volume, Wall Area, Angle, Radius,
// Diameter). Holds the in-progress points only — nothing here is a takeoff
// row. When a measurement is complete it hands the finished geometry to
// onComplete(tool, { points, outer, cutouts, circleMode }); the page decides
// what scale applies and opens the confirmation panel.
//
//   click          add a point (two/three-click tools finish on their own)
//   double-click   close the run/shape (canvas reports it as closeShape)
//                  — Area/Volume then wait for optional cutouts
//   Enter          finish now (keeps any cutouts drawn so far)
//   Backspace      take back the last point (then the last cutout)
export function useMeasureDraft({ activeTool, resetKey, onComplete, onReject }) {
  const [draft, setDraft] = useState(EMPTY);
  const [circleMode, setCircleMode] = useState('center'); // 'center' | 'three'
  const draftRef = useRef(EMPTY);
  const callbacksRef = useRef({ onComplete, onReject });
  callbacksRef.current = { onComplete, onReject };
  const toolRef = useRef(activeTool);
  toolRef.current = activeTool;
  const circleModeRef = useRef(circleMode);
  circleModeRef.current = circleMode;

  const commit = useCallback((next) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const reset = useCallback(() => commit(EMPTY), [commit]);

  // A different tool (or none), or a different page (resetKey), always
  // starts from a clean slate — points only mean something on their page.
  useEffect(() => { commit(EMPTY); }, [activeTool, resetKey, commit]);

  const complete = useCallback((geom) => {
    const tool = toolRef.current;
    commit(EMPTY);
    callbacksRef.current.onComplete?.(tool, { ...geom, circleMode: circleModeRef.current });
  }, [commit]);

  const addPoint = useCallback((pt) => {
    const def = MEASURE_TOOLS[toolRef.current];
    if (!def) return;
    const d = draftRef.current;
    const points = [...d.points, pt];
    if (def.input === 'two' && points.length === 2) return complete({ points });
    if (def.input === 'three' && points.length === 3) return complete({ points });
    if (def.input === 'circle' && points.length === circlePointsNeeded(circleModeRef.current)) {
      if (!circleFromDraft(points, circleModeRef.current)) {
        commit(EMPTY);
        callbacksRef.current.onReject?.('Those three points are in a straight line — pick three points around the circle.');
        return;
      }
      return complete({ points });
    }
    commit({ ...d, points });
  }, [commit, complete]);

  // Double-click: close the current run or shape.
  const closeShape = useCallback(() => {
    const def = MEASURE_TOOLS[toolRef.current];
    if (!def) return;
    const d = draftRef.current;
    if (def.input === 'poly') {
      if (d.points.length >= def.minPoints) complete({ points: d.points });
      return;
    }
    if (def.input !== 'polygon') return;
    if (!d.outer) {
      if (d.points.length < def.minPoints) return;
      if (def.cutouts) commit({ points: [], outer: d.points, cutouts: [] });
      else complete({ points: d.points });
      return;
    }
    // Cutout phase — close this cutout.
    if (d.points.length < 3) return;
    if (!cutoutFitsInside(d.points, d.outer)) {
      commit({ ...d, points: [] });
      callbacksRef.current.onReject?.('A cutout has to sit completely inside the shape — that one was thrown out.');
      return;
    }
    commit({ ...d, points: [], cutouts: [...d.cutouts, d.points] });
  }, [commit, complete]);

  // Enter / Finish button: wrap up with whatever's been drawn.
  const finish = useCallback(() => {
    const def = MEASURE_TOOLS[toolRef.current];
    if (!def) return;
    const d = draftRef.current;
    if (def.input === 'poly') return closeShape();
    if (def.input !== 'polygon') return;
    if (!d.outer) {
      if (d.points.length >= def.minPoints) complete({ points: d.points, outer: d.points, cutouts: [] });
      return;
    }
    const cutouts = d.points.length >= 3 && cutoutFitsInside(d.points, d.outer) ? [...d.cutouts, d.points] : d.cutouts;
    complete({ points: d.outer, outer: d.outer, cutouts });
  }, [closeShape, complete]);

  const removeLast = useCallback(() => {
    const d = draftRef.current;
    if (d.points.length) return commit({ ...d, points: d.points.slice(0, -1) });
    if (d.cutouts.length) return commit({ ...d, cutouts: d.cutouts.slice(0, -1) });
    if (d.outer) return commit({ points: d.outer, outer: null, cutouts: [] });
  }, [commit]);

  useEffect(() => {
    if (!MEASURE_TOOLS[activeTool]) return undefined;
    const onKeyDown = (e) => {
      if (e.repeat || isTypingTarget(e.target)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finish();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        removeLast();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTool, finish, removeLast]);

  // Switching how a circle is picked mid-way would misread the points
  // already placed, so it starts the circle over.
  const changeCircleMode = useCallback((mode) => {
    setCircleMode(mode);
    commit(EMPTY);
  }, [commit]);

  return { draft, circleMode, setCircleMode: changeCircleMode, addPoint, closeShape, finish, removeLast, reset };
}
