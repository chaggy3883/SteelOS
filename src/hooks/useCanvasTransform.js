import { useCallback, useRef, useState } from 'react';
import { clampZoom, zoomAt, ZOOM_STEP } from '@/lib/ironsightView';

// Single source of truth for IRONSIGHT's zoom/pan between PDF-page space
// (the page's native point coordinates at scale=1 — stable regardless of
// zoom or pan) and the canvas viewport. The math itself (anchor-preserving
// zoom, rotation, the inverse used for clicks) lives in
// src/lib/ironsightView.js so it can be checked by hand.
//
// viewportPixel = rotate(pdfPoint * scale) + pan
export function useCanvasTransform(initialScale = 1) {
  const [scale, setScale] = useState(initialScale);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Event handlers (drag, wheel, button clicks) read this instead of
  // closing over `scale`/`pan` directly, so they always see the latest
  // transform without needing to be recreated every time it changes.
  const transformRef = useRef({ scale, pan });
  transformRef.current = { scale, pan };

  // Changes scale while keeping `screenAnchor` (the cursor, or the
  // viewport's center) fixed over the same PDF-space point — without this,
  // every zoom step drifts the view toward the top-left corner. Updates the
  // ref immediately so several wheel ticks in one frame compound correctly.
  const zoomTo = useCallback((nextScale, screenAnchor) => {
    const next = zoomAt(transformRef.current, nextScale, screenAnchor);
    transformRef.current = next;
    setPan(next.pan);
    setScale(next.scale);
  }, []);

  const zoomIn = useCallback((screenAnchor) => zoomTo(transformRef.current.scale * ZOOM_STEP, screenAnchor), [zoomTo]);
  const zoomOut = useCallback((screenAnchor) => zoomTo(transformRef.current.scale / ZOOM_STEP, screenAnchor), [zoomTo]);

  const panBy = useCallback((dx, dy) => {
    setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  // Jump straight to a view (fit page, restore last view, zoom to a markup).
  const setView = useCallback(({ scale: s, pan: p }) => {
    const next = { scale: clampZoom(s), pan: { x: p?.x || 0, y: p?.y || 0 } };
    transformRef.current = next;
    setScale(next.scale);
    setPan(next.pan);
  }, []);

  const resetTransform = useCallback((toScale = 1) => setView({ scale: toScale, pan: { x: 0, y: 0 } }), [setView]);

  return { scale, pan, setPan, panBy, zoomIn, zoomOut, zoomTo, setView, resetTransform, transformRef };
}
