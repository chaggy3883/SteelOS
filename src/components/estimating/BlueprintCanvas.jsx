import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCanvasTransform } from '@/hooks/useCanvasTransform';
import { drawCountMarker } from '@/lib/countMarkerShapes';
import { MEASURE_TOOLS } from '@/lib/takeoffGeometry';
import { extractSegments, buildSnapIndex, findSnap, snapTolerancePdf } from '@/lib/pdfVectorSnap';
import { renderPdfPageToImageData } from '@/lib/pdfRevisionOverlay';
import { drawLegendOnCanvas, layoutLegendTable } from '@/lib/takeoffLegend';
import { rowBounds } from '@/lib/takeoffCarryForward';
import {
  drawMeasureRow, drawDraft, drawSnapMarker, drawViewports, drawRectPreview, drawPolygonWithCutouts, drawCountNumber,
  drawRevisionCloud, drawSearchCandidate,
} from './measureOverlayDraw';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

const VIEWPORT_HEIGHT = 640;

// Count and Bolt Count share the exact same click-to-mark/pan mechanics —
// only their setup fields differ (see CountSetupModal). A plain click drops
// a dot; a click-and-hold drag (no Space needed) pans instead, distinguished
// by whether the pointer moved more than this many px between down and up.
const CLICK_DRAG_TOOLS = ['count', 'bolt_count'];
const MARK_DRAG_THRESHOLD_PX = 5;
// Same hit-test radius used for hovering an existing marker (see
// handleOverlayMouseMove) — right-clicking within this many px of a dot
// removes it.
const DOT_HIT_RADIUS_PX = 11;
// Default Count marker radius (px) — Count Setup can pick another size per
// group (row.marker_size).
const DEFAULT_COUNT_MARKER_RADIUS = 7;
// Drawn measuring tools whose clicks are collected by BlueprintTakeoff's
// useMeasureDraft engine. Runs/shapes ('poly'/'polygon' input) close on a
// double-click.
const isDrawTool = (tool) => Boolean(MEASURE_TOOLS[tool]);
const closesOnDoubleClick = (tool) => MEASURE_TOOLS[tool]?.input === 'poly' || MEASURE_TOOLS[tool]?.input === 'polygon';

// Status color for a measurement marker — green once it's a saved takeoff
// row, blue while its confirmation modal is still open (see
// BlueprintTakeoff's pendingMeasurementMarker), red once the estimator has
// explicitly flagged it as a same-spot duplicate kept separate from an
// existing row. Falls back to blue (pending/unclassified) for any item that
// somehow has no marker_color rather than guessing green or red.
const MARKER_STATUS_COLORS = { green: '#22c55e', blue: '#3b82f6', red: '#ef4444' };

