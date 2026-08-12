import React, { forwardRef, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCanvasTransform } from '@/hooks/useCanvasTransform';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

const VIEWPORT_HEIGHT = 640;

// Phase 1: visual PDF viewer only — page render, page nav, zoom, and pan.
// Phase 2 added the first measurement tool: two-point scale calibration.
// Phase 3 adds Count and Length, the two tools estimators use most — both
// driven the same way as calibration (activeTool/lengthPoints in, clicks out
// via onMeasurementClick) so BlueprintTakeoff owns all the takeoff-row logic
// and this component only ever needs to know how to place a click and draw
// a marker. The overlay canvas is sized and positioned pixel-identical to
// the base canvas on every render/zoom/pan so tools can keep drawing on it
// without touching this file's layout math again.
// Phase 4 adds Area (unlimited-vertex polygon, closed by double-click — see
// lastAreaClickAtRef) and VisualSearch candidate review markers. A closed
// polygon isn't placed automatically: BlueprintTakeoff pops a naming modal
// and only adds it to `areas` (rendered here with its name centered in the
// shape) once the estimator saves a name for it.
const BlueprintCanvas = forwardRef(function BlueprintCanvas({
  source,
  calibrationMode = false,
  calibrationPoints = [],
  onCalibrationClick,
  onScaleChange,
  onPageSizeChange,
  onPageChange,
  activeTool = null,
  lengthPoints = [],
  areaPoints = [],
  onMeasurementClick,
  measurementItems = [],
  pxPerFt = null,
  candidateMarkers = [],
  onCandidateToggle,
  fillHeight = false,
  // steelCatalog — reserved for a future size-aware area tool; accepted here
  // so BlueprintTakeoff can start threading it through without this
  // component needing to know its shape yet.
  steelCatalog = {},
  // Named polygon regions (Area tool, once named via the Name This Area
  // modal) — keyed by name, each holding { polygon, pageNumber }. Only the
  // ones matching the current page are ever drawn (see the overlay effect).
  areas = {},
}, ref) {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [page, setPage] = useState(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [pageInput, setPageInput] = useState('1');
  const [spacePressed, setSpacePressed] = useState(false);

  const { scale, pan, setPan, zoomIn, zoomOut, resetTransform } = useCanvasTransform(1);

  const viewportRef = useRef(null);
  const baseCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const dragRef = useRef(null);
  // Closes an in-progress Area polygon on a real double-click without
  // relying on the browser's native dblclick event, which fires in addition
  // to (not instead of) the two ordinary click events that make it up —
  // using it directly would add two stray vertices right before closing.
  const lastAreaClickAtRef = useRef(0);

  // Loads the document whenever `source` changes (a URL string, or a
  // File/Blob — both accepted so this can be wired directly to the same
  // upload BlueprintTakeoff already does). Destroys the previous document
  // on every change/unmount so pdfjs frees its worker-side resources.
  useEffect(() => {
    if (!source) {
      setPdfDoc(null);
      setNumPages(0);
      return;
    }
    let cancelled = false;
    let doc = null;
    setIsLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const params = typeof source === 'string' ? { url: source } : { data: await source.arrayBuffer() };
        doc = await pdfjsLib.getDocument(params).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(1);
      } catch (e) {
        console.error('BlueprintCanvas failed to load PDF', e);
        if (!cancelled) setLoadError('Could not load this PDF for preview.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      doc?.destroy();
    };
  }, [source]);

  // Fetches the page proxy for the current page number, and resets the
  // transform to a fit-to-width scale for that page's native size — this
  // only runs on document/page change, not on every zoom/pan action.
  useEffect(() => {
    if (!pdfDoc) {
      setPage(null);
      return;
    }
    let cancelled = false;
    pdfDoc.getPage(pageNum).then((p) => {
      if (cancelled) return;
      setPage(p);
      const natural = p.getViewport({ scale: 1 });
      setPageSize({ width: natural.width, height: natural.height });
      onPageSizeChange?.({ width: natural.width, height: natural.height });
      const containerWidth = viewportRef.current?.getBoundingClientRect()?.width || natural.width;
      const fit = Math.min(2, Math.max(0.1, (containerWidth - 32) / natural.width));
      resetTransform(fit);
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNum, resetTransform, onPageSizeChange]);

  // Renders the current page at the current scale onto the base canvas.
  // Cancels any in-flight render task before starting a new one — pdfjs
  // does not allow two concurrent render() calls against the same canvas,
  // and rapid zoom/pan/page changes would otherwise queue up renders and
  // leak RenderTask objects.
  useEffect(() => {
    if (!page) return;
    const baseCanvas = baseCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!baseCanvas) return;

    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;

    baseCanvas.width = Math.ceil(viewport.width * dpr);
    baseCanvas.height = Math.ceil(viewport.height * dpr);
    baseCanvas.style.width = `${viewport.width}px`;
    baseCanvas.style.height = `${viewport.height}px`;

    if (overlayCanvas) {
      overlayCanvas.width = Math.ceil(viewport.width * dpr);
      overlayCanvas.height = Math.ceil(viewport.height * dpr);
      overlayCanvas.style.width = `${viewport.width}px`;
      overlayCanvas.style.height = `${viewport.height}px`;
    }

    renderTaskRef.current?.cancel();

    const ctx = baseCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const task = page.render({ canvasContext: ctx, viewport });
    renderTaskRef.current = task;
    task.promise.catch((e) => {
      if (e?.name !== 'RenderingCancelledException') console.error('BlueprintCanvas render failed', e);
    });

    return () => {
      renderTaskRef.current?.cancel();
    };
  }, [page, scale]);

  // Calibration needs the live render scale to convert a clicked pixel
  // distance back to PDF-space distance — this is the only way for
  // BlueprintTakeoff (which owns the calibration math) to know it, since
  // `scale` itself lives inside this component's useCanvasTransform instance.
  useEffect(() => {
    onScaleChange?.(scale);
  }, [scale, onScaleChange]);

  // Adobe-style hand tool: holding Space enables drag-to-pan even while a
  // measurement tool is active (see handlePointerDown's panAllowedNow),
  // without stealing the tool's own click behavior once Space is released.
  // Ignored while typing into an input/textarea, and while calibrating —
  // calibration's two-click sequence should never be interrupted by a pan.
  useEffect(() => {
    const isTypingTarget = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const handleKeyDown = (e) => {
      if (e.code !== 'Space' || e.repeat || calibrationMode || isTypingTarget(e.target)) return;
      e.preventDefault();
      setSpacePressed(true);
    };
    const handleKeyUp = (e) => {
      if (e.code !== 'Space') return;
      setSpacePressed(false);
      // Mid-drag release: end the pan immediately rather than waiting for
      // pointerup, so the very next click is treated as a tool click again.
      if (dragRef.current?.viaSpace) {
        try { viewportRef.current?.releasePointerCapture(dragRef.current.pointerId); } catch { /* already released */ }
        dragRef.current = null;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [calibrationMode]);

  // Keeps the page-jump input in sync when pageNum changes via the
  // prev/next buttons (not just when the user types into the input itself).
  useEffect(() => {
    setPageInput(String(pageNum));
  }, [pageNum]);

  // Lets BlueprintTakeoff's Page Notes panel track which page is current
  // without owning any of this component's own page-navigation state.
  useEffect(() => {
    onPageChange?.({ pageNum, numPages });
  }, [pageNum, numPages, onPageChange]);

  // Draws calibration crosshairs, in-progress length points, and completed
  // count/length measurements on the overlay canvas. Runs after the sizing
  // effect above (declared later, same [page, scale] dependency ordering
  // guarantee) so it never draws onto a canvas that's about to be wiped by
  // a width/height resize. Every point is stored in PDF space (scale=1);
  // multiplying by `scale` alone (not pdfToScreen, which also adds `pan`)
  // converts it back to canvas-local pixel space — this canvas already sits
  // inside the pan-translated wrapper div, so its CSS transform bakes pan in
  // once already. Adding it again here would double it and make markers
  // drift if the user pans mid-measurement.
  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return;

    const dpr = window.devicePixelRatio || 1;
    const ctx = overlayCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, overlayCanvas.width / dpr, overlayCanvas.height / dpr);

    const drawCrosshair = (x, y, color = '#dc2626') => {
      const size = 8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x - size, y);
      ctx.lineTo(x + size, y);
      ctx.moveTo(x, y - size);
      ctx.lineTo(x, y + size);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.stroke();
    };

    if (calibrationMode || calibrationPoints.length > 0) {
      const points = calibrationPoints.map((p) => ({ x: p.pdfX * scale, y: p.pdfY * scale }));
      if (points.length >= 1) drawCrosshair(points[0].x, points[0].y);
      if (points.length >= 2) {
        drawCrosshair(points[1].x, points[1].y);
        ctx.save();
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (activeTool === 'length' && lengthPoints.length === 1) {
      drawCrosshair(lengthPoints[0].pdfX * scale, lengthPoints[0].pdfY * scale, '#3b82f6');
    }

    // In-progress Area polygon — vertices placed so far, plus the segments
    // already closed between them. The final closing segment only appears
    // once the polygon is actually committed (drawn below from `areas`),
    // since until then it isn't a shape yet, just a run of clicks.
    if (activeTool === 'area' && areaPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      areaPoints.forEach((p, i) => {
        const x = p.pdfX * scale, y = p.pdfY * scale;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = '#22c55e';
      areaPoints.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.pdfX * scale, p.pdfY * scale, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    // Named areas (Area tool, closed + saved via the Name This Area modal)
    // — only the ones on the page currently being viewed, since a polygon's
    // pdfX/pdfY are only meaningful relative to the page it was drawn on.
    Object.entries(areas).filter(([, a]) => a.pageNumber === pageNum).forEach(([name, a]) => {
      const pts = (a.polygon || []).map((p) => ({ x: p.pdfX * scale, y: p.pdfY * scale }));
      if (pts.length < 3) return;

      ctx.save();
      ctx.beginPath();
      pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.closePath();
      ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
      ctx.fill();
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.restore();

      const centerX = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
      const centerY = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;

      ctx.font = 'bold 11px sans-serif';
      const textWidth = ctx.measureText(name).width;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(centerX - textWidth / 2 - 4, centerY - 9, textWidth + 8, 18);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, centerX, centerY + 0.5);
    });

    const countByLabel = {};
    measurementItems.filter((item) => item.source === 'measurement').forEach((item) => {
      if (item.tool === 'count') {
        const key = item.label || 'Count';
        countByLabel[key] = (countByLabel[key] || 0) + 1;
        const x = item.pdfX * scale;
        const y = item.pdfY * scale;
        const color = item.color || '#ef4444';

        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(countByLabel[key]), x, y + 0.5);
      } else if (item.tool === 'length' && item.point1 && item.point2) {
        const p1 = { x: item.point1.pdfX * scale, y: item.point1.pdfY * scale };
        const p2 = { x: item.point2.pdfX * scale, y: item.point2.pdfY * scale };
        const color = item.color || '#3b82f6';

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.restore();

        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const ft = Math.floor(item.length_ft || 0);
        const inches = Math.round(((item.length_ft || 0) % 1) * 12);
        const label = `${ft}'-${inches}"`;

        ctx.font = 'bold 11px sans-serif';
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(midX - textWidth / 2 - 4, midY - 9, textWidth + 8, 18);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, midX, midY + 0.5);
      }
    });
  }, [page, scale, calibrationMode, calibrationPoints, activeTool, lengthPoints, measurementItems, areaPoints, areas, pageNum]);

  const handleOverlayClick = (e) => {
    // React's SyntheticEvent doesn't carry offsetX/offsetY (they're not in
    // its copied MouseEvent property list), so e.offsetX here is always
    // undefined — derive it from clientX/clientY and the canvas's own
    // bounding rect instead. These are still canvas-local coordinates (the
    // CSS translate moves the whole wrapper div, not the canvas element
    // itself) — do NOT subtract pan here.
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const pdfX = offsetX / scale;
    const pdfY = offsetY / scale;

    if (calibrationMode) {
      console.warn('[IRONSIGHT] calibration click registered', { pdfX, pdfY, pointsSoFar: calibrationPoints.length });
      onCalibrationClick?.({ pdfX, pdfY });
      return;
    }

    if (activeTool === 'count' || activeTool === 'length') {
      if (pxPerFt == null) return;
      onMeasurementClick?.({ tool: activeTool, pdfX, pdfY });
    }

    if (activeTool === 'area') {
      if (pxPerFt == null) return;
      const now = Date.now();
      const isClosingClick = areaPoints.length > 0 && now - lastAreaClickAtRef.current < 400;
      lastAreaClickAtRef.current = now;
      onMeasurementClick?.({ tool: 'area', pdfX, pdfY, isClosingClick });
    }
  };

  // Select mode (no tool) always pans on click-drag, same as before. With a
  // tool active, pan is only allowed via the Space+drag hand tool, and only
  // once zoomed past fit (scale > 1) — below that the whole page is already
  // visible, so a bare click there still means "place a measurement point".
  // Calibration never allows panning, regardless of Space.
  const panAllowedNow = !calibrationMode && (activeTool == null || (spacePressed && scale > 1));

  const handlePointerDown = (e) => {
    // setPointerCapture on the viewport redirects the subsequent click event
    // to the viewport div, so the overlay canvas's own onClick never fires —
    // this is what keeps a Space-held pan from also registering as a tool
    // click once the pointer comes back up.
    if (!panAllowedNow) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPan: pan, pointerId: e.pointerId, viaSpace: activeTool != null };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current) return;
    const { startX, startY, startPan } = dragRef.current;
    setPan({ x: startPan.x + (e.clientX - startX), y: startPan.y + (e.clientY - startY) });
  };

  const handlePointerUp = (e) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const viewportCenter = () => {
    const el = viewportRef.current;
    if (!el) return undefined;
    return { x: el.clientWidth / 2, y: el.clientHeight / 2 };
  };

  const handleFitToWidth = () => {
    if (!pageSize.width) return;
    // Use getBoundingClientRect() instead of clientWidth — it forces a layout
    // flush and returns the actual rendered size including flex expansion.
    const rect = viewportRef.current?.getBoundingClientRect();
    const containerWidth = rect?.width || pageSize.width;
    if (containerWidth <= 0) return;
    resetTransform(Math.min(2, Math.max(0.1, (containerWidth - 32) / pageSize.width)));
  };

  const handleFitToPage = () => {
    if (!pageSize.width || !pageSize.height) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const fit = Math.min((rect.width - 32) / pageSize.width, (rect.height - 32) / pageSize.height);
    resetTransform(Math.min(2, Math.max(0.1, fit)));
  };

  const commitPageInput = () => {
    const n = parseInt(pageInput, 10);
    if (!Number.isFinite(n) || n < 1 || n > numPages) { setPageInput(String(pageNum)); return; }
    setPageNum(n);
  };

  if (!source) return null;

  return (
    <div className={fillHeight ? 'h-full w-full flex flex-col bg-muted/20' : 'border rounded-lg overflow-hidden bg-muted/20'}>
      <div className={`flex items-center justify-between gap-2 border-b bg-muted/40 py-2 flex-shrink-0 ${fillHeight ? 'pl-3 pr-28' : 'px-3'}`}>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setPageNum((n) => Math.max(1, n - 1))}
            disabled={pageNum <= 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Input
            type="number"
            min={1}
            max={numPages}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitPageInput(); }}
            onBlur={commitPageInput}
            className="w-14 h-7 text-center text-xs"
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap">of {numPages}</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setPageNum((n) => Math.min(numPages, n + 1))}
            disabled={pageNum >= numPages}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => zoomOut(viewportCenter())}>
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-12 text-center">{Math.round(scale * 100)}%</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => zoomIn(viewportCenter())}>
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={handleFitToWidth} title="Fit to width">
            Fit W
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={handleFitToPage} title="Fit to page">
            Fit Page
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`relative overflow-hidden bg-neutral-700 ${fillHeight ? 'flex-1 min-h-0' : ''}`}
        style={{ height: fillHeight ? undefined : VIEWPORT_HEIGHT, cursor: (calibrationMode || (activeTool != null && !panAllowedNow)) ? 'crosshair' : (dragRef.current ? 'grabbing' : 'grab') }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-amber-300 px-4 text-center">
            {loadError}
          </div>
        )}
        {calibrationMode && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 rounded-md bg-red-600 text-white text-xs font-semibold px-3 py-1.5 shadow-lg pointer-events-none whitespace-nowrap">
            {calibrationPoints.length === 0 && 'Step 1 of 2 — Click point 1 on a known dimension'}
            {calibrationPoints.length === 1 && 'Step 2 of 2 — Click point 2'}
            {calibrationPoints.length >= 2 && 'Points captured — enter the real-world distance below'}
          </div>
        )}
        {!calibrationMode && activeTool === 'length' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 rounded-md bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 shadow-lg pointer-events-none whitespace-nowrap">
            {lengthPoints.length === 0 ? 'Click the start of the run' : 'Click the end of the run'}
          </div>
        )}
        {!calibrationMode && activeTool === 'count' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 rounded-md bg-red-600 text-white text-xs font-semibold px-3 py-1.5 shadow-lg pointer-events-none whitespace-nowrap">
            Click each piece to count it
          </div>
        )}
        {!calibrationMode && activeTool === 'area' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 rounded-md bg-green-600 text-white text-xs font-semibold px-3 py-1.5 shadow-lg pointer-events-none whitespace-nowrap">
            {areaPoints.length === 0 ? 'Click each corner of the area' : 'Double-click to close the shape'}
          </div>
        )}
        <div
          className="absolute top-0 left-0"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <canvas ref={baseCanvasRef} className="block shadow-lg" />
          <canvas
            ref={overlayCanvasRef}
            // Overlay must actually receive clicks whenever a tool (any tool,
            // not just count/length) or calibration is live — pointer-events
            // was previously scoped to only count/length, silently dropping
            // clicks for Area and, if this list ever drifts again, calibration.
            className={`absolute inset-0 ${(calibrationMode || activeTool != null) ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-none'}`}
            onClick={handleOverlayClick}
          />
        </div>
      </div>
    </div>
  );
});

export default BlueprintCanvas;
