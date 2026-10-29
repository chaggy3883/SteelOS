import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useCanvasTransform } from '@/hooks/useCanvasTransform';
import { drawCountMarker } from '@/lib/countMarkerShapes';
import { MEASURE_TOOLS } from '@/lib/takeoffGeometry';
import { extractSegments, buildSnapIndex, findSnap, snapTolerancePdf } from '@/lib/pdfVectorSnap';
import { renderPdfPageToImageData } from '@/lib/pdfRevisionOverlay';
import { drawLegendOnCanvas, layoutLegendTable } from '@/lib/takeoffLegend';
import { rowBounds } from '@/lib/takeoffCarryForward';
import {
  viewMatrix, viewportToPdf, displaySize, fitPageScale, fitWidthScale, centeredPan, viewForRect,
  visibleDisplayRect, wheelZoomFactor, orthoPoint, normRotation, clampZoom,
} from '@/lib/ironsightView';
import {
  MARKUP_TYPES, hitTestMarkup, markupBounds, normalizeBox, distToSegment, boxesIntersect,
  applyHandleDrag, DEFAULT_STAMP_SIZE, DEFAULT_TEXTBOX_SIZE,
} from '@/lib/drawingMarkups';
import {
  drawMeasureRow, drawDraft, drawSnapMarker, drawViewports, drawRectPreview, drawPolygonWithCutouts, drawCountNumber,
  drawRevisionCloud, drawSearchCandidate,
} from './measureOverlayDraw';
import {
  drawDrawingMarkup, drawSelectionBox, drawMarkupDraft, drawGrid, drawSearchHits, drawMarquee, handlesFor,
  measureText as measureMarkupText,
} from './ironsight-workspace/markupCanvasDraw';
import InPlaceTextEditor from './ironsight-workspace/InPlaceTextEditor';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

// Count and Bolt Count share the exact same click-to-mark/pan mechanics —
// only their setup fields differ (see CountSetupModal). A plain click drops
// a dot; a click-and-hold drag pans instead, distinguished by whether the
// pointer moved more than this many px between down and up. The drawn
// measuring tools and Calibrate work the same way now: click places, drag
// pans.
const CLICK_DRAG_TOOLS = ['count', 'bolt_count'];
const MARK_DRAG_THRESHOLD_PX = 5;
// Right-clicking within this many px of a live count dot removes it.
const DOT_HIT_RADIUS_PX = 11;
const DEFAULT_COUNT_MARKER_RADIUS = 7;
// Gap between stacked pages in continuous view, viewport px.
const PAGE_GAP_PX = 24;
// Pixel budget for the sharp region render (canvas memory stays bounded at
// any zoom — 6400% of an E-size sheet would otherwise be a 160,000 px canvas).
const MAX_REGION_PIXELS = 24e6;
const isDrawTool = (tool) => Boolean(MEASURE_TOOLS[tool]);
const closesOnDoubleClick = (tool) => MEASURE_TOOLS[tool]?.input === 'poly' || MEASURE_TOOLS[tool]?.input === 'polygon';
const isTypingTarget = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

// Status color for a measurement marker — green once it's a saved takeoff
// row, blue while its confirmation modal is still open, red once the
// estimator has explicitly kept a same-spot duplicate separate.
const MARKER_STATUS_COLORS = { green: '#22c55e', blue: '#3b82f6', red: '#ef4444' };

// Page-local (scale-applied, unrotated, before pan) point a marker is
// centered on — the click point for Count/Area, or a spot above the
// midpoint for Length so its status circle doesn't sit on its own label.
// Shared between drawing and hit-testing so both agree on where it is.
const itemScreenAnchor = (item, scale) => {
  if (item.tool === 'length' && item.point1 && item.point2) {
    return {
      x: ((item.point1.pdfX + item.point2.pdfX) / 2) * scale,
      y: ((item.point1.pdfY + item.point2.pdfY) / 2) * scale - 26,
    };
  }
  if (item.tool !== 'area' && isDrawTool(item.tool) && item.pdfX != null && item.pdfY != null) {
    return { x: item.pdfX * scale, y: item.pdfY * scale - 26 };
  }
  if ((item.tool === 'count' || item.tool === 'bolt_count') && item.points?.length) {
    return { x: item.points[0].pdfX * scale, y: item.points[0].pdfY * scale };
  }
  if (item.pdfX != null && item.pdfY != null) return { x: item.pdfX * scale, y: item.pdfY * scale };
  return null;
};

const polyDist = (pt, pts, closed) => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i += 1) best = Math.min(best, distToSegment(pt, pts[i - 1], pts[i]));
  if (closed && pts.length > 2) best = Math.min(best, distToSegment(pt, pts[pts.length - 1], pts[0]));
  return best;
};
const inPoly = (pt, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]; const b = poly[j];
    if ((a.pdfY > pt.pdfY) !== (b.pdfY > pt.pdfY) && pt.pdfX < ((b.pdfX - a.pdfX) * (pt.pdfY - a.pdfY)) / (b.pdfY - a.pdfY) + a.pdfX) inside = !inside;
  }
  return inside;
};

// Is PDF point `pt` on takeoff row `item` (its status marker or its own
// geometry)? tolPdf is the screen tolerance divided by the zoom.
function rowHitTest(item, pt, scale, tolPdf) {
  const anchor = itemScreenAnchor(item, scale);
  if (anchor && Math.hypot(pt.pdfX * scale - anchor.x, pt.pdfY * scale - anchor.y) <= 11) return true;
  if (item.tool === 'count' || item.tool === 'bolt_count') {
    const pts = item.points?.length ? item.points : (item.pdfX != null ? [{ pdfX: item.pdfX, pdfY: item.pdfY }] : []);
    const r = ((item.marker_size || DEFAULT_COUNT_MARKER_RADIUS) + 4) / scale;
    return pts.some((p) => Math.hypot(p.pdfX - pt.pdfX, p.pdfY - pt.pdfY) <= r);
  }
  if (item.point1 && item.point2 && distToSegment(pt, item.point1, item.point2) <= tolPdf) return true;
  if (item.polyline_points?.length >= 2 && polyDist(pt, item.polyline_points, false) <= tolPdf) return true;
  if (item.angle_points?.length === 3 && polyDist(pt, item.angle_points, false) <= tolPdf) return true;
  if (item.polygon_points?.length >= 3) {
    if (polyDist(pt, item.polygon_points, true) <= tolPdf) return true;
    if ((item.tool === 'area' || item.tool === 'volume') && inPoly(pt, item.polygon_points)) return true;
  }
  if (item.circle && Number.isFinite(item.circle.r)) {
    const d = Math.hypot(pt.pdfX - item.circle.cx, pt.pdfY - item.circle.cy);
    if (Math.abs(d - item.circle.r) <= tolPdf) return true;
  }
  return false;
}

