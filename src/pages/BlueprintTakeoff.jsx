import React, { useState, useRef, useEffect } from 'react';
import { useOutletContext, useParams, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { db } from '@/api/apiClient';
import { simulateAiBatchTakeoff } from '@/lib/aiIntelligenceEngine';
import { savePdf, getPdf } from '@/lib/pdfBlobStore';
import { findSimilarSymbols } from '@/lib/localAiClient';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/ui/use-toast';
import {
  Loader2, UploadCloud, ScanLine, Plus, Trash2, FileStack, FlaskConical, FileDown,
  Crosshair, FolderOpen, ArrowLeft, AlertTriangle, RotateCw, Ruler,
  MousePointer2, MousePointerClick, Wrench, ChevronDown, ChevronUp,
  Shapes, ScanSearch, Check, X, Link2, ExternalLink, ListChecks, Grid3x3,
  Maximize2, HelpCircle, GripVertical, StickyNote, Save,
} from 'lucide-react';
import { calculateSteelSurfaceArea } from '@/lib/steelShapeMath';
import { SHAPE_CLASSES, getShapeClass } from '@/data/steelShapeSelector';
import { exportRequisitionToPdf } from '@/lib/requisitionPdfExport';
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

const COATING_TYPES = ['No Coating', 'Paint', 'Galvanized'];

// The 16ths commonly used when reading structural steel dimensions off a
// drawing — calibration distance entry mirrors that feet-inches-fraction
// convention instead of a plain decimal + unit toggle.
const FRACTION_OPTIONS = [
  { value: '0', label: '0' },
  { value: '0.0625', label: '1/16' },
  { value: '0.125', label: '1/8' },
  { value: '0.1875', label: '3/16' },
  { value: '0.25', label: '1/4' },
  { value: '0.3125', label: '5/16' },
  { value: '0.375', label: '3/8' },
  { value: '0.4375', label: '7/16' },
  { value: '0.5', label: '1/2' },
  { value: '0.5625', label: '9/16' },
  { value: '0.625', label: '5/8' },
  { value: '0.6875', label: '11/16' },
  { value: '0.75', label: '3/4' },
  { value: '0.8125', label: '13/16' },
  { value: '0.875', label: '7/8' },
  { value: '0.9375', label: '15/16' },
];

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

// Shoelace formula on the closed Area-tool polygon (PDF-space, scale=1) —
// pxPerFt squared converts the raw px² result into real-world sq ft the
// same way pxPerFt alone converts a length.
const polygonAreaSqFt = (polygon, pxPerFtValue) => {
  if (!polygon || polygon.length < 3 || !pxPerFtValue) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    sum += p1.pdfX * p2.pdfY - p2.pdfX * p1.pdfY;
  }
  return (Math.abs(sum) / 2) / (pxPerFtValue * pxPerFtValue);
};

