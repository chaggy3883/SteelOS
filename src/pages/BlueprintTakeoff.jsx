import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useOutletContext, useParams, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { db } from '@/api/apiClient';
import ErrorBoundary from '@/components/ErrorBoundary';
import { simulateAiBatchTakeoff } from '@/lib/aiIntelligenceEngine';
import { savePdf, getPdf } from '@/lib/pdfBlobStore';
import { findSimilarSymbols } from '@/lib/localAiClient';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import {
  Loader2, UploadCloud, ScanLine, Plus, Trash2, FileStack, FlaskConical, FileDown,
  Crosshair, FolderOpen, ArrowLeft, AlertTriangle, RotateCw,
  MousePointer2, MousePointerClick,
  ScanSearch, Check, X, Link2, ExternalLink, ListChecks, Grid3x3,
  Maximize2, GripVertical, StickyNote, Save, Hexagon, FileSpreadsheet,
  GitCompare, CopyPlus, FilePlus2, FileImage,
} from 'lucide-react';
import { calculateSteelSurfaceArea } from '@/lib/steelShapeMath';
import { SHAPE_CLASSES, getShapeClass } from '@/data/steelShapeSelector';
import { formatFeetInchesFraction } from '@/lib/fractionInches';
import { buildPendingMeasurement, applyMeasureExtras, measurementRowFields, measurementSummary, toolLabel, MEASURE_TOOLS } from '@/lib/takeoffGeometry';
import { buildLegendData } from '@/lib/takeoffLegend';
import { presetRowFields, presetSlope } from '@/lib/takeoffRowHelpers';
import { REVIEW_FLAG_TEXT } from '@/lib/takeoffCarryForward';
import { useTakeoffSessionExtras } from '@/hooks/useTakeoffSessionExtras';
import { useSymbolSearch } from '@/hooks/useSymbolSearch';
import { useTakeoffScales } from '@/hooks/useTakeoffScales';
import { useMeasureDraft } from '@/hooks/useMeasureDraft';
import { buildCompactShapeProfile } from '@/lib/countShapeProfile';
import { resolveWeightPerFt } from '@/lib/detailerImportWeight';
import { exportRequisitionToPdf } from '@/lib/requisitionPdfExport';
import { exportRequisitionToXlsx } from '@/lib/requisitionXlsxExport';
import { writeBidRecapCells, downloadWorkbook } from '@/lib/bidRecapXlsxExport';
import { buildBidRecapWrites } from '@/lib/bidRecapMapping';
import { exportRowsToCsv } from '@/lib/csvExport';
import * as XLSX from 'xlsx';
import steelSizesXlsxUrl from '@/assets/steel-sizes.xlsx?url';
import { parseSteelCatalogWorkbook, FALLBACK_STEEL_CATALOG } from '@/lib/steelCatalogXlsx';
import BlueprintCanvas from '@/components/estimating/BlueprintCanvas';
import MarkupsList from '@/components/estimating/MarkupsList';
import SteelCatalogEditor from '@/components/estimating/SteelCatalogEditor';
import AreaNameModal from '@/components/estimating/AreaNameModal';
import MeasurementConfirmationModal from '@/components/estimating/MeasurementConfirmationModal';
import CountSetupModal from '@/components/estimating/CountSetupModal';
import CountColorPickerModal from '@/components/estimating/CountColorPickerModal';
import CountTallyPanel from '@/components/estimating/CountTallyPanel';
import CountMarkerSwatch from '@/components/estimating/CountMarkerSwatch';
import ScalePanel, { stepsForScalePick } from '@/components/estimating/ScalePanel';
import MeasureToolButtons from '@/components/estimating/MeasureToolButtons';
import ToolChestPanel from '@/components/estimating/ToolChestPanel';
import ToolSetLibraryDialog from '@/components/estimating/ToolSetLibraryDialog';
import LegendControls from '@/components/estimating/LegendControls';
import VisualSearchPanel from '@/components/estimating/VisualSearchPanel';
import MarkupPdfExportDialog from '@/components/estimating/MarkupPdfExportDialog';
import RevisionCompareDialog from '@/components/estimating/RevisionCompareDialog';
import CarryForwardDialog from '@/components/estimating/CarryForwardDialog';

const COATING_TYPES = ['No Coating', 'Paint', 'Galvanized'];

// Stable empties for BlueprintCanvas props that feed its redraw effect — a
// fresh [] / {} every render would redraw the whole overlay every render.
const NO_ITEMS = [];
const NO_LEGEND_SETTING = {};

const emptyRow = (overrides = {}) => ({
  _key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  page_number: 1,
  shape_type: '',
  shape_class: 'W-Beam',
  size_designation: getShapeClass('W-Beam').sizes[0],
  confidence: null,
  quantity: 1,
  unit_weight_lbs_per_ft: 0,
  length_ft: 0,
  is_accepted: true,
  notes: '',
  is_demo: false,
  coating_type: 'No Coating',
  ...overrides,
});

// Fully automated from the row's own size designation (e.g. 'W14x90') — no
// manual depth/flange-width entry required. See steelShapeMath.js for the
// shape-family lookup this reads from. catalogRows lets HSS sizes imported
// with exact dimensions (Steel Inventory Catalog's HSS Tubing importer)
// use their true dimension1/dimension2 instead of a regex guess.
const rowPaintAreaSqIn = (r, catalogRows) => {
  if (r.coating_type !== 'Paint') return 0;
  return calculateSteelSurfaceArea(r.size_designation, r.length_ft, r.quantity, catalogRows);
};

const rowGalvanizedTons = (r) => {
  if (r.coating_type !== 'Galvanized') return 0;
  const totalLbs = (r.quantity || 0) * (r.unit_weight_lbs_per_ft || 0) * (r.length_ft || 0);
  return totalLbs / 2000;
};

// Measuring math (shoelace area with cutouts, polylines, slope, volume,
// angle, circles) lives in src/lib/takeoffGeometry.js; per-page/viewport
// scale in src/lib/takeoffScale.js.

// A single PDF-space (scale=1) point representing "where this measurement
// is" — the click point for Count, the midpoint for Length, the centroid
// for Area — used only to flag accidental same-spot duplicates, not for
// rendering.
const measurementAnchorFromPending = (m) => {
  if (m.tool === 'count') return { pdfX: m.pdfX, pdfY: m.pdfY };
  if (m.tool === 'length') return { pdfX: (m.point1.pdfX + m.point2.pdfX) / 2, pdfY: (m.point1.pdfY + m.point2.pdfY) / 2 };
  return { pdfX: m.centroid.pdfX, pdfY: m.centroid.pdfY };
};

const measurementAnchorFromRow = (r) => {
  if (r.tool === 'length' && r.point1 && r.point2) {
    return { pdfX: (r.point1.pdfX + r.point2.pdfX) / 2, pdfY: (r.point1.pdfY + r.point2.pdfY) / 2 };
  }
  if (r.pdfX != null && r.pdfY != null) return { pdfX: r.pdfX, pdfY: r.pdfY };
  return null;
};

// "Same spot" is deliberately generous (50 PDF-space units, roughly a
// finger's width on a typical drawing scale) — this is meant to catch an
// accidental re-click of the same piece, not to flag two genuinely distinct
// W14x90 columns elsewhere on the sheet as duplicates.
const DUPLICATE_SPOT_THRESHOLD_PDF = 50;

// Mirrors BlueprintCanvas's own MARKER_STATUS_COLORS — kept as a separate
// small constant here rather than a shared import since it's only ever
// used for the Confirmed Measurements table's status dot, not the canvas.
const MARKER_COLOR_HEX = { green: '#22c55e', blue: '#3b82f6', red: '#ef4444' };

const findDuplicateRow = (existingRows, tool, shape, size, phaseArea, anchor) => {
  if (!anchor) return null;
  return existingRows.find((r) => {
    if (r.tool !== tool || r.shape_type !== shape || r.size_designation !== size) return false;
    if ((r.phase || '') !== (phaseArea || '')) return false;
    const rAnchor = measurementAnchorFromRow(r);
    if (!rAnchor) return false;
    return Math.hypot(rAnchor.pdfX - anchor.pdfX, rAnchor.pdfY - anchor.pdfY) <= DUPLICATE_SPOT_THRESHOLD_PDF;
  }) || null;
};

// Explicit, clearly-labeled sample rows for checking the spreadsheet layout
// without a local VLM connected — NOT a substitute for the honest "no model
// reachable" state. These only ever load when a user clicks the dedicated
// demo button below; they never silently replace a real scan's error/result,
// and every row is flagged is_demo so it's unmistakable in the grid (this
// feeds real job-cost totals in production, so a fabricated-but-unlabeled
// row here would be a real estimating-accuracy hazard, not just a UI nit).
const DEMO_ROWS = [
  { page_number: 1, shape_type: 'Column', shape_class: 'W-Beam', size_designation: 'W14X90', quantity: 8, notes: 'NDT Testing required', confidence: 0.92 },
  { page_number: 3, shape_type: 'Roof Beam', shape_class: 'W-Beam', size_designation: 'W18X35', quantity: 14, notes: 'Standard Mill Source', confidence: 0.88 },
  { page_number: 4, shape_type: 'Gusset Connection Plate', shape_class: 'PL-Plate', size_designation: 'PL1/2X12', quantity: 42, notes: 'Liquidated damage risk dates attached', confidence: 0.81 },
];