// Screen-space (canvas-local, scale-applied) point a marker is centered on
// — the click point for Count/Area, or a spot above the midpoint for Length
// so its status circle doesn't sit on top of the line's own ft/in label.
// Shared between the draw effect and the hover hit-test below so both
// agree on exactly where a marker is.
const itemScreenAnchor = (item, scale) => {
  if (item.tool === 'length' && item.point1 && item.point2) {
    return {
      x: ((item.point1.pdfX + item.point2.pdfX) / 2) * scale,
      y: ((item.point1.pdfY + item.point2.pdfY) / 2) * scale - 26,
    };
  }
  // Newer drawn tools put their value label on the anchor itself, so the
  // status circle sits above it the same way Length's does.
  if (item.tool !== 'area' && isDrawTool(item.tool) && item.pdfX != null && item.pdfY != null) {
    return { x: item.pdfX * scale, y: item.pdfY * scale - 26 };
  }
  if ((item.tool === 'count' || item.tool === 'bolt_count') && item.points?.length) {
    return { x: item.points[0].pdfX * scale, y: item.points[0].pdfY * scale };
  }
  if (item.pdfX != null && item.pdfY != null) return { x: item.pdfX * scale, y: item.pdfY * scale };
  return null;
};

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
  // In-progress drawing from BlueprintTakeoff's useMeasureDraft — { points,
  // outer, cutouts } — plus how circles are picked ('center' | 'three').
  draft = null,
  circleMode = 'center',
  onMeasurementClick,
  // Enter-equivalent for the on-canvas Finish button (Area/Volume cutouts).
  onFinishShape,
  measurementItems = [],
  // True when the current page has any usable scale (page, older whole-set
  // scale, or at least one scaled viewport). Measuring clicks are ignored
  // while false — the page shows an "isn't calibrated" banner instead.
  canMeasure = false,
  // (pt) => resolved scale for a PDF-space point ({ ptsPerFt, label,
  // source, name } or null) — drives the live readout and the scale chip.
  getScaleAt = null,
  // Scale viewports on the current page (dashed boxes with their scale).
  viewports = [],
  // Snap to the drawing's own line work; holding Alt places freely.
  snapEnabled = true,
  // 'line' (two-point calibrate/check) or 'rect' (viewport corners), plus
  // the banner text for each step of that pick.
  calibrationShape = 'line',
  calibrationSteps = null,
  candidateMarkers = [],
  onCandidateToggle,
  // Count/Bolt Count only — the active, not-yet-saved tally session's dots
  // (BlueprintTakeoff's countSession), drawn distinctly from committed
  // measurementItems rows since they don't exist in `rows` until Save.
  // onCountMark fires on a genuine (non-drag) click while a click-to-mark
  // tool is active; onCountDotRemove fires on a right-click hit against one
  // of activeCountSession's own points (by index).
  activeCountSession = null,
  onCountMark,
  onCountDotRemove,
  fillHeight = false,
  // steelCatalog — reserved for a future size-aware area tool; accepted here
  // so BlueprintTakeoff can start threading it through without this
  // component needing to know its shape yet.
  steelCatalog = {},
  // Named polygon regions (Area tool, once named via the Name This Area
  // modal) — keyed by name, each holding { polygon, pageNumber }. Only the
  // ones matching the current page are ever drawn (see the overlay effect).
  areas = {},
  // _key/id of whichever measurementItems entry the takeoff table's row
  // click most recently highlighted — see the overlay effect for how this
  // gets an extra ring/box drawn around it.
  highlightedItemKey = null,
  // Legends on this page: [{ key, legend (takeoffLegend.buildLegendData),
  // anchor: 'top-left'|'top-right'|'bottom-left'|'bottom-right'|'custom',
  // pdfX, pdfY }]. Drawn at 8pt so they zoom with the sheet. In select mode
  // a legend can be dragged; onLegendMove(key, { pdfX, pdfY }) reports where
  // it was dropped (top-left corner, PDF space).
  legends = [],
  onLegendMove,
  // Visual Search: while boxSelectMode is on, a click-drag draws a box and
  // onBoxSelect({ x, y, width, height }) gets it in PDF space. Candidates
  // ([{ id, pdfX, pdfY, pdfWidth, pdfHeight, score, status }]) are drawn as
  // boxes; clicking one in select mode calls onSearchCandidateClick(id).
  boxSelectMode = false,
  onBoxSelect,
  searchCandidates = [],
  onSearchCandidateClick,
  // Saved revision change clouds for this page (pdf-space boxes).
  revisionClouds = [],
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
  // "Shape | Size | Phase | Area" tooltip for whichever measurement marker
  // (if any) is currently under the cursor — hoverPos is canvas-local
  // (pan-space) so the tooltip div, rendered inside the same pan-translated
  // wrapper as the canvases, tracks the marker correctly at any pan offset.
  const [hoveredItem, setHoveredItem] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  // Live cursor in PDF space (after snapping) and the snap target under it,
  // drawn on their own top canvas so a mouse move never redraws every saved
  // marker on the main overlay.
  const [cursorPdf, setCursorPdf] = useState(null);
  const [snapHit, setSnapHit] = useState(null);
  const [snapIndex, setSnapIndex] = useState(null);

  const { scale, pan, setPan, zoomIn, zoomOut, resetTransform } = useCanvasTransform(1);

  const viewportRef = useRef(null);
  const baseCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const cursorCanvasRef = useRef(null);
  // Extracted line work per page, so flipping back to a page doesn't re-read
  // its whole operator list. Cleared whenever a different PDF loads.
  const snapCacheRef = useRef(new Map());
  const renderTaskRef = useRef(null);
  const dragRef = useRef(null);
  // Closes an in-progress Area polygon on a real double-click without
  // relying on the browser's native dblclick event, which fires in addition
  // to (not instead of) the two ordinary click events that make it up —
  // using it directly would add two stray vertices right before closing.
  const lastAreaClickAtRef = useRef(0);
  // Where each legend was last drawn (canvas px, current zoom) — for the
  // select-mode drag hit test — plus the live drag position while dragging.
  const legendBoundsRef = useRef([]);
  const [legendDrag, setLegendDrag] = useState(null); // { key, pdfX, pdfY }
  // Visual Search box being dragged out (PDF space corners).
  const [boxDraft, setBoxDraft] = useState(null); // { a, b }

  // goToPage lets BlueprintTakeoff's takeoff table jump straight to
  // whatever page a clicked row's marker lives on. getFullPageDataUrl/
  // getCropDataUrl are called by BlueprintTakeoff's Find Similar/Count
  // Similar features but were never implemented here — canvasRef.current
  // was always null before this ref existed at all (forwardRef's `ref` was
  // accepted but never wired up), so those two features have always
  // silently no-opped rather than crashed. Stubbed the same way here so
  // adding this ref for goToPage doesn't turn that into an actual runtime
  // error; not fixing that pre-existing gap as part of this change.
  // renderPageImage renders the CURRENT page off-screen at `renderScale`
  // (pixels per PDF point) for Visual Search's template matcher — returns
  // { image, renderScale, pageNumber } or null before a page has loaded.
  useImperativeHandle(ref, () => ({
    goToPage: (n) => setPageNum((prev) => (Number.isFinite(n) && n >= 1 && n <= numPages ? n : prev)),
    getFullPageDataUrl: () => null,
    getCropDataUrl: () => null,
    renderPageImage: async (renderScale = 2) => {
      if (!page) return null;
      const image = await renderPdfPageToImageData(page, renderScale);
      return { image, renderScale, pageNumber: page.pageNumber };
    },
  }), [numPages, page]);

  // Loads the document whenever `source` changes (a URL string, or a
  // File/Blob — both accepted so this can be wired directly to the same
  // upload BlueprintTakeoff already does). Destroys the previous document
  // on every change/unmount so pdfjs frees its worker-side resources.
  //
  // Destroy via the LOADING TASK (pdfjsLib.getDocument(params)'s own return
  // value), not the resolved PDFDocumentProxy — in pdfjs-dist 6.x the proxy
  // itself has no .destroy() method at all (that convenience delegation was
  // removed from older pdf.js versions); only PDFDocumentLoadingTask.destroy()
  // exists. Calling doc.destroy() threw "doc.destroy is not a function" on
  // every unmount with a loaded PDF (e.g. IRONSIGHT's "Back to sessions"),
  // which went uncaught and blanked the whole screen before the error
  // boundary below existed.
  useEffect(() => {
    if (!source) {
      setPdfDoc(null);
      setNumPages(0);
      return;
    }
    let cancelled = false;
    let loadingTask = null;
    setIsLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const params = typeof source === 'string' ? { url: source } : { data: await source.arrayBuffer() };
        loadingTask = pdfjsLib.getDocument(params);
        const doc = await loadingTask.promise;
        if (cancelled) {
          loadingTask.destroy();
          return;
        }
        snapCacheRef.current = new Map();
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
      loadingTask?.destroy();
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

    [overlayCanvas, cursorCanvasRef.current].forEach((c) => {
      if (!c) return;
      c.width = Math.ceil(viewport.width * dpr);
      c.height = Math.ceil(viewport.height * dpr);
      c.style.width = `${viewport.width}px`;
      c.style.height = `${viewport.height}px`;
    });

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

  // Snap-to-drawing: read this page's own vector line work once (cached per
  // page) while snapping is on. Pages that are just a scanned image simply
  // come back with no lines, and snapping quietly does nothing.
  useEffect(() => {
    if (!page || !snapEnabled) {
      setSnapIndex(null);
      return undefined;
    }
    // Keyed by the page proxy's own number, not pageNum — pageNum flips a
    // render before the new page proxy arrives.
    const pageKey = page.pageNumber;
    const cached = snapCacheRef.current.get(pageKey);
    if (cached) {
      setSnapIndex(cached);
      return undefined;
    }
    let cancelled = false;
    setSnapIndex(null);
    page.getOperatorList({ annotationMode: pdfjsLib.AnnotationMode.DISABLE })
      .then((opList) => {
        if (cancelled) return;
        const segments = extractSegments(opList, page.getViewport({ scale: 1 }).transform, pdfjsLib.OPS);
        const index = buildSnapIndex(segments);
        snapCacheRef.current.set(pageKey, index);
        setSnapIndex(index);
      })
      .catch((e) => console.warn('IRONSIGHT snap: could not read line work for this page', e));
    return () => { cancelled = true; };
  }, [page, snapEnabled]);

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

  // A stale tooltip pinned to a marker's old screen position would be
  // actively misleading after a zoom/page change moves that marker —
  // clearing it here just means the estimator's next mousemove re-hits
  // whatever's actually under the cursor now.
  useEffect(() => {
    setHoveredItem(null);
    setCursorPdf(null);
    setSnapHit(null);
  }, [pageNum, scale]);

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

    if ((calibrationMode || calibrationPoints.length > 0) && calibrationShape === 'rect') {
      if (calibrationPoints.length >= 2) drawRectPreview(ctx, calibrationPoints[0], calibrationPoints[1], scale);
      calibrationPoints.forEach((p) => drawCrosshair(p.pdfX * scale, p.pdfY * scale, '#0891b2'));
    } else if (calibrationMode || calibrationPoints.length > 0) {
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

    // Scale viewports on this page — dashed boxes with their own scale.
    drawViewports(ctx, viewports, scale);

    // In-progress drawing for every measuring tool (Length, Area, …) lives
    // on the cursor canvas — see the cursor-layer effect below.

    // Named areas (Area tool, closed + saved via the Name This Area modal)
    // — only the ones on the page currently being viewed, since a polygon's
    // pdfX/pdfY are only meaningful relative to the page it was drawn on.
    Object.entries(areas).filter(([, a]) => a.pageNumber === pageNum).forEach(([name, a]) => {
      const pts = (a.polygon || []).map((p) => ({ x: p.pdfX * scale, y: p.pdfY * scale }));
      if (pts.length < 3) return;

      // Cutouts (if any) are punched out of the fill, even-odd.
      drawPolygonWithCutouts(ctx, a.polygon, a.cutouts, scale, { stroke: '#22c55e', fill: 'rgba(34, 197, 94, 0.15)' });

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

    // Filled status circle (green=saved, blue=pending confirmation,
    // red=kept-separate duplicate) shared by Count/Length/Area markers —
    // 75% opacity fill so overlapping markers stay distinguishable, full-
    // opacity white outline and quantity label on top so those never wash
    // out under the translucent fill.
    const drawStatusMarker = (x, y, item) => {
      const fillColor = MARKER_STATUS_COLORS[item.marker_color] || MARKER_STATUS_COLORS.blue;
      const radius = 10;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`x${item.quantity || 1}`, x, y + 0.5);
    };

    // A brief dashed amber ring/box around whichever marker the takeoff
    // table's row click most recently highlighted (BlueprintTakeoff clears
    // highlightedItemKey ~1.6s later, giving the "flash" effect without any
    // animation loop here).
    const isHighlighted = (item) => highlightedItemKey != null && (item._key || item.id) === highlightedItemKey;
    const drawHighlightRing = (x, y) => {
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };
    const drawHighlightBox = (p1, p2) => {
      const minX = Math.min(p1.x, p2.x) - 14;
      const maxX = Math.max(p1.x, p2.x) + 14;
      const minY = Math.min(p1.y, p2.y) - 14;
      const maxY = Math.max(p1.y, p2.y) + 14;
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      ctx.restore();
    };

    // Saved revision change clouds for this page, under the markups.
    revisionClouds.forEach((box) => drawRevisionCloud(ctx, box, scale, '#dc2626'));

    measurementItems.filter((item) => item.source === 'measurement').forEach((item) => {
      // Carried forward from an older revision into a changed area — dashed
      // amber box until the estimator marks it checked.
      if (item.review_flag && (item.page_number || 1) === pageNum) {
        const b = rowBounds(item);
        if (b) {
          ctx.save();
          ctx.strokeStyle = '#d97706';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(b.x * scale - 10, b.y * scale - 10, b.width * scale + 20, b.height * scale + 20);
          ctx.restore();
        }
      }
      if (item.tool === 'count' || item.tool === 'bolt_count') {
        // New-style rows carry one dot per click in `points`; a legacy
        // single-click count row (pre-tally-engine) only ever had a bare
        // pdfX/pdfY — fall back to treating that as a one-point group so it
        // still renders after this redesign.
        const pts = item.points?.length ? item.points : (item.pdfX != null && item.pdfY != null ? [{ pdfX: item.pdfX, pdfY: item.pdfY }] : []);
        const radius = item.marker_size || DEFAULT_COUNT_MARKER_RADIUS;
        pts.forEach((p, i) => {
          drawCountMarker(ctx, p.pdfX * scale, p.pdfY * scale, { color: item.color, symbol: item.symbol }, radius);
          if (item.show_numbers) drawCountNumber(ctx, i + 1, p.pdfX * scale, p.pdfY * scale, radius);
        });
        if (isHighlighted(item) && pts[0]) drawHighlightRing(pts[0].pdfX * scale, pts[0].pdfY * scale);
      } else if (item.tool === 'length' && item.point1 && item.point2) {
        const p1 = { x: item.point1.pdfX * scale, y: item.point1.pdfY * scale };
        const p2 = { x: item.point2.pdfX * scale, y: item.point2.pdfY * scale };
        // Measured with a tool-set tool → drawn in that tool's color (the
        // status circle above still shows saved / duplicate).
        const statusColor = item.tool_set_tool_id && item.color ? item.color : (MARKER_STATUS_COLORS[item.marker_color] || MARKER_STATUS_COLORS.blue);

        ctx.save();
        ctx.strokeStyle = statusColor;
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

        // Status circle sits above the length label instead of on top of
        // it — same anchor itemScreenAnchor uses for the hover hit-test.
        drawStatusMarker(midX, midY - 26, item);
        if (isHighlighted(item)) drawHighlightBox(p1, p2);
      } else if (item.tool === 'area' && item.pdfX != null && item.pdfY != null) {
        // The named zone itself (fill/outline/label) is drawn separately
        // above from `areas` — this is only the takeoff-row status circle
        // for that same closed shape, centered on its centroid.
        const x = item.pdfX * scale, y = item.pdfY * scale;
        // Rows saved since cutouts existed carry their own outline (the
        // named zone above only lives for the current visit).
        if (item.polygon_points?.length >= 3) {
          drawPolygonWithCutouts(ctx, item.polygon_points, item.cutouts, scale, { stroke: MARKER_STATUS_COLORS[item.marker_color] || MARKER_STATUS_COLORS.blue });
        }
        drawStatusMarker(x, y, item);
        if (isHighlighted(item)) drawHighlightRing(x, y);
      } else if (isDrawTool(item.tool) && item.pdfX != null && item.pdfY != null) {
        // Polylength / Perimeter / Volume / Wall Area / Angle / Radius /
        // Diameter — shape + value label at the anchor, status circle above.
        const statusColor = item.tool_set_tool_id && item.color ? item.color : (MARKER_STATUS_COLORS[item.marker_color] || MARKER_STATUS_COLORS.blue);
        drawMeasureRow(ctx, item, scale, statusColor);
        const anchor = itemScreenAnchor(item, scale);
        drawStatusMarker(anchor.x, anchor.y, item);
        if (isHighlighted(item)) drawHighlightRing(anchor.x, anchor.y);
      }
    });

    // The active, not-yet-saved Count/Bolt Count session's own dots — kept
    // separate from measurementItems since nothing here is a committed
    // takeoff row until the tally panel's Save is clicked.
    if (activeCountSession?.points?.length) {
      const radius = activeCountSession.fields?.marker_size || DEFAULT_COUNT_MARKER_RADIUS;
      activeCountSession.points.forEach((p, i) => {
        drawCountMarker(ctx, p.pdfX * scale, p.pdfY * scale, { color: activeCountSession.color, symbol: activeCountSession.symbol }, radius);
        if (activeCountSession.fields?.show_numbers) drawCountNumber(ctx, i + 1, p.pdfX * scale, p.pdfY * scale, radius);
      });
    }

    searchCandidates.forEach((c) => drawSearchCandidate(ctx, c, scale));

    // Legends last so they sit on top of the markups. Corner anchors are
    // resolved here, where the table's size is known.
    const bounds = [];
    if (pageSize.width > 0) {
      const fontSize = 8 * scale;
      const measureText = (t, fs) => { ctx.font = `${fs}px Helvetica, Arial, sans-serif`; return ctx.measureText(String(t)).width; };
      legends.forEach((l) => {
        if (!l?.legend?.rows?.length) return;
        const layout = layoutLegendTable(l.legend, { fontSize, measureText });
        const margin = 18 * scale;
        const anchor = l.anchor || 'bottom-right';
        let x;
        let y;
        if (legendDrag?.key === l.key) {
          x = legendDrag.pdfX * scale; y = legendDrag.pdfY * scale;
        } else if (anchor === 'custom' && l.pdfX != null && l.pdfY != null) {
          x = l.pdfX * scale; y = l.pdfY * scale;
        } else {
          x = anchor.includes('right') ? pageSize.width * scale - margin - layout.width : margin;
          y = anchor.includes('bottom') ? pageSize.height * scale - margin - layout.height : margin;
        }
        drawLegendOnCanvas(ctx, l.legend, x, y, { fontSize });
        bounds.push({ key: l.key, x, y, width: layout.width, height: layout.height });
      });
    }
    legendBoundsRef.current = bounds;
  }, [page, scale, calibrationMode, calibrationPoints, calibrationShape, measurementItems, areas, pageNum, highlightedItemKey, activeCountSession, viewports, revisionClouds, searchCandidates, legends, legendDrag, pageSize]);

  // Cursor layer — the in-progress drawing with its rubber band to the
  // cursor and live readout, the snap marker, and a viewport being dragged
  // out. Redrawn on every mouse move without touching the main overlay.
  useEffect(() => {
    const c = cursorCanvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width / dpr, c.height / dpr);

    if (calibrationMode && calibrationShape === 'rect' && calibrationPoints.length === 1 && cursorPdf) {
      drawRectPreview(ctx, calibrationPoints[0], cursorPdf, scale);
    }
    if (!calibrationMode && isDrawTool(activeTool) && draft) {
      const first = draft.outer?.[0] || draft.points?.[0] || cursorPdf;
      const ptsPerFt = first && getScaleAt ? getScaleAt(first)?.ptsPerFt : null;
      drawDraft(ctx, { tool: activeTool, draft, cursor: cursorPdf, scale, circleMode, ptsPerFt });
    }
    if (calibrationMode || isDrawTool(activeTool)) drawSnapMarker(ctx, snapHit, scale);
    if (boxDraft) drawRectPreview(ctx, boxDraft.a, boxDraft.b, scale);
  }, [page, scale, cursorPdf, snapHit, draft, activeTool, circleMode, calibrationMode, calibrationShape, calibrationPoints, getScaleAt, boxDraft]);

  // Where a click at this event should land in PDF space: snapped to the
  // drawing's line work when snapping is on (Alt held = place freely).
  // Rect comes from the overlay canvas itself (pointer capture can retarget
  // events to the viewport div) — still canvas-local, never minus pan.
  const pickPoint = (e) => {
    const rect = (overlayCanvasRef.current || e.currentTarget).getBoundingClientRect();
    const raw = { pdfX: (e.clientX - rect.left) / scale, pdfY: (e.clientY - rect.top) / scale };
    if (!snapEnabled || e.altKey || !snapIndex) return { pt: raw, snap: null };
    const snap = findSnap(snapIndex, raw, snapTolerancePdf(scale));
    return snap ? { pt: { pdfX: snap.pdfX, pdfY: snap.pdfY }, snap } : { pt: raw, snap: null };
  };

  const handleOverlayClick = (e) => {
    // React's SyntheticEvent doesn't carry offsetX/offsetY (they're not in
    // its copied MouseEvent property list), so e.offsetX here is always
    // undefined — derive it from clientX/clientY and the canvas's own
    // bounding rect instead. These are still canvas-local coordinates (the
    // CSS translate moves the whole wrapper div, not the canvas element
    // itself) — do NOT subtract pan here.
    // pickPoint does the clientX/rect math (canvas-local, never minus pan)
    // and snaps to the drawing's line work when snapping is on.
    const { pt } = pickPoint(e);
    const { pdfX, pdfY } = pt;

    if (calibrationMode) {
      onCalibrationClick?.({ pdfX, pdfY });
      return;
    }

    // Count/Bolt Count no longer mark on this event — a click-to-mark tool's
    // pointer is always captured on mousedown (see handlePointerDown), which
    // redirects the click event to the viewport and marks from
    // handlePointerUp instead, so it can tell a real click apart from a
    // click-and-hold pan. This branch only ever ran for those tools before
    // the tally engine existed.
    if (isDrawTool(activeTool)) {
      if (!canMeasure) return;
      // Runs/shapes close on a real double-click. The browser fires two
      // ordinary clicks for it, so the second click of a quick pair is the
      // "close" and isn't added as a vertex.
      let isClosingClick = false;
      if (closesOnDoubleClick(activeTool)) {
        const now = Date.now();
        const hasPoints = (draft?.points?.length || 0) > 0;
        isClosingClick = hasPoints && now - lastAreaClickAtRef.current < 400;
        lastAreaClickAtRef.current = isClosingClick ? 0 : now;
      }
      onMeasurementClick?.({ tool: activeTool, pdfX, pdfY, isClosingClick });
    }
  };

  // Right-click removes an existing dot from the active Count/Bolt Count
  // session (decrementing the tally) — only meaningful while that session is
  // live, so this no-ops entirely for every other tool/mode, including a
  // right-click over an already-saved (non-active) count row's dots.
  const handleOverlayContextMenu = (e) => {
    if (!CLICK_DRAG_TOOLS.includes(activeTool) || !activeCountSession?.points?.length) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    let hitIndex = -1;
    let hitDist = Infinity;
    // Bigger markers (Count Setup's marker size) get a matching hit area.
    const hitRadius = Math.max(DOT_HIT_RADIUS_PX, (activeCountSession.fields?.marker_size || DEFAULT_COUNT_MARKER_RADIUS) + 4);
    activeCountSession.points.forEach((p, i) => {
      const d = Math.hypot(offsetX - p.pdfX * scale, offsetY - p.pdfY * scale);
      if (d <= hitRadius && d < hitDist) {
        hitDist = d;
        hitIndex = i;
      }
    });
    if (hitIndex >= 0) onCountDotRemove?.(hitIndex);
  };

  // Hover tooltip for whichever marker (if any) is under the cursor right
  // now — meant to work in plain select mode as much as while a tool's
  // active, so it doesn't gate on calibrationMode/activeTool the way
  // handleOverlayClick does. Skipped mid-drag so a pan doesn't also spam
  // hit-tests every frame.
  const handleOverlayMouseMove = (e) => {
    if (dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    const hit = measurementItems
      .filter((item) => item.source === 'measurement')
      .find((item) => {
        const anchor = itemScreenAnchor(item, scale);
        return anchor && Math.hypot(offsetX - anchor.x, offsetY - anchor.y) <= 11;
      });

    setHoveredItem(hit || null);
    setHoverPos({ x: offsetX, y: offsetY });

    // Live cursor + snap target, only while something is being picked.
    if (calibrationMode || isDrawTool(activeTool)) {
      const { pt, snap } = pickPoint(e);
      setCursorPdf(pt);
      setSnapHit(snap);
    } else if (cursorPdf) {
      setCursorPdf(null);
      setSnapHit(null);
    }
  };

  const handleOverlayMouseLeave = () => {
    setHoveredItem(null);
    setCursorPdf(null);
    setSnapHit(null);
  };

  // Select mode (no tool) always pans on click-drag, same as before. With a
  // tool active, pan is only allowed via the Space+drag hand tool, and only
  // once zoomed past fit (scale > 1) — below that the whole page is already
  // visible, so a bare click there still means "place a measurement point".
  // Calibration never allows panning, regardless of Space.
  const panAllowedNow = !calibrationMode && (activeTool == null || (spacePressed && scale > 1));

  const canvasPdfPoint = (e) => {
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { pdfX: (e.clientX - rect.left) / scale, pdfY: (e.clientY - rect.top) / scale };
  };

  const handlePointerDown = (e) => {
    // Visual Search box pick — takes over every other gesture while on.
    if (boxSelectMode && !calibrationMode) {
      if (e.button !== 0) return;
      const pt = canvasPdfPoint(e);
      if (!pt) return;
      dragRef.current = { boxSelect: true, pointerId: e.pointerId };
      setBoxDraft({ a: pt, b: pt });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    // Select mode on a legend → drag the legend instead of panning.
    if (activeTool == null && !calibrationMode && e.button === 0 && legendBoundsRef.current.length) {
      const rect = overlayCanvasRef.current?.getBoundingClientRect();
      if (rect) {
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const hit = legendBoundsRef.current.find((b) => cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height);
        if (hit) {
          dragRef.current = { legendKey: hit.key, startX: e.clientX, startY: e.clientY, startPdf: { pdfX: hit.x / scale, pdfY: hit.y / scale }, pointerId: e.pointerId };
          setLegendDrag({ key: hit.key, pdfX: hit.x / scale, pdfY: hit.y / scale });
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }
    }
    // setPointerCapture on the viewport redirects the subsequent click event
    // to the viewport div, so the overlay canvas's own onClick never fires —
    // this is what keeps a Space-held pan from also registering as a tool
    // click once the pointer comes back up.
    //
    // Count/Bolt Count are a special case: they always capture the pointer
    // (no Space needed) so a click-and-hold can pan, but whether this
    // gesture ends up being a pan or a mark isn't known until pointerup —
    // see handlePointerMove/handlePointerUp's `moved` tracking below.
    if (CLICK_DRAG_TOOLS.includes(activeTool)) {
      // Right-click is handled entirely by handleOverlayContextMenu (remove
      // a dot) — don't also start a mark/pan gesture for it.
      if (e.button !== 0) return;
      dragRef.current = { startX: e.clientX, startY: e.clientY, startPan: pan, pointerId: e.pointerId, isMarkTool: true, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (!panAllowedNow) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPan: pan, pointerId: e.pointerId, viaSpace: activeTool != null };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  // Select mode over a Visual Search candidate box → accept/reject it.
  // Select mode always captures the pointer for panning, so the canvas never
  // sees a click — a pan that didn't actually move is treated as one here.
  const hitSearchCandidate = (pt) => searchCandidates.find((c) => pt.pdfX >= c.pdfX && pt.pdfX <= c.pdfX + c.pdfWidth && pt.pdfY >= c.pdfY && pt.pdfY <= c.pdfY + c.pdfHeight);

  const handlePointerMove = (e) => {
    if (!dragRef.current) return;
    if (!dragRef.current.isMarkTool && !dragRef.current.moved
      && Math.hypot(e.clientX - (dragRef.current.startX ?? e.clientX), e.clientY - (dragRef.current.startY ?? e.clientY)) > MARK_DRAG_THRESHOLD_PX) {
      dragRef.current.moved = true;
    }
    if (dragRef.current.boxSelect) {
      const pt = canvasPdfPoint(e);
      if (pt) setBoxDraft((d) => (d ? { ...d, b: pt } : d));
      return;
    }
    if (dragRef.current.legendKey) {
      const { startX, startY, startPdf, legendKey } = dragRef.current;
      setLegendDrag({ key: legendKey, pdfX: startPdf.pdfX + (e.clientX - startX) / scale, pdfY: startPdf.pdfY + (e.clientY - startY) / scale });
      return;
    }
    const { startX, startY, startPan } = dragRef.current;
    if (dragRef.current.isMarkTool && !dragRef.current.moved) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) <= MARK_DRAG_THRESHOLD_PX) return;
      dragRef.current.moved = true;
    }
    setPan({ x: startPan.x + (e.clientX - startX), y: startPan.y + (e.clientY - startY) });
  };

  const handlePointerUp = (e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);

    if (drag?.boxSelect) {
      const box = boxDraft;
      setBoxDraft(null);
      if (box) {
        const x = Math.min(box.a.pdfX, box.b.pdfX);
        const y = Math.min(box.a.pdfY, box.b.pdfY);
        const width = Math.abs(box.b.pdfX - box.a.pdfX);
        const height = Math.abs(box.b.pdfY - box.a.pdfY);
        // A stray click (no real box) isn't a pick.
        if (width * scale >= 6 && height * scale >= 6) onBoxSelect?.({ x, y, width, height });
      }
      return;
    }
    if (drag && !drag.isMarkTool && !drag.moved && !drag.boxSelect && !drag.legendKey && activeTool == null && searchCandidates.length) {
      const pt = canvasPdfPoint(e);
      const hit = pt && hitSearchCandidate(pt);
      if (hit) { onSearchCandidateClick?.(hit.id); return; }
    }
    if (drag?.legendKey) {
      const moved = legendDrag;
      setLegendDrag(null);
      if (moved && (Math.abs(e.clientX - drag.startX) > 2 || Math.abs(e.clientY - drag.startY) > 2)) {
        onLegendMove?.(drag.legendKey, { pdfX: moved.pdfX, pdfY: moved.pdfY });
      }
      return;
    }

    // The pointer never moved past the drag threshold — this was a mark
    // click, not a pan. Compute pdfX/pdfY off the overlay canvas's own rect
    // (not the viewport, which is where pointer capture retargeted this
    // event) so it lines up with every other click-to-PDF-space conversion
    // in this file.
    if (drag?.isMarkTool && !drag.moved) {
      if (!canMeasure) return;
      const rect = overlayCanvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      onCountMark?.({ tool: activeTool, pdfX: (e.clientX - rect.left) / scale, pdfY: (e.clientY - rect.top) / scale });
    }
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
        style={{ height: fillHeight ? undefined : VIEWPORT_HEIGHT, cursor: (calibrationMode || boxSelectMode || (activeTool != null && !panAllowedNow)) ? 'crosshair' : (dragRef.current ? 'grabbing' : 'grab') }}
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
            {calibrationSteps
              ? calibrationSteps[Math.min(calibrationPoints.length, calibrationSteps.length - 1)]
              : (
                <>
                  {calibrationPoints.length === 0 && 'Step 1 of 2 — Click point 1 on a known dimension'}
                  {calibrationPoints.length === 1 && 'Step 2 of 2 — Click point 2'}
                  {calibrationPoints.length >= 2 && 'Points captured — enter the real-world distance below'}
                </>
              )}
          </div>
        )}
        {!calibrationMode && isDrawTool(activeTool) && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 rounded-md bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 shadow-lg whitespace-nowrap flex items-center gap-2 pointer-events-none">
            <span className="pointer-events-none">
              {draft?.outer
                ? 'Shape closed — draw any cutouts inside it (double-click closes each), then Finish'
                : MEASURE_TOOLS[activeTool].input === 'poly' || MEASURE_TOOLS[activeTool].input === 'polygon'
                  ? `${MEASURE_TOOLS[activeTool].hint} · double-click or Enter to finish · Backspace undoes a point`
                  : MEASURE_TOOLS[activeTool].hint}
              {snapEnabled ? ' · hold Alt to place without snapping' : ''}
            </span>
            {draft?.outer && (
              <Button size="sm" variant="secondary" className="h-6 px-2 text-xs pointer-events-auto" onClick={() => onFinishShape?.()}>Finish (Enter)</Button>
            )}
          </div>
        )}
        {!calibrationMode && !canMeasure && page && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-10 rounded-md bg-amber-500 text-white text-xs font-semibold px-3 py-1.5 shadow-lg pointer-events-none whitespace-nowrap">
            This page isn&apos;t calibrated — set its scale before measuring
          </div>
        )}
        {page && getScaleAt && (
          <div className="absolute bottom-2 left-2 z-10 rounded bg-black/70 text-white text-[11px] px-2 py-1 pointer-events-none whitespace-nowrap">
            {(() => {
              const s = getScaleAt(cursorPdf || null);
              if (!s) return 'Scale: not set on this page';
              if (s.blocked) return `${s.name || 'Viewport'}: scale not set`;
              return `Scale: ${s.label}${s.source === 'viewport' ? ` (${s.name || 'viewport'})` : s.source === 'legacy' ? ' (whole set, older session)' : ''}`;
            })()}
          </div>
        )}
        {boxSelectMode && !calibrationMode && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 rounded-md bg-violet-600 text-white text-xs font-semibold px-3 py-1.5 shadow-lg pointer-events-none whitespace-nowrap">
            Drag a box around ONE symbol to find the others like it · Esc to cancel
          </div>
        )}
        {!calibrationMode && (activeTool === 'count' || activeTool === 'bolt_count') && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 rounded-md bg-red-600 text-white text-xs font-semibold px-3 py-1.5 shadow-lg pointer-events-none whitespace-nowrap">
            Click to mark · click-and-hold to pan · right-click a dot to remove it
          </div>
        )}
        <div
          className="absolute top-0 left-0"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <canvas ref={baseCanvasRef} className="block shadow-lg" />
          <canvas
            ref={overlayCanvasRef}
            // Always pointer-events-auto now, not just while a tool/
            // calibration is live — the marker hover tooltip needs to work
            // in plain select mode too, and handleOverlayClick already
            // no-ops on its own when neither is active, so this doesn't
            // change click behavior, only which mode hover works in.
            className={`absolute inset-0 pointer-events-auto ${(calibrationMode || activeTool != null) ? 'cursor-crosshair' : ''}`}
            onClick={handleOverlayClick}
            onContextMenu={handleOverlayContextMenu}
            onMouseMove={handleOverlayMouseMove}
            onMouseLeave={handleOverlayMouseLeave}
          />
          <canvas ref={cursorCanvasRef} className="absolute inset-0 pointer-events-none" />
          {hoveredItem && (
            <div
              className="absolute z-20 pointer-events-none rounded bg-black/80 text-white text-[11px] px-2 py-1 whitespace-nowrap"
              style={{ left: hoverPos.x + 14, top: hoverPos.y + 14 }}
            >
              {[hoveredItem.shape_type, hoveredItem.size_designation, hoveredItem.phase, hoveredItem.area].filter(Boolean).join(' | ') || 'Measurement'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default BlueprintCanvas;