const polygonCentroid = (polygon) => ({
  pdfX: polygon.reduce((s, p) => s + p.pdfX, 0) / polygon.length,
  pdfY: polygon.reduce((s, p) => s + p.pdfY, 0) / polygon.length,
});

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
  // to whichever PDF is currently loaded — reset alongside pxPerFt/rows any
  // time a different file is opened/uploaded, never persisted server-side.
  const [areas, setAreas] = useState({});
  // Closed-but-unnamed polygon awaiting the Name This Area modal — cleared
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
  const [calFeet, setCalFeet] = useState('');
  const [calInches, setCalInches] = useState('');
  const [calFraction, setCalFraction] = useState('0'); // string fraction value
  const [pxPerFt, setPxPerFt] = useState(null);
  // Raw inputs behind the current pxPerFt, kept for reference/debugging —
  // pxPerFt itself is always derived back into PDF space (screenDistance /
  // calibrationScale) so it stays correct at any zoom level, not just the
  // zoom that was active at calibration time.
  const [calibrationData, setCalibrationData] = useState(null);
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

  // Count/Length/Area measurement tools. All write straight into `rows`,
  // same as any other accepted_items row — source: 'measurement' is what
  // marks them as tool-placed (vs. AI-detected/manual/demo) for redraw +
  // display. toolChest presets are per-session saved shortcuts (label +
  // shape + color) so an estimator doesn't have to re-pick a shape/size
  // before every click; selectedPresetId tracks which one is "loaded" into
  // the tools.
  const [activeTool, setActiveTool] = useState(null);
  const [lengthPoints, setLengthPoints] = useState([]);
  const [areaPoints, setAreaPoints] = useState([]);
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
  const [toolChestOpen, setToolChestOpen] = useState(false);
  const [newPresetLabel, setNewPresetLabel] = useState('');
  const [newPresetShapeClass, setNewPresetShapeClass] = useState(SHAPE_CLASSES[0].value);
  const [newPresetSize, setNewPresetSize] = useState('');
  const [newPresetTool, setNewPresetTool] = useState('count');
  const [newPresetColor, setNewPresetColor] = useState('#ef4444');

  // VisualSearch — a Count row's marker gets cropped, sent to the local VLM
  // alongside the full page, and candidate matches come back as transient
  // review markers. Nothing here ever reaches `rows`/persist until the
  // estimator explicitly accepts it (see handleAcceptAllCandidates).
  const [candidates, setCandidates] = useState([]);
  const [candidateSourceRow, setCandidateSourceRow] = useState(null);
  const [visualSearchLoading, setVisualSearchLoading] = useState(false);
  const [visualSearchError, setVisualSearchError] = useState(null);

  const fileInputRef = useRef(null);
  const reattachInputRef = useRef(null);
  const activePdfUrlRef = useRef(null);
  const toolChestSaveTimerRef = useRef(null);
  const pageNotesSaveTimerRef = useRef(null);
  const canvasRef = useRef(null);
  const highlightTimeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(highlightTimeoutRef.current), []);

  useEffect(() => {
    db.entities.steel_catalog.list('size_designation', 1000).then(setCatalog).catch(() => setCatalog([]));
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

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const list = await db.entities.blueprint_takeoffs.filter({ company_id: user?.company_id }, '-created_date', 500);
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
    }
  };

  useEffect(() => {
    loadSessions();
  }, [user?.company_id]);

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
    setCalFeet('');
    setCalInches('');
    setCalFraction('0');
    setPxPerFt(null);
    setCalibrationData(null);
    setActiveTool(null);
    setLengthPoints([]);
    setAreaPoints([]);
    setAreas({});
    setPendingAreaPolygon(null);
    setAreaNameModalOpen(false);
    setToolChest([]);
    setSelectedPresetId(null);
    setCandidates([]);
    setCandidateSourceRow(null);
    setVisualSearchLoading(false);
    setVisualSearchError(null);
    setSessionBidId(null);
    setSessionProjectId(null);
    setWorkspaceLinkDraft('');
    setGridView('takeoff');
    setMarkupWeights({});
    setPageNotes({});
    setPageInfo({ pageNum: 1, numPages: 1 });
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
    setCalFeet('');
    setCalInches('');
    setCalFraction('0');
    setPxPerFt(takeoff.px_per_ft ?? null);
    setCalibrationData(null);
    setActiveTool(null);
    setLengthPoints([]);
    setAreaPoints([]);
    setAreas({});
    setPendingAreaPolygon(null);
    setAreaNameModalOpen(false);
    setToolChest(takeoff.tool_chest || []);
    setSelectedPresetId(null);
    setCandidates([]);
    setCandidateSourceRow(null);
    setVisualSearchLoading(false);
    setVisualSearchError(null);
    setSessionBidId(takeoff.bid_id || null);
    setSessionProjectId(takeoff.bid_id ? null : (takeoff.project_id || null));
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

  const handleNewTakeoffFile = async (file) => {
    if (!file) return;
    if (!newTakeoffName.trim()) {
      setNewSessionError('Enter a takeoff name before uploading.');
      return;
    }
    setNewSessionError(null);
    setCreatingSession(true);
    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file });
      const pickedLink = bidId ? { bid_id: null, project_id: null } : parseLinkValue(newTakeoffLinkValue);
      const created = await db.entities.blueprint_takeoffs.create({
        company_id: user?.company_id,
        bid_id: bidId || pickedLink.bid_id || undefined,
        project_id: bidId ? undefined : (pickedLink.project_id || undefined),
        takeoff_name: newTakeoffName.trim(),
        file_url,
        file_name: file.name,
        sheet_count: 1,
        scale_reference: '',
        accepted_items: [],
        has_stored_pdf: false,
        last_opened_at: new Date().toISOString(),
      });

      setTakeoffId(created.id);
      setTakeoffName(newTakeoffName.trim());
      setHasStoredPdf(false);
      setActivePdfUrl(file_url);
      setFileName(file.name);
      setSheetCount(null);
      setScaleReference('');
      setRows([]);
      setScanError(null);
      setPdfMissingNotice(false);
      setReattachError(null);
      setCalibrationMode(false);
      setCalibrationPoints([]);
      setCalFeet('');
      setCalInches('');
      setCalFraction('0');
      setPxPerFt(null);
      setCalibrationData(null);
      setActiveTool(null);
      setLengthPoints([]);
      setAreaPoints([]);
      setAreas({});
      setPendingAreaPolygon(null);
      setAreaNameModalOpen(false);
      setToolChest([]);
      setSelectedPresetId(null);
      setCandidates([]);
      setCandidateSourceRow(null);
      setVisualSearchLoading(false);
      setVisualSearchError(null);
      setSessionBidId(created.bid_id || null);
      setSessionProjectId(created.bid_id ? null : (created.project_id || null));
      setWorkspaceLinkDraft('');
      setGridView('takeoff');
      setMarkupWeights({});
      setPageNotes({});
      setPageInfo({ pageNum: 1, numPages: 1 });
      setNewTakeoffLinkValue('');

      setNewTakeoffName('');
      setMode('workspace');
      loadSessions();

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

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleStartCalibration = () => {
    setActiveTool(null);
    setLengthPoints([]);
    setAreaPoints([]);
    setCalibrationPoints([]);
    setCalibrationMode(true);
    setMeasurementModalOpen(false);
    setPendingMeasurement(null);
  };

  const handleCalibrationCancel = () => {
    setCalibrationPoints([]);
    setCalibrationMode(false);
  };

  const handleCalibrationClick = ({ pdfX, pdfY }) => {
    setCalibrationPoints((prev) => (prev.length >= 2 ? prev : [...prev, { pdfX, pdfY }]));
  };

  const handleConfirmCalibration = async () => {
    const [p1, p2] = calibrationPoints;
    if (!p1 || !p2) return;

    const feet = parseFloat(calFeet) || 0;
    const inches = parseFloat(calInches) || 0;
    const fraction = parseFloat(calFraction) || 0;
    const realFt = feet + (inches + fraction) / 12;

    // p1/p2 are already in PDF space (scale=1) — screenDistance/calibrationScale
    // is recorded here only so the PDF-space distance can be recovered the
    // same way regardless of what zoom level this calibration happened at.
    // pxPerFt is a PDF-space ratio and must never be multiplied by whatever
    // scale happens to be live when a later Length/Area click uses it —
    // that's what let this drift every time the estimator zoomed between
    // calibrating and measuring.
    const calibrationScale = canvasScale;
    const screenDistance = Math.sqrt((p2.pdfX - p1.pdfX) ** 2 + (p2.pdfY - p1.pdfY) ** 2) * calibrationScale;
    const pdfPixelDistance = screenDistance / calibrationScale;
    const resolvedPxPerFt = pdfPixelDistance / realFt;

    if (!(realFt > 0)) {
      toast({ title: 'Enter the dimension between your two points.', variant: 'destructive' });
      setCalibrationPoints([]);
      return;
    }

    if (!(screenDistance > 10)) {
      toast({ title: 'Points are too close together', description: 'Click two clearly separated points on the drawing.', variant: 'destructive' });
      setCalibrationPoints([]);
      return;
    }
    if (!(resolvedPxPerFt > 0 && resolvedPxPerFt < 100000)) {
      toast({ title: 'Implausible scale', description: 'That scale looks wrong — check your points and distance and try again.', variant: 'destructive' });
      setCalibrationPoints([]);
      return;
    }

    const fractionLabel = FRACTION_OPTIONS.find((f) => f.value === calFraction)?.label;
    const readableDistance = `${feet}'-${inches}${calFraction !== '0' && fractionLabel ? `-${fractionLabel}` : ''}"`;

    setPxPerFt(resolvedPxPerFt);
    setCalibrationData({ pdfX1: p1.pdfX, pdfY1: p1.pdfY, pdfX2: p2.pdfX, pdfY2: p2.pdfY, screenDistance, calibrationScale });
    setCalibrationMode(false);
    setScaleReference(readableDistance);

    if (takeoffId) {
      try {
        await db.entities.blueprint_takeoffs.update(takeoffId, {
          px_per_ft: resolvedPxPerFt,
          scale_reference: readableDistance,
        });
      } catch (e) {
        console.error('Failed to persist calibration', e);
      }
    }
  };

  const handleSelectTool = () => {
    setActiveTool(null);
    setLengthPoints([]);
    setAreaPoints([]);
    setMeasurementModalOpen(false);
    setPendingMeasurement(null);
  };

  // Gate every tool activation behind calibration — Count/Length/Area
  // measurements are meaningless without pxPerFt, so there's no
  // partial-credit path here: either it's set and the tool goes live, or it
  // isn't and nothing changes beyond the toast telling the estimator what to
  // do first.
  const handleActivateTool = (tool) => {
    if (pxPerFt == null) {
      toast({ title: 'Calibrate the drawing scale first — click Set Scale', variant: 'destructive' });
      return;
    }
    setCalibrationMode(false);
    setCalibrationPoints([]);
    setLengthPoints([]);
    setAreaPoints([]);
    setMeasurementModalOpen(false);
    setPendingMeasurement(null);
    setActiveTool(tool);
  };

  const handleMeasurementClick = ({ tool, pdfX, pdfY, isClosingClick }) => {
    if (tool === 'count') {
      setPendingMeasurement({ tool: 'count', pdfX, pdfY });
      setMeasurementModalOpen(true);
      return;
    }

    if (tool === 'length') {
      if (lengthPoints.length === 0) {
        setLengthPoints([{ pdfX, pdfY }]);
        return;
      }

      const p1 = lengthPoints[0];
      const p2 = { pdfX, pdfY };
      // Both points and pxPerFt live in PDF space — no canvasScale factor
      // here, or this drifts the instant the estimator zooms in/out between
      // calibrating and clicking a length (see handleConfirmCalibration).
      const pxDist = Math.sqrt((p2.pdfX - p1.pdfX) ** 2 + (p2.pdfY - p1.pdfY) ** 2);
      const lengthFt = pxDist / pxPerFt;
      setPendingMeasurement({ tool: 'length', point1: p1, point2: p2, length_ft: Math.round(lengthFt * 100) / 100 });
      setMeasurementModalOpen(true);
      return;
    }

    if (tool === 'area') {
      if (isClosingClick) {
        // Fewer than 3 vertices can't form a polygon — ignore the closing
        // click entirely (don't add it as a vertex either) and keep
        // collecting points.
        if (areaPoints.length < 3) return;

        // Don't auto-place anything here — hand the closed polygon to the
        // Name This Area modal instead, and only commit it to `areas` once
        // the estimator saves a name for it (see handleSaveAreaName).
        setPendingAreaPolygon(areaPoints);
        setAreaNameModalOpen(true);
        return;
      }

      setAreaPoints((prev) => [...prev, { pdfX, pdfY }]);
    }
  };

  const handleSaveAreaName = (name) => {
    if (pendingAreaPolygon) {
      setAreas((prev) => ({
        ...prev,
        [name]: { id: crypto.randomUUID(), polygon: pendingAreaPolygon, pageNumber: pageInfo.pageNum },
      }));
      // The zone itself is committed above regardless — this only decides
      // whether it also becomes a takeoff row. zoneName pre-selects this
      // exact zone in the confirmation modal's Phase/Area dropdown.
      setPendingMeasurement({
        tool: 'area',
        polygon: pendingAreaPolygon,
        area_sq_ft: polygonAreaSqFt(pendingAreaPolygon, pxPerFt),
        centroid: polygonCentroid(pendingAreaPolygon),
        zoneName: name,
      });
      setMeasurementModalOpen(true);
    }
    setPendingAreaPolygon(null);
    setAreaPoints([]);
    setAreaNameModalOpen(false);
  };

  const handleCancelAreaName = () => {
    setPendingAreaPolygon(null);
    setAreaPoints([]);
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

    const point = pendingMeasurement.tool === 'area' ? pendingMeasurement.centroid
      : pendingMeasurement.tool === 'length' ? pendingMeasurement.point2
      : pendingMeasurement;

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
    if (pendingMeasurement?.tool === 'length') setLengthPoints([]);
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
  const buildMeasurementRow = (shape, size, qty, phaseArea, markerColor) => {
    const base = {
      id: crypto.randomUUID(),
      source: 'measurement',
      tool: pendingMeasurement.tool,
      page_number: pageInfo.pageNum,
      shape_type: shape,
      size_designation: size,
      label: [shape, size].filter(Boolean).join(' ')
        || (pendingMeasurement.tool === 'count' ? 'Count' : pendingMeasurement.tool === 'length' ? 'Length' : 'Area'),
      color: markerColor === 'red' ? '#ef4444' : '#22c55e',
      marker_color: markerColor,
      quantity: qty,
      phase: phaseArea,
      area: phaseArea,
      notes: '',
      is_saved: true,
      is_accepted: true,
      unit_weight_lbs_per_ft: 0,
      length_ft: pendingMeasurement.tool === 'length' ? pendingMeasurement.length_ft : 0,
    };
    base._key = base.id;

    if (pendingMeasurement.tool === 'count') return { ...base, pdfX: pendingMeasurement.pdfX, pdfY: pendingMeasurement.pdfY };
    if (pendingMeasurement.tool === 'length') return { ...base, point1: pendingMeasurement.point1, point2: pendingMeasurement.point2 };
    return {
      ...base,
      pdfX: pendingMeasurement.centroid.pdfX,
      pdfY: pendingMeasurement.centroid.pdfY,
      area_sq_ft: pendingMeasurement.area_sq_ft,
    };
  };

  // Returns { added: true } once the row is in, or { duplicate: <row> } if
  // an existing row already covers this same spot/shape/size/phase —
  // nothing is written to `rows` in that case; the modal shows a
  // merge-or-keep-separate prompt and calls handleMergeDuplicate/
  // handleKeepSeparateMeasurement with the estimator's choice instead.
  const handleConfirmMeasurement = ({ shape, size, quantity, phaseArea }) => {
    if (!pendingMeasurement) return { added: false };
    const qty = Math.max(1, Number(quantity) || 1);
    const anchor = measurementAnchorFromPending(pendingMeasurement);
    const duplicate = findDuplicateRow(rows, pendingMeasurement.tool, shape, size, phaseArea, anchor);
    if (duplicate) return { duplicate };

    const updated = [...rows, buildMeasurementRow(shape, size, qty, phaseArea, 'green')];
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

  const handleKeepSeparateMeasurement = ({ shape, size, quantity, phaseArea, existingRowKey }) => {
    if (!pendingMeasurement) return;
    const qty = Math.max(1, Number(quantity) || 1);
    const newRow = buildMeasurementRow(shape, size, qty, phaseArea, 'red');
    const updated = rows
      .map((r) => (r._key === existingRowKey ? { ...r, marker_color: 'red', color: '#ef4444' } : r))
      .concat(newRow);
    setRows(updated);
    persist(updated);
    finishMeasurementModal();
  };

  const handleSelectPreset = (preset) => {
    setSelectedPresetId(preset.id);
    if (pxPerFt == null) {
      toast({ title: 'Calibrate the drawing scale first — click Set Scale', variant: 'destructive' });
      return;
    }
    setCalibrationMode(false);
    setCalibrationPoints([]);
    setLengthPoints([]);
    setAreaPoints([]);
    setMeasurementModalOpen(false);
    setPendingMeasurement(null);
    setActiveTool(preset.tool);
  };

  const handleRemovePreset = (id) => {
    setToolChest((prev) => prev.filter((p) => p.id !== id));
    setSelectedPresetId((prev) => (prev === id ? null : prev));
  };

  const handleAddPreset = () => {
    if (!newPresetLabel.trim()) return;
    const preset = {
      id: crypto.randomUUID(),
      tool: newPresetTool,
      label: newPresetLabel.trim(),
      shapeClass: newPresetShapeClass,
      sizeDesignation: newPresetSize.trim(),
      color: newPresetColor,
    };
    setToolChest((prev) => [...prev, preset]);
    setNewPresetLabel('');
    setNewPresetSize('');
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
      if (e.key === 'Escape') {
        setActiveTool(null);
        setLengthPoints([]);
        setAreaPoints([]);
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode]);

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

  const handleExportRequisitionPdf = () => {
    exportRequisitionToPdf({
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
      columns: ['Page', 'Shape Type', 'Size', 'Quantity', 'Phase/Area', 'Notes', 'Status'],
      rows: visibleRows.map((r) => [
        r.page_number || 1, r.shape_type || '', r.size_designation || '', r.quantity || 0,
        r.phase || r.area || '', r.notes || '', r.marker_color || '',
      ]),
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
      : pendingMeasurement.tool === 'length' ? { point1: pendingMeasurement.point1, point2: pendingMeasurement.point2 }
      : { pdfX: pendingMeasurement.centroid.pdfX, pdfY: pendingMeasurement.centroid.pdfY }),
  } : null;
  const measurementItemsForCanvas = pendingMeasurementMarker ? [...rows, pendingMeasurementMarker] : rows;

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
    <div className="flex flex-wrap items-center gap-3">
      {pxPerFt == null ? (
        <Badge variant="outline" className="text-amber-600 border-amber-300">Not calibrated</Badge>
      ) : (
        <Badge variant="outline" className="text-green-700 border-green-300">Calibrated — 1 ft = {pxPerFt.toFixed(1)} px</Badge>
      )}
      {calibrationMode ? (
        <Button size="sm" variant="outline" onClick={handleCalibrationCancel}>Cancel Calibration</Button>
      ) : (
        <Button size="sm" variant="outline" onClick={handleStartCalibration} disabled={!fileUrl}>
          <Ruler className="w-3.5 h-3.5 mr-1.5" />{pxPerFt == null ? 'Set Scale' : 'Recalibrate'}
        </Button>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="icon" variant="ghost" className="h-7 w-7" title="How to calibrate">
            <HelpCircle className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="text-sm space-y-2">
          <p className="font-semibold">How to calibrate</p>
          <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
            <li>Click Set Scale to enter calibration mode</li>
            <li>Click the first point on a known dimension (e.g. one end of a column spacing)</li>
            <li>Click the second point at the other end of that dimension</li>
            <li>Type the real-world distance between those two points</li>
            <li>Click Confirm — the drawing is now calibrated</li>
          </ol>
          <p className="text-xs text-amber-600 pt-1 border-t border-border">
            Tip: Use a grid dimension or column spacing marked on the drawing for best accuracy.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );

  const calFractionLabel = FRACTION_OPTIONS.find((f) => f.value === calFraction)?.label;
  const calShowPreview = (parseFloat(calFeet) || 0) > 0 || (parseFloat(calInches) || 0) > 0;
  const calPreviewText = `${parseFloat(calFeet) || 0}'-${parseFloat(calInches) || 0}${calFraction !== '0' && calFractionLabel ? `-${calFractionLabel}` : ''}"`;
  const calRealFtPreview = (parseFloat(calFeet) || 0) + ((parseFloat(calInches) || 0) + (parseFloat(calFraction) || 0)) / 12;

  const calibrationDistanceCard = calibrationMode && calibrationPoints.length === 2 && (
    <Card>
      <CardContent className="p-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Real-world distance between the two points</label>
          <div className="flex items-end gap-2">
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                value={calFeet}
                onChange={(e) => setCalFeet(e.target.value)}
                placeholder="0"
                className="w-[60px] h-8"
                autoFocus
              />
              <span className="text-xs text-muted-foreground">ft</span>
            </div>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                max={11}
                value={calInches}
                onChange={(e) => setCalInches(e.target.value)}
                placeholder="0"
                className="w-[60px] h-8"
              />
              <span className="text-xs text-muted-foreground">in</span>
            </div>
            <div className="flex items-center gap-1">
              <Select value={calFraction} onValueChange={setCalFraction}>
                <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FRACTION_OPTIONS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">&quot;</span>
            </div>
          </div>
          {calShowPreview && <p className="text-xs text-muted-foreground">= {calPreviewText}</p>}
        </div>
        <Button size="sm" onClick={handleConfirmCalibration} disabled={!(calRealFtPreview > 0)}>Confirm</Button>
        <Button size="sm" variant="outline" onClick={handleCalibrationCancel}>Cancel</Button>
      </CardContent>
    </Card>
  );

  // Select/Count/Length/Area/Calibrate + fullscreen toggle. Escape (bound in
  // an effect above) always drops back to Select and exits fullscreen, same
  // as clicking through them manually.
  const toolButtonsRow = (
    <div className="flex items-center gap-1.5 p-1.5 rounded-lg border bg-muted/20 w-fit">
      <Button size="sm" variant={activeTool === null && !calibrationMode ? 'default' : 'ghost'} onClick={handleSelectTool}>
        <MousePointer2 className="w-3.5 h-3.5 mr-1.5" />Select
      </Button>
      <Button size="sm" variant={activeTool === 'count' ? 'default' : 'ghost'} onClick={() => handleActivateTool('count')} disabled={!fileUrl}>
        <MousePointerClick className="w-3.5 h-3.5 mr-1.5" />Count
      </Button>
      <Button size="sm" variant={activeTool === 'length' ? 'default' : 'ghost'} onClick={() => handleActivateTool('length')} disabled={!fileUrl}>
        <Ruler className="w-3.5 h-3.5 mr-1.5" />Length
      </Button>
      <Button size="sm" variant={activeTool === 'area' ? 'default' : 'ghost'} onClick={() => handleActivateTool('area')} disabled={!fileUrl}>
        <Shapes className="w-3.5 h-3.5 mr-1.5" />Area
      </Button>
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
            <p className="text-sm text-slate-400 mt-1">Structural Steel Takeoff Platform</p>
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
              <FolderOpen className="w-4 h-4" />Resume a takeoff
            </h3>
            {sessionsLoading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading sessions…</p>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No takeoff sessions yet — start one on the right.</p>
            ) : (
              <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                {sessions.map((s) => {
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
            <Input
              placeholder='Takeoff name — e.g. "Scott Park Phase II — Sheets S1-S8"'
              value={newTakeoffName}
              onChange={(e) => setNewTakeoffName(e.target.value)}
            />
            {!bidId && (
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
            )}
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
          </div>
        </div>
      )}

      {mode === 'workspace' && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold truncate" title={takeoffName || fileName || 'Untitled takeoff'}>{takeoffName || fileName || 'Untitled takeoff'}</span>
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
                  {calibrationDistanceCard}
                  {toolButtonsRow}
                </>
              )}

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
                    lengthPoints={lengthPoints}
                    areaPoints={areaPoints}
                    onMeasurementClick={handleMeasurementClick}
                    measurementItems={measurementItemsForCanvas}
                    highlightedItemKey={highlightedRowKey}
                    pxPerFt={pxPerFt}
                    candidateMarkers={candidates}
                    onCandidateToggle={handleToggleCandidate}
                    fillHeight={isFullscreen}
                    steelCatalog={steelCatalog}
                    areas={areas}
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
                      {calibrationDistanceCard}
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
            <div className="border rounded-lg">
              <button
                type="button"
                onClick={() => setToolChestOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold"
              >
                <span className="flex items-center gap-2"><Wrench className="w-4 h-4" />Tool Chest</span>
                {toolChestOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {toolChestOpen && (
                <div className="border-t p-3 space-y-3">
                  {toolChest.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No saved presets yet — add one below.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {toolChest.map((preset) => (
                        <div
                          key={preset.id}
                          onClick={() => handleSelectPreset(preset)}
                          className={`flex items-center gap-2 rounded-md border px-2 py-1.5 cursor-pointer text-xs ${selectedPresetId === preset.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}
                        >
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: preset.color }} />
                          {preset.tool === 'count' && <MousePointerClick className="w-3.5 h-3.5 flex-shrink-0" />}
                          {preset.tool === 'length' && <Ruler className="w-3.5 h-3.5 flex-shrink-0" />}
                          {preset.tool === 'area' && <Shapes className="w-3.5 h-3.5 flex-shrink-0" />}
                          <span className="font-medium truncate">{preset.label}</span>
                          <span className="text-muted-foreground truncate flex-1">
                            {preset.shapeClass}{preset.sizeDesignation ? ` — ${preset.sizeDesignation}` : ''}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 flex-shrink-0"
                            onClick={(e) => { e.stopPropagation(); handleRemovePreset(preset.id); }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="border-t pt-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">New Preset</p>
                    <Input
                      placeholder="Label — e.g. W14x90 Columns"
                      value={newPresetLabel}
                      onChange={(e) => setNewPresetLabel(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={newPresetShapeClass} onValueChange={setNewPresetShapeClass}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SHAPE_CLASSES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Size (e.g. W14X90)"
                        value={newPresetSize}
                        onChange={(e) => setNewPresetSize(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={newPresetTool} onValueChange={setNewPresetTool}>
                        <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="count">Count</SelectItem>
                          <SelectItem value="length">Length</SelectItem>
                          <SelectItem value="area">Area</SelectItem>
                        </SelectContent>
                      </Select>
                      <input
                        type="color"
                        value={newPresetColor}
                        onChange={(e) => setNewPresetColor(e.target.value)}
                        className="h-8 w-10 rounded border cursor-pointer"
                      />
                      <Button size="sm" onClick={handleAddPreset} disabled={!newPresetLabel.trim()} className="ml-auto">
                        <Plus className="w-3.5 h-3.5 mr-1" />Add
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
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
                  onLink={(newBidId, newProjectId) => persistTakeoffLink(takeoffId, newBidId, newProjectId)}
                  initialWeights={markupWeights}
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
                      <th className="p-2 font-medium w-20">Length</th>
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
                          <td className="p-2 text-xs text-muted-foreground">
                            {r.tool === 'count' || r.tool === 'area' ? '—' : `${Math.floor(r.length_ft || 0)}'-${Math.round(((r.length_ft || 0) % 1) * 12)}"`}
                          </td>
                          <td className="p-2 text-xs text-muted-foreground">
                            {r.tool === 'area' ? r.area_sq_ft?.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                          </td>
                          <td className="p-2 text-xs font-medium">{rowWeight.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className="p-2">
                            <div className="flex items-center gap-1 justify-end">
                              {r.source === 'measurement' && r.tool === 'count' && (
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
                          <th className="p-2 font-medium">Notes</th>
                          <th className="p-2 font-medium w-20 text-center">Status</th>
                          <th className="p-2 font-medium w-12"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleMeasurementRows.map((r) => (
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
                            <td className="p-2" onClick={(e) => e.stopPropagation()}>
                              <Input
                                value={r.notes || ''}
                                onChange={(e) => updateRow(r._key, 'notes', e.target.value)}
                                placeholder="Add a note…"
                                className="h-8"
                              />
                            </td>
                            <td className="p-2 text-center">
                              <span
                                className="inline-block w-3 h-3 rounded-full border border-black/10"
                                style={{ backgroundColor: MARKER_COLOR_HEX[r.marker_color] || MARKER_COLOR_HEX.blue }}
                                title={r.marker_color || 'blue'}
                              />
                            </td>
                            <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive"
                                onClick={() => handleDeleteMeasurementRow(r)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
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
      />
    </div>
  );
}