export default function BlueprintTakeoff() {
  useDocumentTitle('SteelOS — IRONSIGHT');
  const { user } = useOutletContext() || {};
  const { id: bidId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [bid, setBid] = useState(null);
  const [estimatorFullName, setEstimatorFullName] = useState('');

  // 'sessions' = IRONSIGHT landing screen (resume list + start-new panel);
  // 'workspace' = the existing uploader/canvas/grid, scoped to whichever
  // takeoffId is currently open.
  const [mode, setMode] = useState('sessions');
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [newTakeoffName, setNewTakeoffName] = useState('');
  const [newSessionError, setNewSessionError] = useState(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [pdfMissingNotice, setPdfMissingNotice] = useState(false);
  const [reattachError, setReattachError] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [fileName, setFileName] = useState('');
  const [sheetCount, setSheetCount] = useState(null);
  const [scaleReference, setScaleReference] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [rows, setRows] = useState([]);
  const [catalog, setCatalog] = useState([]);
  // Steel Sizes workbook (src/assets/steel-sizes.xlsx), parsed client-side
  // into { shapeType: [sizes] } — separate from the steel_catalog entity
  // above; this is the raw AISC size list the workbook ships with, not the
  // estimator-curated/custom catalog. steelCatalogEditorOpen toggles the
  // modal that lets an estimator add/remove shapes and sizes on top of it.
  const [steelCatalog, setSteelCatalog] = useState({});
  const [steelCatalogEditorOpen, setSteelCatalogEditorOpen] = useState(false);
  // Named polygon regions an estimator can drop on the drawing (e.g. a deck
  // pour area) — keyed by name, each holding its own point list + id. Scoped
  // to whichever PDF is currently loaded — reset alongside the scale/rows any
  // time a different file is opened/uploaded, never persisted server-side.
  const [areas, setAreas] = useState({});
  // Closed-but-unnamed Area measurement (outer + cutouts, already scaled)
  // awaiting the Name This Area modal — cleared
  // (with no entry added to `areas`) if the estimator cancels instead.
  const [pendingAreaPolygon, setPendingAreaPolygon] = useState(null);
  const [areaNameModalOpen, setAreaNameModalOpen] = useState(false);
  const [takeoffId, setTakeoffId] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [excelExportError, setExcelExportError] = useState(null);
  const [takeoffName, setTakeoffName] = useState('');
  const [hasStoredPdf, setHasStoredPdf] = useState(false);

  // Part 3 — which Bid/Project (if any) the currently-open session is linked
  // to. activeBids/activeProjects back every "link to a bid or project"
  // picker in this file (sessions list, workspace header, new-takeoff form)
  // and MarkupsList's own push-time link prompt.
  const [sessionBidId, setSessionBidId] = useState(null);
  const [sessionProjectId, setSessionProjectId] = useState(null);
  const [activeBids, setActiveBids] = useState([]);
  const [activeProjects, setActiveProjects] = useState([]);
  const [loadingLinkTargets, setLoadingLinkTargets] = useState(true);
  const [newTakeoffLinkValue, setNewTakeoffLinkValue] = useState('');
  const [sessionLinkDraft, setSessionLinkDraft] = useState({});
  const [workspaceLinkDraft, setWorkspaceLinkDraft] = useState('');
  const [gridView, setGridView] = useState('takeoff');
  // Bid-entry drop-first flow — the bid's own ProjectSequenceArea rows (empty,
  // silently, for a bid with none defined), which area the estimator picked
  // for the NEXT file(s) about to be dropped, and which area the CURRENTLY
  // OPEN session was actually created with (restored on resume via
  // openSession, set on create via enterNewSessionWorkspace).
  const [bidAreas, setBidAreas] = useState([]);
  const [pendingDropAreaId, setPendingDropAreaId] = useState(null);
  const [sessionAreaId, setSessionAreaId] = useState(null);
  // Inline rename of the open session's takeoff_name (workspace header) —
  // the bid-entry drop-first flow never asks for a name up front, so this is
  // the "editable later" half of that trade-off; also available for a
  // standalone session.
  const [editingTakeoffName, setEditingTakeoffName] = useState(false);
  const [takeoffNameDraft, setTakeoffNameDraft] = useState('');
  // Confirmed Measurements table (Count/Length/Area rows only) — highlight
  // is which row's canvas marker most recently got clicked (cleared after a
  // short flash by highlightTimeoutRef), sort/excludedAreas drive that
  // table's own column-sort and phase/area checkbox filter.
  const [highlightedRowKey, setHighlightedRowKey] = useState(null);
  const [measurementSort, setMeasurementSort] = useState({ field: 'page_number', dir: 'asc' });
  const [excludedMeasurementAreas, setExcludedMeasurementAreas] = useState(() => new Set());
  // Phase 4 — Markups List weight settings (unit weight, typical length,
  // AISC/manual/override source), restored from the session on open and
  // handed to MarkupsList as its seed; MarkupsList owns persisting edits
  // back via its own 800ms-debounced write to blueprint_takeoffs.
  const [markupWeights, setMarkupWeights] = useState({});

  // Fullscreen drawing workspace — the canvas fills the viewport and the
  // toolbar becomes a small floating, draggable panel instead of an inline
  // row. floatingPanelPos tracks the panel's screen position; the drag
  // itself is handled with document-level listeners registered on
  // mousedown (see handlePanelDragStart) rather than extra state, since the
  // listeners' own closures already carry the drag's start position.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [floatingPanelPos, setFloatingPanelPos] = useState({ x: 16, y: 72 });

  const handlePanelDragStart = (e) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = floatingPanelPos;
    const handleMove = (moveEvent) => {
      setFloatingPanelPos({ x: startPos.x + (moveEvent.clientX - startX), y: startPos.y + (moveEvent.clientY - startY) });
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  // Two-point scale calibration. calibrationPoints are stored in PDF space
  // (scale=1) so they stay valid across zoom/pan; canvasScale mirrors
  // BlueprintCanvas's own live render scale (reported via onScaleChange)
  // since that's what converts a PDF-space distance into an actual
  // on-screen pixel distance at the current zoom level.
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState([]);
  // What the current two-click pick is for: { purpose: 'calibrate' |
  // 'check' | 'viewport', target: { kind: 'page' } | { kind: 'viewport',
  // id, name } }. ScalePanel reads the two points once both are placed.
  const [scalePick, setScalePick] = useState(null);
  // Per-page + per-viewport drawing scale (replaces the single session
  // px_per_ft, which is still read as the whole-set fallback for older
  // sessions — see takeoffScale.js migrateScaleState).
  const scales = useTakeoffScales(takeoffId);
  // Snap clicks to the PDF's own line work (hold Alt to place freely).
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [canvasScale, setCanvasScale] = useState(1);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });

  // Page Notes — free-form text per PDF page number, e.g. { 1: "note", 2:
  // "note" }. pageInfo mirrors BlueprintCanvas's own page-navigation state
  // (reported via onPageChange) so this panel always shows/edits the note
  // for whatever page the estimator is currently looking at, without this
  // component owning any of the page-turning logic itself.
  const [pageNotes, setPageNotes] = useState({});
  const [pageInfo, setPageInfo] = useState({ pageNum: 1, numPages: 1 });
  const [notesPanelOpen, setNotesPanelOpen] = useState(true);
  // Measuring is blocked on a page with no usable scale at all.
  const pageCalibrated = scales.pageHasScale(pageInfo.pageNum);
  const NOT_CALIBRATED_TOAST = { title: "This page isn't calibrated", description: 'Pick the drawing scale or Calibrate before measuring.', variant: 'destructive' };

  // Count/Length/Area measurement tools. All write straight into `rows`,
  // same as any other accepted_items row — source: 'measurement' is what
  // marks them as tool-placed (vs. AI-detected/manual/demo) for redraw +
  // display. toolChest presets are per-session saved shortcuts (label +
  // shape + color) so an estimator doesn't have to re-pick a shape/size
  // before every click; selectedPresetId tracks which one is "loaded" into
  // the tools.
  const [activeTool, setActiveTool] = useState(null);
  // Click collector for every drawn measuring tool (Length, Polylength,
  // Perimeter, Area + cutouts, Volume, Wall Area, Angle, Radius, Diameter).
  // Finished geometry lands in handleDraftComplete below.
  const measureDraft = useMeasureDraft({
    activeTool,
    resetKey: pageInfo.pageNum,
    onComplete: (tool, geom) => handleDraftComplete(tool, geom),
    onReject: (message) => toast({ title: message, variant: 'destructive' }),
  });
  // Confirmation modal that fires after every completed Count/Length/Area
  // measurement (never during calibration) — pendingMeasurement holds
  // whatever geometry that tool just produced (a click point, a two-point
  // length, or a closed+named polygon) until the estimator confirms or
  // cancels it in MeasurementConfirmationModal; nothing reaches `rows` until
  // then.
  const [measurementModalOpen, setMeasurementModalOpen] = useState(false);
  const [pendingMeasurement, setPendingMeasurement] = useState(null);
  const [toolChest, setToolChest] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState(null);
  // The Tool Chest preset currently being measured with — its shape/size/
  // slope seed the confirmation panel and its tool-set fields (subject,
  // color, symbol …) are copied onto every row it confirms.
  const activePreset = selectedPresetId ? toolChest.find((p) => p.id === selectedPresetId) || null : null;
  // Company tool set copy, custom columns, legends, revision compare and
  // the previous-revision link for this session (see the hook).
  const extras = useTakeoffSessionExtras(takeoffId);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [exportPdfOpen, setExportPdfOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [carryOpen, setCarryOpen] = useState(false);
  // Visual Search matches accepted into "a new count" wait here until the
  // Count setup finishes, then become that tally session's first marks.
  const pendingCountPointsRef = useRef(null);
  const revisionInputRef = useRef(null);

  // Count/Bolt Count click-to-mark tally engine. One shared session model
  // for both — `kind` ('beam'|'bolt') only decides which setup fields were
  // asked for. countSetup drives the Shape/Size/Length (or Size/Type/Grade)
  // step; pendingCountFields holds that step's result while the color/symbol
  // step runs; countSession is the live, uncommitted click-to-mark session
  // (points/color/symbol + which row, if any, is being resumed via "Add
  // Pieces"). Nothing reaches `rows` until handleSaveCountSession.
  const [countSetup, setCountSetup] = useState(null); // { kind, editingRowKey }
  const [countSetupModalOpen, setCountSetupModalOpen] = useState(false);
  const [pendingCountFields, setPendingCountFields] = useState(null); // { kind, editingRowKey, fields }
  const [countColorModalOpen, setCountColorModalOpen] = useState(false);
  const [countSession, setCountSession] = useState(null);
  // { kind, editingRowKey, fields, color, symbol, points, page_number }

  // Master material catalog, split by category — Structural Steel etc. for
  // the beam Count setup, Bolts/Fasteners for the Bolt Count setup. Same
  // MaterialShapeType/MaterialSizeOption/MaterialGradeOption entities Full
  // Takeoff's Grade dropdown already reads from, not the narrow legacy
  // steel_catalog.
  const [beamShapeTypes, setBeamShapeTypes] = useState([]);
  const [boltShapeTypes, setBoltShapeTypes] = useState([]);
  const [materialSizesByShapeId, setMaterialSizesByShapeId] = useState({});
  const [materialGradesByShapeId, setMaterialGradesByShapeId] = useState({});

  // VisualSearch — a Count row's marker gets cropped, sent to the local VLM
  // alongside the full page, and candidate matches come back as transient
  // review markers. Nothing here ever reaches `rows`/persist until the
  // estimator explicitly accepts it (see handleAcceptAllCandidates).
  const [candidates, setCandidates] = useState([]);
  const [candidateSourceRow, setCandidateSourceRow] = useState(null);
  const [visualSearchLoading, setVisualSearchLoading] = useState(false);
  const [visualSearchError, setVisualSearchError] = useState(null);

  const fileInputRef = useRef(null);
  const bidFileInputRef = useRef(null);
  const reattachInputRef = useRef(null);
  const activePdfUrlRef = useRef(null);
  const toolChestSaveTimerRef = useRef(null);
  const pageNotesSaveTimerRef = useRef(null);
  const canvasRef = useRef(null);
  const highlightTimeoutRef = useRef(null);
  // Non-AI Visual Search (template matching) on the current page.
  const symbolSearch = useSymbolSearch({ canvasRef, pageNum: pageInfo.pageNum, pageSize });

  useEffect(() => () => clearTimeout(highlightTimeoutRef.current), []);

  useEffect(() => {
    db.entities.steel_catalog.list('size_designation', 1000).then(setCatalog).catch(() => setCatalog([]));
  }, []);

  // Count/Bolt Count setup catalog — loaded once, split by category so the
  // beam setup step never shows a bolt/fastener shape type and vice versa.
  useEffect(() => {
    (async () => {
      try {
        const shapeTypes = await db.entities.MaterialShapeType.filter({ is_active: true }, 'shape_code', 1000);
        setBeamShapeTypes(shapeTypes.filter((s) => s.category !== 'Bolts/Fasteners'));
        setBoltShapeTypes(shapeTypes.filter((s) => s.category === 'Bolts/Fasteners'));

        const [sizes, grades] = await Promise.all([
          db.entities.MaterialSizeOption.list('sort_order', 20000),
          db.entities.MaterialGradeOption.list('sort_order', 20000),
        ]);
        const sizesByShape = {};
        sizes.forEach((s) => {
          if (s.is_active === false) return;
          (sizesByShape[s.shape_type_id] ||= []).push(s.size_value);
        });
        setMaterialSizesByShapeId(sizesByShape);
        const gradesByShape = {};
        grades.forEach((g) => {
          if (g.is_active === false) return;
          (gradesByShape[g.shape_type_id] ||= []).push(g.grade_value);
        });
        setMaterialGradesByShapeId(gradesByShape);
      } catch (e) {
        console.error('Failed to load material catalog for Count tool', e);
        setBeamShapeTypes([]);
        setBoltShapeTypes([]);
        setMaterialSizesByShapeId({});
        setMaterialGradesByShapeId({});
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(steelSizesXlsxUrl);
        if (!res.ok) throw new Error(`Steel sizes fetch failed: ${res.status}`);
        const buffer = await res.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const grouped = parseSteelCatalogWorkbook(workbook);
        if (!cancelled) setSteelCatalog(grouped);
      } catch (e) {
        console.error('Failed to load Steel sizes workbook, falling back to seed sizes', e);
        if (!cancelled) setSteelCatalog(FALLBACK_STEEL_CATALOG);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Only present when this page is reached as /estimating/blueprint-takeoff/:id
  // (linked from a specific Bid) — the Excel export uses it to pull
  // customer/project/tax/insurance/bond/LEED/estimator fields into the bid
  // template. Opened standalone (no bidId), those cells are simply skipped.
  useEffect(() => {
    if (!bidId) return;
    db.entities.Bid.get(bidId).then(setBid).catch(() => setBid(null));
  }, [bidId]);

  useEffect(() => {
    if (!bid?.estimator_id) {
      setEstimatorFullName('');
      return;
    }
    db.entities.employees.get(bid.estimator_id)
      .then((emp) => setEstimatorFullName(emp?.full_name || ''))
      .catch(() => setEstimatorFullName(''));
  }, [bid?.estimator_id]);

  // This bid's own Areas (BidAreaManager.jsx), if any — drives the optional
  // "Which area is this set for?" selector on the drop-first panel below.
  // Silently empty for a bid with none defined, or when opened standalone.
  useEffect(() => {
    if (!bidId) { setBidAreas([]); return; }
    db.entities.ProjectSequenceArea.filter({ bid_id: bidId }, 'production_priority', 200)
      .then(setBidAreas)
      .catch(() => setBidAreas([]));
  }, [bidId]);

  // Blob URLs handed back by getPdf() are ours to revoke — swap them out
  // through this helper instead of setFileUrl directly so a session switch
  // (or unmount) never leaks the previous one.
  const setActivePdfUrl = (url) => {
    if (activePdfUrlRef.current && activePdfUrlRef.current !== url) {
      URL.revokeObjectURL(activePdfUrlRef.current);
    }
    activePdfUrlRef.current = url;
    setFileUrl(url);
  };

  useEffect(() => () => {
    if (activePdfUrlRef.current) URL.revokeObjectURL(activePdfUrlRef.current);
  }, []);

  // AppLayout resolves `user` via its own separate db.auth.me() call, so this
  // page's very first render(s) always see `user` as null before it arrives
  // — loadSessions still fires on that pass (company_id: undefined) and can
  // finish with a stale/empty list before the real company_id is known.
  // sessionsLoadedForCompanyRef records which company_id the last COMPLETED
  // load actually reflects, so the auto-open effect below can tell a load
  // that's merely finished apart from one that's finished FOR THE REAL USER.
  const sessionsLoadedForCompanyRef = useRef(undefined);

  const loadSessions = async () => {
    const forCompanyId = user?.company_id;
    setSessionsLoading(true);
    try {
      const list = await db.entities.blueprint_takeoffs.filter({ company_id: forCompanyId }, '-created_date', 500);
      const sorted = [...list].sort((a, b) => {
        const aOpened = a.last_opened_at || '';
        const bOpened = b.last_opened_at || '';
        if (aOpened !== bOpened) return aOpened > bOpened ? -1 : 1;
        const aCreated = a.created_date || '';
        const bCreated = b.created_date || '';
        if (aCreated === bCreated) return 0;
        return aCreated > bCreated ? -1 : 1;
      });
      const withLabels = await Promise.all(sorted.map(async (t) => {
        let linkedLabel = '';
        let linkedType = null;
        if (t.project_id) {
          const project = await db.entities.Project.get(t.project_id).catch(() => null);
          linkedLabel = project?.name || '';
          linkedType = 'project';
        } else if (t.bid_id) {
          const linkedBid = await db.entities.Bid.get(t.bid_id).catch(() => null);
          linkedLabel = linkedBid?.job_name || (linkedBid?.bid_number ? `Bid ${linkedBid.bid_number}` : '');
          linkedType = 'bid';
        }
        return { ...t, _linkedLabel: linkedLabel, _linkedType: linkedType, _linkedId: t.project_id || t.bid_id || null };
      }));
      setSessions(withLabels);
    } catch (e) {
      console.error('Failed to load takeoff sessions', e);
      setSessions([]);
    } finally {
      setSessionsLoading(false);
      sessionsLoadedForCompanyRef.current = forCompanyId;
    }
  };

  useEffect(() => {
    loadSessions();
  }, [user?.company_id]);

  // This bid's own takeoff sessions only — drives the Resume list and the
  // auto-open decision below when reached via a specific bid. Standalone
  // (no bidId) keeps showing every company session, unfiltered, as before.
  const bidSessions = useMemo(
    () => (bidId ? sessions.filter((s) => s.bid_id === bidId) : sessions),
    [sessions, bidId]
  );

  // Reached via a bid's "Open IRONSIGHT" button (BidDetail.jsx) as
  // /estimating/blueprint-takeoff/:id — auto-resume that bid's own existing
  // session instead of leaving the estimator to find and click it in the
  // Resume list, so the button drops them straight into a session already
  // scoped to this bid rather than a blank/unassociated one. Only when
  // there's exactly one — with several, which one to auto-open is a real
  // choice the estimator should make, so this falls through to the sessions
  // screen (now scoped to just this bid's sessions) and its drop-first panel
  // instead. No matching session at all also falls through, the same way.
  // Attempted once per page load (a ref, not state) so it doesn't fight a
  // deliberate "Back to Sessions" navigation afterward.
  const autoOpenAttemptedRef = useRef(false);
  useEffect(() => {
    if (!bidId || sessionsLoading || autoOpenAttemptedRef.current) return;
    // sessionsLoading can flip back to false after a premature pass that ran
    // before the real user/company_id was known (see sessionsLoadedForCompanyRef
    // above) — wait for a completed load that's actually scoped to the
    // current user before treating "how many sessions does this bid have" as
    // settled, or this fires once on the wrong (empty) list and never gets
    // another chance.
    if (sessionsLoadedForCompanyRef.current !== user?.company_id) return;
    autoOpenAttemptedRef.current = true;
    const matches = sessions.filter((s) => s.bid_id === bidId);
    if (matches.length === 1) openSession(matches[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidId, user?.company_id, sessions, sessionsLoading]);

  const loadLinkTargets = async () => {
    if (!user) { setActiveBids([]); setActiveProjects([]); return; }
    // A company_id-less account (a real, observed state — some accounts get
    // created without one) used to permanently no-op here, since the caller
    // never even invoked this function. Falling back to an unfiltered load
    // instead mirrors localData.js's own applyTenantScope, which already
    // "fails open" when there's no resolvable tenant — so this stays
    // consistent with how the rest of the app already treats that case,
    // rather than leaving the picker empty with no path to recovery.
    if (!user.company_id) {
      console.warn(`BlueprintTakeoff: user ${user.email || user.id || '(unknown)'} has no company_id — loading all bids/projects unfiltered for the link picker.`);
    }
    setLoadingLinkTargets(true);
    try {
      const companyFilter = user.company_id ? { company_id: user.company_id } : {};
      const [bidsList, projectsList] = await Promise.all([
        db.entities.Bid.filter(companyFilter, '-created_date', 500),
        db.entities.Project.filter(companyFilter, '-created_date', 500),
      ]);
      setActiveBids(bidsList.filter((b) => !b.is_archived));
      setActiveProjects(projectsList.filter((p) => !p.is_archived));
    } catch (e) {
      console.error('Failed to load bids/projects for linking', e);
      setActiveBids([]);
      setActiveProjects([]);
    } finally {
      setLoadingLinkTargets(false);
    }
  };

  useEffect(() => {
    loadLinkTargets();
  }, [user]);

  // Persists a takeoff's bid_id/project_id link (mutually exclusive — linking
  // to one clears the other) and, when it's the currently-open session,
  // mirrors it into sessionBidId/sessionProjectId so the workspace header and
  // MarkupsList see the new link immediately.
  const persistTakeoffLink = async (targetTakeoffId, newBidId, newProjectId) => {
    await db.entities.blueprint_takeoffs.update(targetTakeoffId, {
      bid_id: newBidId || null,
      project_id: newBidId ? null : (newProjectId || null),
    });
    if (targetTakeoffId === takeoffId) {
      setSessionBidId(newBidId || null);
      setSessionProjectId(newBidId ? null : (newProjectId || null));
    }
    await loadSessions();
  };

  const parseLinkValue = (value) => {
    const [kind, id] = String(value || '').split(':');
    return { bid_id: kind === 'bid' ? id : null, project_id: kind === 'project' ? id : null };
  };

  const handleLinkSessionNow = async (sessionId, value) => {
    setSessionLinkDraft((prev) => ({ ...prev, [sessionId]: value }));
    const { bid_id, project_id } = parseLinkValue(value);
    if (!bid_id && !project_id) return;
    try {
      await persistTakeoffLink(sessionId, bid_id, project_id);
    } catch (e) {
      console.error('Failed to link takeoff session', e);
      toast({ title: 'Failed to link takeoff', variant: 'destructive' });
    }
  };

  const handleLinkWorkspaceNow = async (value) => {
    setWorkspaceLinkDraft(value);
    const { bid_id, project_id } = parseLinkValue(value);
    if (!bid_id && !project_id) return;
    try {
      await persistTakeoffLink(takeoffId, bid_id, project_id);
    } catch (e) {
      console.error('Failed to link takeoff session', e);
      toast({ title: 'Failed to link takeoff', variant: 'destructive' });
    }
  };

  // Debounced so rapid-fire "Add Preset" clicks (or the load-triggered set
  // right after openSession) don't each fire their own write — only the
  // settled toolChest, 800ms after the last change, gets persisted.
  useEffect(() => {
    if (!takeoffId) return;
    if (toolChestSaveTimerRef.current) clearTimeout(toolChestSaveTimerRef.current);
    toolChestSaveTimerRef.current = setTimeout(() => {
      db.entities.blueprint_takeoffs.update(takeoffId, { tool_chest: toolChest }).catch((e) => {
        console.error('Failed to persist tool chest', e);
      });
    }, 800);
    return () => clearTimeout(toolChestSaveTimerRef.current);
  }, [toolChest, takeoffId]);

  // Same 800ms-debounced pattern as tool_chest above — page notes save
  // shortly after the estimator stops typing rather than on every keystroke.
  useEffect(() => {
    if (!takeoffId) return;
    if (pageNotesSaveTimerRef.current) clearTimeout(pageNotesSaveTimerRef.current);
    pageNotesSaveTimerRef.current = setTimeout(() => {
      db.entities.blueprint_takeoffs.update(takeoffId, { page_notes: pageNotes }).catch((e) => {
        console.error('Failed to persist page notes', e);
      });
    }, 800);
    return () => clearTimeout(pageNotesSaveTimerRef.current);
  }, [pageNotes, takeoffId]);

  const resetWorkspaceState = () => {
    setTakeoffId(null);
    setActivePdfUrl(null);
    setFileName('');
    setSheetCount(null);
    setScaleReference('');
    setRows([]);
    setScanError(null);
    setPdfMissingNotice(false);
    setReattachError(null);
    setCalibrationMode(false);
    setCalibrationPoints([]);
    scales.reset();
    setScalePick(null);
    setActiveTool(null);
    measureDraft.reset();
    setAreas({});
    setPendingAreaPolygon(null);
    setAreaNameModalOpen(false);
    setToolChest([]);
    setSelectedPresetId(null);
    extras.reset();
    symbolSearch.clear();
    pendingCountPointsRef.current = null;
    setCandidates([]);
    setCandidateSourceRow(null);
    setVisualSearchLoading(false);
    setVisualSearchError(null);
    setSessionBidId(null);
    setSessionProjectId(null);
    setSessionAreaId(null);
    setEditingTakeoffName(false);
    setWorkspaceLinkDraft('');
    setGridView('takeoff');
    setMarkupWeights({});
    setPageNotes({});
    setPageInfo({ pageNum: 1, numPages: 1 });
    setCountSetup(null);
    setCountSetupModalOpen(false);
    setPendingCountFields(null);
    setCountColorModalOpen(false);
    setCountSession(null);
  };

  const openSession = async (takeoff) => {
    setTakeoffId(takeoff.id);
    setTakeoffName(takeoff.takeoff_name || takeoff.file_name || 'Untitled takeoff');
    setFileName(takeoff.file_name || '');
    setSheetCount(takeoff.sheet_count || null);
    setScaleReference(takeoff.scale_reference || '');
    setRows((takeoff.accepted_items || []).map((item) => emptyRow({ ...item })));
    setScanError(null);
    setReattachError(null);
    setHasStoredPdf(Boolean(takeoff.has_stored_pdf));
    setCalibrationMode(false);
    setCalibrationPoints([]);
    scales.loadFrom(takeoff);
    setScalePick(null);
    setActiveTool(null);
    measureDraft.reset();
    setAreas({});
    setPendingAreaPolygon(null);
    setAreaNameModalOpen(false);
    setToolChest(takeoff.tool_chest || []);
    setSelectedPresetId(null);
    extras.loadFrom(takeoff);
    symbolSearch.clear();
    pendingCountPointsRef.current = null;
    setCandidates([]);
    setCandidateSourceRow(null);
    setVisualSearchLoading(false);
    setVisualSearchError(null);
    setCountSetup(null);
    setCountSetupModalOpen(false);
    setPendingCountFields(null);
    setCountColorModalOpen(false);
    setCountSession(null);
    setSessionBidId(takeoff.bid_id || null);
    setSessionProjectId(takeoff.bid_id ? null : (takeoff.project_id || null));
    setSessionAreaId(takeoff.sequence_area_id || null);
    setEditingTakeoffName(false);
    setWorkspaceLinkDraft('');
    setGridView('takeoff');
    setMarkupWeights(takeoff.markup_weights || {});
    setPageNotes(takeoff.page_notes || {});
    setPageInfo({ pageNum: 1, numPages: 1 });

    let url = null;
    if (takeoff.has_stored_pdf) {
      try {
        url = await getPdf(takeoff.id);
      } catch (e) {
        console.error('Failed to load stored PDF for takeoff', takeoff.id, e);
        url = null;
      }
    }
    setActivePdfUrl(url);
    setPdfMissingNotice(!url);

    setMode('workspace');
    db.entities.blueprint_takeoffs.update(takeoff.id, { last_opened_at: new Date().toISOString() }).catch((e) => {
      console.error('Failed to update last_opened_at', e);
    });
  };

  const handleBackToSessions = () => {
    if (!confirmDiscardActiveCountSession()) return;
    resetWorkspaceState();
    setTakeoffName('');
    setHasStoredPdf(false);
    setMode('sessions');
    loadSessions();
  };

  // Recovery path for the IRONSIGHT workspace error boundary below — same
  // end state as handleBackToSessions, but skipped the confirm-discard
  // prompt deliberately: this only ever runs after a render exception, where
  // in-memory count-session state may itself be the thing that's broken, and
  // this must unconditionally get the estimator back to a working screen.
  const handleWorkspaceErrorReset = () => {
    resetWorkspaceState();
    setTakeoffName('');
    setHasStoredPdf(false);
    setMode('sessions');
    loadSessions();
  };

  const handleReattachPdf = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !takeoffId) return;
    setReattachError(null);
    try {
      await savePdf(takeoffId, file);
      await db.entities.blueprint_takeoffs.update(takeoffId, { has_stored_pdf: true, file_name: file.name });
      setFileName(file.name);
      const url = await getPdf(takeoffId);
      setActivePdfUrl(url);
      setPdfMissingNotice(!url);
    } catch (err) {
      console.error('Failed to re-attach PDF', err);
      setReattachError('Could not store this PDF — see console for details.');
    }
  };

  const stripPdfExtension = (name) => (name || '').replace(/\.pdf$/i, '').trim();

  // Core session-record creation, shared by the standalone named-upload flow
  // (handleNewTakeoffFile) and the bid-entry drop-first flow below
  // (handleBidFilesDrop) — just the UploadFile + blueprint_takeoffs.create,
  // no workspace UI state. areaId is the bid-entry flow's optional
  // ProjectSequenceArea pick; always undefined for a standalone session.
  const createTakeoffRecord = async ({ file, name, areaId, extra = {} }) => {
    const { file_url } = await db.integrations.Core.UploadFile({ file });
    const pickedLink = bidId ? { bid_id: null, project_id: null } : parseLinkValue(newTakeoffLinkValue);
    return db.entities.blueprint_takeoffs.create({
      company_id: user?.company_id,
      bid_id: bidId || pickedLink.bid_id || undefined,
      project_id: bidId ? undefined : (pickedLink.project_id || undefined),
      sequence_area_id: areaId || undefined,
      takeoff_name: name,
      file_url,
      file_name: file.name,
      sheet_count: 1,
      scale_reference: '',
      accepted_items: [],
      has_stored_pdf: false,
      last_opened_at: new Date().toISOString(),
      ...extra,
    });
  };

  // Stores a just-created session's PDF to IndexedDB in the background with
  // no workspace UI feedback — used for every session in a multi-file
  // bid-entry drop EXCEPT the one that's actually opened (enterNewSessionWorkspace
  // below already does this with UI feedback for that one), since a
  // not-currently-open session has no "storing…"/error UI to update anyway.
  const persistTakeoffPdfQuietly = (created, file) => {
    savePdf(created.id, file)
      .then(() => db.entities.blueprint_takeoffs.update(created.id, { has_stored_pdf: true }))
      .catch((e) => console.error('Failed to store PDF for offline resume (background session)', created.id, e));
  };

  // Opens a freshly-created session straight into the workspace — the same
  // full state reset handleNewTakeoffFile always did, factored out so the
  // bid-entry drop-first flow (possibly several files dropped at once) can
  // open just the first one the exact same way.
  const enterNewSessionWorkspace = (created, file) => {
    setTakeoffId(created.id);
    setTakeoffName(created.takeoff_name || file.name);
    setHasStoredPdf(false);
    // file_url (from UploadFile) is an opaque steelos-upload:<id> reference,
    // not a fetchable URL — pdf.js can't load it. Display the in-memory
    // File directly via its own object URL instead; setActivePdfUrl revokes
    // it automatically on the next session switch/unmount. The persisted
    // blueprint_takeoffs.file_url record and the background savePdf below
    // are unaffected — this only changes what's handed to BlueprintCanvas.
    setActivePdfUrl(URL.createObjectURL(file));
    setFileName(file.name);
    setSheetCount(null);
    setScaleReference('');
    setRows([]);
    setScanError(null);
    setPdfMissingNotice(false);
    setReattachError(null);
    setCalibrationMode(false);
    setCalibrationPoints([]);
    scales.reset();
    setScalePick(null);
    setActiveTool(null);
    measureDraft.reset();
    setAreas({});
    setPendingAreaPolygon(null);
    setAreaNameModalOpen(false);
    setToolChest([]);
    setSelectedPresetId(null);
    extras.reset();
    symbolSearch.clear();
    pendingCountPointsRef.current = null;
    setCandidates([]);
    setCandidateSourceRow(null);
    setVisualSearchLoading(false);
    setVisualSearchError(null);
    setCountSetup(null);
    setCountSetupModalOpen(false);
    setPendingCountFields(null);
    setCountColorModalOpen(false);
    setCountSession(null);
    setSessionBidId(created.bid_id || null);
    setSessionProjectId(created.bid_id ? null : (created.project_id || null));
    setSessionAreaId(created.sequence_area_id || null);
    setEditingTakeoffName(false);
    setWorkspaceLinkDraft('');
    setGridView('takeoff');
    setMarkupWeights({});
    setPageNotes({});
    setPageInfo({ pageNum: 1, numPages: 1 });
    setMode('workspace');

    // Open the workspace immediately — the PDF write to IndexedDB happens
    // in the background so the user isn't stuck on the sessions screen
    // waiting for it. has_stored_pdf/hasStoredPdf flip on once it lands.
    savePdf(created.id, file)
      .then(() => db.entities.blueprint_takeoffs.update(created.id, { has_stored_pdf: true }))
      .then(() => setHasStoredPdf(true))
      .catch((e) => {
        console.error('Failed to store PDF for offline resume', e);
        setHasStoredPdf(false);
        setNewSessionError('This session was created, but the PDF could not be stored on this device — reopening it later will restore measurements only, not the drawing.');
      });
  };

  const handleNewTakeoffFile = async (file) => {
    if (!file) return;
    if (!newTakeoffName.trim()) {
      setNewSessionError('Enter a takeoff name before uploading.');
      return;
    }
    setNewSessionError(null);
    setCreatingSession(true);
    try {
      const created = await createTakeoffRecord({ file, name: newTakeoffName.trim(), areaId: null });
      enterNewSessionWorkspace(created, file);
      setNewTakeoffLinkValue('');
      setNewTakeoffName('');
      loadSessions();
    } catch (e) {
      console.error('Failed to create takeoff session', e);
      setNewSessionError('Could not create the takeoff session — see console for details.');
    } finally {
      setCreatingSession(false);
    }
  };

  const handleNewDropzoneClick = () => {
    if (!newTakeoffName.trim()) {
      setNewSessionError('Enter a takeoff name before uploading.');
      return;
    }
    setNewSessionError(null);
    fileInputRef.current?.click();
  };

  const handleNewBrowseSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    await handleNewTakeoffFile(file);
  };

  const handleNewDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!newTakeoffName.trim()) {
      setNewSessionError('Enter a takeoff name before uploading.');
      return;
    }
    const file = e.dataTransfer.files?.[0];
    await handleNewTakeoffFile(file);
  };

  // Bid-entry drop-first flow — no name required up front (defaults from
  // each file's own name), one session per dropped file, all linked to this
  // bid and tagged with whatever area is currently selected in
  // pendingDropAreaId (if the bid has any). The first session opens straight
  // into the workspace; the rest are created and stored in the background
  // and simply show up in the Resume list next time it's seen (loadSessions
  // below already refreshes it, even though the estimator is mid-upload in
  // the first file's workspace when that happens).
  const handleBidFilesDrop = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length === 0) return;
    setNewSessionError(null);
    setCreatingSession(true);
    try {
      const areaId = pendingDropAreaId;
      const createdPairs = [];
      for (const file of files) {
        const name = stripPdfExtension(file.name) || file.name;
        const created = await createTakeoffRecord({ file, name, areaId });
        createdPairs.push({ created, file });
      }
      const [first, ...rest] = createdPairs;
      enterNewSessionWorkspace(first.created, first.file);
      rest.forEach(({ created, file }) => persistTakeoffPdfQuietly(created, file));
      loadSessions();
    } catch (e) {
      console.error('Failed to create takeoff session(s)', e);
      setNewSessionError('Could not create the takeoff session — see console for details.');
    } finally {
      setCreatingSession(false);
    }
  };

  const handleBidBrowseSelect = async (e) => {
    // Snapshot into a real array before clearing the input — e.target.files
    // is a live FileList tied to the input's current value, so resetting
    // e.target.value first (as handleNewBrowseSelect does, safe there since
    // it extracts files[0] into a plain File reference immediately) would
    // empty this one out from under handleBidFilesDrop's later iteration.
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await handleBidFilesDrop(files);
  };

  const handleBidDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    await handleBidFilesDrop(e.dataTransfer.files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  // Inline rename (workspace header) — the only way to set a takeoff's name
  // when it was created via the bid-entry drop-first flow, which never asks
  // up front; also available for a standalone session.
  const commitTakeoffNameEdit = () => {
    const trimmed = takeoffNameDraft.trim();
    setEditingTakeoffName(false);
    if (!trimmed || trimmed === takeoffName) return;
    setTakeoffName(trimmed);
    if (takeoffId) {
      db.entities.blueprint_takeoffs.update(takeoffId, { takeoff_name: trimmed }).catch((e) => {
        console.error('Failed to rename takeoff', e);
      });
    }
  };

  // Starts a two-click pick on the drawing for ScalePanel — calibrate the
  // page or a viewport, check the scale against a known dimension, or box
  // out a new viewport.
  const startScalePick = (purpose = 'calibrate', target = { kind: 'page' }) => {
    if (!confirmDiscardActiveCountSession()) return;
    setActiveTool(null);
    measureDraft.reset();
    resetCountEngine();
    setCalibrationPoints([]);
    setScalePick({ purpose, target });
    setCalibrationMode(true);
    setMeasurementModalOpen(false);
    setPendingMeasurement(null);
  };

  const handleStartCalibration = () => startScalePick('calibrate', { kind: 'page' });

  const handleCalibrationCancel = () => {
    setCalibrationPoints([]);
    setCalibrationMode(false);
    setScalePick(null);
  };

  const handleScaleReference = (text) => {
    setScaleReference(text);
    if (takeoffId) {
      db.entities.blueprint_takeoffs.update(takeoffId, { scale_reference: text }).catch((e) => {
        console.error('Failed to persist scale reference', e);
      });
    }
  };

  const handleCalibrationClick = ({ pdfX, pdfY }) => {
    setCalibrationPoints((prev) => (prev.length >= 2 ? prev : [...prev, { pdfX, pdfY }]));
  };

  // Clears every piece of Count/Bolt Count engine state — used whenever the
  // estimator switches to a different tool (or Escape) mid-setup or
  // mid-session, same as the other tools already reset the measuring draft/
  // pendingMeasurement on a switch. A live session's marks only
  // ever exist in countSession.points until Save, so this never touches an
  // already-saved row.
  const resetCountEngine = () => {
    setCountSetup(null);
    setCountSetupModalOpen(false);
    setPendingCountFields(null);
    setCountColorModalOpen(false);
    setCountSession(null);
  };

  // A live count session's dots only ever live in countSession.points until
  // Save writes them into `rows` — switching tools/presets, hitting Escape,
  // or re-clicking Count would otherwise silently throw away every unsaved
  // mark. Returns true (safe to proceed) when there's nothing to lose, or
  // once the estimator explicitly confirms discarding it.
  const confirmDiscardActiveCountSession = () => {
    const tally = countSession?.points?.length || 0;
    if (tally === 0) return true;
    return window.confirm(`Discard ${tally} unsaved mark${tally === 1 ? '' : 's'} from the current count session? Click Cancel to go back and Save first.`);
  };

  const handleSelectTool = () => {
    if (!confirmDiscardActiveCountSession()) return;
    setActiveTool(null);
    measureDraft.reset();
    setMeasurementModalOpen(false);
    setPendingMeasurement(null);
    resetCountEngine();
  };

  // Gate every tool activation behind calibration — Count/Length/Area
  // measurements are meaningless without a page scale, so there's no
  // partial-credit path here: either it's set and the tool goes live, or it
  // isn't and nothing changes beyond the toast telling the estimator what to
  // do first.
  const handleActivateTool = (tool) => {
    if (!pageCalibrated) {
      toast(NOT_CALIBRATED_TOAST);
      return;
    }
    if (!confirmDiscardActiveCountSession()) return;
    setCalibrationMode(false);
    setCalibrationPoints([]);
    setScalePick(null);
    measureDraft.reset();
    setMeasurementModalOpen(false);
    setPendingMeasurement(null);
    resetCountEngine();
    setSelectedPresetId(null);
    setActiveTool(tool);
  };

  // Step 1 — opens CountSetupModal for a fresh beam ('count') or bolt
  // ('bolt_count') tally. activeTool stays null until the color/symbol step
  // also completes (handleConfirmCountColor), so the canvas never enters
  // click-to-mark mode with an incomplete session.
  // `preset` — the Tool Chest preset this count was started from (if any);
  // its tool-set fields ride along to the saved row.
  const handleStartCountSetup = (kind, preset = null) => {
    if (!pageCalibrated) {
      pendingCountPointsRef.current = null;
      toast(NOT_CALIBRATED_TOAST);
      return;
    }
    if (!confirmDiscardActiveCountSession()) { pendingCountPointsRef.current = null; return; }
    setCalibrationMode(false);
    setCalibrationPoints([]);
    measureDraft.reset();
    setMeasurementModalOpen(false);
    setPendingMeasurement(null);
    setActiveTool(null);
    setCountSession(null);
    setSelectedPresetId(preset?.id || null);
    setCountSetup({ kind, editingRowKey: null, preset });
    setCountSetupModalOpen(true);
  };

  // Step 2 — Shape/Size/Length (or Type/Size/Grade) collected, now pick a
  // color (or symbol, once this page's 20-color palette is exhausted). A
  // company tool-set tool already defines its color/symbol, so that step is
  // skipped for one.
  const handleConfirmCountSetup = (fields) => {
    setCountSetupModalOpen(false);
    const preset = countSetup.preset || null;
    const pending = {
      kind: countSetup.kind,
      editingRowKey: countSetup.editingRowKey,
      preset,
      fields: preset
        ? { ...fields, marker_size: fields.marker_size || preset.marker_size || null, show_numbers: Boolean(fields.show_numbers || preset.show_numbers) }
        : fields,
    };
    if (preset?.tool_set_tool_id) {
      beginCountSession(pending, preset.symbol && preset.symbol !== 'circle' ? { symbol: preset.symbol } : { color: preset.color });
      return;
    }
    setPendingCountFields(pending);
    setCountColorModalOpen(true);
  };

  const handleCancelCountSetup = () => {
    setCountSetupModalOpen(false);
    setCountSetup(null);
    pendingCountPointsRef.current = null;
  };

  // Step 3 — color/symbol chosen, the click-to-mark session goes live.
  const beginCountSession = (pending, choice) => {
    const { kind, editingRowKey, fields, preset } = pending;
    const tool = kind === 'bolt' ? 'bolt_count' : 'count';
    const existingRow = editingRowKey ? rows.find((r) => r._key === editingRowKey) : null;
    const pageNumber = existingRow ? (existingRow.page_number || 1) : pageInfo.pageNum;
    // A brand-new count can start with Visual Search matches the estimator
    // already accepted (same page only).
    const fromSearch = pendingCountPointsRef.current;
    pendingCountPointsRef.current = null;
    const initialPoints = existingRow
      ? (existingRow.points?.length ? existingRow.points.slice() : (existingRow.pdfX != null ? [{ pdfX: existingRow.pdfX, pdfY: existingRow.pdfY }] : []))
      : (fromSearch && fromSearch.page === pageNumber ? fromSearch.points.slice() : []);

    setCountSession({
      kind,
      editingRowKey,
      fields,
      preset: preset || null,
      color: choice.color || null,
      symbol: choice.symbol || null,
      points: initialPoints,
      page_number: pageNumber,
    });
    setCountColorModalOpen(false);
    setPendingCountFields(null);
    setCountSetup(null);
    setActiveTool(tool);
    if (existingRow) canvasRef.current?.goToPage(pageNumber);
  };

  const handleConfirmCountColor = (choice) => {
    if (!pendingCountFields) return;
    beginCountSession(pendingCountFields, choice);
  };

  const handleCancelCountColor = () => {
    setCountColorModalOpen(false);
    setPendingCountFields(null);
    setCountSetup(null);
    pendingCountPointsRef.current = null;
  };

  // "Add Pieces" — resumes an already-saved count/bolt_count row's session
  // directly, pre-loaded with its existing shape/size/length(-or-grade),
  // color/symbol, and dots, skipping the setup/color steps entirely since
  // that context already exists. Saving updates this same row instead of
  // creating a new one (see handleSaveCountSession).
  const handleResumeCount = (row) => {
    if (!scales.pageHasScale(row.page_number || 1)) {
      toast(NOT_CALIBRATED_TOAST);
      return;
    }
    if (!confirmDiscardActiveCountSession()) return;
    const kind = row.tool === 'bolt_count' ? 'bolt' : 'beam';
    setCalibrationMode(false);
    setCalibrationPoints([]);
    measureDraft.reset();
    setMeasurementModalOpen(false);
    setPendingMeasurement(null);
    setCountSetupModalOpen(false);
    setCountColorModalOpen(false);
    setPendingCountFields(null);
    setCountSetup(null);

    const fields = kind === 'bolt'
      ? { shape_type: row.shape_type, shape_code: row.shape_code || '', size_designation: row.size_designation, grade: row.grade || '' }
      : { shape_type: row.shape_type, shape_code: row.shape_code || '', size_designation: row.size_designation, length_ft: row.length_ft || 0, width_ft: row.width_ft || 0, grade: row.grade || '' };
    fields.marker_size = row.marker_size || null;
    fields.show_numbers = Boolean(row.show_numbers);
    const pageNumber = row.page_number || 1;

    setCountSession({
      kind,
      editingRowKey: row._key,
      fields,
      color: row.color || null,
      symbol: row.symbol || null,
      points: row.points?.length ? row.points.slice() : (row.pdfX != null ? [{ pdfX: row.pdfX, pdfY: row.pdfY }] : []),
      page_number: pageNumber,
    });
    setActiveTool(kind === 'bolt' ? 'bolt_count' : 'count');
    canvasRef.current?.goToPage(pageNumber);
  };

  // Click-to-mark — drops a dot and grows the running tally. Nothing is
  // written to `rows` here; the session lives entirely in countSession until
  // Save (handleSaveCountSession).
  const handleCountMark = ({ pdfX, pdfY }) => {
    setCountSession((prev) => (prev ? { ...prev, points: [...prev.points, { pdfX, pdfY }] } : prev));
  };

  // Right-click on an existing dot — removes it and decrements the tally.
  const handleCountDotRemove = (pointIndex) => {
    setCountSession((prev) => (prev ? { ...prev, points: prev.points.filter((_, i) => i !== pointIndex) } : prev));
  };

  const handleCancelCountSession = () => {
    setCountSession(null);
    setActiveTool(null);
  };

  // Commits the tally as this session's quantity — updating the resumed row
  // in place (editingRowKey set) or creating a new takeoff line item.
  const handleSaveCountSession = () => {
    if (!countSession) return;
    const qty = countSession.points.length;
    if (qty === 0) {
      toast({ title: 'Mark at least one piece before saving.', variant: 'destructive' });
      return;
    }
    const { kind, editingRowKey, fields, color, symbol, points, page_number, preset } = countSession;
    const tool = kind === 'bolt' ? 'bolt_count' : 'count';
    const fromPreset = presetRowFields(preset);

    // Weight-per-ft — same catalog-match-then-estimate resolution Detailer
    // Import already uses (resolveWeightPerFt), just fed a compact AISC-style
    // profile bridged from the master catalog's shape_code + size_designation
    // (see countShapeProfile.js). Bolt counts aren't weighed by length.
    const weightPerFt = kind === 'beam'
      ? (resolveWeightPerFt(
          {
            material_profile: buildCompactShapeProfile({ shapeCode: fields.shape_code, sizeDesignation: fields.size_designation, widthFt: fields.width_ft }),
            shape: fields.shape_code,
          },
          catalog,
        ) || 0)
      : 0;

    let updated;
    if (editingRowKey) {
      updated = rows.map((r) => (r._key === editingRowKey ? {
        ...r,
        shape_type: fields.shape_type,
        shape_code: fields.shape_code || '',
        size_designation: fields.size_designation,
        grade: fields.grade || '',
        ...(kind === 'beam' ? { length_ft: fields.length_ft || 0, width_ft: fields.width_ft || 0 } : {}),
        color,
        symbol,
        points,
        marker_size: fields.marker_size || null,
        show_numbers: Boolean(fields.show_numbers),
        quantity: qty,
        unit_weight_lbs_per_ft: weightPerFt,
        label: [fields.shape_type, fields.size_designation].filter(Boolean).join(' '),
      } : r));
    } else {
      const newRow = {
        ...fromPreset,
        _key: crypto.randomUUID(),
        id: crypto.randomUUID(),
        source: 'measurement',
        tool,
        page_number,
        shape_type: fields.shape_type,
        shape_code: fields.shape_code || '',
        size_designation: fields.size_designation,
        label: [fields.shape_type, fields.size_designation].filter(Boolean).join(' ') || (kind === 'bolt' ? 'Bolt Count' : 'Count'),
        color,
        symbol,
        points,
        marker_size: fields.marker_size || null,
        show_numbers: Boolean(fields.show_numbers),
        quantity: qty,
        length_ft: kind === 'beam' ? (fields.length_ft || 0) : 0,
        width_ft: kind === 'beam' ? (fields.width_ft || 0) : 0,
        grade: fields.grade || fromPreset.grade || '',
        // A tool's typed lb/ft only fills in when the catalog found nothing.
        unit_weight_lbs_per_ft: weightPerFt || fromPreset.unit_weight_lbs_per_ft || 0,
        notes: '',
        is_saved: true,
        is_accepted: true,
      };
      updated = [...rows, newRow];
    }
    setRows(updated);
    persist(updated);
    setCountSession(null);
    setActiveTool(null);
  };

  // Every drawn tool's clicks go through useMeasureDraft. The first click
  // decides the scale (the viewport it's in, else the page's) — a click on
  // an uncalibrated page/viewport is refused before anything is drawn.
  const handleMeasurementClick = ({ pdfX, pdfY, isClosingClick }) => {
    if (isClosingClick) {
      measureDraft.closeShape();
      return;
    }
    const pt = { pdfX, pdfY };
    const { draft } = measureDraft;
    if (draft.points.length === 0 && !draft.outer) {
      const sc = scales.resolveAt(pageInfo.pageNum, pt);
      if (!sc?.ptsPerFt) {
        toast(sc?.blocked
          ? { title: `${sc.name || 'This viewport'} has no scale yet`, description: 'Set its scale in the scale panel before measuring inside it.', variant: 'destructive' }
          : NOT_CALIBRATED_TOAST);
        return;
      }
    }
    measureDraft.addPoint(pt);
  };

  // A finished drawing becomes a pending measurement at the scale that
  // applied at its first point. Area still goes through Name This Area
  // first (that name becomes a phase/area zone); everything else goes
  // straight to the confirmation panel. Nothing reaches `rows` until the
  // estimator confirms.
  const handleDraftComplete = (tool, geom) => {
    const first = geom.outer?.[0] || geom.points?.[0];
    const sc = first ? scales.resolveAt(pageInfo.pageNum, first) : null;
    if (!sc?.ptsPerFt) {
      toast(NOT_CALIBRATED_TOAST);
      return;
    }
    const pending = buildPendingMeasurement(tool, geom, sc.ptsPerFt);
    if (!pending) return;
    pending.scale_source = sc.source;
    pending.scale_label = sc.label;
    if (sc.viewportId) pending.scale_viewport_id = sc.viewportId;
    if (tool === 'area') {
      setPendingAreaPolygon(pending);
      setAreaNameModalOpen(true);
      return;
    }
    setPendingMeasurement(pending);
    setMeasurementModalOpen(true);
  };

  const handleSaveAreaName = (name) => {
    if (pendingAreaPolygon) {
      setAreas((prev) => ({
        ...prev,
        [name]: { id: crypto.randomUUID(), polygon: pendingAreaPolygon.polygon_points, cutouts: pendingAreaPolygon.cutouts || [], pageNumber: pageInfo.pageNum },
      }));
      // The zone itself is committed above regardless — this only decides
      // whether it also becomes a takeoff row. zoneName pre-selects this
      // exact zone in the confirmation modal's Phase/Area dropdown.
      setPendingMeasurement({ ...pendingAreaPolygon, zoneName: name });
      setMeasurementModalOpen(true);
    }
    setPendingAreaPolygon(null);
    measureDraft.reset();
    setAreaNameModalOpen(false);
  };

  const handleCancelAreaName = () => {
    setPendingAreaPolygon(null);
    measureDraft.reset();
    setAreaNameModalOpen(false);
  };

  // Same crop-and-ask-the-local-VLM flow as handleFindSimilar below, but for
  // a measurement that hasn't been confirmed into `rows` yet — so it works
  // off pendingMeasurement's own point instead of an existing row, and hands
  // the raw match count back to the modal instead of populating the
  // separate candidate-review UI (`candidates`).
  const handleCountSimilarForModal = async () => {
    if (!pendingMeasurement || !canvasRef.current || pageSize.width <= 0 || pageSize.height <= 0) {
      toast({ title: 'Could not capture the drawing for visual search.', variant: 'destructive' });
      return null;
    }

    const point = pendingMeasurement.tool === 'length' ? pendingMeasurement.point2
      : pendingMeasurement.centroid || pendingMeasurement;

    const pageImageDataUrl = canvasRef.current.getFullPageDataUrl();
    const cropDataUrl = canvasRef.current.getCropDataUrl(point.pdfX, point.pdfY, 120);
    if (!pageImageDataUrl || !cropDataUrl) {
      toast({ title: 'Could not capture the drawing for visual search.', variant: 'destructive' });
      return null;
    }

    const matches = await findSimilarSymbols(pageImageDataUrl, cropDataUrl, scaleReference);
    if (!matches) {
      toast({ title: 'Visual search requires a local AI model — see Settings > AI Configuration', variant: 'destructive' });
      return null;
    }
    return matches.length;
  };

  const finishMeasurementModal = () => {
    measureDraft.reset();
    setMeasurementModalOpen(false);
    setPendingMeasurement(null);
  };

  const handleCancelMeasurement = () => {
    finishMeasurementModal();
  };

  // markerColor is always 'green' for a fresh, non-duplicate row, or 'red'
  // when the estimator explicitly chose "Keep Separate" on a duplicate
  // prompt — `color` is kept in sync with it since MarkupsList's own group
  // swatches still read the hex field, not marker_color.
  // `extras` is the confirmation panel's slope / depth / wall height —
  // applied on top of the plan values here so the saved row carries the
  // final quantity (see takeoffGeometry.js applyMeasureExtras).
  const buildMeasurementRow = (shape, size, qty, phaseArea, markerColor, measureExtras) => {
    const m = pendingMeasurement.tool === 'count' ? pendingMeasurement : applyMeasureExtras(pendingMeasurement, measureExtras || {});
    const base = {
      id: crypto.randomUUID(),
      source: 'measurement',
      tool: pendingMeasurement.tool,
      page_number: pageInfo.pageNum,
      shape_type: shape,
      size_designation: size,
      label: [shape, size].filter(Boolean).join(' ') || toolLabel(pendingMeasurement.tool),
      color: markerColor === 'red' ? '#ef4444' : '#22c55e',
      marker_color: markerColor,
      quantity: qty,
      phase: phaseArea,
      area: phaseArea,
      notes: '',
      is_saved: true,
      is_accepted: true,
      unit_weight_lbs_per_ft: 0,
      length_ft: m.length_ft || 0,
    };
    base._key = base.id;
    // Measured with a Tool Chest tool of this same kind → copy its tool-set
    // fields (subject, color, symbol, shape class …) onto the row.
    if (activePreset && (activePreset.measurement_type || activePreset.tool) === pendingMeasurement.tool) {
      Object.assign(base, presetRowFields(activePreset));
    }

    if (pendingMeasurement.tool === 'count') return { ...base, pdfX: pendingMeasurement.pdfX, pdfY: pendingMeasurement.pdfY };
    return {
      ...base,
      ...measurementRowFields(m),
      scale_source: m.scale_source || null,
      scale_label: m.scale_label || null,
      scale_viewport_id: m.scale_viewport_id || null,
    };
  };

  // Returns { added: true } once the row is in, or { duplicate: <row> } if
  // an existing row already covers this same spot/shape/size/phase —
  // nothing is written to `rows` in that case; the modal shows a
  // merge-or-keep-separate prompt and calls handleMergeDuplicate/
  // handleKeepSeparateMeasurement with the estimator's choice instead.
  const handleConfirmMeasurement = ({ shape, size, quantity, phaseArea, extras: measureExtras }) => {
    if (!pendingMeasurement) return { added: false };
    const qty = Math.max(1, Number(quantity) || 1);
    const anchor = measurementAnchorFromPending(pendingMeasurement);
    const duplicate = findDuplicateRow(rows, pendingMeasurement.tool, shape, size, phaseArea, anchor);
    if (duplicate) return { duplicate };

    const updated = [...rows, buildMeasurementRow(shape, size, qty, phaseArea, 'green', measureExtras)];
    setRows(updated);
    persist(updated);
    finishMeasurementModal();
    return { added: true };
  };

  const handleMergeDuplicate = (existingRowKey, additionalQty) => {
    const addQty = Math.max(1, Number(additionalQty) || 1);
    const updated = rows.map((r) => (r._key === existingRowKey ? { ...r, quantity: (r.quantity || 0) + addQty } : r));
    setRows(updated);
    persist(updated);
    finishMeasurementModal();
  };

  const handleKeepSeparateMeasurement = ({ shape, size, quantity, phaseArea, extras: measureExtras, existingRowKey }) => {
    if (!pendingMeasurement) return;
    const qty = Math.max(1, Number(quantity) || 1);
    const newRow = buildMeasurementRow(shape, size, qty, phaseArea, 'red', measureExtras);
    const updated = rows
      .map((r) => (r._key === existingRowKey ? { ...r, marker_color: 'red', color: '#ef4444' } : r))
      .concat(newRow);
    setRows(updated);
    persist(updated);
    finishMeasurementModal();
  };

  const handleSelectPreset = (preset) => {
    const type = preset.measurement_type || preset.tool;
    // Count presets go through Count setup (the master catalog shape/size
    // step) — a preset's shape is the old 5-class enum, not a catalog
    // shape_type_id, so there's no clean bridge straight into a tally.
    if (type === 'count' || type === 'bolt_count') {
      handleStartCountSetup(type === 'bolt_count' ? 'bolt' : 'beam', preset);
      return;
    }
    const tool = MEASURE_TOOLS[type] ? type : preset.tool;
    if (!MEASURE_TOOLS[tool]) return;
    if (!pageCalibrated) {
      toast(NOT_CALIBRATED_TOAST);
      return;
    }
    if (!confirmDiscardActiveCountSession()) return;
    setCalibrationMode(false);
    setCalibrationPoints([]);
    measureDraft.reset();
    setMeasurementModalOpen(false);
    setPendingMeasurement(null);
    resetCountEngine();
    setActiveTool(tool);
    setSelectedPresetId(preset.id);
  };

  const handleRemovePreset = (id) => {
    setToolChest((prev) => prev.filter((p) => p.id !== id));
    setSelectedPresetId((prev) => (prev === id ? null : prev));
  };

  // A whole company tool set (library "Load into this takeoff" or the Tool
  // Chest picker) replaces this takeoff's presets and becomes its company
  // columns. Already-measured rows keep what they were saved with.
  const handleApplyToolSet = (set, presets) => {
    if (toolChest.length > 0 && !window.confirm(`Replace the ${toolChest.length} tool${toolChest.length === 1 ? '' : 's'} in this takeoff's Tool Chest with "${set.name}"? Markups you've already measured are kept.`)) return;
    setToolChest(presets);
    setSelectedPresetId(null);
    extras.setToolSet(set);
    toast({ title: `Loaded "${set.name}"`, description: `${presets.length} tool${presets.length === 1 ? '' : 's'}, ${set.columns?.length || 0} column${set.columns?.length === 1 ? '' : 's'}.` });
  };

  // Visual Search → count marks. Matches only become marks here, after the
  // estimator accepted them and picked a count. An existing count gets them
  // added (marks already sitting on a spot are skipped); "a new count" goes
  // through Count setup and the tally panel's Save like any other count.
  const handleAddSearchMatches = (rowKey, accepted) => {
    const pts = accepted.map((c) => ({ pdfX: c.centerPdfX, pdfY: c.centerPdfY }));
    if (!pts.length) return;
    if (!rowKey) {
      pendingCountPointsRef.current = { page: pageInfo.pageNum, points: pts };
      symbolSearch.clear();
      handleStartCountSetup('beam');
      return;
    }
    const row = rows.find((r) => r._key === rowKey);
    if (!row) return;
    const existing = row.points?.length ? row.points : (row.pdfX != null ? [{ pdfX: row.pdfX, pdfY: row.pdfY }] : []);
    const near = (row.marker_size || 7) + 2;
    const fresh = pts.filter((p) => !existing.some((q) => Math.hypot(q.pdfX - p.pdfX, q.pdfY - p.pdfY) <= near));
    const points = [...existing, ...fresh];
    const updated = rows.map((r) => (r._key === rowKey ? { ...r, points, quantity: points.length } : r));
    setRows(updated);
    persist(updated);
    symbolSearch.clear();
    toast({
      title: `${fresh.length} mark${fresh.length === 1 ? '' : 's'} added to ${row.label || 'the count'}`,
      description: pts.length - fresh.length ? `${pts.length - fresh.length} were already marked and were skipped.` : `Now ${points.length} in total.`,
    });
  };

  const handleStartSymbolSearch = () => {
    if (!confirmDiscardActiveCountSession()) return;
    setActiveTool(null);
    measureDraft.reset();
    setCalibrationMode(false);
    setCalibrationPoints([]);
    setScalePick(null);
    resetCountEngine();
    symbolSearch.start();
  };

  // Load a newer issue of this drawing as its own session, linked back to
  // this one. The new session starts with this one's tools and columns but
  // no markups — those come over through "Bring markups forward", after
  // comparing the sheets, so nothing is copied without the estimator seeing
  // it.
  const handleNewRevisionFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !takeoffId) return;
    if (!confirmDiscardActiveCountSession()) return;
    const link = sessionBidId ? { bid_id: sessionBidId, project_id: undefined }
      : sessionProjectId ? { bid_id: undefined, project_id: sessionProjectId } : {};
    try {
      const created = await createTakeoffRecord({
        file,
        name: `${takeoffName || stripPdfExtension(fileName) || 'Takeoff'} — new revision`,
        areaId: sessionAreaId,
        extra: {
          ...link,
          previous_takeoff_id: takeoffId,
          tool_chest: toolChest,
          tool_set_id: extras.toolSet?.id || null,
          tool_set_snapshot: extras.toolSet || null,
          custom_columns: extras.customColumns,
        },
      });
      enterNewSessionWorkspace(created, file);
      setToolChest(created.tool_chest || []);
      extras.loadFrom(created);
      loadSessions();
      toast({ title: 'New revision started', description: 'Use "Compare with older revision" to find what changed, then "Bring markups forward".' });
    } catch (err) {
      console.error('Failed to start a new revision', err);
      toast({ title: 'Could not start the new revision', description: 'See console for details.', variant: 'destructive' });
    }
  };

  const handleSaveCompare = (result) => {
    const prev = extras.revisionCompare || {};
    extras.setRevisionCompare({
      previous_takeoff_id: result.previous_takeoff_id,
      pages: {
        ...(prev.previous_takeoff_id && prev.previous_takeoff_id !== result.previous_takeoff_id ? {} : (prev.pages || {})),
        [result.page]: {
          previous_takeoff_id: result.previous_takeoff_id,
          old_page_number: result.old_page_number,
          transform: result.transform,
          clouds: result.clouds,
          stats: result.stats,
          compared_at: result.compared_at,
        },
      },
    });
    toast({ title: `${result.clouds.length} change cloud${result.clouds.length === 1 ? '' : 's'} saved for page ${result.page}` });
  };

  const handleApplyCarryForward = (newRows, { flagged }) => {
    const updated = [...rows, ...newRows];
    setRows(updated);
    persist(updated);
    setCarryOpen(false);
    toast({
      title: `${newRows.length} markup${newRows.length === 1 ? '' : 's'} brought forward`,
      description: flagged ? `${flagged} landed in a changed area — they're marked "${REVIEW_FLAG_TEXT}".` : 'None landed in a changed area.',
    });
  };

  const clearReviewFlag = (key) => {
    const updated = rows.map((r) => (r._key === key ? { ...r, review_flag: null, review_note: null } : r));
    setRows(updated);
    persist(updated);
  };

  const handlePageNoteChange = (value) => {
    setPageNotes((prev) => ({ ...prev, [pageInfo.pageNum]: value }));
  };

  // Crops a small region around a Count row's marker, captures the current
  // full page render, and asks the local VLM to find visually similar spots
  // elsewhere on the page. Results land in `candidates` only — a transient
  // review state that never touches `rows`/persist until the estimator
  // explicitly accepts them below.
  const handleFindSimilar = async (row) => {
    setVisualSearchError(null);
    setCandidates([]);
    setCandidateSourceRow(row);

    if (!canvasRef.current || pageSize.width <= 0 || pageSize.height <= 0) {
      setVisualSearchError('Could not capture the drawing for visual search.');
      return;
    }

    setVisualSearchLoading(true);
    try {
      const pageImageDataUrl = canvasRef.current.getFullPageDataUrl();
      const cropDataUrl = canvasRef.current.getCropDataUrl(row.pdfX, row.pdfY, 120);
      if (!pageImageDataUrl || !cropDataUrl) {
        setVisualSearchError('Could not capture the drawing for visual search.');
        return;
      }

      const matches = await findSimilarSymbols(pageImageDataUrl, cropDataUrl, scaleReference);
      if (!matches) {
        setVisualSearchError('Visual search requires a local AI model — see Settings > AI Configuration');
        return;
      }

      // x_percent/y_percent are fractions of the full page image, which is
      // scale-invariant the same way it is for detectBlueprintShapes' bbox
      // fractions — no need to know the canvas's current zoom/dpr here.
      setCandidates(matches.map((m) => ({
        id: crypto.randomUUID(),
        pdfX: (m.x_percent / 100) * pageSize.width,
        pdfY: (m.y_percent / 100) * pageSize.height,
        confidence: m.confidence,
      })));
    } finally {
      setVisualSearchLoading(false);
    }
  };

  const handleToggleCandidate = (id) => {
    setCandidates((prev) => prev.filter((c) => c.id !== id));
  };

  const handleClearCandidates = () => {
    setCandidates([]);
    setCandidateSourceRow(null);
    setVisualSearchError(null);
  };

  const handleAcceptAllCandidates = () => {
    if (candidates.length === 0) return;
    const source = candidateSourceRow;
    const newRows = candidates.map((c) => ({
      _key: crypto.randomUUID(),
      source: 'measurement',
      tool: 'count',
      shape_type: source?.shape_type || 'Custom',
      size_designation: source?.size_designation || '',
      label: source?.label || 'Count',
      color: source?.color || '#ef4444',
      pdfX: c.pdfX,
      pdfY: c.pdfY,
      quantity: 1,
      length_ft: 0,
      unit_weight_lbs_per_ft: 0,
      is_accepted: true,
    }));
    const updated = [...rows, ...newRows];
    setRows(updated);
    persist(updated);
    handleClearCandidates();
  };

  // Escape always wins, regardless of which tool (or none) is active —
  // it's the one universal "get me out of whatever I'm doing" key.
  useEffect(() => {
    if (mode !== 'workspace') return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !e.repeat) {
        if (symbolSearch.phase === 'picking' || symbolSearch.phase === 'searching') symbolSearch.cancel();
        if (!confirmDiscardActiveCountSession()) return;
        setActiveTool(null);
        measureDraft.reset();
        setCalibrationMode(false);
        setCalibrationPoints([]);
        setScalePick(null);
        setIsFullscreen(false);
        resetCountEngine();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // countSession is read (via confirmDiscardActiveCountSession) inside
    // onKeyDown — it must be a dependency or this listener's closure goes
    // stale and would always see the session as it was when `mode` last
    // changed (effectively never prompting before discarding it).
  }, [mode, countSession, symbolSearch.phase]);

  // Live catalog lookup — the "Available Size" dropdown no longer reads the
  // hardcoded SHAPE_CLASSES.sizes array, it reads whatever sizes are
  // currently in steel_catalog for this class (built-ins + anything an
  // admin added via the Steel Inventory Catalog panel).
  const sizesForClass = (shapeClass) => {
    const fromCatalog = catalog.filter((c) => c.shape_class === shapeClass).map((c) => c.size_designation);
    return fromCatalog.length > 0 ? fromCatalog : getShapeClass(shapeClass).sizes;
  };

  // Single-action batch trigger — one click scans every sheet in the
  // uploaded document at once and drops the whole result into one unified,
  // simultaneously-reviewable grid. No page picker, no per-sheet buttons.
  const handleProcessFullDocument = async () => {
    if (!fileUrl) return;
    setScanning(true);
    setScanError(null);
    try {
      const result = await simulateAiBatchTakeoff(user?.company_id, fileUrl, fileName, scaleReference);
      if (!result) {
        setScanError('No local vision model reachable — connect a local VLM proxy (VITE_LOCAL_VLM_URL) to enable automatic detection, or add takeoff rows manually below.');
        setRows([]);
      } else {
        setSheetCount(result.sheetCount || 1);
        setRows(result.detections.map((d) => emptyRow({ ...d, is_accepted: true })));
      }
    } finally {
      setScanning(false);
    }
  };

  const persist = async (newRows) => {
    const payload = {
      company_id: user?.company_id,
      bid_id: bidId || undefined,
      file_url: fileUrl,
      file_name: fileName,
      sheet_count: sheetCount || 1,
      scale_reference: scaleReference,
      accepted_items: newRows.map(({ _key, ...rest }) => rest),
      takeoff_name: takeoffName.trim() || fileName || undefined,
      has_stored_pdf: hasStoredPdf,
    };
    if (takeoffId) {
      await db.entities.blueprint_takeoffs.update(takeoffId, payload);
      await loadSessions();
    } else {
      const created = await db.entities.blueprint_takeoffs.create(payload);
      setTakeoffId(created.id);
      setTakeoffName(created.takeoff_name || takeoffName || fileName || '');
      await loadSessions();
    }
  };

  const updateRow = (key, field, value) => {
    const newRows = rows.map((r) => {
      if (r._key !== key) return r;
      const updated = { ...r, [field]: value };
      if (field === 'shape_class') {
        updated.size_designation = sizesForClass(value)[0] || '';
      }
      return updated;
    });
    setRows(newRows);
    persist(newRows);
  };

  const handleExportRequisitionPdf = async () => {
    await exportRequisitionToPdf({
      title: 'Blueprint Takeoff Requisition',
      subtitle: `${fileName || 'Untitled document'} — unpriced, for supplier quoting`,
      columns: ['Shape Type', 'Selected Size', 'Length (ft)', 'Weight (lb/ft)', 'Qty', 'Coating', 'Calculated Metrics'],
      rows: acceptedRows.map((r) => [
        r.shape_type || '—',
        r.size_designation,
        r.length_ft,
        r.unit_weight_lbs_per_ft,
        r.quantity,
        r.coating_type,
        r.coating_type === 'Paint' ? `${rowPaintAreaSqIn(r, catalog).toLocaleString(undefined, { maximumFractionDigits: 0 })} Sq In`
          : r.coating_type === 'Galvanized' ? `${rowGalvanizedTons(r).toFixed(3)} Tons`
          : '—',
      ]),
    });
  };

  const handleExportRequisitionXlsx = async () => {
    await exportRequisitionToXlsx({
      title: 'Blueprint Takeoff Requisition',
      subtitle: `${fileName || 'Untitled document'} — unpriced, for supplier quoting`,
      columns: ['Shape Type', 'Selected Size', 'Length (ft)', 'Weight (lb/ft)', 'Qty', 'Coating', 'Calculated Metrics'],
      rows: acceptedRows.map((r) => [
        r.shape_type || '—',
        r.size_designation,
        r.length_ft,
        r.unit_weight_lbs_per_ft,
        r.quantity,
        r.coating_type,
        r.coating_type === 'Paint' ? rowPaintAreaSqIn(r, catalog)
          : r.coating_type === 'Galvanized' ? rowGalvanizedTons(r)
          : '—',
      ]),
    });
  };

  // Fills the company's uploaded Bid Proposal template (company_templates,
  // category "Spreadsheet") rather than a template baked into this repo —
  // that's the existing mechanism every other file-backed feature in this
  // app already uses (see TemplateVaultPanel), and it's what lets this work
  // the same way in local dev and in a hosted deployment. This is a
  // category-rollup estimate with no piece-level tab, so nothing new is
  // created — buildBidRecapWrites only targets verified input cells across
  // Structural/RECAP/Addtn'l (AKP), and writeBidRecapCells refuses to
  // overwrite any cell that turns out to hold a formula. Everything else in
  // the workbook (other tabs, form controls, images, external-link
  // formulas, and every manual-entry cell this app has no source for —
  // Bolts/Fasteners, Anchor Bolts, Labor hours, Outsourced $, J&D, Allowance)
  // is left untouched. The filled workbook downloads as a new file — the
  // uploaded template itself is never modified.
  const handleExportExcelTemplate = async () => {
    setExportingExcel(true);
    setExcelExportError(null);
    try {
      const templates = await db.entities.company_templates.filter({ is_active: true }, '-created_date', 100);
      const bidTemplate = templates.find(
        (t) => t.category === 'Spreadsheet' && /bid[\s_-]*proposal/i.test(`${t.template_name || ''} ${t.file_name || ''}`)
      );
      if (!bidTemplate) {
        setExcelExportError('No active Bid Proposal template found — upload "Bid_Proposal_Template.xlsx" as a Spreadsheet template in Settings > Template Vault.');
        return;
      }

      const res = await fetch(bidTemplate.file_url);
      if (!res.ok) throw new Error(`Template fetch failed: ${res.status}`);
      const templateBuffer = await res.arrayBuffer();

      const sheetWrites = buildBidRecapWrites({ bid, estimatorFullName, acceptedRows, catalog, rowPaintAreaSqIn });
      const { bytes, skipped } = await writeBidRecapCells(templateBuffer, sheetWrites);
      if (skipped.length) {
        console.warn('Bid recap export: cells skipped because they already held a formula', skipped);
        setExcelExportError(`${skipped.length} cell(s) were left untouched because the template already had a formula there — see console for details.`);
      }

      const baseName = bid?.bid_number || fileName?.replace(/\.[^.]+$/, '') || 'Blueprint_Takeoff';
      downloadWorkbook(bytes, `${baseName}_Bid_Proposal.xlsx`);
    } catch (e) {
      console.error(e);
      setExcelExportError('Excel export failed — see console for details.');
    } finally {
      setExportingExcel(false);
    }
  };

  const removeRow = (key) => {
    const newRows = rows.filter((r) => r._key !== key);
    setRows(newRows);
    persist(newRows);
  };

  // Jumps to the row's page (if it's on a different one than currently
  // shown) and flashes a highlight ring/box around its marker for ~1.6s —
  // see BlueprintCanvas's isHighlighted/drawHighlightRing/drawHighlightBox.
  const handleMeasurementRowClick = (row) => {
    if (row.page_number && row.page_number !== pageInfo.pageNum) {
      canvasRef.current?.goToPage(row.page_number);
    }
    setHighlightedRowKey(row._key);
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => setHighlightedRowKey(null), 1600);
  };

  // Deleting one half of a same-spot duplicate pair clears the other's red
  // flag too — leaving it red after its only conflict is gone would
  // permanently mislabel an otherwise ordinary row as a duplicate.
  const handleDeleteMeasurementRow = (row) => {
    const remaining = rows.filter((r) => r._key !== row._key);
    const stillHasDuplicate = (candidate) => remaining.some((r) => {
      if (r._key === candidate._key || r.tool !== candidate.tool || r.shape_type !== candidate.shape_type) return false;
      if (r.size_designation !== candidate.size_designation || (r.phase || '') !== (candidate.phase || '')) return false;
      const a = measurementAnchorFromRow(candidate);
      const b = measurementAnchorFromRow(r);
      return a && b && Math.hypot(a.pdfX - b.pdfX, a.pdfY - b.pdfY) <= DUPLICATE_SPOT_THRESHOLD_PDF;
    });
    const updated = remaining.map((r) => (
      r.marker_color === 'red' && !stillHasDuplicate(r) ? { ...r, marker_color: 'green', color: '#22c55e' } : r
    ));
    setRows(updated);
    persist(updated);
    if (highlightedRowKey === row._key) setHighlightedRowKey(null);
  };

  const handleMeasurementSortClick = (field) => {
    setMeasurementSort((prev) => (prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' }));
  };

  const toggleMeasurementAreaFilter = (area) => {
    setExcludedMeasurementAreas((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area); else next.add(area);
      return next;
    });
  };

  // Every add/edit/delete on a measurement row already calls persist()
  // itself (see handleConfirmMeasurement/updateRow/handleDeleteMeasurementRow
  // etc.), so this button is really a "confirm it's saved" affordance rather
  // than the only path to the bid record — but it must actually write
  // through to blueprint_takeoffs, not just localStorage, or "survives a
  // reload" is a lie.
  const handleSaveMeasurementsLocally = async (measurementRows) => {
    try {
      await persist(rows);
      toast({ title: 'Takeoff saved', description: `${measurementRows.length} row${measurementRows.length === 1 ? '' : 's'} saved to this bid.` });
    } catch (e) {
      toast({ title: 'Could not save takeoff', variant: 'destructive' });
    }
  };

  const handleExportMeasurementsCsv = (visibleRows) => {
    exportRowsToCsv({
      filename: `${takeoffName || 'takeoff'}_measurements`,
      // Company + job custom columns ride along at the end (formula
      // columns as their calculated value).
      columns: ['Page', 'Tool', 'Shape Type', 'Size', 'Quantity', 'Measured', 'Phase/Area', 'Notes', 'Status', 'Review', ...extras.columns.map((c) => (c.unit ? `${c.name} (${c.unit})` : c.name))],
      rows: visibleRows.map((r) => {
        const { values, errors } = extras.computeRow(r);
        return [
          r.page_number || 1, toolLabel(r.tool), r.shape_type || '', r.size_designation || '', r.quantity || 0,
          r.tool === 'count' || r.tool === 'bolt_count' ? `${r.quantity || 0} pcs` : measurementSummary(r, formatFeetInchesFraction),
          r.phase || r.area || '', r.notes || '', r.marker_color || '', r.review_flag ? REVIEW_FLAG_TEXT : '',
          ...extras.columns.map((c) => (errors[c.alias] ? `#ERROR: ${errors[c.alias]}` : (values[c.alias] ?? ''))),
        ];
      }),
    });
  };

  const addManualRow = () => {
    setRows((prev) => [...prev, emptyRow()]);
  };

  const loadDemoRows = () => {
    const demoRows = DEMO_ROWS.map((d) => emptyRow({ ...d, is_demo: true }));
    setSheetCount((prev) => prev || 4);
    setRows(demoRows);
    setScanError(null);
    persist(demoRows);
  };

  const scaleAtPoint = useMemo(() => (pt) => scales.resolveAt(pageInfo.pageNum, pt), [scales.resolveAt, pageInfo.pageNum]);

  // Legend for one page from that page's confirmed markups (same data the
  // exported PDF's legend uses).
  const legendForPage = useCallback((page, setting = {}) => buildLegendData(
    rows.filter((r) => r.source === 'measurement'),
    { groupBy: setting.group_by || 'tool', toolSet: extras.toolSet || undefined, weightLookup: extras.weightLookup, pages: [page], title: 'Legend' },
  ), [rows, extras.toolSet, extras.weightLookup]);
  const currentLegendSetting = extras.legendSettings[pageInfo.pageNum] || NO_LEGEND_SETTING;
  const canvasLegends = useMemo(() => (currentLegendSetting.on ? [{
    key: pageInfo.pageNum,
    legend: legendForPage(pageInfo.pageNum, currentLegendSetting),
    anchor: currentLegendSetting.anchor || 'bottom-right',
    pdfX: currentLegendSetting.pdfX,
    pdfY: currentLegendSetting.pdfY,
  }] : NO_ITEMS), [currentLegendSetting, legendForPage, pageInfo.pageNum]);
  const pageMarkupCount = rows.filter((r) => r.source === 'measurement' && r.is_accepted !== false && (r.page_number || 1) === pageInfo.pageNum).length;
  const revisionCloudsOnPage = extras.revisionCompare?.pages?.[pageInfo.pageNum]?.clouds || NO_ITEMS;
  const countRowsOnPage = rows.filter((r) => r.source === 'measurement' && (r.tool === 'count' || r.tool === 'bolt_count') && (r.page_number || 1) === pageInfo.pageNum);
  // Older sessions this one could be a revision of — same bid/project first.
  const revisionCandidates = sessions
    .filter((s) => s.id !== takeoffId)
    .sort((a, b) => {
      const same = (s) => (sessionBidId && s.bid_id === sessionBidId) || (sessionProjectId && s.project_id === sessionProjectId) ? 0 : 1;
      return same(a) - same(b);
    });
  const previousSession = extras.previousTakeoffId ? sessions.find((s) => s.id === extras.previousTakeoffId) : null;
  const flaggedRowCount = rows.filter((r) => r.review_flag).length;
  // Starting values the confirmation panel takes from the active Tool
  // Chest tool (only when it's the same kind of measurement).
  const measurementDefaults = activePreset && pendingMeasurement && (activePreset.measurement_type || activePreset.tool) === pendingMeasurement.tool
    ? { shape: activePreset.shapeClass, size: activePreset.sizeDesignation, slope: presetSlope(activePreset), depth_ft: activePreset.depth_ft, description: activePreset.label }
    : null;

  const acceptedRows = rows.filter((r) => r.is_accepted);
  const totalWeight = acceptedRows.reduce((sum, r) => sum + (r.quantity || 0) * (r.unit_weight_lbs_per_ft || 0) * (r.length_ft || 0), 0);
  const totalPaintAreaSqIn = acceptedRows.reduce((sum, r) => sum + rowPaintAreaSqIn(r, catalog), 0);
  const totalGalvanizedTons = acceptedRows.reduce((sum, r) => sum + rowGalvanizedTons(r), 0);

  // A not-yet-confirmed measurement gets its own BLUE marker on the canvas
  // for as long as the confirmation modal is open, without ever touching
  // `rows` — it's appended to whatever's passed as measurementItems rather
  // than replacing it, so it draws alongside every already-saved marker.
  const pendingMeasurementMarker = measurementModalOpen && pendingMeasurement ? {
    source: 'measurement',
    tool: pendingMeasurement.tool,
    marker_color: 'blue',
    quantity: 1,
    shape_type: '',
    size_designation: '',
    phase: '',
    area: '',
    ...(pendingMeasurement.tool === 'count' ? { pdfX: pendingMeasurement.pdfX, pdfY: pendingMeasurement.pdfY }
      : measurementRowFields(pendingMeasurement)),
  } : null;
  // While a count/bolt_count session is resuming an existing row
  // (editingRowKey), that row's own saved dots are excluded here — the live
  // countSession (passed to BlueprintCanvas as activeCountSession, below)
  // already carries a copy of them, and drawing both would double every dot.
  const rowsForCanvas = countSession?.editingRowKey
    ? rows.filter((r) => r._key !== countSession.editingRowKey)
    : rows;
  const measurementItemsForCanvas = pendingMeasurementMarker ? [...rowsForCanvas, pendingMeasurementMarker] : rowsForCanvas;

  // Colors already spoken for by another count/bolt_count group on the
  // CURRENT page — the color step only ever runs for a brand-new session
  // (an "Add Pieces" resume skips straight to the click-to-mark session with
  // its row's existing color/symbol already set), so "current page" here is
  // always the right scope.
  const countUsedColorsOnPage = new Set(
    rows
      .filter((r) => r.source === 'measurement' && (r.tool === 'count' || r.tool === 'bolt_count') && (r.page_number || 1) === pageInfo.pageNum && r.color)
      .map((r) => r.color)
  );
  // Same per-page scoping as colors, for the symbol fallback grid once the
  // 20-color palette is exhausted — without this, a second/third symbol
  // group would have no signal that it's about to collide with an already-
  // used symbol on this page.
  const countUsedSymbolsOnPage = new Set(
    rows
      .filter((r) => r.source === 'measurement' && (r.tool === 'count' || r.tool === 'bolt_count') && (r.page_number || 1) === pageInfo.pageNum && r.symbol)
      .map((r) => r.symbol)
  );

  const countSessionLabel = countSession ? (
    countSession.kind === 'bolt'
      ? [countSession.fields.shape_type, countSession.fields.size_designation, countSession.fields.grade].filter(Boolean).join(' · ')
      : [countSession.fields.shape_type, countSession.fields.size_designation, countSession.fields.length_ft ? `${countSession.fields.length_ft.toFixed(2)} ft` : null].filter(Boolean).join(' · ')
  ) : '';

  // Confirmed Measurements table — every row the confirmation modal has
  // ever added (green or red; never the ephemeral blue pending marker,
  // which never touches `rows`), sorted/filtered per the table's own
  // controls.
  const measurementRows = rows.filter((r) => r.source === 'measurement');
  // Whether this bid/project has any named phases/areas at all — mirrors the
  // MeasurementConfirmationModal's own phaseRequired check, so the filter
  // row and column only ever show real phase data, never a meaningless
  // all-"—" list on an unphased project.
  const isPhased = Object.keys(areas || {}).length > 0;
  const measurementAreaOptions = Array.from(new Set(measurementRows.map((r) => r.area || '(none)')));
  const visibleMeasurementRows = measurementRows
    .filter((r) => !excludedMeasurementAreas.has(r.area || '(none)'))
    .slice()
    .sort((a, b) => {
      const { field, dir } = measurementSort;
      const av = field === 'page_number' || field === 'quantity' ? (a[field] || 0) : (a[field] || '');
      const bv = field === 'page_number' || field === 'quantity' ? (b[field] || 0) : (b[field] || '');
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });

  // Distinguishes "still loading" from "genuinely nothing to link to" so the
  // link dropdowns don't look broken when a fresh company just has no bids
  // or projects yet.
  const noLinkTargets = !!user && !loadingLinkTargets && activeBids.length === 0 && activeProjects.length === 0;
  // "Load demo data first" is only the right message when the user's
  // company really does have zero bids/projects. When the account itself
  // has no company_id, that's the actual cause — real bids/projects likely
  // exist but can't be tenant-matched to this account — so say that
  // instead of pointing someone at demo data that won't fix anything.
  const noLinkTargetsMessage = !user?.company_id
    ? 'Your account has no company assigned — contact an admin before linking a bid or project'
    : 'No bids or projects found — load demo data first';

  // Shared between the normal inline toolbar and the floating panel shown in
  // fullscreen — same state/handlers either way, just a different container
  // around it, so there's exactly one place to edit the calibration status
  // row, the calibration distance form, and the tool buttons.
  const calibrationStatusRow = (
    <ScalePanel
      pageNum={pageInfo.pageNum}
      numPages={pageInfo.numPages}
      scales={scales}
      disabled={!fileUrl}
      canvasScale={canvasScale}
      calibrationMode={calibrationMode}
      calibrationPoints={calibrationPoints}
      pick={calibrationMode ? scalePick : null}
      onStartPick={startScalePick}
      onCancelPick={handleCalibrationCancel}
      onScaleReference={handleScaleReference}
    />
  );

  // Select/Count/Length/Area/Calibrate + fullscreen toggle. Escape (bound in
  // an effect above) always drops back to Select and exits fullscreen, same
  // as clicking through them manually.
  const toolButtonsRow = (
    <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-lg border bg-muted/20 w-fit max-w-full">
      <Button size="sm" variant={activeTool === null && !calibrationMode ? 'default' : 'ghost'} onClick={handleSelectTool}>
        <MousePointer2 className="w-3.5 h-3.5 mr-1.5" />Select
      </Button>
      <Button size="sm" variant={activeTool === 'count' ? 'default' : 'ghost'} onClick={() => handleStartCountSetup('beam')} disabled={!fileUrl}>
        <MousePointerClick className="w-3.5 h-3.5 mr-1.5" />Count
      </Button>
      <Button size="sm" variant={activeTool === 'bolt_count' ? 'default' : 'ghost'} onClick={() => handleStartCountSetup('bolt')} disabled={!fileUrl}>
        <Hexagon className="w-3.5 h-3.5 mr-1.5" />Bolt Count
      </Button>
      <Button
        size="sm"
        variant={symbolSearch.phase === 'picking' ? 'default' : 'ghost'}
        onClick={handleStartSymbolSearch}
        disabled={!fileUrl || symbolSearch.phase === 'searching'}
        title="Box one symbol and find the others like it on this page (no AI — works offline)"
      >
        <ScanSearch className="w-3.5 h-3.5 mr-1.5" />Find symbols
      </Button>
      <MeasureToolButtons
        activeTool={activeTool}
        onActivate={handleActivateTool}
        disabled={!fileUrl}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled((v) => !v)}
        circleMode={measureDraft.circleMode}
        onCircleMode={measureDraft.setCircleMode}
      />
      <div className="w-px h-5 bg-border mx-1" />
      <Button size="sm" variant={calibrationMode ? 'default' : 'ghost'} onClick={handleStartCalibration} disabled={!fileUrl}>
        <Crosshair className="w-3.5 h-3.5 mr-1.5" />Calibrate
      </Button>
      <div className="w-px h-5 bg-border mx-1" />
      <Button size="sm" variant={notesPanelOpen ? 'default' : 'ghost'} onClick={() => setNotesPanelOpen((o) => !o)} title={notesPanelOpen ? 'Hide page notes' : 'Show page notes'}>
        <StickyNote className="w-3.5 h-3.5" />
      </Button>
      <div className="w-px h-5 bg-border mx-1" />
      <Button size="sm" variant="ghost" onClick={() => setSteelCatalogEditorOpen(true)} title="Edit steel size catalog">
        <ListChecks className="w-3.5 h-3.5 mr-1.5" />Steel Catalog
      </Button>
      <div className="w-px h-5 bg-border mx-1" />
      <Button size="sm" variant={isFullscreen ? 'default' : 'ghost'} onClick={() => setIsFullscreen((f) => !f)} disabled={!fileUrl} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
        <Maximize2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );

  return (
    <div className="p-6 w-full max-w-none space-y-4 animate-fade-in">
      {mode === 'sessions' ? (
        <div className="bg-slate-900 rounded-lg px-6 py-5 flex items-center gap-4">
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true" className="flex-shrink-0">
            <circle cx="22" cy="22" r="16" stroke="#f59e0b" strokeWidth="2" />
            <circle cx="22" cy="22" r="3" fill="#f59e0b" />
            <line x1="22" y1="1" x2="22" y2="10" stroke="#f59e0b" strokeWidth="2" />
            <line x1="22" y1="34" x2="22" y2="43" stroke="#f59e0b" strokeWidth="2" />
            <line x1="1" y1="22" x2="10" y2="22" stroke="#f59e0b" strokeWidth="2" />
            <line x1="34" y1="22" x2="43" y2="22" stroke="#f59e0b" strokeWidth="2" />
          </svg>
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight leading-none">IRONSIGHT</h1>
            <p className="text-sm text-slate-400 mt-1">
              {bidId
                ? (bid ? `Takeoff for Bid ${[bid.bid_number, bid.job_name].filter(Boolean).join(': ')}` : 'Loading bid…')
                : 'Structural Steel Takeoff Platform'}
            </p>
          </div>
        </div>
      ) : (
        <PageHeader
          title="IRONSIGHT"
          subtitle="Drawing takeoff and measurement"
          icon={Crosshair}
          actions={
            <Button variant="outline" size="sm" onClick={handleBackToSessions}>
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />Back to sessions
            </Button>
          }
        />
      )}

      {mode === 'sessions' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
              <FolderOpen className="w-4 h-4" />{bidId ? "This Bid's Takeoff Sessions" : 'Resume a takeoff'}
            </h3>
            {sessionsLoading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading sessions…</p>
            ) : bidSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No takeoff sessions yet — start one on the right.</p>
            ) : (
              <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                {bidSessions.map((s) => {
                  const itemCount = (s.accepted_items || []).length;
                  return (
                    <Card key={s.id} className="cursor-pointer hover:border-primary transition-colors" onClick={() => openSession(s)}>
                      <CardContent className="p-4 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold truncate" title={s.takeoff_name || s.file_name || 'Untitled takeoff'}>{s.takeoff_name || s.file_name || 'Untitled takeoff'}</p>
                          {s._linkedLabel ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); navigate(s._linkedType === 'project' ? `/projects/${s._linkedId}` : `/estimating/${s._linkedId}`); }}
                              className="text-xs text-primary truncate hover:underline flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3 flex-shrink-0" />{s._linkedLabel}
                            </button>
                          ) : (
                            <div className="flex items-center gap-1.5 mt-0.5" onClick={(e) => e.stopPropagation()}>
                              <span className="text-xs text-muted-foreground">Not linked</span>
                              <Select value={sessionLinkDraft[s.id] || ''} onValueChange={(v) => handleLinkSessionNow(s.id, v)}>
                                <SelectTrigger className="h-6 text-[11px] w-32"><SelectValue placeholder="Link now…" /></SelectTrigger>
                                <SelectContent>
                                  {noLinkTargets && <SelectItem value="__none__" disabled>{noLinkTargetsMessage}</SelectItem>}
                                  {activeBids.map((b) => <SelectItem key={`bid:${b.id}`} value={`bid:${b.id}`}>{b.job_name}</SelectItem>)}
                                  {activeProjects.map((p) => <SelectItem key={`project:${p.id}`} value={`project:${p.id}`}>{p.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {itemCount} item{itemCount === 1 ? '' : 's'} · {s.sheet_count || 1} sheet{(s.sheet_count || 1) === 1 ? '' : 's'}
                          </p>
                          {!s.has_stored_pdf && (
                            <Badge variant="outline" className="mt-1.5 text-amber-600 border-amber-300">PDF not stored — measurements only</Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap">
                          {s.last_opened_at ? formatDistanceToNow(new Date(s.last_opened_at), { addSuffix: true }) : 'never opened'}
                        </span>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
              <Plus className="w-4 h-4" />Start a new takeoff
            </h3>
            {bidId ? (
              <>
                {bidAreas.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Which area is this set for? (optional)</label>
                    <Select value={pendingDropAreaId || 'unassigned'} onValueChange={(v) => setPendingDropAreaId(v === 'unassigned' ? null : v)}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {bidAreas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div
                  onClick={() => bidFileInputRef.current?.click()}
                  onDrop={handleBidDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={`rounded-lg border-2 border-dashed p-12 flex flex-col items-center justify-center gap-2 text-center cursor-pointer transition-colors ${isDragOver ? 'border-primary bg-primary/10' : 'border-border bg-muted/20 hover:bg-muted/30'}`}
                >
                  <input ref={bidFileInputRef} type="file" accept=".pdf,image/*" multiple className="hidden" onChange={handleBidBrowseSelect} />
                  {creatingSession ? <Loader2 className="w-12 h-12 text-primary animate-spin" /> : <UploadCloud className="w-12 h-12 text-primary" />}
                  <p className="font-semibold text-base">Drag & drop blueprints here to start</p>
                  <p className="text-xs text-muted-foreground">or click to browse — drop several files to create one session per sheet set, all linked to this bid. Name defaults from the file, editable later.</p>
                </div>
                {newSessionError && <p className="text-sm text-amber-600">{newSessionError}</p>}
              </>
            ) : (
              <>
                <Input
                  placeholder='Takeoff name — e.g. "Scott Park Phase II — Sheets S1-S8"'
                  value={newTakeoffName}
                  onChange={(e) => setNewTakeoffName(e.target.value)}
                />
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Link to Bid or Project (optional)</label>
                  <Select value={newTakeoffLinkValue} onValueChange={setNewTakeoffLinkValue}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Not linked" /></SelectTrigger>
                    <SelectContent>
                      {noLinkTargets && <SelectItem value="__none__" disabled>{noLinkTargetsMessage}</SelectItem>}
                      {activeBids.map((b) => <SelectItem key={`bid:${b.id}`} value={`bid:${b.id}`}>{b.job_name} ({b.bid_number})</SelectItem>)}
                      {activeProjects.map((p) => <SelectItem key={`project:${p.id}`} value={`project:${p.id}`}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div
                  onClick={handleNewDropzoneClick}
                  onDrop={handleNewDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={`rounded-lg border-2 border-dashed p-8 flex flex-col items-center justify-center gap-2 text-center cursor-pointer transition-colors ${isDragOver ? 'border-primary bg-primary/10' : 'border-border bg-muted/20 hover:bg-muted/30'}`}
                >
                  <input ref={fileInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleNewBrowseSelect} />
                  {creatingSession ? <Loader2 className="w-10 h-10 text-primary animate-spin" /> : <UploadCloud className="w-10 h-10 text-primary" />}
                  <p className="font-semibold">Drag & drop the blueprint package here</p>
                  <p className="text-xs text-muted-foreground">or click to browse — multi-page PDFs and drawing sets accepted</p>
                </div>
                {newSessionError && <p className="text-sm text-amber-600">{newSessionError}</p>}
              </>
            )}
          </div>
        </div>
      )}

      {mode === 'workspace' && (
        <ErrorBoundary
          label="ironsight-workspace"
          title="IRONSIGHT hit an unexpected error"
          onReset={handleWorkspaceErrorReset}
          resetLabel="Back to sessions"
        >
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {editingTakeoffName ? (
              <Input
                autoFocus
                value={takeoffNameDraft}
                onChange={(e) => setTakeoffNameDraft(e.target.value)}
                onBlur={commitTakeoffNameEdit}
                onKeyDown={(e) => { if (e.key === 'Enter') commitTakeoffNameEdit(); if (e.key === 'Escape') setEditingTakeoffName(false); }}
                className="h-7 text-sm font-semibold w-64"
              />
            ) : (
              <button
                type="button"
                onClick={() => { setTakeoffNameDraft(takeoffName); setEditingTakeoffName(true); }}
                className="font-semibold truncate hover:underline decoration-dotted underline-offset-2"
                title="Click to rename"
              >
                {takeoffName || fileName || 'Untitled takeoff'}
              </button>
            )}
            {sessionAreaId && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">Area: {bidAreas.find((a) => a.id === sessionAreaId)?.name || 'Assigned'}</span>
              </>
            )}
            <span className="text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1"><Link2 className="w-3 h-3" />Linked to:</span>
            {sessionBidId ? (
              <button type="button" onClick={() => navigate(`/estimating/${sessionBidId}`)} className="text-xs text-primary hover:underline flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />{activeBids.find((b) => b.id === sessionBidId)?.job_name || 'Bid'}
              </button>
            ) : sessionProjectId ? (
              <button type="button" onClick={() => navigate(`/projects/${sessionProjectId}`)} className="text-xs text-primary hover:underline flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />{activeProjects.find((p) => p.id === sessionProjectId)?.name || 'Project'}
              </button>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">Not linked</span>
                <Select value={workspaceLinkDraft} onValueChange={handleLinkWorkspaceNow}>
                  <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="Link now…" /></SelectTrigger>
                  <SelectContent>
                    {noLinkTargets && <SelectItem value="__none__" disabled>{noLinkTargetsMessage}</SelectItem>}
                    {activeBids.map((b) => <SelectItem key={`bid:${b.id}`} value={`bid:${b.id}`}>{b.job_name}</SelectItem>)}
                    {activeProjects.map((p) => <SelectItem key={`project:${p.id}`} value={`project:${p.id}`}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setExportPdfOpen(true)} disabled={!hasStoredPdf}>
              <FileImage className="w-3.5 h-3.5 mr-1.5" />Export marked-up PDF
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCompareOpen(true)} disabled={!fileUrl}>
              <GitCompare className="w-3.5 h-3.5 mr-1.5" />Compare with older revision
            </Button>
            <Button size="sm" variant="outline" onClick={() => revisionInputRef.current?.click()} title="Start a new session for a newer issue of this drawing, linked to this one">
              <FilePlus2 className="w-3.5 h-3.5 mr-1.5" />Load new revision…
            </Button>
            <input ref={revisionInputRef} type="file" accept=".pdf" className="hidden" onChange={handleNewRevisionFile} />
            {extras.previousTakeoffId && (
              <Button size="sm" variant="outline" onClick={() => setCarryOpen(true)}>
                <CopyPlus className="w-3.5 h-3.5 mr-1.5" />Bring markups forward
              </Button>
            )}
            {extras.previousTakeoffId && (
              <span className="text-xs text-muted-foreground">
                Revision of{' '}
                {previousSession ? (
                  <button type="button" className="text-primary hover:underline" onClick={() => openSession(previousSession)}>{previousSession.takeoff_name || previousSession.file_name || 'older takeoff'}</button>
                ) : 'an older takeoff'}
              </span>
            )}
            {flaggedRowCount > 0 && (
              <button type="button" onClick={() => setGridView('measurements')} className="text-xs text-amber-700 flex items-center gap-1 hover:underline">
                <AlertTriangle className="w-3.5 h-3.5" />{flaggedRowCount} markup{flaggedRowCount === 1 ? '' : 's'} to check — area changed
              </button>
            )}
          </div>

          {!hasStoredPdf && !newSessionError && !pdfMissingNotice && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />Storing drawing for offline resume…
            </div>
          )}

          {pdfMissingNotice && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                This session's PDF isn't stored on this device — measurements were restored, but the drawing needs to be re-attached.
              </p>
              <Button size="sm" variant="outline" onClick={() => reattachInputRef.current?.click()}>
                <RotateCw className="w-3.5 h-3.5 mr-1.5" />Re-attach PDF
              </Button>
              <input ref={reattachInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleReattachPdf} />
            </div>
          )}
          {reattachError && <p className="text-sm text-amber-600">{reattachError}</p>}

          <div className={isFullscreen ? 'fixed inset-0 z-50 bg-black flex' : 'flex flex-col lg:flex-row gap-4 items-start'}>
            <div className={isFullscreen ? 'flex-1 min-h-0 relative' : 'flex-1 min-w-0 space-y-3'}>
              {!isFullscreen && (
                <>
                  {calibrationStatusRow}
                  {toolButtonsRow}
                </>
              )}

              <VisualSearchPanel search={symbolSearch} countRowsOnPage={countRowsOnPage} onAddToCount={handleAddSearchMatches} />

              {(visualSearchLoading || visualSearchError || candidates.length > 0) && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 flex flex-wrap items-center justify-between gap-3">
                  {visualSearchLoading && (
                    <p className="text-sm text-amber-800 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />Scanning page for matches…
                    </p>
                  )}
                  {!visualSearchLoading && visualSearchError && (
                    <p className="text-sm text-amber-800">{visualSearchError}</p>
                  )}
                  {!visualSearchLoading && !visualSearchError && candidates.length > 0 && (
                    <>
                      <p className="text-sm text-amber-800 font-medium">
                        {candidates.length} candidate match{candidates.length === 1 ? '' : 'es'} found — click a marker to exclude it
                      </p>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={handleAcceptAllCandidates}>
                          <Check className="w-3.5 h-3.5 mr-1.5" />Accept All
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleClearCandidates}>
                          <X className="w-3.5 h-3.5 mr-1.5" />Clear
                        </Button>
                      </div>
                    </>
                  )}
                  {!visualSearchLoading && visualSearchError && (
                    <Button size="sm" variant="outline" onClick={handleClearCandidates}>Dismiss</Button>
                  )}
                </div>
              )}

              {/* Visual PDF viewer, plus scale calibration and the Count/
                  Length/Area measurement tools. Only rendered for actual PDF
                  uploads; image uploads have nothing for pdfjs to open. In
                  fullscreen this wrapper is absolutely positioned to fill its
                  fixed-inset-0 ancestor, and BlueprintCanvas itself switches
                  to fillHeight so its viewport grows to match instead of
                  staying capped at its normal ~640px height. */}
              {fileUrl && /\.pdf$/i.test(fileName || '') && (
                <div className={isFullscreen ? 'absolute inset-0' : ''}>
                  <BlueprintCanvas
                    ref={canvasRef}
                    source={fileUrl}
                    calibrationMode={calibrationMode}
                    calibrationPoints={calibrationPoints}
                    onCalibrationClick={handleCalibrationClick}
                    onScaleChange={setCanvasScale}
                    onPageSizeChange={setPageSize}
                    onPageChange={setPageInfo}
                    activeTool={activeTool}
                    draft={measureDraft.draft}
                    circleMode={measureDraft.circleMode}
                    onMeasurementClick={handleMeasurementClick}
                    onFinishShape={measureDraft.finish}
                    measurementItems={measurementItemsForCanvas}
                    highlightedItemKey={highlightedRowKey}
                    canMeasure={pageCalibrated}
                    getScaleAt={scaleAtPoint}
                    viewports={scales.pageEntry(pageInfo.pageNum)?.viewports || []}
                    snapEnabled={snapEnabled}
                    calibrationShape={calibrationMode && scalePick?.purpose === 'viewport' ? 'rect' : 'line'}
                    calibrationSteps={stepsForScalePick(calibrationMode ? scalePick : null)}
                    candidateMarkers={candidates}
                    onCandidateToggle={handleToggleCandidate}
                    fillHeight={isFullscreen}
                    steelCatalog={steelCatalog}
                    areas={areas}
                    activeCountSession={countSession}
                    onCountMark={handleCountMark}
                    onCountDotRemove={handleCountDotRemove}
                    legends={canvasLegends}
                    onLegendMove={(page, pos) => extras.setLegendSetting(page, { anchor: 'custom', pdfX: pos.pdfX, pdfY: pos.pdfY })}
                    boxSelectMode={symbolSearch.phase === 'picking'}
                    onBoxSelect={symbolSearch.onBoxSelect}
                    searchCandidates={symbolSearch.phase === 'review' ? symbolSearch.visible : NO_ITEMS}
                    onSearchCandidateClick={symbolSearch.toggle}
                    revisionClouds={revisionCloudsOnPage}
                  />
                </div>
              )}

              {isFullscreen && (
                <>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => setIsFullscreen(false)}
                    title="Exit fullscreen (Esc)"
                    className="fixed top-4 right-4 z-[60] bg-slate-900 text-white border-slate-700 hover:bg-slate-800 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </Button>

                  <div
                    style={{ position: 'fixed', left: floatingPanelPos.x, top: floatingPanelPos.y }}
                    className="z-[60] w-80 max-h-[85vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
                  >
                    <div
                      onMouseDown={handlePanelDragStart}
                      className="flex items-center gap-2 px-3 py-2 border-b border-slate-700 text-xs font-semibold uppercase tracking-wide text-slate-300 cursor-move select-none"
                    >
                      <GripVertical className="w-4 h-4" />IRONSIGHT Tools
                    </div>
                    <div className="p-3 space-y-3">
                      {calibrationStatusRow}
                      {toolButtonsRow}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className={isFullscreen ? 'hidden' : 'w-full lg:w-72 flex-shrink-0 space-y-4'}>
            {notesPanelOpen && (
              <div className="border rounded-lg">
                <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold border-b">
                  <StickyNote className="w-4 h-4" />
                  Page Notes — Page {pageInfo.pageNum} of {pageInfo.numPages || 1}
                </div>
                <div className="p-3">
                  <textarea
                    key={pageInfo.pageNum}
                    value={pageNotes[pageInfo.pageNum] || ''}
                    onChange={(e) => handlePageNoteChange(e.target.value)}
                    placeholder="Notes for this page…"
                    className="w-full h-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm resize-y"
                  />
                </div>
              </div>
            )}
            <LegendControls
              pageNum={pageInfo.pageNum}
              setting={currentLegendSetting}
              rowCount={pageMarkupCount}
              onChange={(patch) => extras.setLegendSetting(pageInfo.pageNum, patch)}
            />
            <ToolChestPanel
              toolChest={toolChest}
              selectedPresetId={selectedPresetId}
              onSelectPreset={handleSelectPreset}
              onRemovePreset={handleRemovePreset}
              onAddPreset={(preset) => setToolChest((prev) => [...prev, preset])}
              activeToolSet={extras.toolSet}
              onLoadToolSet={handleApplyToolSet}
              onOpenLibrary={() => setLibraryOpen(true)}
            />
            </div>
          </div>

          {/* Single-action batch trigger */}
          <Button
            onClick={handleProcessFullDocument}
            disabled={!fileUrl || scanning}
            className="w-full h-16 text-lg font-extrabold uppercase tracking-wide steel-gradient text-white border-0"
          >
            {scanning ? <Loader2 className="w-6 h-6 mr-3 animate-spin" /> : <ScanLine className="w-6 h-6 mr-3" />}
            PROCESS FULL DOCUMENT TAKEOFF
          </Button>

          {fileUrl && (
            <div className="flex items-center justify-end">
              <Button variant="outline" size="sm" onClick={loadDemoRows} disabled={scanning}>
                <FlaskConical className="w-3.5 h-3.5 mr-1.5" />Load Demo Rows (sample data, not a real scan)
              </Button>
            </div>
          )}

          {scanning && (
            <div className="w-full rounded-lg border-2 border-primary bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3 animate-pulse">
              <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
              <p className="text-sm font-bold uppercase tracking-wide">
                AI Vision Core Analyzing Entire Multi-Sheet Blueprint Package. Processing Elements Across All Drawing Pages...
              </p>
            </div>
          )}
          {scanError && <p className="text-sm text-amber-600">{scanError}</p>}
          {excelExportError && <p className="text-sm text-amber-600">{excelExportError}</p>}

          {rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <FileStack className="w-4 h-4 text-primary" />
                  Unified Quantity Takeoff — {sheetCount || 1} sheet{(sheetCount || 1) === 1 ? '' : 's'}, {rows.length} item{rows.length === 1 ? '' : 's'}
                </h3>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleExportRequisitionPdf}><FileDown className="w-3.5 h-3.5 mr-1" />EXPORT REQUISITION TO PDF</Button>
                  <Button size="sm" variant="outline" onClick={handleExportRequisitionXlsx}><FileSpreadsheet className="w-3.5 h-3.5 mr-1" />EXPORT REQUISITION TO EXCEL</Button>
                  <Button size="sm" variant="outline" onClick={handleExportExcelTemplate} disabled={exportingExcel}>
                    {exportingExcel ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileDown className="w-3.5 h-3.5 mr-1" />}
                    EXPORT TO EXCEL TEMPLATE
                  </Button>
                  <Button size="sm" variant="outline" onClick={addManualRow}><Plus className="w-3.5 h-3.5 mr-1" />Add Row</Button>
                </div>
              </div>

              <div className="flex items-center gap-1.5 p-1.5 rounded-lg border bg-muted/20 w-fit">
                <Button size="sm" variant={gridView === 'takeoff' ? 'default' : 'ghost'} onClick={() => setGridView('takeoff')}>
                  <Grid3x3 className="w-3.5 h-3.5 mr-1.5" />Takeoff Grid
                </Button>
                <Button size="sm" variant={gridView === 'markups' ? 'default' : 'ghost'} onClick={() => setGridView('markups')}>
                  <ListChecks className="w-3.5 h-3.5 mr-1.5" />Markups List
                </Button>
                <Button size="sm" variant={gridView === 'measurements' ? 'default' : 'ghost'} onClick={() => setGridView('measurements')}>
                  <MousePointerClick className="w-3.5 h-3.5 mr-1.5" />Confirmed Measurements
                </Button>
              </div>

              {/* Both panels stay mounted (toggled via `hidden`) rather than a
                  ternary — MarkupsList owns local edit state (qty
                  multipliers, in-flight weight overrides) that a tab switch
                  shouldn't silently reset before its own debounce saves. */}
              <div className={gridView === 'markups' ? '' : 'hidden'}>
                <MarkupsList
                  rows={rows}
                  onRowsChange={(newRows) => { setRows(newRows); persist(newRows); }}
                  takeoffId={takeoffId}
                  takeoffName={takeoffName}
                  fileName={fileName}
                  companyId={user?.company_id}
                  bidId={sessionBidId}
                  projectId={sessionProjectId}
                  sequenceAreaId={sessionAreaId}
                  onLink={(newBidId, newProjectId) => persistTakeoffLink(takeoffId, newBidId, newProjectId)}
                  initialWeights={markupWeights}
                  columns={extras.columns}
                  toolSetColumns={extras.toolSet?.columns || []}
                  customColumns={extras.customColumns}
                  computeRow={extras.computeRow}
                  onCustomColumnsChange={extras.setCustomColumns}
                  onRowClick={handleMeasurementRowClick}
                />
              </div>
              <div className={gridView === 'takeoff' ? '' : 'hidden'}>
              {rows.some((r) => r.is_demo) && (
                <p className="text-xs font-medium text-amber-600 flex items-center gap-1.5">
                  <FlaskConical className="w-3.5 h-3.5" />Sample rows loaded for layout testing — these are not real blueprint detections and should not be used for an actual bid.
                </p>
              )}
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm min-w-[1400px]">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="p-2 font-medium w-10">✓</th>
                      <th className="p-2 font-medium w-16">Sheet</th>
                      <th className="p-2 font-medium">Shape Type</th>
                      <th className="p-2 font-medium w-40">Shape Class</th>
                      <th className="p-2 font-medium w-32">Size</th>
                      <th className="p-2 font-medium w-32">Coating</th>
                      <th className="p-2 font-medium w-32">Calculated Metrics</th>
                      <th className="p-2 font-medium w-20">Conf.</th>
                      <th className="p-2 font-medium w-20">Qty</th>
                      <th className="p-2 font-medium w-24">Wt (lb/ft)</th>
                      <th className="p-2 font-medium w-20">Length (ft)</th>
                      <th className="p-2 font-medium min-w-24 w-auto whitespace-nowrap">Length</th>
                      <th className="p-2 font-medium w-24">Area (sq ft)</th>
                      <th className="p-2 font-medium w-24">Total Wt (lb)</th>
                      <th className="p-2 font-medium w-28"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const rowWeight = (r.quantity || 0) * (r.unit_weight_lbs_per_ft || 0) * (r.length_ft || 0);
                      return (
                        <tr key={r._key} className={`border-t ${r.is_accepted ? '' : 'opacity-50'}`}>
                          <td className="p-2">
                            <input type="checkbox" checked={r.is_accepted} onChange={(e) => updateRow(r._key, 'is_accepted', e.target.checked)} />
                          </td>
                          <td className="p-2 text-xs text-muted-foreground">{r.page_number || 1}</td>
                          <td className="p-2">
                            <Input value={r.shape_type} onChange={(e) => updateRow(r._key, 'shape_type', e.target.value)} className="h-8" />
                            {(r.is_demo || r.notes) && (
                              <p className="text-[10px] mt-0.5 flex items-center gap-1 text-amber-600">
                                {r.is_demo && <span className="font-bold uppercase">[Demo]</span>}
                                {r.notes}
                              </p>
                            )}
                          </td>
                          <td className="p-2">
                            <select
                              value={r.shape_class || 'W'}
                              onChange={(e) => updateRow(r._key, 'shape_class', e.target.value)}
                              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                            >
                              {SHAPE_CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                          </td>
                          <td className="p-2">
                            <select
                              value={r.size_designation}
                              onChange={(e) => updateRow(r._key, 'size_designation', e.target.value)}
                              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                            >
                              {sizesForClass(r.shape_class || 'W-Beam').map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td className="p-2">
                            <select
                              value={r.coating_type || 'No Coating'}
                              onChange={(e) => updateRow(r._key, 'coating_type', e.target.value)}
                              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                            >
                              {COATING_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="p-2 text-xs font-medium">
                            {r.coating_type === 'Paint' && `${rowPaintAreaSqIn(r, catalog).toLocaleString(undefined, { maximumFractionDigits: 0 })} Sq In`}
                            {r.coating_type === 'Galvanized' && `${rowGalvanizedTons(r).toFixed(3)} Tons`}
                            {r.coating_type === 'No Coating' && '—'}
                          </td>
                          <td className="p-2 text-xs text-muted-foreground">{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—'}</td>
                          <td className="p-2"><Input type="number" min={0} value={r.quantity} onChange={(e) => updateRow(r._key, 'quantity', Number(e.target.value) || 0)} className="h-8" /></td>
                          <td className="p-2"><Input type="number" min={0} value={r.unit_weight_lbs_per_ft} onChange={(e) => updateRow(r._key, 'unit_weight_lbs_per_ft', Number(e.target.value) || 0)} className="h-8" /></td>
                          <td className="p-2"><Input type="number" min={0} value={r.length_ft} onChange={(e) => updateRow(r._key, 'length_ft', Number(e.target.value) || 0)} className="h-8" /></td>
                          <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                            {['area', 'bolt_count', 'volume', 'angle'].includes(r.tool) ? '—' : formatFeetInchesFraction(r.length_ft || 0)}
                          </td>
                          <td className="p-2 text-xs text-muted-foreground">
                            {['area', 'wall_area', 'volume'].includes(r.tool) ? r.area_sq_ft?.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                          </td>
                          <td className="p-2 text-xs font-medium">{rowWeight.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className="p-2">
                            <div className="flex items-center gap-1 justify-end">
                              {r.source === 'measurement' && r.tool === 'count' && r.pdfX != null && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  title="Find Similar"
                                  onClick={() => handleFindSimilar(r)}
                                  disabled={visualSearchLoading}
                                >
                                  <ScanSearch className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              {r.source === 'measurement' && (r.tool === 'count' || r.tool === 'bolt_count') && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  title="Add Pieces"
                                  onClick={() => handleResumeCount(r)}
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeRow(r._key)}><Trash2 className="w-3.5 h-3.5" /></Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/30 font-semibold">
                      <td colSpan={13} className="p-2 text-right">Job Totals ({acceptedRows.length} accepted)</td>
                      <td className="p-2 text-xs">{totalWeight.toLocaleString(undefined, { maximumFractionDigits: 0 })} lb</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="sticky bottom-0 z-10 rounded-lg border-2 border-primary bg-slate-900 text-white px-4 py-3 shadow-2xl flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm font-bold">
                  🎨 Total Paint Area: {totalPaintAreaSqIn.toLocaleString(undefined, { maximumFractionDigits: 0 })} Sq In
                </p>
                <p className="text-sm font-bold">
                  🪙 Total Galvanized Mass: {totalGalvanizedTons.toLocaleString(undefined, { maximumFractionDigits: 2 })} Tons
                </p>
              </div>
              </div>

              <div className={gridView === 'measurements' ? '' : 'hidden'}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <MousePointerClick className="w-4 h-4 text-primary" />
                    Confirmed Measurements — {measurementRows.length} row{measurementRows.length === 1 ? '' : 's'}
                  </h4>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleSaveMeasurementsLocally(measurementRows)}>
                      <Save className="w-3.5 h-3.5 mr-1" />Save Takeoff
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleExportMeasurementsCsv(visibleMeasurementRows)}
                      disabled={measurementRows.length === 0}
                    >
                      <FileDown className="w-3.5 h-3.5 mr-1" />Export Takeoff
                    </Button>
                  </div>
                </div>

                {isPhased && measurementAreaOptions.length > 0 && (
                  <div className="flex items-center gap-3 flex-wrap mb-2 text-xs">
                    <span className="font-medium text-muted-foreground">Filter Phase/Area:</span>
                    {measurementAreaOptions.map((a) => (
                      <label key={a} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!excludedMeasurementAreas.has(a)}
                          onChange={() => toggleMeasurementAreaFilter(a)}
                        />
                        {a}
                      </label>
                    ))}
                  </div>
                )}

                {measurementRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No confirmed measurements yet — use the Count/Length/Area tools and confirm from the modal to add rows here.
                  </p>
                ) : (
                  <div className="border rounded-lg overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left">
                        <tr>
                          {[
                            { key: 'page_number', label: 'Page #' },
                            { key: 'shape_type', label: 'Shape Type' },
                            { key: 'size_designation', label: 'Size' },
                            { key: 'quantity', label: 'Quantity' },
                            { key: 'phase', label: 'Phase/Area' },
                          ].map((col) => (
                            <th
                              key={col.key}
                              className="p-2 font-medium cursor-pointer select-none whitespace-nowrap"
                              onClick={() => handleMeasurementSortClick(col.key)}
                            >
                              {col.label}{measurementSort.field === col.key && (measurementSort.dir === 'asc' ? ' ▲' : ' ▼')}
                            </th>
                          ))}
                          <th className="p-2 font-medium">Measured</th>
                          <th className="p-2 font-medium">Grade</th>
                          <th className="p-2 font-medium">Notes</th>
                          <th className="p-2 font-medium w-20 text-center">Status</th>
                          <th className="p-2 font-medium w-24"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleMeasurementRows.map((r) => {
                          const isCountRow = r.tool === 'count' || r.tool === 'bolt_count';
                          return (
                          <tr
                            key={r._key}
                            className={`border-t cursor-pointer hover:bg-muted/40 transition-colors ${highlightedRowKey === r._key ? 'bg-amber-500/10' : ''}`}
                            onClick={() => handleMeasurementRowClick(r)}
                          >
                            <td className="p-2 text-xs text-muted-foreground">{r.page_number || 1}</td>
                            <td className="p-2">{r.shape_type || '—'}</td>
                            <td className="p-2">{r.size_designation || '—'}</td>
                            <td className="p-2">{r.quantity || 0}</td>
                            <td className="p-2">{r.phase || r.area || '—'}</td>
                            <td className="p-2 text-xs whitespace-nowrap">{isCountRow ? `${r.quantity || 0} pcs` : (measurementSummary(r, formatFeetInchesFraction) || '—')}</td>
                            <td className="p-2">{isCountRow ? (r.grade || '—') : '—'}</td>
                            <td className="p-2" onClick={(e) => e.stopPropagation()}>
                              <Input
                                value={r.notes || ''}
                                onChange={(e) => updateRow(r._key, 'notes', e.target.value)}
                                placeholder="Add a note…"
                                className="h-8"
                              />
                            </td>
                            <td className="p-2 text-center">
                              {r.review_flag && (
                                <span className="inline-flex items-center gap-1 mb-1 rounded border border-amber-300 bg-amber-50 text-amber-800 text-[10px] px-1.5 py-0.5 whitespace-nowrap" title={r.review_note || ''}>
                                  <AlertTriangle className="w-3 h-3" />{REVIEW_FLAG_TEXT}
                                  <button type="button" className="underline ml-1" onClick={(e) => { e.stopPropagation(); clearReviewFlag(r._key); }}>Checked</button>
                                </span>
                              )}
                              {isCountRow ? (
                                <CountMarkerSwatch color={r.color} symbol={r.symbol} size={18} />
                              ) : (
                                <span
                                  className="inline-block w-3 h-3 rounded-full border border-black/10"
                                  style={{ backgroundColor: MARKER_COLOR_HEX[r.marker_color] || MARKER_COLOR_HEX.blue }}
                                  title={r.marker_color || 'blue'}
                                />
                              )}
                            </td>
                            <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1">
                                {isCountRow && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    title="Add Pieces"
                                    onClick={() => handleResumeCount(r)}
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive"
                                  onClick={() => handleDeleteMeasurementRow(r)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
        </ErrorBoundary>
      )}
      <SteelCatalogEditor
        open={steelCatalogEditorOpen}
        onOpenChange={setSteelCatalogEditorOpen}
        catalog={steelCatalog}
        onSave={setSteelCatalog}
      />
      <AreaNameModal
        open={areaNameModalOpen}
        onOpenChange={(next) => { if (!next) handleCancelAreaName(); }}
        onSave={handleSaveAreaName}
      />
      <MeasurementConfirmationModal
        open={measurementModalOpen}
        pendingMeasurement={pendingMeasurement}
        steelCatalog={steelCatalog}
        areas={areas}
        onCountSimilar={handleCountSimilarForModal}
        onConfirm={handleConfirmMeasurement}
        onMergeDuplicate={handleMergeDuplicate}
        onKeepSeparate={handleKeepSeparateMeasurement}
        onCancel={handleCancelMeasurement}
        defaults={measurementDefaults}
      />
      <ToolSetLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        initialToolSetId={extras.toolSet?.id}
        onApplyTool={(preset) => setToolChest((prev) => [...prev, preset])}
        onApplyToolSet={handleApplyToolSet}
      />
      {mode === 'workspace' && (
        <>
          <MarkupPdfExportDialog
            open={exportPdfOpen}
            onOpenChange={setExportPdfOpen}
            takeoffId={takeoffId}
            takeoffName={takeoffName || stripPdfExtension(fileName)}
            rows={rows}
            toolSet={extras.toolSet}
            numPages={pageInfo.numPages || 1}
            currentPage={pageInfo.pageNum}
            legendSettings={extras.legendSettings}
            legendForPage={legendForPage}
            revisionCompare={extras.revisionCompare}
            author={user?.full_name || user?.email || ''}
          />
          <RevisionCompareDialog
            open={compareOpen}
            onOpenChange={setCompareOpen}
            takeoffId={takeoffId}
            fileUrl={fileUrl}
            currentPage={pageInfo.pageNum}
            revisionCandidates={revisionCandidates}
            previousTakeoffId={extras.previousTakeoffId}
            savedPage={extras.revisionCompare?.pages?.[pageInfo.pageNum] || null}
            onLinkPrevious={extras.setPreviousTakeoffId}
            onSave={handleSaveCompare}
            onOpenCarryForward={() => { setCompareOpen(false); setCarryOpen(true); }}
          />
          <CarryForwardDialog
            open={carryOpen}
            onOpenChange={setCarryOpen}
            previousTakeoffId={extras.previousTakeoffId}
            currentRows={rows}
            revisionCompare={extras.revisionCompare}
            onApply={handleApplyCarryForward}
          />
        </>
      )}
      <CountSetupModal
        open={countSetupModalOpen}
        kind={countSetup?.kind}
        shapeTypes={countSetup?.kind === 'bolt' ? boltShapeTypes : beamShapeTypes}
        sizesByShapeId={materialSizesByShapeId}
        gradesByShapeId={materialGradesByShapeId}
        onConfirm={handleConfirmCountSetup}
        onCancel={handleCancelCountSetup}
      />
      <CountColorPickerModal
        open={countColorModalOpen}
        usedColors={countUsedColorsOnPage}
        usedSymbols={countUsedSymbolsOnPage}
        onConfirm={handleConfirmCountColor}
        onCancel={handleCancelCountColor}
      />
      <CountTallyPanel
        session={activeTool === 'count' || activeTool === 'bolt_count' ? countSession : null}
        label={countSessionLabel}
        onSave={handleSaveCountSession}
        onCancel={handleCancelCountSession}
      />
    </div>
  );
}