// IRONSIGHT drawing canvas. Renders one PDF page (pdf.js) with every
// takeoff marker and general markup over it, and turns mouse input into
// PDF-space points for the page (BlueprintTakeoff owns all the row logic).
//
// Rendering: a low-res copy of the whole page (always there, so panning
// never shows blank) plus a sharp render of just the visible region, redone
// shortly after zoom/pan settles. Between renders the old bitmap is simply
// stretched, which is what makes wheel zoom smooth. Overlays are
// viewport-sized canvases whose context carries the view transform, so the
// draw code still draws at pdfX * scale.
//
// Mouse: wheel (or Ctrl+wheel) zooms at the cursor; middle-drag pans in
// any tool; Space-drag and the Pan tool pan with the left button; in Select,
// left-drag draws a selection box or moves selected markups, double-click
// edits, right-click opens the workspace's context menu.
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
  // True when the current page has any usable scale. Measuring clicks are
  // ignored while false — the page shows an "isn't calibrated" banner.
  canMeasure = false,
  // (pt) => resolved scale for a PDF-space point ({ ptsPerFt, label,
  // source, name } or null) — drives the live readout.
  getScaleAt = null,
  viewports = [],
  // Snap to the drawing's own line work; holding Alt places freely.
  snapEnabled = true,
  // Ortho: every placed point is kept horizontal/vertical from the last one
  // (holding Shift does the same for a single pick).
  ortho = false,
  calibrationShape = 'line',
  calibrationSteps = null,
  activeCountSession = null,
  onCountMark,
  onCountDotRemove,
  fillHeight = false,
  areas = {},
  highlightedItemKey = null,
  legends = [],
  onLegendMove,
  boxSelectMode = false,
  onBoxSelect,
  searchCandidates = [],
  onSearchCandidateClick,
  revisionClouds = [],
  // ---- workspace (Revu-style) additions ----
  // 'select' | 'pan' | 'zoom' — what the left button does with no tool live.
  navTool = 'select',
  // General markup tool being drawn (drawingMarkups.js MARKUP_TYPES id) and
  // its style preview.
  markupTool = null,
  markupStyle = null,
  // General markups on THIS page, selection ('m:<id>' / 'r:<_key>'), and
  // the callbacks that turn gestures into changes.
  drawingMarkups = [],
  selectedKeys = [],
  onSelectionChange,
  onCreateMarkup,
  onMoveMarkups,
  onMarkupHandleDrag,
  onMarkupDoubleClick,
  onCanvasContextMenu,
  editingTextId = null,
  onTextCommit,
  showGrid = false,
  continuous = false,
  // View rotation for this page (0/90/180/270) — view only, PDF space is untouched.
  rotation = 0,
  // pdf.js OptionalContentConfig (PDF layers) + a counter bumped on toggle.
  ocConfig = null,
  ocVersion = 0,
  // Text-search hits on this page ({ id, x, y, width, height } PDF space).
  searchHits = [],
  activeSearchHitId = null,
  // Where to open: { page, scale, pan } — applied once per document load.
  initialView = null,
  // Settled view ({ page, scale, pan, rotation }) for "reopen where I left off".
  onViewChange,
  // Live stores (useWorkspaceLayout.createLiveStore) for the status bar.
  cursorStore = null,
  viewStore = null,
  onDocumentLoad,
}, ref) {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [page, setPage] = useState(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [vpSize, setVpSize] = useState({ width: 0, height: 0 });
  const [hoveredItem, setHoveredItem] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [cursorPdf, setCursorPdf] = useState(null);
  const [snapHit, setSnapHit] = useState(null);
  const [snapIndex, setSnapIndex] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  // Rendered sharp region { pageNumber, rotation, oc, scale, x, y, w, h } (display px at that scale).
  const [region, setRegion] = useState(null);
  // `${pageNumber}:${rotation}` of the low-res backdrop currently on screen.
  const [backdropKey, setBackdropKey] = useState('');
  const [neighbors, setNeighbors] = useState({ prev: null, next: null });
  const [legendDrag, setLegendDrag] = useState(null);
  const [boxDraft, setBoxDraft] = useState(null);
  const [marquee, setMarquee] = useState(null); // { a, b, kind: 'select'|'zoom' }
  const [moveOffset, setMoveOffset] = useState(null); // { dx, dy } PDF
  const [handlePreview, setHandlePreview] = useState(null); // markup being resized
  const [markupDraft, setMarkupDraft] = useState(null);

  const { scale, pan, setPan, setView, zoomTo, transformRef } = useCanvasTransform(1);
  const rot = normRotation(rotation);

  const viewportRef = useRef(null);
  const backdropCanvasRef = useRef(null);
  const regionCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const cursorCanvasRef = useRef(null);
  const prevCanvasRef = useRef(null);
  const nextCanvasRef = useRef(null);
  const snapCacheRef = useRef(new Map());
  const neighborCacheRef = useRef(new Map());
  const regionTaskRef = useRef(null);
  const dragRef = useRef(null);
  const lastAreaClickAtRef = useRef(0);
  const lastMarkupClickAtRef = useRef(0);
  const legendBoundsRef = useRef([]);
  const markupDraftRef = useRef(null);
  markupDraftRef.current = markupDraft;
  // A view to apply when the next page proxy arrives (goToPage with a
  // target, continuous scrolling, restoring the last view).
  const pendingViewRef = useRef(null);
  const initialViewRef = useRef(null);
  const wheelRef = useRef({ factor: 1, anchor: null, raf: 0 });

  const view = { scale, pan, rotation: rot, pageWidth: pageSize.width, pageHeight: pageSize.height };
  const viewRef = useRef(view);
  viewRef.current = view;

  const panTo = useCallback((p) => {
    transformRef.current = { ...transformRef.current, pan: p };
    setPan(p);
  }, [setPan, transformRef]);

  // Viewport px → PDF space: the ONE place a mouse position becomes a PDF
  // point (ironsightView.viewportToPdf: un-pan, un-rotate, ÷ scale).
  const pdfAt = useCallback((e) => {
    const r = viewportRef.current?.getBoundingClientRect();
    if (!r) return null;
    return viewportToPdf(viewRef.current, e.clientX - r.left, e.clientY - r.top);
  }, []);

  const viewportCenter = () => ({ x: vpSize.width / 2, y: vpSize.height / 2 });

  const fitView = useCallback((mode, size = null) => {
    const ps = size || { width: viewRef.current.pageWidth, height: viewRef.current.pageHeight };
    const r = viewportRef.current?.getBoundingClientRect();
    if (!ps.width || !r || r.width <= 0) return null;
    const rotNow = viewRef.current.rotation;
    const s = mode === 'width' ? fitWidthScale(ps.width, ps.height, r.width, rotNow) : mode === 'actual' ? 1 : fitPageScale(ps.width, ps.height, r.width, r.height, rotNow);
    return { scale: s, pan: centeredPan(ps.width, ps.height, r.width, r.height, s, rotNow) };
  }, []);

  useImperativeHandle(ref, () => ({
    // Optional target: { rect } (PDF space, frame it) or { view } ({ scale, pan }).
    goToPage: (n, target = null) => {
      if (!(Number.isFinite(n) && n >= 1 && n <= numPages)) return;
      if (n === pageNum) {
        if (target?.rect) {
          const r = viewportRef.current?.getBoundingClientRect();
          if (r) setView(viewForRect(target.rect, viewRef.current, r.width, r.height));
        } else if (target?.view) setView(target.view);
        return;
      }
      pendingViewRef.current = target || null;
      setPageNum(n);
    },
    zoomIn: () => zoomTo(transformRef.current.scale * 1.25, viewportCenter()),
    zoomOut: () => zoomTo(transformRef.current.scale / 1.25, viewportCenter()),
    zoomToScale: (s) => zoomTo(clampZoom(s), viewportCenter()),
    fitPage: () => { const v = fitView('page'); if (v) setView(v); },
    fitWidth: () => { const v = fitView('width'); if (v) setView(v); },
    actualSize: () => zoomTo(1, viewportCenter()),
    zoomToRect: (rect) => {
      const r = viewportRef.current?.getBoundingClientRect();
      if (r) setView(viewForRect(rect, viewRef.current, r.width, r.height));
    },
    getView: () => ({ page: pageNum, ...transformRef.current, rotation: rot }),
    getFullPageDataUrl: () => null,
    getCropDataUrl: () => null,
    renderPageImage: async (renderScale = 2) => {
      if (!page) return null;
      const image = await renderPdfPageToImageData(page, renderScale);
      return { image, renderScale, pageNumber: page.pageNumber };
    },
  }), [numPages, page, pageNum, rot, zoomTo, setView, fitView, transformRef, vpSize.width, vpSize.height]);

  // Load the document whenever `source` changes. Destroy via the LOADING
  // TASK — in pdfjs-dist 6.x the PDFDocumentProxy has no .destroy().
  useEffect(() => {
    if (!source) {
      setPdfDoc(null);
      setNumPages(0);
      return undefined;
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
        if (cancelled) { loadingTask.destroy(); return; }
        snapCacheRef.current = new Map();
        neighborCacheRef.current = new Map();
        initialViewRef.current = initialView;
        const startPage = initialView?.page && initialView.page >= 1 && initialView.page <= doc.numPages ? initialView.page : 1;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(startPage);
        onDocumentLoad?.(doc);
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
      onDocumentLoad?.(null);
    };
  }, [source]);

  // Viewport size (panels resize it).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setVpSize((prev) => (prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [source]);

  // Fetch the page proxy for the current page and pick its view: a pending
  // target (zoom-to-markup, continuous scroll), the session's last view on
  // first open, otherwise fit the whole page.
  useEffect(() => {
    if (!pdfDoc) { setPage(null); return undefined; }
    let cancelled = false;
    pdfDoc.getPage(pageNum).then((p) => {
      if (cancelled) return;
      const natural = p.getViewport({ scale: 1 });
      const size = { width: natural.width, height: natural.height };
      setPage(p);
      setPageSize(size);
      viewRef.current = { ...viewRef.current, pageWidth: size.width, pageHeight: size.height };
      onPageSizeChange?.(size);
      const pending = pendingViewRef.current;
      pendingViewRef.current = null;
      const initial = initialViewRef.current;
      initialViewRef.current = null;
      if (pending?.view) setView(pending.view);
      else if (pending?.rect) {
        const r = viewportRef.current?.getBoundingClientRect();
        if (r) setView(viewForRect(pending.rect, viewRef.current, r.width, r.height));
      } else if (initial && initial.page === pageNum && initial.scale > 0 && initial.pan) setView({ scale: initial.scale, pan: initial.pan });
      else {
        const v = fitView('page', size);
        if (v) setView(v);
      }
    });
    return () => { cancelled = true; };
  }, [pdfDoc, pageNum, onPageSizeChange, setView, fitView]);

  // Live zoom for the status bar; the page-level callback only once the
  // zoom settles (wheel zoom changes scale every frame).
  useEffect(() => {
    viewStore?.set({ scale, page: pageNum, numPages });
    const t = setTimeout(() => onScaleChange?.(scale), 150);
    return () => clearTimeout(t);
  }, [scale, pageNum, numPages, viewStore, onScaleChange]);

  useEffect(() => {
    if (!page) return undefined;
    const t = setTimeout(() => onViewChange?.({ page: pageNum, scale, pan, rotation: rot }), 400);
    return () => clearTimeout(t);
  }, [page, pageNum, scale, pan, rot, onViewChange]);

  useEffect(() => {
    onPageChange?.({ pageNum, numPages });
  }, [pageNum, numPages, onPageChange]);

  // ---------------------------------------------------------------- render

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const disp = displaySize(pageSize.width, pageSize.height, scale, rot);

  // Low-res whole page (re-rendered on page / rotation / layer change).
  useEffect(() => {
    if (!page) return undefined;
    let cancelled = false;
    const natural = page.getViewport({ scale: 1, rotation: (page.rotate + rot) % 360 });
    const bs = Math.min(2, 2200 / Math.max(natural.width, natural.height));
    const vp = page.getViewport({ scale: bs, rotation: (page.rotate + rot) % 360 });
    const off = document.createElement('canvas');
    off.width = Math.ceil(vp.width);
    off.height = Math.ceil(vp.height);
    const task = page.render({ canvasContext: off.getContext('2d'), viewport: vp, ...(ocConfig ? { optionalContentConfigPromise: Promise.resolve(ocConfig) } : {}) });
    task.promise.then(() => {
      if (cancelled) return;
      const c = backdropCanvasRef.current;
      if (!c) return;
      c.width = off.width;
      c.height = off.height;
      c.getContext('2d').drawImage(off, 0, 0);
      setBackdropKey(`${page.pageNumber}:${rot}`);
    }).catch((e) => { if (e?.name !== 'RenderingCancelledException') console.error('BlueprintCanvas backdrop render failed', e); });
    return () => { cancelled = true; task.cancel(); };
  }, [page, rot, ocConfig, ocVersion]);

  // Sharp render of the visible region (+ a margin), shortly after the view
  // settles. Rendered off-screen and copied in, so the old bitmap stays up
  // (stretched) until the new one is ready — no white flash.
  useEffect(() => {
    if (!page || !vpSize.width) return undefined;
    const v = { scale, pan, rotation: rot, pageWidth: pageSize.width, pageHeight: pageSize.height };
    const vis = visibleDisplayRect(v, vpSize.width, vpSize.height);
    if (!vis) return undefined;
    const covered = region && region.pageNumber === page.pageNumber && region.rotation === rot && region.oc === ocVersion
      && Math.abs(region.scale - scale) < 1e-6
      && vis.x >= region.x && vis.y >= region.y && vis.x + vis.width <= region.x + region.w && vis.y + vis.height <= region.y + region.h;
    if (covered) return undefined;
    const timer = setTimeout(() => {
      const d = displaySize(pageSize.width, pageSize.height, scale, rot);
      const mx = vpSize.width * 0.35; const my = vpSize.height * 0.35;
      const x = Math.max(0, Math.floor(vis.x - mx));
      const y = Math.max(0, Math.floor(vis.y - my));
      const w = Math.min(Math.ceil(d.width), Math.ceil(vis.x + vis.width + mx)) - x;
      const h = Math.min(Math.ceil(d.height), Math.ceil(vis.y + vis.height + my)) - y;
      if (w <= 0 || h <= 0) return;
      const ratio = Math.min(dpr, Math.sqrt(MAX_REGION_PIXELS / (w * h)));
      const vp = page.getViewport({ scale, rotation: (page.rotate + rot) % 360 });
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.floor(w * ratio));
      off.height = Math.max(1, Math.floor(h * ratio));
      regionTaskRef.current?.cancel();
      const task = page.render({
        canvasContext: off.getContext('2d'),
        viewport: vp,
        transform: [ratio, 0, 0, ratio, -x * ratio, -y * ratio],
        ...(ocConfig ? { optionalContentConfigPromise: Promise.resolve(ocConfig) } : {}),
      });
      regionTaskRef.current = task;
      task.promise.then(() => {
        const c = regionCanvasRef.current;
        if (!c) return;
        c.width = off.width;
        c.height = off.height;
        c.getContext('2d').drawImage(off, 0, 0);
        setRegion({ pageNumber: page.pageNumber, rotation: rot, oc: ocVersion, scale, x, y, w, h });
      }).catch((e) => { if (e?.name !== 'RenderingCancelledException') console.error('BlueprintCanvas render failed', e); });
    }, 120);
    return () => clearTimeout(timer);
  }, [page, scale, pan, rot, vpSize.width, vpSize.height, ocConfig, ocVersion, pageSize.width, pageSize.height, dpr]);

  useEffect(() => () => regionTaskRef.current?.cancel(), []);

  // Continuous view: low-res previews of the pages above and below.
  useEffect(() => {
    if (!continuous || !pdfDoc || !page) { setNeighbors({ prev: null, next: null }); return undefined; }
    let cancelled = false;
    const load = async (n) => {
      if (n < 1 || n > numPages) return null;
      const key = `${n}:${rot}:${ocVersion}`;
      let entry = neighborCacheRef.current.get(key);
      if (!entry) {
        const p = await pdfDoc.getPage(n);
        const nat = p.getViewport({ scale: 1, rotation: (p.rotate + rot) % 360 });
        const bs = Math.min(1, 1100 / Math.max(nat.width, nat.height));
        const vp = p.getViewport({ scale: bs, rotation: (p.rotate + rot) % 360 });
        const off = document.createElement('canvas');
        off.width = Math.ceil(vp.width); off.height = Math.ceil(vp.height);
        await p.render({ canvasContext: off.getContext('2d'), viewport: vp, ...(ocConfig ? { optionalContentConfigPromise: Promise.resolve(ocConfig) } : {}) }).promise;
        entry = { canvas: off, width: nat.width, height: nat.height };
        neighborCacheRef.current.set(key, entry);
      }
      return { num: n, ...entry };
    };
    Promise.all([load(pageNum - 1), load(pageNum + 1)]).then(([prev, next]) => {
      if (!cancelled) setNeighbors({ prev, next, forPage: pageNum });
    }).catch((e) => console.warn('IRONSIGHT: could not render neighbouring pages', e));
    return () => { cancelled = true; };
  }, [continuous, pdfDoc, page, pageNum, numPages, rot, ocConfig, ocVersion]);

  useEffect(() => {
    [[prevCanvasRef, neighbors.prev], [nextCanvasRef, neighbors.next]].forEach(([r, n]) => {
      const c = r.current;
      if (!c || !n) return;
      c.width = n.canvas.width; c.height = n.canvas.height;
      c.getContext('2d').drawImage(n.canvas, 0, 0);
    });
  }, [neighbors]);

  // Continuous view: when the middle of the window crosses into the page
  // above/below, that page becomes the active one — pan shifts by exactly
  // the page offset so nothing jumps.
  useEffect(() => {
    if (!continuous || !page || !vpSize.height || neighbors.forPage !== pageNum) return;
    const cy = vpSize.height / 2 - pan.y;
    if (neighbors.next && cy > disp.height + PAGE_GAP_PX / 2) {
      const delta = disp.height + PAGE_GAP_PX;
      const next = { x: pan.x, y: pan.y + delta };
      if (dragRef.current?.startPan) dragRef.current.startPan = { ...dragRef.current.startPan, y: dragRef.current.startPan.y + delta };
      pendingViewRef.current = { view: { scale, pan: next } };
      setPageNum(neighbors.next.num);
    } else if (neighbors.prev && cy < -PAGE_GAP_PX / 2) {
      const prevH = displaySize(neighbors.prev.width, neighbors.prev.height, scale, 0).height;
      const delta = prevH + PAGE_GAP_PX;
      const next = { x: pan.x, y: pan.y - delta };
      if (dragRef.current?.startPan) dragRef.current.startPan = { ...dragRef.current.startPan, y: dragRef.current.startPan.y - delta };
      pendingViewRef.current = { view: { scale, pan: next } };
      setPageNum(neighbors.prev.num);
    }
  }, [continuous, page, pageNum, pan, scale, vpSize.height, disp.height, neighbors]);

  // Rotating the view re-fits the page (the old pan means nothing rotated).
  const lastRotRef = useRef(rot);
  useEffect(() => {
    if (lastRotRef.current === rot) return;
    lastRotRef.current = rot;
    const v = fitView('page');
    if (v) setView(v);
  }, [rot, fitView, setView]);

  // Snap-to-drawing: read this page's vector line work once (cached).
  useEffect(() => {
    if (!page || !snapEnabled) { setSnapIndex(null); return undefined; }
    const pageKey = page.pageNumber;
    const cached = snapCacheRef.current.get(pageKey);
    if (cached) { setSnapIndex(cached); return undefined; }
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

  // Hold Space = temporary hand tool (never while calibrating or typing).
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code !== 'Space' || e.repeat || calibrationMode || isTypingTarget(e.target)) return;
      e.preventDefault();
      setSpacePressed(true);
    };
    const handleKeyUp = (e) => {
      if (e.code !== 'Space') return;
      setSpacePressed(false);
      if (dragRef.current?.viaSpace) {
        try { viewportRef.current?.releasePointerCapture(dragRef.current.pointerId); } catch { /* already released */ }
        dragRef.current = null;
        setIsDragging(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [calibrationMode]);

  // A markup being drawn starts over on a tool or page change.
  useEffect(() => { setMarkupDraft(null); }, [markupTool, pageNum]);

  // Polyline/polygon markup keys: Enter finishes, Backspace takes back a point.
  useEffect(() => {
    if (!markupDraft || MARKUP_TYPES[markupDraft.type]?.shape !== 'poly') return undefined;
    const onKey = (e) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Enter') { e.preventDefault(); finishPolyMarkup(); }
      if (e.key === 'Backspace') {
        e.preventDefault();
        setMarkupDraft((d) => (d ? { ...d, points: d.points.slice(0, -1) } : d));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    setHoveredItem(null);
    setSnapHit(null);
  }, [pageNum, scale]);

  // Wheel / Ctrl+wheel zoom at the cursor. Ticks inside one animation frame
  // are multiplied together and applied once, keeping the zoom smooth.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!viewRef.current.pageWidth) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const w = wheelRef.current;
      w.factor *= wheelZoomFactor(e.deltaY, e.deltaMode);
      w.anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (w.raf) return;
      w.raf = requestAnimationFrame(() => {
        const { factor, anchor } = wheelRef.current;
        wheelRef.current = { factor: 1, anchor: null, raf: 0 };
        zoomTo(transformRef.current.scale * factor, anchor);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelRef.current.raf) cancelAnimationFrame(wheelRef.current.raf);
      wheelRef.current = { factor: 1, anchor: null, raf: 0 };
    };
  }, [zoomTo, transformRef, source]);

  // ---------------------------------------------------------------- overlay

  const pageItems = measurementItems.filter((item) => item.source === 'measurement' && (item.page_number || 1) === pageNum);

  // Draws every marker and markup for this page. The context carries the
  // view transform (rotation + pan) times devicePixelRatio, so the draw
  // code below works in page-local px (pdfX * scale) and never adds pan.
  useEffect(() => {
    const c = overlayCanvasRef.current;
    if (!c || !vpSize.width) return;
    c.width = Math.ceil(vpSize.width * dpr);
    c.height = Math.ceil(vpSize.height * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!page) return;
    const m = viewMatrix({ scale, pan, rotation: rot, pageWidth: pageSize.width, pageHeight: pageSize.height });
    ctx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);

    if (showGrid) drawGrid(ctx, pageSize.width, pageSize.height, scale);

    const drawCrosshair = (x, y, color = '#dc2626') => {
      const size = 8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x - size, y); ctx.lineTo(x + size, y);
      ctx.moveTo(x, y - size); ctx.lineTo(x, y + size);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.stroke();
    };

    drawViewports(ctx, viewports, scale);

    Object.entries(areas).filter(([, a]) => a.pageNumber === pageNum).forEach(([name, a]) => {
      const pts = (a.polygon || []).map((p) => ({ x: p.pdfX * scale, y: p.pdfY * scale }));
      if (pts.length < 3) return;
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

    revisionClouds.forEach((box) => drawRevisionCloud(ctx, box, scale, '#dc2626'));

    // General markups (drawing notes) under the takeoff markers, in z-order.
    const moving = moveOffset ? new Set(selectedKeys.filter((k) => k.startsWith('m:')).map((k) => k.slice(2))) : null;
    drawingMarkups.forEach((mk) => {
      const shown = handlePreview && handlePreview.id === mk.id ? handlePreview : mk;
      drawDrawingMarkup(ctx, shown, scale, { offset: moving?.has(mk.id) ? moveOffset : null, hideText: mk.id === editingTextId });
    });

    const drawStatusMarker = (x, y, item) => {
      const fillColor = MARKER_STATUS_COLORS[item.marker_color] || MARKER_STATUS_COLORS.blue;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
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
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(Math.min(p1.x, p2.x) - 14, Math.min(p1.y, p2.y) - 14, Math.abs(p2.x - p1.x) + 28, Math.abs(p2.y - p1.y) + 28);
      ctx.restore();
    };

    pageItems.forEach((item) => {
      if (item.review_flag) {
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
        drawStatusMarker(midX, midY - 26, item);
        if (isHighlighted(item)) drawHighlightBox(p1, p2);
      } else if (item.tool === 'area' && item.pdfX != null && item.pdfY != null) {
        const x = item.pdfX * scale; const y = item.pdfY * scale;
        if (item.polygon_points?.length >= 3) {
          drawPolygonWithCutouts(ctx, item.polygon_points, item.cutouts, scale, { stroke: MARKER_STATUS_COLORS[item.marker_color] || MARKER_STATUS_COLORS.blue });
        }
        drawStatusMarker(x, y, item);
        if (isHighlighted(item)) drawHighlightRing(x, y);
      } else if (isDrawTool(item.tool) && item.pdfX != null && item.pdfY != null) {
        const statusColor = item.tool_set_tool_id && item.color ? item.color : (MARKER_STATUS_COLORS[item.marker_color] || MARKER_STATUS_COLORS.blue);
        drawMeasureRow(ctx, item, scale, statusColor);
        const anchor = itemScreenAnchor(item, scale);
        drawStatusMarker(anchor.x, anchor.y, item);
        if (isHighlighted(item)) drawHighlightRing(anchor.x, anchor.y);
      }
    });

    if (activeCountSession?.points?.length && (activeCountSession.page_number || pageNum) === pageNum) {
      const radius = activeCountSession.fields?.marker_size || DEFAULT_COUNT_MARKER_RADIUS;
      activeCountSession.points.forEach((p, i) => {
        drawCountMarker(ctx, p.pdfX * scale, p.pdfY * scale, { color: activeCountSession.color, symbol: activeCountSession.symbol }, radius);
        if (activeCountSession.fields?.show_numbers) drawCountNumber(ctx, i + 1, p.pdfX * scale, p.pdfY * scale, radius);
      });
    }

    searchCandidates.forEach((cand) => drawSearchCandidate(ctx, cand, scale));
    drawSearchHits(ctx, searchHits, activeSearchHitId, scale);

    // Selection boxes + grab handles.
    selectedKeys.forEach((key) => {
      if (key.startsWith('m:')) {
        const mk = drawingMarkups.find((d) => d.id === key.slice(2));
        if (!mk) return;
        const shown = handlePreview && handlePreview.id === mk.id ? handlePreview : mk;
        const b = markupBounds(shown, measureMarkupText);
        const off = moveOffset || { dx: 0, dy: 0 };
        drawSelectionBox(ctx, b && { ...b, x: b.x + off.dx, y: b.y + off.dy }, scale, {
          handles: selectedKeys.length === 1 && !moveOffset ? handlesFor(shown) : [],
          locked: mk.locked,
        });
      } else if (key.startsWith('r:')) {
        const item = pageItems.find((it) => (it._key || it.id) === key.slice(2));
        const b = item && rowBounds(item);
        if (b) drawSelectionBox(ctx, b, scale, { locked: item.locked });
      }
    });

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

    // Legends last so they sit on top. Corner anchors resolve here.
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
  }, [page, scale, pan, rot, vpSize.width, vpSize.height, dpr, calibrationMode, calibrationPoints, calibrationShape, measurementItems, areas, pageNum,
    highlightedItemKey, activeCountSession, viewports, revisionClouds, searchCandidates, legends, legendDrag, pageSize, drawingMarkups, selectedKeys,
    moveOffset, handlePreview, editingTextId, showGrid, searchHits, activeSearchHitId]);

  // Cursor layer — in-progress drawings with their rubber band, the snap
  // marker, boxes being dragged out. Redrawn on every mouse move.
  useEffect(() => {
    const c = cursorCanvasRef.current;
    if (!c || !vpSize.width) return;
    c.width = Math.ceil(vpSize.width * dpr);
    c.height = Math.ceil(vpSize.height * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!page) return;
    const m = viewMatrix({ scale, pan, rotation: rot, pageWidth: pageSize.width, pageHeight: pageSize.height });
    ctx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
    if (calibrationMode && calibrationShape === 'rect' && calibrationPoints.length === 1 && cursorPdf) {
      drawRectPreview(ctx, calibrationPoints[0], cursorPdf, scale);
    }
    if (calibrationMode && calibrationShape !== 'rect' && calibrationPoints.length === 1 && cursorPdf) {
      ctx.save();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(calibrationPoints[0].pdfX * scale, calibrationPoints[0].pdfY * scale);
      ctx.lineTo(cursorPdf.pdfX * scale, cursorPdf.pdfY * scale);
      ctx.stroke();
      ctx.restore();
    }
    if (!calibrationMode && isDrawTool(activeTool) && draft) {
      const first = draft.outer?.[0] || draft.points?.[0] || cursorPdf;
      const ptsPerFt = first && getScaleAt ? getScaleAt(first)?.ptsPerFt : null;
      drawDraft(ctx, { tool: activeTool, draft, cursor: cursorPdf, scale, circleMode, ptsPerFt });
    }
    if (markupDraft) drawMarkupDraft(ctx, { ...markupDraft, cursor: markupDraft.cursor || cursorPdf, style: markupStyle || {} }, scale);
    if (calibrationMode || isDrawTool(activeTool) || markupTool) drawSnapMarker(ctx, snapHit, scale);
    if (boxDraft) drawRectPreview(ctx, boxDraft.a, boxDraft.b, scale);
    if (marquee) drawMarquee(ctx, marquee.a, marquee.b, scale, marquee.kind === 'zoom' ? '#7c3aed' : undefined);
  }, [page, scale, pan, rot, vpSize.width, vpSize.height, dpr, cursorPdf, snapHit, draft, activeTool, circleMode, calibrationMode, calibrationShape,
    calibrationPoints, getScaleAt, boxDraft, marquee, markupDraft, markupStyle, markupTool, pageSize]);

  // ---------------------------------------------------------------- input

  // Where a pick at this event lands: snapped to the drawing's line work
  // (Alt = place freely), then held horizontal/vertical from `from` when
  // Ortho is on or Shift is held.
  const pickPoint = (e, from = null) => {
    const raw = pdfAt(e);
    if (!raw) return { pt: null, snap: null };
    let pt = raw;
    let snap = null;
    if (snapEnabled && !e.altKey && snapIndex) {
      snap = findSnap(snapIndex, raw, snapTolerancePdf(scale));
      if (snap) pt = { pdfX: snap.pdfX, pdfY: snap.pdfY };
    }
    if (from && (ortho || e.shiftKey)) { pt = orthoPoint(from, pt); snap = null; }
    return { pt, snap };
  };

  // The previous point of whatever is being picked, for Ortho/Shift.
  const orthoFrom = () => {
    if (calibrationMode) return calibrationShape === 'rect' ? null : calibrationPoints[calibrationPoints.length - 1] || null;
    if (isDrawTool(activeTool) && draft) return draft.points?.[draft.points.length - 1] || null;
    const d = markupDraftRef.current;
    if (d && d.points?.length && (MARKUP_TYPES[d.type]?.shape === 'line' || MARKUP_TYPES[d.type]?.shape === 'poly')) return d.points[d.points.length - 1];
    return null;
  };

  const hitMarkupAt = (pt) => {
    const tol = 6 / scale;
    for (let i = drawingMarkups.length - 1; i >= 0; i -= 1) {
      if (hitTestMarkup(drawingMarkups[i], pt, tol, measureMarkupText)) return drawingMarkups[i];
    }
    return null;
  };
  const hitRowAt = (pt) => {
    const tol = 6 / scale;
    for (let i = pageItems.length - 1; i >= 0; i -= 1) {
      if ((pageItems[i]._key || pageItems[i].id) && rowHitTest(pageItems[i], pt, scale, tol)) return pageItems[i];
    }
    return null;
  };
  const hitKeyAt = (pt) => {
    const mk = hitMarkupAt(pt);
    if (mk) return `m:${mk.id}`;
    const row = hitRowAt(pt);
    return row ? `r:${row._key || row.id}` : null;
  };

  const startPan = (e, viaSpace = false) => {
    dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, startPan: transformRef.current.pan, pointerId: e.pointerId, viaSpace };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const finishMarkup = (type, points, extra = {}) => {
    setMarkupDraft(null);
    onCreateMarkup?.({ type, points, page_number: pageNum, ...extra });
  };

  function finishPolyMarkup() {
    const d = markupDraftRef.current;
    if (!d) return;
    const need = d.type === 'polygon' ? 3 : 2;
    if (d.points.length >= need) finishMarkup(d.type, d.points);
    else setMarkupDraft(null);
  }

  const markupPointerDown = (e) => {
    const type = markupTool;
    const shape = MARKUP_TYPES[type]?.shape;
    const { pt } = pickPoint(e, orthoFrom());
    if (!pt) return;
    const d = markupDraftRef.current;
    if (shape === 'point') {
      finishMarkup(type, [pt]);
      return;
    }
    if (shape === 'poly') {
      const now = Date.now();
      const closing = d && d.points.length > 0 && now - lastMarkupClickAtRef.current < 400;
      lastMarkupClickAtRef.current = closing ? 0 : now;
      if (closing) { finishPolyMarkup(); return; }
      setMarkupDraft({ type, points: [...(d?.points || []), pt], cursor: pt });
      return;
    }
    if (shape === 'line' && d?.awaitingSecond) {
      finishMarkup(type, [d.points[0], pt]);
      return;
    }
    dragRef.current = { kind: 'markup', shape, type, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (type === 'callout') setMarkupDraft({ type, points: [], leader: pt, cursor: pt });
    else setMarkupDraft({ type, points: [pt], cursor: pt });
  };

  const selectPointerDown = (e) => {
    const pt = pdfAt(e);
    if (!pt) return;
    // Legend drag.
    if (legendBoundsRef.current.length) {
      const lx = pt.pdfX * scale; const ly = pt.pdfY * scale;
      const hit = legendBoundsRef.current.find((b) => lx >= b.x && lx <= b.x + b.width && ly >= b.y && ly <= b.y + b.height);
      if (hit) {
        dragRef.current = { kind: 'legend', legendKey: hit.key, startX: e.clientX, startY: e.clientY, startPdf: { pdfX: hit.x / scale, pdfY: hit.y / scale }, startPt: pt, pointerId: e.pointerId };
        setLegendDrag({ key: hit.key, pdfX: hit.x / scale, pdfY: hit.y / scale });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }
    // Grab handle of the one selected markup.
    if (selectedKeys.length === 1 && selectedKeys[0].startsWith('m:')) {
      const mk = drawingMarkups.find((d) => d.id === selectedKeys[0].slice(2));
      if (mk && !mk.locked) {
        const h = handlesFor(mk).find((hd) => Math.hypot((hd.pdfX - pt.pdfX) * scale, (hd.pdfY - pt.pdfY) * scale) <= 7);
        if (h) {
          dragRef.current = { kind: 'handle', id: mk.id, handleId: h.id, markup: mk, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const key = hitKeyAt(pt);
    if (key) {
      let next = selectedKeys;
      if (additive) next = selectedKeys.includes(key) ? selectedKeys.filter((k) => k !== key) : [...selectedKeys, key];
      else if (!selectedKeys.includes(key)) next = [key];
      if (next !== selectedKeys) onSelectionChange?.(next);
      const movable = next.filter((k) => k.startsWith('m:')).map((k) => k.slice(2))
        .filter((id) => !drawingMarkups.find((d) => d.id === id)?.locked);
      if (key.startsWith('m:') && next.includes(key) && movable.length) {
        dragRef.current = { kind: 'move', ids: movable, startPt: pt, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }
    dragRef.current = { kind: 'marquee', a: pt, additive, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerDown = (e) => {
    if (!page) return;
    if (e.button === 1) { e.preventDefault(); startPan(e); return; }
    if (e.button !== 0) return;
    if (spacePressed && !calibrationMode) { startPan(e, true); return; }
    if (navTool === 'pan' && !calibrationMode && !boxSelectMode && !activeTool && !markupTool) { startPan(e); return; }
    if (boxSelectMode && !calibrationMode) {
      const pt = pdfAt(e);
      if (!pt) return;
      dragRef.current = { kind: 'box', pointerId: e.pointerId };
      setBoxDraft({ a: pt, b: pt });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (calibrationMode || isDrawTool(activeTool)) {
      // Click places a point; a drag pans (decided on pointer up).
      dragRef.current = { kind: 'click', startX: e.clientX, startY: e.clientY, startPan: transformRef.current.pan, pointerId: e.pointerId, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (CLICK_DRAG_TOOLS.includes(activeTool)) {
      dragRef.current = { kind: 'mark', startX: e.clientX, startY: e.clientY, startPan: transformRef.current.pan, pointerId: e.pointerId, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (markupTool) { markupPointerDown(e); return; }
    if (navTool === 'zoom') {
      const pt = pdfAt(e);
      dragRef.current = { kind: 'zoom', a: pt, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, moved: false, out: e.altKey };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    selectPointerDown(e);
  };

  const updateHover = (e) => {
    const pt = pdfAt(e);
    if (!pt) return;
    cursorStore?.set({ pdfX: pt.pdfX, pdfY: pt.pdfY, page: pageNum });
    const r = viewportRef.current.getBoundingClientRect();
    if (!dragRef.current) {
      const hit = pageItems.find((item) => {
        const anchor = itemScreenAnchor(item, scale);
        return anchor && Math.hypot(pt.pdfX * scale - anchor.x, pt.pdfY * scale - anchor.y) <= 11;
      });
      setHoveredItem(hit || null);
      setHoverPos({ x: e.clientX - r.left, y: e.clientY - r.top });
    }
    if (calibrationMode || isDrawTool(activeTool) || markupTool) {
      const { pt: picked, snap } = pickPoint(e, orthoFrom());
      setCursorPdf(picked);
      setSnapHit(snap);
      if (markupDraftRef.current && !dragRef.current) setMarkupDraft((d) => (d ? { ...d, cursor: picked } : d));
    } else if (cursorPdf) {
      setCursorPdf(null);
      setSnapHit(null);
    }
  };

  const dragMoved = (e, d) => {
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > MARK_DRAG_THRESHOLD_PX) d.moved = true;
    return d.moved;
  };

  const handlePointerMove = (e) => {
    updateHover(e);
    const d = dragRef.current;
    if (!d) return;
    switch (d.kind) {
      case 'pan':
        panTo({ x: d.startPan.x + (e.clientX - d.startX), y: d.startPan.y + (e.clientY - d.startY) });
        return;
      case 'click':
      case 'mark':
        if (dragMoved(e, d)) {
          if (!isDragging) setIsDragging(true);
          panTo({ x: d.startPan.x + (e.clientX - d.startX), y: d.startPan.y + (e.clientY - d.startY) });
        }
        return;
      case 'box': {
        const pt = pdfAt(e);
        if (pt) setBoxDraft((b) => (b ? { ...b, b: pt } : b));
        return;
      }
      case 'legend': {
        const pt = pdfAt(e);
        if (pt) setLegendDrag({ key: d.legendKey, pdfX: d.startPdf.pdfX + (pt.pdfX - d.startPt.pdfX), pdfY: d.startPdf.pdfY + (pt.pdfY - d.startPt.pdfY) });
        return;
      }
      case 'marquee':
      case 'zoom': {
        if (!dragMoved(e, d)) return;
        const pt = pdfAt(e);
        if (pt) setMarquee({ a: d.a, b: pt, kind: d.kind === 'zoom' ? 'zoom' : 'select' });
        return;
      }
      case 'move': {
        if (!dragMoved(e, d)) return;
        const pt = pdfAt(e);
        if (pt) setMoveOffset({ dx: pt.pdfX - d.startPt.pdfX, dy: pt.pdfY - d.startPt.pdfY });
        return;
      }
      case 'handle': {
        if (!dragMoved(e, d)) return;
        const { pt } = pickPoint(e);
        if (pt) setHandlePreview(applyHandleDrag(d.markup, d.handleId, pt));
        return;
      }
      case 'markup': {
        const { pt } = pickPoint(e, d.shape === 'line' ? markupDraftRef.current?.points?.[0] : null);
        if (!pt) return;
        dragMoved(e, d);
        if (d.shape === 'stroke') {
          setMarkupDraft((md) => {
            if (!md) return md;
            const last = md.points[md.points.length - 1];
            if (last && Math.hypot((pt.pdfX - last.pdfX) * scale, (pt.pdfY - last.pdfY) * scale) < 2) return md;
            return { ...md, points: [...md.points, pt] };
          });
        } else setMarkupDraft((md) => (md ? { ...md, cursor: pt } : md));
        return;
      }
      default:
    }
  };

  const handlePointerUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    setIsDragging(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    switch (d.kind) {
      case 'box': {
        const box = boxDraft;
        setBoxDraft(null);
        if (box) {
          const x = Math.min(box.a.pdfX, box.b.pdfX);
          const y = Math.min(box.a.pdfY, box.b.pdfY);
          const width = Math.abs(box.b.pdfX - box.a.pdfX);
          const height = Math.abs(box.b.pdfY - box.a.pdfY);
          if (width * scale >= 6 && height * scale >= 6) onBoxSelect?.({ x, y, width, height });
        }
        return;
      }
      case 'legend': {
        const moved = legendDrag;
        setLegendDrag(null);
        if (moved && (Math.abs(e.clientX - d.startX) > 2 || Math.abs(e.clientY - d.startY) > 2)) {
          onLegendMove?.(d.legendKey, { pdfX: moved.pdfX, pdfY: moved.pdfY });
        }
        return;
      }
      case 'click': {
        if (d.moved || e.type === 'pointerleave') return;
        const { pt } = pickPoint(e, orthoFrom());
        if (!pt) return;
        if (calibrationMode) { onCalibrationClick?.(pt); return; }
        if (!canMeasure) return;
        // Runs/shapes close on a real double-click: the second click of a
        // quick pair is the "close", not another vertex.
        let isClosingClick = false;
        if (closesOnDoubleClick(activeTool)) {
          const now = Date.now();
          const hasPoints = (draft?.points?.length || 0) > 0;
          isClosingClick = hasPoints && now - lastAreaClickAtRef.current < 400;
          lastAreaClickAtRef.current = isClosingClick ? 0 : now;
        }
        onMeasurementClick?.({ tool: activeTool, pdfX: pt.pdfX, pdfY: pt.pdfY, isClosingClick });
        return;
      }
      case 'mark': {
        if (d.moved || e.type === 'pointerleave' || !canMeasure) return;
        const pt = pdfAt(e);
        if (pt) onCountMark?.({ tool: activeTool, pdfX: pt.pdfX, pdfY: pt.pdfY });
        return;
      }
      case 'marquee': {
        setMarquee(null);
        const pt = pdfAt(e);
        if (!d.moved) {
          // A plain click on empty sheet: a Visual Search box, else clear the selection.
          const cand = pt && searchCandidates.find((c) => pt.pdfX >= c.pdfX && pt.pdfX <= c.pdfX + c.pdfWidth && pt.pdfY >= c.pdfY && pt.pdfY <= c.pdfY + c.pdfHeight);
          if (cand) { onSearchCandidateClick?.(cand.id); return; }
          if (!d.additive && selectedKeys.length) onSelectionChange?.([]);
          return;
        }
        if (!pt) return;
        const box = { x: Math.min(d.a.pdfX, pt.pdfX), y: Math.min(d.a.pdfY, pt.pdfY), width: Math.abs(pt.pdfX - d.a.pdfX), height: Math.abs(pt.pdfY - d.a.pdfY) };
        const keys = [
          ...drawingMarkups.filter((mk) => boxesIntersect(markupBounds(mk, measureMarkupText), box)).map((mk) => `m:${mk.id}`),
          ...pageItems.filter((it) => (it._key || it.id) && boxesIntersect(rowBounds(it), box)).map((it) => `r:${it._key || it.id}`),
        ];
        onSelectionChange?.(d.additive ? Array.from(new Set([...selectedKeys, ...keys])) : keys);
        return;
      }
      case 'zoom': {
        setMarquee(null);
        const pt = pdfAt(e);
        const r = viewportRef.current.getBoundingClientRect();
        const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (!d.moved || !pt) { zoomTo(transformRef.current.scale * (d.out || e.altKey ? 1 / 1.6 : 1.6), anchor); return; }
        const rect = { x: Math.min(d.a.pdfX, pt.pdfX), y: Math.min(d.a.pdfY, pt.pdfY), width: Math.abs(pt.pdfX - d.a.pdfX), height: Math.abs(pt.pdfY - d.a.pdfY) };
        setView(viewForRect(rect, viewRef.current, r.width, r.height, { pad: 10, maxScale: 64 }));
        return;
      }
      case 'move': {
        const off = moveOffset;
        setMoveOffset(null);
        if (d.moved && off && (off.dx || off.dy)) onMoveMarkups?.({ ids: d.ids, dx: off.dx, dy: off.dy });
        return;
      }
      case 'handle': {
        const preview = handlePreview;
        setHandlePreview(null);
        if (d.moved && preview) onMarkupHandleDrag?.(d.id, preview);
        return;
      }
      case 'markup': {
        const md = markupDraftRef.current;
        if (!md) return;
        const pt = md.cursor;
        if (d.shape === 'stroke') {
          if (md.points.length >= 2) finishMarkup(md.type, md.points);
          else setMarkupDraft(null);
          return;
        }
        if (d.shape === 'line') {
          if (d.moved && pt) finishMarkup(md.type, [md.points[0], pt]);
          else setMarkupDraft({ ...md, awaitingSecond: true });
          return;
        }
        if (md.type === 'callout') {
          const tip = md.leader;
          const at = d.moved && pt ? pt : { pdfX: tip.pdfX + 30, pdfY: tip.pdfY - 60 };
          const { width, height } = DEFAULT_TEXTBOX_SIZE;
          finishMarkup('callout', [{ pdfX: at.pdfX, pdfY: at.pdfY - height / 2 }, { pdfX: at.pdfX + width, pdfY: at.pdfY + height / 2 }], { leader: tip });
          return;
        }
        // Box-like.
        const a = md.points[0];
        if (d.moved && pt && Math.abs(pt.pdfX - a.pdfX) * scale > 4 && Math.abs(pt.pdfY - a.pdfY) * scale > 4) {
          finishMarkup(md.type, normalizeBox(a, pt));
          return;
        }
        if (md.type === 'stamp' || md.type === 'textbox') {
          const { width, height } = md.type === 'stamp' ? DEFAULT_STAMP_SIZE : DEFAULT_TEXTBOX_SIZE;
          finishMarkup(md.type, [a, { pdfX: a.pdfX + width, pdfY: a.pdfY + height }]);
          return;
        }
        setMarkupDraft(null);
        return;
      }
      default:
    }
  };

  const handleDoubleClick = (e) => {
    if (activeTool || markupTool || calibrationMode || boxSelectMode || navTool !== 'select') return;
    const pt = pdfAt(e);
    if (!pt) return;
    const key = hitKeyAt(pt);
    if (key) onMarkupDoubleClick?.(key);
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    if (!page) return;
    const pt = pdfAt(e);
    if (!pt) return;
    // Live Count session: right-click a dot removes it.
    if (CLICK_DRAG_TOOLS.includes(activeTool) && activeCountSession?.points?.length) {
      let hitIndex = -1;
      let hitDist = Infinity;
      const hitRadius = Math.max(DOT_HIT_RADIUS_PX, (activeCountSession.fields?.marker_size || DEFAULT_COUNT_MARKER_RADIUS) + 4);
      activeCountSession.points.forEach((p, i) => {
        const dd = Math.hypot((pt.pdfX - p.pdfX) * scale, (pt.pdfY - p.pdfY) * scale);
        if (dd <= hitRadius && dd < hitDist) { hitDist = dd; hitIndex = i; }
      });
      if (hitIndex >= 0) { onCountDotRemove?.(hitIndex); return; }
    }
    if (markupDraftRef.current && MARKUP_TYPES[markupDraftRef.current.type]?.shape === 'poly') { finishPolyMarkup(); return; }
    const key = !activeTool && !markupTool && !calibrationMode ? hitKeyAt(pt) : null;
    if (key && !selectedKeys.includes(key)) onSelectionChange?.([key]);
    onCanvasContextMenu?.({ clientX: e.clientX, clientY: e.clientY, pdf: pt, key });
  };

  const handlePointerLeave = (e) => {
    setHoveredItem(null);
    setCursorPdf(null);
    setSnapHit(null);
    cursorStore?.set(null);
    if (dragRef.current && !e.currentTarget.hasPointerCapture?.(e.pointerId)) handlePointerUp(e);
  };

  if (!source) return null;

  const regionStyle = region && page && region.pageNumber === page.pageNumber && region.rotation === rot && region.oc === ocVersion
    ? (() => {
      const k = scale / region.scale;
      return { left: region.x * k, top: region.y * k, width: region.w * k, height: region.h * k };
    })()
    : null;
  const cursorStyle = calibrationMode || boxSelectMode || activeTool || markupTool
    ? (isDragging ? 'grabbing' : 'crosshair')
    : spacePressed || navTool === 'pan'
      ? (isDragging ? 'grabbing' : 'grab')
      : navTool === 'zoom' ? 'zoom-in' : 'default';
  const editingMarkup = editingTextId ? drawingMarkups.find((mk) => mk.id === editingTextId) : null;
  const layerMatrix = viewMatrix(view);
  const prevDisp = neighbors.prev ? displaySize(neighbors.prev.width, neighbors.prev.height, scale, 0) : null;
  const nextDisp = neighbors.next ? displaySize(neighbors.next.width, neighbors.next.height, scale, 0) : null;

  return (
    <div className={fillHeight ? 'h-full w-full flex flex-col bg-muted/20' : 'border rounded-lg overflow-hidden bg-muted/20 h-[640px] flex flex-col'}>
      <div
        ref={viewportRef}
        className="relative overflow-hidden bg-neutral-600 flex-1 min-h-0 select-none touch-none"
        style={{ cursor: cursorStyle }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-white z-30">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-amber-300 px-4 text-center z-30">{loadError}</div>
        )}

        {/* Pages (backdrop + sharp region), in displayed (rotated) page px. */}
        <div className="absolute top-0 left-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px)`, width: disp.width, height: disp.height }}>
          {continuous && neighbors.prev && prevDisp && (
            <canvas ref={prevCanvasRef} className="absolute bg-white shadow-lg opacity-90" style={{ left: 0, top: -(prevDisp.height + PAGE_GAP_PX), width: prevDisp.width, height: prevDisp.height }} />
          )}
          <canvas ref={backdropCanvasRef} className="absolute left-0 top-0 bg-white shadow-lg" style={{ width: disp.width, height: disp.height, visibility: page && backdropKey === `${page.pageNumber}:${rot}` ? 'visible' : 'hidden' }} />
          <canvas ref={regionCanvasRef} className="absolute" style={regionStyle || { display: 'none' }} />
          {continuous && neighbors.next && nextDisp && (
            <canvas ref={nextCanvasRef} className="absolute bg-white shadow-lg opacity-90" style={{ left: 0, top: disp.height + PAGE_GAP_PX, width: nextDisp.width, height: nextDisp.height }} />
          )}
        </div>

        <canvas ref={overlayCanvasRef} className="absolute inset-0 pointer-events-none" style={{ width: vpSize.width, height: vpSize.height }} />
        <canvas ref={cursorCanvasRef} className="absolute inset-0 pointer-events-none" style={{ width: vpSize.width, height: vpSize.height }} />

        {/* DOM layer in page space (same transform as the canvases) — the
            in-place text editor lives here so it tracks zoom and pan. */}
        {editingMarkup && page && (
          <div
            className="absolute left-0 top-0 pointer-events-none"
            style={{ transformOrigin: '0 0', transform: `matrix(${layerMatrix.join(',')})` }}
          >
            <InPlaceTextEditor
              key={editingMarkup.id}
              markup={editingMarkup}
              scale={scale}
              onCommit={(value) => onTextCommit?.(editingMarkup.id, value)}
            />
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
                  {calibrationPoints.length >= 2 && 'Points captured — enter the real-world distance'}
                </>
              )}
            {calibrationShape !== 'rect' && calibrationPoints.length < 2 ? ' · Shift = straight · Alt = no snap' : ''}
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
              {snapEnabled ? ' · Alt = no snap' : ''} · Shift = straight · drag to pan
            </span>
            {draft?.outer && (
              <Button size="sm" variant="secondary" className="h-6 px-2 text-xs pointer-events-auto" onPointerDown={(e) => e.stopPropagation()} onClick={() => onFinishShape?.()}>Finish (Enter)</Button>
            )}
          </div>
        )}
        {!calibrationMode && markupTool && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 rounded-md bg-slate-800 text-white text-xs font-semibold px-3 py-1.5 shadow-lg pointer-events-none whitespace-nowrap">
            {MARKUP_TYPES[markupTool]?.label}:{' '}
            {MARKUP_TYPES[markupTool]?.shape === 'poly' ? 'click each point · double-click, Enter or right-click to finish'
              : MARKUP_TYPES[markupTool]?.shape === 'stroke' ? 'press and drag to draw'
                : MARKUP_TYPES[markupTool]?.shape === 'line' ? 'drag, or click both ends · Shift = straight'
                  : markupTool === 'callout' ? 'press on the point, drag to where the text goes'
                    : markupTool === 'typewriter' ? 'click where the text starts, then type'
                      : markupTool === 'note' ? 'click to drop a note'
                        : markupTool === 'textbox' ? 'drag a box (or click), then type'
                          : 'drag a box (or click for the standard size)'}
            {' '}· Esc to stop
          </div>
        )}
        {!calibrationMode && !canMeasure && page && (activeTool || calibrationMode) && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-10 rounded-md bg-amber-500 text-white text-xs font-semibold px-3 py-1.5 shadow-lg pointer-events-none whitespace-nowrap">
            This page isn&apos;t calibrated — set its scale before measuring
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
        {hoveredItem && !isDragging && (
          <div
            className="absolute z-20 pointer-events-none rounded bg-black/80 text-white text-[11px] px-2 py-1 whitespace-nowrap"
            style={{ left: hoverPos.x + 14, top: hoverPos.y + 14 }}
          >
            {[hoveredItem.shape_type, hoveredItem.size_designation, hoveredItem.phase, hoveredItem.area].filter(Boolean).join(' | ') || 'Measurement'}
          </div>
        )}
      </div>
    </div>
  );
});

export default BlueprintCanvas;
