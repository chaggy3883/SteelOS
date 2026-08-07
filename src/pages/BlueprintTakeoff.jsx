import React, { useState, useRef, useEffect } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { db } from '@/api/apiClient';
import { simulateAiBatchTakeoff } from '@/lib/aiIntelligenceEngine';
import { savePdf, getPdf } from '@/lib/pdfBlobStore';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, UploadCloud, ScanLine, Plus, Trash2, FileStack, FlaskConical, FileDown,
  Crosshair, FolderOpen, ArrowLeft, AlertTriangle, RotateCw,
} from 'lucide-react';
import { calculateSteelSurfaceArea } from '@/lib/steelShapeMath';
import { SHAPE_CLASSES, getShapeClass } from '@/data/steelShapeSelector';
import { exportRequisitionToPdf } from '@/lib/requisitionPdfExport';
import { writeBidRecapCells, downloadWorkbook } from '@/lib/bidRecapXlsxExport';
import { buildBidRecapWrites } from '@/lib/bidRecapMapping';
import BlueprintCanvas from '@/components/estimating/BlueprintCanvas';

const COATING_TYPES = ['No Coating', 'Paint', 'Galvanized'];

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
  const [takeoffId, setTakeoffId] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [excelExportError, setExcelExportError] = useState(null);
  const [takeoffName, setTakeoffName] = useState('');
  const [hasStoredPdf, setHasStoredPdf] = useState(false);
  const fileInputRef = useRef(null);
  const reattachInputRef = useRef(null);
  const activePdfUrlRef = useRef(null);

  useEffect(() => {
    db.entities.steel_catalog.list('size_designation', 1000).then(setCatalog).catch(() => setCatalog([]));
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
        if (t.project_id) {
          const project = await db.entities.Project.get(t.project_id).catch(() => null);
          linkedLabel = project?.name || '';
        } else if (t.bid_id) {
          const linkedBid = await db.entities.Bid.get(t.bid_id).catch(() => null);
          linkedLabel = linkedBid?.job_name || (linkedBid?.bid_number ? `Bid ${linkedBid.bid_number}` : '');
        }
        return { ...t, _linkedLabel: linkedLabel };
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
      const created = await db.entities.blueprint_takeoffs.create({
        company_id: user?.company_id,
        bid_id: bidId || undefined,
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

      try {
        await savePdf(created.id, file);
        await db.entities.blueprint_takeoffs.update(created.id, { has_stored_pdf: true });
        setHasStoredPdf(true);
      } catch (e) {
        console.error('Failed to store PDF for offline resume', e);
        setHasStoredPdf(false);
        setNewSessionError('This session was created, but the PDF could not be stored on this device — reopening it later will restore measurements only, not the drawing.');
      }

      setNewTakeoffName('');
      setMode('workspace');
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

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

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

  return (
    <div className="p-6 w-full max-w-none space-y-4 animate-fade-in">
      <PageHeader
        title="IRONSIGHT"
        subtitle="Drawing takeoff and measurement"
        icon={Crosshair}
        actions={mode === 'workspace' ? (
          <Button variant="outline" size="sm" onClick={handleBackToSessions}>
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />Back to sessions
          </Button>
        ) : undefined}
      />

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
                          <p className="font-semibold truncate">{s.takeoff_name || s.file_name || 'Untitled takeoff'}</p>
                          {s._linkedLabel && <p className="text-xs text-primary truncate">{s._linkedLabel}</p>}
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

          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Drawing scale (e.g. 1/4in = 1ft)" value={scaleReference} onChange={(e) => setScaleReference(e.target.value)} className="w-64" />
          </div>

          {/* Visual PDF viewer only — no measurement tools yet (phase 2). Only
              rendered for actual PDF uploads; image uploads have nothing for
              pdfjs to open. */}
          {fileUrl && /\.pdf$/i.test(fileName || '') && <BlueprintCanvas source={fileUrl} />}

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
                      <th className="p-2 font-medium w-24">Total Wt (lb)</th>
                      <th className="p-2 font-medium w-10"></th>
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
                          <td className="p-2 text-xs font-medium">{rowWeight.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className="p-2">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeRow(r._key)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/30 font-semibold">
                      <td colSpan={11} className="p-2 text-right">Job Totals ({acceptedRows.length} accepted)</td>
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
          )}
        </>
      )}
    </div>
  );
}
