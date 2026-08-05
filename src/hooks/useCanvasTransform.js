import { useCallback, useRef, useState } from 'react';

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;

// Single source of truth for the zoom/pan transform between PDF-page space
// (the page's native point coordinates at scale=1 — stable regardless of
// zoom or pan) and on-screen canvas pixel space. Every measurement tool
// added in later phases (scale calibration, length/count/area) needs to
// convert a click position to a PDF-page coordinate and back, so that math
// lives here once rather than being re-derived per tool.
//
// canvasPixel = pdfPoint * scale + pan
export function useCanvasTransform(initialScale = 1) {
  const [scale, setScale] = useState(initialScale);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Event handlers (drag, wheel, button clicks) read this instead of
  // closing over `scale`/`pan` directly, so they always see the latest
  // transform without needing to be recreated every time it changes.
  const transformRef = useRef({ scale, pan });
  transformRef.current = { scale, pan };

  const pdfToScreen = useCallback((pdfX, pdfY) => {
    const { scale: s, pan: p } = transformRef.current;
    return { x: pdfX * s + p.x, y: pdfY * s + p.y };
  }, []);

  const screenToPdf = useCallback((screenX, screenY) => {
    const { scale: s, pan: p } = transformRef.current;
    return { x: (screenX - p.x) / s, y: (screenY - p.y) / s };
  }, []);

  // Changes scale while keeping `screenAnchor` (e.g. the viewport's center,
  // or the cursor position) fixed over the same PDF-space point — without
  // this, every zoom step drifts the view toward the top-left corner.
  const zoomTo = useCallback((nextScale, screenAnchor) => {
    const { scale: prevScale, pan: prevPan } = transformRef.current;
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    if (screenAnchor) {
      const anchorPdfX = (screenAnchor.x - prevPan.x) / prevScale;
      const anchorPdfY = (screenAnchor.y - prevPan.y) / prevScale;
      setPan({
        x: screenAnchor.x - anchorPdfX * clamped,
        y: screenAnchor.y - anchorPdfY * clamped,
      });
    }
    setScale(clamped);
  }, []);

  const zoomIn = useCallback((screenAnchor) => zoomTo(transformRef.current.scale * ZOOM_STEP, screenAnchor), [zoomTo]);
  const zoomOut = useCallback((screenAnchor) => zoomTo(transformRef.current.scale / ZOOM_STEP, screenAnchor), [zoomTo]);

  const panBy = useCallback((dx, dy) => {
    setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const resetTransform = useCallback((toScale = 1) => {
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, toScale)));
    setPan({ x: 0, y: 0 });
  }, []);

  return { scale, pan, setPan, panBy, zoomIn, zoomOut, zoomTo, resetTransform, pdfToScreen, screenToPdf };
}
