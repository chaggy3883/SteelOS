import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { getCertStatus } from '@/lib/certAlerts';
import { sortPiecesByPriority, hasActiveOverride } from '@/lib/shopOpsMetrics';
import { matchPieceByScan } from '@/lib/pieceScan';
import { LABEL_STOCK_SIZES, buildZplPayload } from '@/lib/zplLabels';
import PrintableLabelSheet from '@/components/barcode-printing/PrintableLabelSheet';
import { logStatusChange } from '@/lib/statusHistory';
import { workflowStatusLabel } from '@/lib/pieceWorkflowStatus';
import PieceTimeline from '@/components/shared/PieceTimeline';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';
import {
  QrCode, ScanLine, ClipboardCheck, HardHat, PlayCircle, PauseCircle,
  CheckCircle2, ArrowRightCircle, Lock, X, Stamp, AlertTriangle, Ban, Printer,
} from 'lucide-react';

const STATIONS = [
  { id: 1, name: 'Receiving' },
  { id: 2, name: 'Shot Blaster' },
  { id: 3, name: 'Iron Worker' },
  { id: 4, name: 'Drill Line' },
  { id: 5, name: 'Fab (Layout / Tack)' },
  { id: 6, name: 'Paint' },
];
const stationName = (id) => STATIONS.find((s) => s.id === Number(id))?.name || `Station ${id}`;

// Module 10 safety gate: certain shop-floor stations are "locked" behind a
// specific active (non-expired) certification. A dispatcher/fabricator can't
// punch a worker into these stations without HR having that cert on file.
const STATION_CERT_REQUIREMENTS = {
  2: 'OSHA_10',
  3: 'Rigging',
};

const assertStationCertClearance = async (employeeNumber, stationId) => {
  const requiredCert = STATION_CERT_REQUIREMENTS[Number(stationId)];
  if (!requiredCert) return { ok: true };
  const matches = await db.entities.employees.filter({ employee_number: String(employeeNumber).trim() });
  const employee = matches[0];
  if (!employee) return { ok: true }; // no HR record on file for this ID — nothing to block against
  const certs = await db.entities.employee_certifications.filter({ employee_id: employee.id, cert_type: requiredCert });
  const hasValidCert = certs.some((c) => getCertStatus(c.expiration_date) !== 'Expired');
  if (!hasValidCert) {
    return { ok: false, message: `${employee.full_name} needs a valid ${requiredCert.replace(/_/g, ' ')} certification for ${stationName(stationId)}.` };
  }
  return { ok: true };
};

// No real backend/cron exists in this app — the "shift-end fail-safe" runs as
// a client-side check on page load instead of a true midnight cron job.
const SHIFT_END_HOUR = 17;

const isPastShiftEnd = (log) => {
  if (log.status !== 'In_Progress') return false;
  return new Date(log.start_time).toDateString() !== new Date().toDateString();
};

export default function ShopFabrication() {
  const { toast } = useToast();
  const [pieces, setPieces] = useState([]);
  const [stationLogs, setStationLogs] = useState([]);
  const [qaInspections, setQaInspections] = useState([]);
  const [selectedPieceId, setSelectedPieceId] = useState(null);
  const [employeeId, setEmployeeId] = useState('EMP-101');
  const [loading, setLoading] = useState(true);
  const [scanValue, setScanValue] = useState('');
  const [showBlueprint, setShowBlueprint] = useState(false);
  const [stampCredentials, setStampCredentials] = useState('');
  const [qaNotes, setQaNotes] = useState('');
  const [schedules, setSchedules] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [printSheet, setPrintSheet] = useState(null);
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    db.auth.me().then((me) => setCurrentUser(me || null)).catch(() => setCurrentUser(null));
    getEffectiveCompany()
      .then((company) => setModuleAllowed(hasModule(company, '/shop-fabrication')))
      .catch(() => setModuleAllowed(false))
      .finally(() => setCheckingModuleAccess(false));
  }, []);

  const openPrintSheet = (piece) => {
    setPrintSheet({
      size: LABEL_STOCK_SIZES.Piece_Mark,
      title: piece.piece_mark,
      subtitle: piece.material_shape,
      qrPayload: piece.qr_payload_string,
      targetRecordId: piece.id,
    });
  };

  const handleTagPrinted = async () => {
    if (!printSheet?.targetRecordId) return;
    await db.entities.print_label_jobs.create({
      label_type: 'Piece_Mark',
      target_record_id: printSheet.targetRecordId,
      zpl_payload_string: buildZplPayload({ labelType: 'Piece_Mark', title: printSheet.title, subtitle: printSheet.subtitle, qrPayload: printSheet.qrPayload }),
      status: 'Printed',
      created_at: new Date().toISOString(),
    });
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [pieceData, logsData, qaData, scheduleData, overrideData] = await Promise.all([
        db.entities.pieces.list('-created_date', 100),
        db.entities.station_logs.list('-created_date', 100),
        db.entities.qa_inspections.list('-created_date', 100),
        db.entities.shop_schedules.list('-created_date', 200),
        db.entities.manager_overrides.list('-created_date', 200),
      ]);
      setSchedules(scheduleData);
      setOverrides(overrideData);

      const failSafeLogs = logsData.filter(isPastShiftEnd);
      let finalLogs = logsData;
      if (failSafeLogs.length > 0) {
        const fixed = await Promise.all(failSafeLogs.map((log) => {
          const started = new Date(log.start_time);
          const cutoff = new Date(started);
          cutoff.setHours(SHIFT_END_HOUR, 0, 0, 0);
          const elapsed_minutes = Math.max(0, Math.round((cutoff.getTime() - started.getTime()) / 60000));
          return db.entities.station_logs.update(log.id, {
            status: 'Paused',
            end_time: cutoff.toISOString(),
            elapsed_minutes,
            auto_paused: true,
          });
        }));
        const fixedIds = new Set(fixed.map((f) => f.id));
        finalLogs = logsData.map((log) => (fixedIds.has(log.id) ? fixed.find((f) => f.id === log.id) : log));
        toast({ title: 'Shift-end fail-safe applied', description: `${fixed.length} log(s) left running past shift end were auto-paused.` });
      }

      setPieces(pieceData);
      setStationLogs(finalLogs);
      setQaInspections(qaData);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const selectedPiece = useMemo(() => pieces.find((p) => p.id === selectedPieceId) || null, [pieces, selectedPieceId]);
  const pieceLogs = useMemo(() => stationLogs.filter((entry) => entry.piece_id === selectedPieceId), [stationLogs, selectedPieceId]);
  const activeLog = useMemo(() => pieceLogs.find((entry) => entry.status === 'In_Progress'), [pieceLogs]);
  const autoPausedLogs = useMemo(() => pieceLogs.filter((entry) => entry.status === 'Paused' && entry.auto_paused), [pieceLogs]);
  const isFrozen = selectedPiece?.workflow_status === 'Inspector_Queue';
  // Module 10b real-time priority sync: Expedite_Part overrides always sort
  // first, then each piece's project priority_weight from the Scheduler
  // Matrix — a single shared function (shopOpsMetrics.js) keeps this in sync
  // with the Scheduler Matrix UI rather than reimplementing the sort here.
  const sortedPieces = useMemo(() => sortPiecesByPriority(pieces, schedules, overrides), [pieces, schedules, overrides]);

  // Which QA stage is next for a piece: 1_Layout until it's Approved, then 2_Weld.
  const pendingStage = (piece) => {
    const layoutApproved = qaInspections.some((q) => q.piece_id === piece.id && q.stage === '1_Layout' && q.status === 'Approved');
    return layoutApproved ? '2_Weld' : '1_Layout';
  };

  // Mirrors the "Ready for Layout" / "Ready for Weld" gating below: station 5
  // is the only QA-gated station, and it's gated until whichever stage is
  // still pending is requested.
  const requiresInspectionRouting = (piece) => piece.current_station_id === 5
    && (piece.workflow_status === 'In_Fabrication' || piece.workflow_status === 'Weld_Unlocked');

  const startWork = async (pieceOverride, options = {}) => {
    const target = pieceOverride || selectedPiece;
    if (!target || target.workflow_status === 'Inspector_Queue') return { ok: false };
    const expedited = hasActiveOverride(overrides, target.id, 'Expedite_Part');
    if (!expedited) {
      const clearance = await assertStationCertClearance(employeeId, target.current_station_id);
      if (!clearance.ok) {
        toast({ title: 'Certification block', description: clearance.message, variant: 'destructive' });
        return { ok: false, message: clearance.message };
      }
    }
    const log = await db.entities.station_logs.create({
      piece_id: target.id,
      employee_id: employeeId,
      station_id: target.current_station_id,
      status: 'In_Progress',
      start_time: new Date().toISOString(),
      elapsed_minutes: 0,
      auto_paused: false,
    });
    setStationLogs((prev) => [log, ...prev]);
    await db.entities.piece_timing_events.create({
      company_id: target.company_id,
      piece_id: target.id,
      station_id: target.current_station_id,
      event_type: 'start_work',
      scanned_by: employeeId,
      scanned_at: new Date().toISOString(),
    });
    if (!options.silent) toast({ title: 'Work started' });
    return { ok: true, log };
  };

  const finishWork = async (nextStatus, logOverride, options = {}) => {
    const log = logOverride || activeLog;
    if (!log) return null;
    const endTime = new Date().toISOString();
    const elapsed_minutes = Math.max(1, Math.round((new Date(endTime).getTime() - new Date(log.start_time).getTime()) / 60000));
    const updated = await db.entities.station_logs.update(log.id, {
      status: nextStatus,
      end_time: endTime,
      elapsed_minutes,
      auto_paused: false,
    });
    setStationLogs((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    if (!options.silent) toast({ title: nextStatus === 'Paused' ? 'Timer paused' : 'Work completed' });
    return updated;
  };

  const requestInspection = async (pieceOverride, options = {}) => {
    const target = pieceOverride || selectedPiece;
    if (!target) return;
    const fromStatus = target.workflow_status;
    const updated = await db.entities.pieces.update(target.id, { workflow_status: 'Inspector_Queue' });
    setPieces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    await logStatusChange({
      entityType: 'pieces',
      entityId: target.id,
      fieldName: 'workflow_status',
      fromValue: fromStatus,
      toValue: 'Inspector_Queue',
      changedBy: employeeId,
    });
    await db.entities.piece_timing_events.create({
      company_id: target.company_id,
      piece_id: target.id,
      station_id: target.current_station_id,
      event_type: 'ready_for_inspection',
      scanned_by: employeeId,
      scanned_at: new Date().toISOString(),
      notes: `${pendingStage(target).replace('_', ' ')} inspection requested`,
    });
    if (!options.silent) toast({ title: 'Sent to Inspector Queue', description: 'Workspace frozen pending approval.' });
  };

  const handleScan = async () => {
    const { piece: found, ambiguous } = matchPieceByScan(pieces, scanValue);
    if (ambiguous) {
      toast({ title: 'Multiple pieces match that piece mark', description: 'This piece mark exists on more than one project — scan the QR code instead of typing the piece mark.', variant: 'destructive' });
      return;
    }
    if (!found) {
      toast({ title: 'Piece not found', variant: 'destructive' });
      return;
    }

    const activeLogForPiece = stationLogs.find((entry) => entry.piece_id === found.id && entry.status === 'In_Progress');

    if (activeLogForPiece) {
      // Second scan of a piece already In_Progress — finish it and route.
      setSelectedPieceId(found.id);
      await finishWork('Complete', activeLogForPiece, { silent: true });
      if (requiresInspectionRouting(found)) {
        await requestInspection(found, { silent: true });
        toast({ title: 'Sent to inspection queue', description: `${found.piece_mark} is queued for ${pendingStage(found).replace('_', ' ')} inspection.` });
      } else {
        toast({ title: 'Piece marked complete', description: `${found.piece_mark} work finished.` });
      }
      setShowBlueprint(false);
      return;
    }

    // First scan — start work immediately; only select/open the blueprint if
    // that succeeds, so a certification block never opens the blueprint or
    // starts the timer.
    const result = await startWork(found, { silent: true });
    if (!result.ok) return;
    setSelectedPieceId(found.id);
    setShowBlueprint(true);
    toast({ title: `Loaded ${found.piece_mark}`, description: 'Blueprint opened and work started.' });
  };

  const resumeWork = async (pausedLog) => {
    if (!selectedPiece) return;
    const log = await db.entities.station_logs.create({
      piece_id: selectedPiece.id,
      employee_id: employeeId,
      station_id: pausedLog?.station_id ?? selectedPiece.current_station_id,
      status: 'In_Progress',
      start_time: new Date().toISOString(),
      elapsed_minutes: 0,
      auto_paused: false,
    });
    setStationLogs((prev) => [log, ...prev]);
    toast({ title: 'Work resumed', description: 'A fresh ledger block was started.' });
  };

  const moveToStation = async (nextStationId) => {
    if (!selectedPiece || isFrozen || activeLog) return;
    const expedited = hasActiveOverride(overrides, selectedPiece.id, 'Expedite_Part');
    if (!expedited) {
      const clearance = await assertStationCertClearance(employeeId, nextStationId);
      if (!clearance.ok) {
        toast({ title: 'Certification block', description: clearance.message, variant: 'destructive' });
        return;
      }
    }
    try {
      const log = await db.entities.station_logs.create({
        piece_id: selectedPiece.id,
        employee_id: employeeId,
        station_id: nextStationId,
        status: 'In_Progress',
        start_time: new Date().toISOString(),
        elapsed_minutes: 0,
        auto_paused: false,
      });
      const updatedPiece = await db.entities.pieces.update(selectedPiece.id, { current_station_id: nextStationId });
      setStationLogs((prev) => [log, ...prev]);
      setPieces((prev) => prev.map((p) => (p.id === updatedPiece.id ? updatedPiece : p)));
      toast({ title: `Routed to ${stationName(nextStationId)}` });
    } catch (e) {
      toast({ title: 'Routing blocked', description: e.message, variant: 'destructive' });
    }
  };

  const submitInspection = async (status) => {
    if (!selectedPiece) return;
    if (!stampCredentials.trim()) {
      toast({ title: 'Digital stamp required', variant: 'destructive' });
      return;
    }
    const stage = pendingStage(selectedPiece);
    const created = await db.entities.qa_inspections.create({
      piece_id: selectedPiece.id,
      stage,
      inspector_id: employeeId,
      digital_stamp_credentials: stampCredentials.trim(),
      status,
      notes: qaNotes,
      inspected_at: new Date().toISOString(),
    });
    setQaInspections((prev) => [created, ...prev]);
    await logStatusChange({
      entityType: 'qa_inspections',
      entityId: created.id,
      fieldName: 'status',
      fromValue: null,
      toValue: status,
      changedBy: employeeId,
      note: qaNotes,
    });
    await db.entities.piece_timing_events.create({
      company_id: selectedPiece.company_id,
      piece_id: selectedPiece.id,
      station_id: selectedPiece.current_station_id,
      event_type: status === 'Approved' ? 'inspection_pass' : 'inspection_fail',
      scanned_by: employeeId,
      scanned_at: new Date().toISOString(),
      notes: qaNotes,
    });

    let nextWorkflowStatus;
    if (stage === '1_Layout') {
      nextWorkflowStatus = status === 'Approved' ? 'Weld_Unlocked' : 'In_Fabrication';
    } else {
      nextWorkflowStatus = status === 'Approved' ? 'Paint_Unlocked' : 'Weld_Unlocked';
    }
    const fromWorkflowStatus = selectedPiece.workflow_status;
    const updatedPiece = await db.entities.pieces.update(selectedPiece.id, { workflow_status: nextWorkflowStatus });
    setPieces((prev) => prev.map((p) => (p.id === updatedPiece.id ? updatedPiece : p)));
    await logStatusChange({
      entityType: 'pieces',
      entityId: selectedPiece.id,
      fieldName: 'workflow_status',
      fromValue: fromWorkflowStatus,
      toValue: nextWorkflowStatus,
      changedBy: employeeId,
      note: `${stage.replace('_', ' ')} ${status}`,
    });
    setStampCredentials('');
    setQaNotes('');
    toast({ title: `${stage.replace('_', ' ')} ${status}` });
  };

  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  const showModule = moduleAllowed || isPlatformOperatorView;

  if (loading || checkingModuleAccess) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;

  // Route guard — a direct URL to /shop-fabrication can't bypass the nav's
  // module-pack filtering. Shop-floor station scanning is Fabricator +
  // Enterprise Connect only (see modulePacks.js); an Erector-pack company
  // has no shop stations to work, so none of this applies to them.
  if (!showModule) {
    return <ModuleLocked modulePath="/shop-fabrication" title="Shop & Fabrication Not Included" />;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <PageHeader title="Shop & Fabrication" subtitle="Tablet-friendly station scanning, time tracking, and two-stage QA locks" />

      {autoPausedLogs.length > 0 && (
        <div className="steel-card p-3 border-yellow-500/30 bg-yellow-500/5 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle className="w-4 h-4 text-yellow-600" />
            <span>{autoPausedLogs.length} punch{autoPausedLogs.length > 1 ? 'es' : ''} auto-paused at shift end for this piece.</span>
          </div>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => resumeWork(autoPausedLogs[0])}>
            <PlayCircle className="w-4 h-4" />Resume Work
          </Button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="steel-card p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <QrCode className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium">QR / Piece Scan</span>
          </div>
          <div className="flex flex-col gap-2 md:flex-row">
            <Input value={scanValue} onChange={(e) => setScanValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleScan()} placeholder="Scan QR payload or enter piece mark" />
            <Button onClick={handleScan} className="steel-gradient text-white border-0">Scan</Button>
          </div>

          {selectedPiece ? (
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Active Piece</p>
                  <p className="text-lg font-semibold">{selectedPiece.piece_mark}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isFrozen && <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-600"><Lock className="w-3 h-3" />Frozen</span>}
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{stationName(selectedPiece.current_station_id)}</span>
                </div>
              </div>
              <div className="grid gap-2 text-sm md:grid-cols-2">
                <div><span className="text-muted-foreground">Material Shape</span><p className="font-medium">{selectedPiece.material_shape}</p></div>
                <div><span className="text-muted-foreground">Dimensions</span><p className="font-medium">{selectedPiece.dimensions}</p></div>
                <div><span className="text-muted-foreground">Weight</span><p className="font-medium">{selectedPiece.weight} lb</p></div>
                <div><span className="text-muted-foreground">Workflow Status</span><p className="font-medium">{workflowStatusLabel(selectedPiece.workflow_status)}</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="gap-2" onClick={() => setShowBlueprint(true)}><ScanLine className="w-4 h-4" />View Blueprint</Button>
                <Button variant="outline" className="gap-2" disabled={isFrozen || !!activeLog} onClick={() => startWork()}><PlayCircle className="w-4 h-4" />Start Work</Button>
                <Button variant="outline" className="gap-2" disabled={!activeLog} onClick={() => finishWork('Complete')}><CheckCircle2 className="w-4 h-4" />Complete</Button>
                <Button variant="outline" className="gap-2" disabled={!activeLog} onClick={() => finishWork('Paused')}><PauseCircle className="w-4 h-4" />Pause / End Shift</Button>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                {selectedPiece.current_station_id < 5 && (
                  <Button variant="outline" className="gap-2" disabled={isFrozen || !!activeLog} onClick={() => moveToStation(selectedPiece.current_station_id + 1)}>
                    <ArrowRightCircle className="w-4 h-4" />Advance to {stationName(selectedPiece.current_station_id + 1)}
                  </Button>
                )}
                {selectedPiece.current_station_id === 5 && selectedPiece.workflow_status === 'In_Fabrication' && (
                  <Button variant="outline" className="gap-2" onClick={() => requestInspection()}><ClipboardCheck className="w-4 h-4" />Ready for Layout</Button>
                )}
                {selectedPiece.current_station_id === 5 && selectedPiece.workflow_status === 'Weld_Unlocked' && (
                  <Button variant="outline" className="gap-2" onClick={() => requestInspection()}><ClipboardCheck className="w-4 h-4" />Ready for Weld</Button>
                )}
                {selectedPiece.workflow_status === 'Paint_Unlocked' && selectedPiece.current_station_id !== 6 && (
                  <Button variant="outline" className="gap-2" onClick={() => moveToStation(6)}><ArrowRightCircle className="w-4 h-4" />Route to Paint (Station 6)</Button>
                )}
                {selectedPiece.workflow_status === 'Rejected' && (
                  <span className="flex items-center gap-1 text-xs text-red-600"><Ban className="w-3.5 h-3.5" />{workflowStatusLabel('Rejected')}</span>
                )}
              </div>
              <PieceTimeline pieceId={selectedPiece.id} className="border-t border-border pt-3" />
            </div>
          ) : null}
        </div>

        <div className="steel-card p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <HardHat className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium">Two-Stage QA Inspection Gateway</span>
          </div>
          {selectedPiece && isFrozen ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{selectedPiece.piece_mark}</span> is queued for <span className="font-medium text-foreground">{pendingStage(selectedPiece).replace('_', ' ')}</span> inspection.
              </p>
              <div>
                <Label className="text-xs">Digital Stamp Credentials</Label>
                <div className="relative mt-1">
                  <Stamp className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={stampCredentials} onChange={(e) => setStampCredentials(e.target.value)} className="pl-9" placeholder="INSP-JD-4471" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea value={qaNotes} onChange={(e) => setQaNotes(e.target.value)} rows={2} placeholder="Inspection notes…" />
              </div>
              <div className="flex gap-2">
                <Button className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white border-0" onClick={() => submitInspection('Approved')}><CheckCircle2 className="w-4 h-4" />Approve</Button>
                <Button variant="outline" className="flex-1 gap-2 text-red-600 border-red-500/30 hover:bg-red-500/10" onClick={() => submitInspection('Failed')}><Ban className="w-4 h-4" />Fail</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select a piece queued for inspection to review it here. Fabricator clicks "Ready for Layout"/"Ready for Weld" to freeze the workspace and send it to this queue.</p>
          )}
          <div className="pt-2 border-t border-border">
            <Label>Employee ID</Label>
            <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1">Used as both the fabricator/employee ID and the inspector ID when acting on this tablet.</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="logs">
        <TabsList className="mb-3">
          <TabsTrigger value="logs">Work Logs</TabsTrigger>
          <TabsTrigger value="qa">QA Queue</TabsTrigger>
          <TabsTrigger value="pieces">Pieces</TabsTrigger>
        </TabsList>
        <TabsContent value="logs" className="space-y-3">
          {pieceLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No work logs for this piece yet.</p>
          ) : pieceLogs.map((entry) => (
            <div key={entry.id} className="steel-card p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{stationName(entry.station_id)}</span>
                <span className="text-muted-foreground">{entry.status}{entry.auto_paused ? ' (shift-end fail-safe)' : ''}</span>
              </div>
              <p className="mt-1 text-muted-foreground">Employee {entry.employee_id} • {entry.elapsed_minutes || 0} min</p>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="qa" className="space-y-3">
          {qaInspections.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No QA inspections logged yet.</p>
          ) : qaInspections.map((inspection) => (
            <div key={inspection.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <p className="font-medium">{inspection.stage.replace('_', ' ')} • {inspection.status}</p>
                <span className="text-xs text-muted-foreground font-mono">{inspection.digital_stamp_credentials}</span>
              </div>
              <p className="text-muted-foreground">{inspection.notes}</p>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="pieces" className="space-y-3">
          {sortedPieces.map((piece) => (
            <div key={piece.id} className={`steel-card p-3 text-sm flex items-center justify-between w-full text-left transition-colors ${piece.id === selectedPieceId ? 'ring-1 ring-primary' : ''}`}>
              <div>
                <p className="font-medium flex items-center gap-1.5">
                  {piece.piece_mark}
                  {hasActiveOverride(overrides, piece.id, 'Expedite_Part') && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-700 font-semibold">EXPEDITED</span>
                  )}
                </p>
                <p className="text-muted-foreground">{piece.material_shape} • {stationName(piece.current_station_id)}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className="font-medium">{workflowStatusLabel(piece.workflow_status)}</p>
                  <p className="text-muted-foreground font-mono text-xs">{piece.qr_payload_string}</p>
                </div>
                <button
                  type="button"
                  title="Print Tracking Tag"
                  onClick={(e) => { e.stopPropagation(); openPrintSheet(piece); }}
                  className="p-1.5 rounded-md hover:bg-muted flex-shrink-0"
                >
                  <Printer className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      {showBlueprint && selectedPiece && (
        <div className="fixed inset-0 z-[100] bg-background flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
            <div>
              <h3 className="font-semibold">{selectedPiece.piece_mark} — Blueprint</h3>
              <p className="text-xs text-muted-foreground">{selectedPiece.blueprint_file_uri || 'No blueprint on file'}</p>
            </div>
            <Button size="lg" onClick={() => setShowBlueprint(false)} className="bg-red-600 hover:bg-red-700 text-white border-0 font-bold shadow-lg">
              <X className="w-5 h-5 mr-2" />Close Blueprint
            </Button>
          </div>
          <div className="flex-1 bg-muted/30">
            {selectedPiece.blueprint_file_uri ? (
              <iframe src={selectedPiece.blueprint_file_uri} title={`Blueprint for ${selectedPiece.piece_mark}`} className="w-full h-full border-0" />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">No blueprint file on record for this piece.</div>
            )}
          </div>
        </div>
      )}

      <PrintableLabelSheet
        open={!!printSheet}
        onClose={() => setPrintSheet(null)}
        onPrinted={handleTagPrinted}
        size={printSheet?.size || LABEL_STOCK_SIZES.Piece_Mark}
        title={printSheet?.title}
        subtitle={printSheet?.subtitle}
        qrPayload={printSheet?.qrPayload}
      />
    </div>
  );
}
