import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { db } from '@/api/apiClient';
import {
  getStationBottlenecks, getStationDwellVariance, getStalePieces, computeEfficiencyPct,
  getCapacityStatus, STATIONS, stationName, HEATMAP_COLOR, normalizeTargetMinutes,
} from '@/lib/shopOpsMetrics';
import { matchPieceByScan } from '@/lib/pieceScan';
import CameraQrScanner, { useIsTouchPrimaryDevice } from '@/components/shared/CameraQrScanner';
import { workflowStatusLabel } from '@/lib/pieceWorkflowStatus';
import { pieceEventLabel } from '@/lib/pieceTimeline';
import PieceTimeline from '@/components/shared/PieceTimeline';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle, Clock, Gauge, CheckCircle2, ScanLine, PauseCircle, PlayCircle, ClipboardCheck, Camera } from 'lucide-react';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';

const REFRESH_INTERVAL_MS = 45000;

// Matches ShopFabrication.jsx's SHIFT_END_HOUR=17 fail-safe convention — this
// app has no real shift-scheduling entity, so "current shift" here is a
// presentational label derived from the same single day-shift cutoff, not a
// stored schedule.
const SHIFT_END_HOUR = 17;
const currentShiftLabel = (now) => (now.getHours() < SHIFT_END_HOUR ? '1st Shift' : '2nd Shift');

export default function ShopFloorCommandCenter() {
  useDocumentTitle('SteelOS — Shop Floor Command Center');
  const { toast } = useToast();
  const [pieces, setPieces] = useState([]);
  const [stationLogs, setStationLogs] = useState([]);
  const [pieceProductionLogs, setPieceProductionLogs] = useState([]);
  const [timingEvents, setTimingEvents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [detailStation, setDetailStation] = useState(null);
  const [detailPiece, setDetailPiece] = useState(null);
  const [detailTimingEvent, setDetailTimingEvent] = useState(null);

  // Who's operating the scan station right now — plain text, same
  // "type your employee ID" convention as ShopFabrication.jsx's tablet, not
  // a real login (this page has no auth-per-station concept).
  const [employeeId, setEmployeeId] = useState('');
  const [stationScanValue, setStationScanValue] = useState('');
  const [stationTargetMinutesInput, setStationTargetMinutesInput] = useState('');

  // Out-of-sequence confirmation gate (cross-phase, or a second station
  // clock left running elsewhere) — { piece, stationId, reasonText }.
  const [pendingScan, setPendingScan] = useState(null);
  const [confirmNote, setConfirmNote] = useState('');
  const [confirmingScan, setConfirmingScan] = useState(false);

  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const touchPrimary = useIsTouchPrimaryDevice();

  const loadAll = async () => {
    try {
      const [pieceData, logsData, pplData, timingData, projectData, settingsRows] = await Promise.all([
        db.entities.pieces.list('-created_date', 500),
        db.entities.station_logs.list('-created_date', 500),
        db.entities.piece_production_logs.filter({ status: 'Complete' }, '-created_date', 1000),
        db.entities.piece_timing_events.list('-scanned_at', 500),
        db.entities.Project.filter({ is_archived: false }, 'name', 200),
        db.entities.SystemSetting.filter({ setting_group: 'production' }, '-created_date', 1),
      ]);
      setPieces(pieceData);
      setStationLogs(logsData);
      setPieceProductionLogs(pplData);
      setTimingEvents(timingData);
      setProjects(projectData);
      setSettings(settingsRows[0] || null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    const dataTimer = setInterval(loadAll, REFRESH_INTERVAL_MS);
    const clockTimer = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(dataTimer); clearInterval(clockTimer); };
  }, []);

  useEffect(() => {
    db.auth.me().then((me) => setCurrentUser(me || null)).catch(() => setCurrentUser(null));
    getEffectiveCompany()
      .then((company) => setModuleAllowed(hasModule(company, '/shop-floor-command-center')))
      .catch(() => setModuleAllowed(false))
      .finally(() => setCheckingModuleAccess(false));
  }, []);

  const bottleneckThreshold = settings?.station_bottleneck_threshold || 50;
  const dwellThresholdPct = settings?.station_dwell_bottleneck_threshold_pct || 25;
  const staleHours = settings?.stale_piece_alert_hours || 8;

  const headcountBottlenecks = useMemo(() => getStationBottlenecks(pieces, bottleneckThreshold), [pieces, bottleneckThreshold]);
  const stationSignals = useMemo(
    () => getStationDwellVariance(stationLogs, pieces, pieceProductionLogs, headcountBottlenecks, dwellThresholdPct),
    [stationLogs, pieces, pieceProductionLogs, headcountBottlenecks, dwellThresholdPct]
  );
  const stalePieces = useMemo(() => getStalePieces(stationLogs, staleHours, now), [stationLogs, staleHours, now]);
  const inspectorQueuePieces = useMemo(() => pieces.filter((p) => p.workflow_status === 'Inspector_Queue'), [pieces]);
  const inspectorQueueRef = useRef(null);

  const recentCompletions = useMemo(() => {
    return stationLogs
      .filter((log) => log.status === 'Complete' && log.end_time)
      .sort((a, b) => new Date(b.end_time) - new Date(a.end_time))
      .slice(0, 10);
  }, [stationLogs]);

  const todaysEfficiency = useMemo(() => {
    const todayKey = now.toDateString();
    const todaysLogs = pieceProductionLogs.filter((log) => log.end_time && new Date(log.end_time).toDateString() === todayKey);
    // actualMinutes/targetMinutes only accumulate over pieces that HAVE a
    // target — a piece with no target contributes to missingTarget instead,
    // so its real elapsed time never drags the ratio down against a target
    // sum that doesn't include it (see shopOpsMetrics.js computeEfficiencyPct).
    const totals = todaysLogs.reduce((acc, log) => {
      const target = normalizeTargetMinutes(log.target_minutes);
      if (target == null) {
        acc.missingTarget += 1;
      } else {
        acc.actualMinutes += log.elapsed_minutes || 0;
        acc.targetMinutes += target;
      }
      return acc;
    }, { actualMinutes: 0, targetMinutes: 0, missingTarget: 0 });
    return { ...totals, pieces: todaysLogs.length, efficiencyPct: computeEfficiencyPct(totals.actualMinutes, totals.targetMinutes) };
  }, [pieceProductionLogs, now]);

  // Reuses the exact Green<=85% / Yellow 86-100% / Red>100% tiering already
  // established by getCapacityStatus for the capacity heatmap, fed the worse
  // of the two bottleneck signals' pct-of-threshold — rather than inventing a
  // second color-tiering rule for this screen.
  const stationHeatmapStatus = (s) => {
    const headcountPct = bottleneckThreshold > 0 ? (s.count / bottleneckThreshold) * 100 : 0;
    const dwellPct = dwellThresholdPct > 0 && s.dwellVariancePct != null ? (s.dwellVariancePct / dwellThresholdPct) * 100 : 0;
    return getCapacityStatus(Math.max(headcountPct, dwellPct), 100);
  };

  const projectName = (id) => projects.find((p) => p.id === id)?.name || 'Unassigned';
  const pieceById = (id) => pieces.find((p) => p.id === id);

  // The one place a scan actually writes a timing record — start (no open
  // session at this station) or complete (an open session exists) against
  // station_logs (the app's existing dwell/efficiency source of truth),
  // additive to a piece_timing_events row for the scan audit trail. `note`/
  // `isOverride` are only ever set by confirmPendingScan below.
  const recordScanEvent = async ({ piece, stationId, note = '', isOverride = false }) => {
    const nowIso = new Date().toISOString();
    const openHere = stationLogs.find((l) => l.piece_id === piece.id && Number(l.station_id) === Number(stationId) && l.status === 'In_Progress');

    if (!openHere) {
      const targetMinutes = normalizeTargetMinutes(stationTargetMinutesInput);
      const log = await db.entities.station_logs.create({
        piece_id: piece.id, employee_id: employeeId || 'Unknown', station_id: stationId,
        status: 'In_Progress', start_time: nowIso, elapsed_minutes: 0, auto_paused: false,
      });
      await db.entities.piece_timing_events.create({
        company_id: piece.company_id, piece_id: piece.id, station_id: stationId, station_log_id: log.id,
        event_type: 'start', scanned_by: employeeId || 'Unknown', scanned_at: nowIso,
        target_minutes: targetMinutes, is_override: isOverride, notes: note,
      });
      toast({ title: `Clock started — ${piece.piece_mark} at ${stationName(stationId)}` });
    } else {
      const elapsedMinutes = Math.max(1, Math.round((new Date(nowIso).getTime() - new Date(openHere.start_time).getTime()) / 60000));
      await db.entities.station_logs.update(openHere.id, { status: 'Complete', end_time: nowIso, elapsed_minutes: elapsedMinutes, auto_paused: false });
      // Target minutes were captured on the start/resume event that opened
      // this session — read it back via the explicit station_log_id FK
      // rather than re-deriving it from timestamps or free-text piece_mark.
      const startEvent = timingEvents.find((e) => e.station_log_id === openHere.id && (e.event_type === 'start' || e.event_type === 'resume'));
      const targetMinutes = normalizeTargetMinutes(startEvent?.target_minutes);
      const efficiencyPct = computeEfficiencyPct(elapsedMinutes, targetMinutes);
      const varianceMinutes = targetMinutes != null ? elapsedMinutes - targetMinutes : null;
      await db.entities.piece_timing_events.create({
        company_id: piece.company_id, piece_id: piece.id, station_id: stationId, station_log_id: openHere.id,
        event_type: 'complete', scanned_by: employeeId || 'Unknown', scanned_at: nowIso,
        target_minutes: targetMinutes, elapsed_minutes: elapsedMinutes, is_override: isOverride, notes: note,
      });
      toast({
        title: `Completed — ${piece.piece_mark} at ${stationName(stationId)}`,
        description: efficiencyPct != null
          ? `${elapsedMinutes}m • ${efficiencyPct}% efficiency (${varianceMinutes > 0 ? '+' : ''}${varianceMinutes}m vs target)`
          : `${elapsedMinutes}m • No target set`,
      });
    }
    await loadAll();
  };

  const handleHoldLog = async (log) => {
    const nowIso = new Date().toISOString();
    const elapsedMinutes = Math.max(1, Math.round((new Date(nowIso).getTime() - new Date(log.start_time).getTime()) / 60000));
    await db.entities.station_logs.update(log.id, { status: 'Paused', end_time: nowIso, elapsed_minutes: elapsedMinutes, auto_paused: false });
    const piece = pieceById(log.piece_id);
    await db.entities.piece_timing_events.create({
      company_id: piece?.company_id, piece_id: log.piece_id, station_id: log.station_id, station_log_id: log.id,
      event_type: 'hold', scanned_by: employeeId || 'Unknown', scanned_at: nowIso, elapsed_minutes: elapsedMinutes, notes: '',
    });
    toast({ title: 'Timer held' });
    await loadAll();
  };

  const handleResumePiece = async (piece, stationId) => {
    const nowIso = new Date().toISOString();
    // Carries the original target forward across the hold/resume gap so a
    // pause doesn't erase the efficiency math for the eventual completion.
    const priorStart = [...timingEvents]
      .filter((e) => e.piece_id === piece.id && Number(e.station_id) === Number(stationId) && (e.event_type === 'start' || e.event_type === 'resume'))
      .sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at))[0];
    const log = await db.entities.station_logs.create({
      piece_id: piece.id, employee_id: employeeId || 'Unknown', station_id: stationId,
      status: 'In_Progress', start_time: nowIso, elapsed_minutes: 0, auto_paused: false,
    });
    await db.entities.piece_timing_events.create({
      company_id: piece.company_id, piece_id: piece.id, station_id: stationId, station_log_id: log.id,
      event_type: 'resume', scanned_by: employeeId || 'Unknown', scanned_at: nowIso,
      target_minutes: normalizeTargetMinutes(priorStart?.target_minutes), notes: '',
    });
    toast({ title: 'Timer resumed' });
    await loadAll();
  };

  // Scan resolution: explicit FK match against the piece's own
  // qr_payload_string/piece_mark (matchPieceByScan — the same
  // case-insensitive matcher JobsiteReceiving.jsx uses), never an inferred
  // cross-entity string join. Cross-phase (piece.current_station_id doesn't
  // match the station being scanned) and "another station's clock is still
  // running" are both wrong-order conditions that gate on confirmation
  // rather than recording silently.
  const handleStationScan = async (stationId, valueOverride) => {
    const value = (valueOverride ?? stationScanValue).trim();
    if (!value) return;
    const { piece, ambiguous } = matchPieceByScan(pieces, value);
    if (ambiguous) {
      toast({ title: 'Multiple pieces match that piece mark', description: 'This piece mark exists on more than one project — scan the QR code instead of typing the piece mark.', variant: 'destructive' });
      return;
    }
    if (!piece) {
      toast({ title: 'No matching piece found', variant: 'destructive' });
      return;
    }

    const openElsewhere = stationLogs.find((l) => l.piece_id === piece.id && l.status === 'In_Progress' && Number(l.station_id) !== Number(stationId));
    const isCrossPhase = Number(piece.current_station_id) !== Number(stationId);

    if (isCrossPhase) {
      // Same hint pattern as JobsiteReceiving.jsx's handlePhaseScan — tell
      // the operator where the piece actually belongs instead of silently
      // rejecting or silently recording at the wrong station.
      toast({ title: `${piece.piece_mark} is currently at ${stationName(piece.current_station_id)} — scan there instead`, variant: 'destructive' });
    }

    if (isCrossPhase || openElsewhere) {
      const reasonText = openElsewhere
        ? `${piece.piece_mark} still has an unfinished timer running at ${stationName(openElsewhere.station_id)}. Recording this scan at ${stationName(stationId)} anyway will leave that timer open.`
        : `${piece.piece_mark}'s station on file is ${stationName(piece.current_station_id)}, not ${stationName(stationId)}.`;
      setPendingScan({ piece, stationId, reasonText });
      setConfirmNote('');
      setStationScanValue('');
      return;
    }

    await recordScanEvent({ piece, stationId });
    setStationScanValue('');
    setStationTargetMinutesInput('');
  };

  const handleCameraScan = (decodedText) => {
    setShowCameraScanner(false);
    setStationScanValue(decodedText);
    if (detailStation) handleStationScan(detailStation.stationId, decodedText);
  };

  const confirmPendingScan = async () => {
    if (!pendingScan || confirmNote.trim().length < 10) return;
    setConfirmingScan(true);
    try {
      await recordScanEvent({ piece: pendingScan.piece, stationId: pendingScan.stationId, note: confirmNote.trim(), isOverride: true });
      setPendingScan(null);
      setConfirmNote('');
      setStationTargetMinutesInput('');
    } finally {
      setConfirmingScan(false);
    }
  };

  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  const showModule = moduleAllowed || isPlatformOperatorView;

  if (loading || checkingModuleAccess) return <div className="p-6 bg-black min-h-screen"><div className="h-96 bg-neutral-800 rounded-xl animate-pulse" /></div>;

  // Route guard — a direct URL to /shop-floor-command-center can't bypass
  // the nav's module-pack filtering. This is Fabricator + Enterprise Connect
  // only (see modulePacks.js); an Erector-pack company has no shop floor to
  // display here, so none of this applies to them.
  if (!showModule) {
    return <ModuleLocked modulePath="/shop-floor-command-center" title="Shop Floor Command Center Not Included" />;
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 space-y-5">
      {/* Top strip */}
      <div className="flex items-center justify-between border-b border-neutral-700 pb-4">
        <div>
          <p className="text-2xl font-bold">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <p className="text-lg text-neutral-400">{currentShiftLabel(now)}</p>
        </div>
        <div className="flex items-center gap-3">
          <Clock className="w-8 h-8 text-primary" />
          <p className="text-5xl font-mono font-bold tabular-nums">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
        </div>
      </div>

      {/* Per-station tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {STATIONS.map((station) => {
          const signal = stationSignals.find((s) => s.stationId === station.id) || { stationId: station.id, count: 0, avgActualMinutes: null, isBottleneck: false, signal: 'None' };
          const status = stationHeatmapStatus(signal);
          return (
            <button
              key={station.id}
              onClick={() => { setDetailStation(signal); setStationScanValue(''); setStationTargetMinutesInput(''); }}
              className={`rounded-2xl border-2 p-4 text-center transition-colors ${HEATMAP_COLOR[status]} ${status === 'Red' ? 'border-red-500 animate-pulse' : status === 'Yellow' ? 'border-yellow-500' : 'border-green-600'}`}
            >
              <p className="text-sm font-semibold uppercase tracking-wide">{station.name}</p>
              <p className="text-4xl font-bold mt-2">{signal.count}</p>
              <p className="text-xs mt-1 opacity-80">pieces at station</p>
              <p className="text-lg font-semibold mt-2">{signal.avgActualMinutes != null ? `${signal.avgActualMinutes.toFixed(0)}m avg dwell` : 'No dwell data'}</p>
            </button>
          );
        })}
        <button
          onClick={() => inspectorQueueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className={`rounded-2xl border-2 p-4 text-center transition-colors ${inspectorQueuePieces.length > 0 ? HEATMAP_COLOR.Yellow : HEATMAP_COLOR.Green} ${inspectorQueuePieces.length > 0 ? 'border-yellow-500' : 'border-green-600'}`}
        >
          <p className="text-sm font-semibold uppercase tracking-wide">Waiting for Inspection</p>
          <p className="text-4xl font-bold mt-2">{inspectorQueuePieces.length}</p>
          <p className="text-xs mt-1 opacity-80">pieces queued</p>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent completions */}
        <div className="lg:col-span-2 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-500" />Recent Completions</h3>
          {recentCompletions.length === 0 ? (
            <p className="text-neutral-500 py-6 text-center">No completions logged yet.</p>
          ) : (
            <div className="space-y-1.5">
              {recentCompletions.map((log) => {
                const piece = pieceById(log.piece_id);
                return (
                  <button
                    key={log.id}
                    onClick={() => setDetailPiece(piece || null)}
                    disabled={!piece}
                    className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-neutral-800 transition-colors disabled:cursor-default"
                  >
                    <span className="font-medium">{piece?.piece_mark || log.piece_id}</span>
                    <span className="text-neutral-400">{stationName(log.station_id)}</span>
                    <span className="font-mono text-neutral-300">{log.elapsed_minutes || 0}m</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Shop-wide efficiency */}
        <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-4 flex flex-col items-center justify-center">
          <Gauge className="w-6 h-6 text-primary mb-2" />
          <p className="text-sm uppercase tracking-wide text-neutral-400">Today's Efficiency</p>
          <p className={`text-4xl md:text-6xl font-bold mt-2 ${todaysEfficiency.efficiencyPct == null ? 'text-neutral-500' : todaysEfficiency.efficiencyPct >= 100 ? 'text-emerald-500' : todaysEfficiency.efficiencyPct >= 85 ? 'text-amber-500' : 'text-red-500'}`}>
            {todaysEfficiency.pieces === 0 ? '—' : todaysEfficiency.efficiencyPct != null ? `${todaysEfficiency.efficiencyPct}%` : 'No target set'}
          </p>
          <p className="text-xs text-neutral-500 mt-2">
            {todaysEfficiency.pieces} piece{todaysEfficiency.pieces === 1 ? '' : 's'} completed today
            {todaysEfficiency.missingTarget > 0 ? ` (${todaysEfficiency.missingTarget} missing target)` : ''}
          </p>
        </div>
      </div>

      {/* Stale pieces */}
      <div className="rounded-xl border-2 border-yellow-600/60 bg-yellow-950/30 p-4">
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-yellow-400"><AlertTriangle className="w-5 h-5" />Stale Pieces (&gt; {staleHours}h)</h3>
        {stalePieces.length === 0 ? (
          <p className="text-neutral-500 py-4 text-center">No stale punches right now.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {stalePieces.map((log) => {
              const piece = pieceById(log.piece_id);
              return (
                <button
                  key={log.id}
                  onClick={() => setDetailPiece(piece || null)}
                  disabled={!piece}
                  className="flex items-center justify-between rounded-lg border border-yellow-600/40 bg-black/30 px-3 py-2 text-left hover:bg-black/50 transition-colors disabled:cursor-default"
                >
                  <span className="font-medium">{piece?.piece_mark || log.piece_id}</span>
                  <span className="text-neutral-400">{stationName(log.station_id)}</span>
                  <span className="text-yellow-400 text-sm">{log.status}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Awaiting inspection — target of the "Waiting for Inspection" stat tile above. */}
      <div ref={inspectorQueueRef} className="rounded-xl border-2 border-blue-600/60 bg-blue-950/30 p-4">
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-blue-400"><ClipboardCheck className="w-5 h-5" />Waiting for Inspection ({inspectorQueuePieces.length})</h3>
        {inspectorQueuePieces.length === 0 ? (
          <p className="text-neutral-500 py-4 text-center">No pieces queued for inspection right now.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {inspectorQueuePieces.map((piece) => (
              <button
                key={piece.id}
                onClick={() => setDetailPiece(piece)}
                className="flex items-center justify-between rounded-lg border border-blue-600/40 bg-black/30 px-3 py-2 text-left hover:bg-black/50 transition-colors"
              >
                <span className="font-medium">{piece.piece_mark}</span>
                <span className="text-neutral-400">{stationName(piece.current_station_id)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Recent scan-driven timing events — the audit trail requested
          alongside station_logs; every row is clickable to full detail. */}
      <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-4">
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><ScanLine className="w-5 h-5 text-primary" />Recent Scan Events</h3>
        {timingEvents.length === 0 ? (
          <p className="text-neutral-500 py-6 text-center">No scan events recorded yet.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {timingEvents.slice(0, 20).map((event) => {
              const piece = pieceById(event.piece_id);
              return (
                <button
                  key={event.id}
                  onClick={() => setDetailTimingEvent(event)}
                  className="w-full flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-neutral-800 transition-colors"
                >
                  <span className="font-medium">{piece?.piece_mark || event.piece_id}</span>
                  <span className="text-neutral-400">{event.station_id != null ? stationName(event.station_id) : '—'}</span>
                  <span className={`text-xs font-semibold uppercase ${
                    event.event_type === 'complete' || event.event_type === 'inspection_pass' ? 'text-green-400'
                    : event.event_type === 'hold' ? 'text-yellow-400'
                    : event.event_type === 'inspection_fail' ? 'text-red-400'
                    : 'text-blue-400'
                  }`}>
                    {pieceEventLabel(event.event_type)}{event.is_override ? ' ⚠' : ''}
                  </span>
                  <span className="text-neutral-500 text-xs">{new Date(event.scanned_at).toLocaleTimeString()}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Station detail dialog */}
      <Dialog open={!!detailStation} onOpenChange={(open) => { if (!open) { setDetailStation(null); setStationScanValue(''); setStationTargetMinutesInput(''); } }}>
        <DialogContent className="bg-neutral-900 text-white border-neutral-700 max-h-[80vh] overflow-y-auto">
          {detailStation && (
            <>
              <DialogHeader><DialogTitle>{stationName(detailStation.stationId)} — Station Detail</DialogTitle></DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="space-y-2 border-b border-neutral-700 pb-3">
                  <Label className="text-xs text-neutral-400">Scanned By (Employee ID)</Label>
                  <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="EMP-101" className="bg-neutral-800 border-neutral-700 text-white" />
                  {touchPrimary && (
                    <Button size="lg" className="w-full gap-2 steel-gradient text-white border-0" onClick={() => setShowCameraScanner(true)}>
                      <Camera className="w-5 h-5" />Scan with Camera
                    </Button>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      value={stationScanValue}
                      onChange={(e) => setStationScanValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleStationScan(detailStation.stationId)}
                      placeholder="Scan QR payload or enter piece mark"
                      className="bg-neutral-800 border-neutral-700 text-white flex-1"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={stationTargetMinutesInput}
                      onChange={(e) => setStationTargetMinutesInput(e.target.value)}
                      placeholder="Target min (optional)"
                      className="bg-neutral-800 border-neutral-700 text-white sm:w-40"
                    />
                    <Button onClick={() => handleStationScan(detailStation.stationId)} className="steel-gradient text-white border-0">Scan</Button>
                    {!touchPrimary && (
                      <Button variant="outline" className="border-neutral-600 gap-2" onClick={() => setShowCameraScanner(true)}>
                        <Camera className="w-4 h-4" />Camera
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-500">Scanning starts this station's clock for a piece; scanning it again here completes it.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-xs text-neutral-500">Pieces at Station</p><p className="text-lg font-semibold">{detailStation.count}</p></div>
                  <div><p className="text-xs text-neutral-500">Signal</p><p className="text-lg font-semibold">{detailStation.signal}</p></div>
                  <div><p className="text-xs text-neutral-500">Avg Actual Dwell</p><p className="font-medium">{detailStation.avgActualMinutes != null ? `${detailStation.avgActualMinutes.toFixed(0)} min` : '—'}</p></div>
                  <div><p className="text-xs text-neutral-500">Avg Target</p><p className="font-medium">{detailStation.avgTargetMinutes != null ? `${detailStation.avgTargetMinutes.toFixed(0)} min` : 'No target data'}</p></div>
                </div>
                <div className="pt-2">
                  <p className="text-xs text-neutral-500 mb-1">Pieces Currently At This Station</p>
                  {pieces.filter((p) => Number(p.current_station_id) === detailStation.stationId).length === 0 ? (
                    <p className="text-neutral-500 py-3 text-center">No pieces at this station.</p>
                  ) : (
                    <div className="space-y-1">
                      {pieces.filter((p) => Number(p.current_station_id) === detailStation.stationId).map((p) => {
                        const openLog = stationLogs.find((l) => l.piece_id === p.id && Number(l.station_id) === detailStation.stationId && l.status === 'In_Progress');
                        const pausedLog = stationLogs
                          .filter((l) => l.piece_id === p.id && Number(l.station_id) === detailStation.stationId && l.status === 'Paused')
                          .sort((a, b) => new Date(b.end_time) - new Date(a.end_time))[0];
                        return (
                          <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-neutral-800 transition-colors">
                            <button onClick={() => { setDetailPiece(p); setDetailStation(null); }} className="flex-1 text-left">
                              <span className="font-medium">{p.piece_mark}</span>
                              <span className="text-neutral-400 text-xs block">
                                {workflowStatusLabel(p.workflow_status)}{openLog ? ' • Running' : pausedLog ? ' • Held' : ''}
                              </span>
                            </button>
                            {openLog && (
                              <Button size="sm" variant="outline" className="border-neutral-600 gap-1.5 flex-shrink-0" onClick={() => handleHoldLog(openLog)}>
                                <PauseCircle className="w-3.5 h-3.5" />Hold
                              </Button>
                            )}
                            {!openLog && pausedLog && (
                              <Button size="sm" variant="outline" className="border-neutral-600 gap-1.5 flex-shrink-0" onClick={() => handleResumePiece(p, detailStation.stationId)}>
                                <PlayCircle className="w-3.5 h-3.5" />Resume
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" className="border-neutral-600" onClick={() => setDetailStation(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Piece detail dialog */}
      <Dialog open={!!detailPiece} onOpenChange={(open) => !open && setDetailPiece(null)}>
        <DialogContent className="bg-neutral-900 text-white border-neutral-700">
          {detailPiece && (
            <>
              <DialogHeader><DialogTitle>{detailPiece.piece_mark}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-neutral-500">Project</p><p className="font-medium">{projectName(detailPiece.project_id)}</p></div>
                <div><p className="text-xs text-neutral-500">Current Station</p><p className="font-medium">{stationName(detailPiece.current_station_id)}</p></div>
                <div><p className="text-xs text-neutral-500">Material Shape</p><p className="font-medium">{detailPiece.material_shape || '—'}</p></div>
                <div><p className="text-xs text-neutral-500">Dimensions</p><p className="font-medium">{detailPiece.dimensions || '—'}</p></div>
                <div><p className="text-xs text-neutral-500">Weight</p><p className="font-medium">{detailPiece.weight ? `${detailPiece.weight} lbs` : '—'}</p></div>
                <div><p className="text-xs text-neutral-500">Workflow Status</p><p className="font-medium">{detailPiece.workflow_status ? workflowStatusLabel(detailPiece.workflow_status) : '—'}</p></div>
                <div><p className="text-xs text-neutral-500">Field Status</p><p className="font-medium">{detailPiece.field_status?.replace(/_/g, ' ') || '—'}</p></div>
              </div>
              <PieceTimeline pieceId={detailPiece.id} className="border-t border-neutral-700 pt-3 [&_.border-l-2]:border-neutral-700" />
              <DialogFooter>
                <Button variant="outline" className="border-neutral-600" onClick={() => setDetailPiece(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Timing event detail dialog — standing rule: every data point is
          clickable to its full detail. */}
      <Dialog open={!!detailTimingEvent} onOpenChange={(open) => !open && setDetailTimingEvent(null)}>
        <DialogContent className="bg-neutral-900 text-white border-neutral-700">
          {detailTimingEvent && (() => {
            const piece = pieceById(detailTimingEvent.piece_id);
            const targetMinutes = normalizeTargetMinutes(detailTimingEvent.target_minutes);
            const isComplete = detailTimingEvent.event_type === 'complete';
            const efficiencyPct = isComplete ? computeEfficiencyPct(detailTimingEvent.elapsed_minutes, targetMinutes) : null;
            const varianceMinutes = isComplete && targetMinutes != null ? detailTimingEvent.elapsed_minutes - targetMinutes : null;
            return (
              <>
                <DialogHeader><DialogTitle>{piece?.piece_mark || detailTimingEvent.piece_id} — {pieceEventLabel(detailTimingEvent.event_type)}</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-neutral-500">Station</p><p className="font-medium">{detailTimingEvent.station_id != null ? stationName(detailTimingEvent.station_id) : '—'}</p></div>
                  <div><p className="text-xs text-neutral-500">Scanned By</p><p className="font-medium">{detailTimingEvent.scanned_by}</p></div>
                  <div><p className="text-xs text-neutral-500">Scanned At</p><p className="font-medium">{new Date(detailTimingEvent.scanned_at).toLocaleString()}</p></div>
                  <div><p className="text-xs text-neutral-500">Out-of-Sequence</p><p className="font-medium">{detailTimingEvent.is_override ? 'Yes' : 'No'}</p></div>
                  {isComplete && (
                    <>
                      <div><p className="text-xs text-neutral-500">Elapsed</p><p className="font-medium">{detailTimingEvent.elapsed_minutes} min</p></div>
                      <div><p className="text-xs text-neutral-500">Target</p><p className="font-medium">{targetMinutes != null ? `${targetMinutes} min` : 'No target set'}</p></div>
                      <div><p className="text-xs text-neutral-500">Efficiency</p><p className="font-medium">{efficiencyPct != null ? `${efficiencyPct}%` : 'No target set'}</p></div>
                      <div><p className="text-xs text-neutral-500">Variance</p><p className="font-medium">{varianceMinutes != null ? `${varianceMinutes > 0 ? '+' : ''}${varianceMinutes} min` : 'No target set'}</p></div>
                    </>
                  )}
                  {detailTimingEvent.event_type === 'start' && (
                    <div><p className="text-xs text-neutral-500">Target</p><p className="font-medium">{targetMinutes != null ? `${targetMinutes} min` : 'No target set'}</p></div>
                  )}
                </div>
                {detailTimingEvent.notes && (
                  <div className="pt-1">
                    <p className="text-xs text-neutral-500 mb-1">Notes</p>
                    <p className="text-sm whitespace-pre-wrap">{detailTimingEvent.notes}</p>
                  </div>
                )}
                <DialogFooter>
                  {piece && (
                    <Button variant="outline" className="border-neutral-600" onClick={() => { setDetailPiece(piece); setDetailTimingEvent(null); }}>View Piece</Button>
                  )}
                  <Button variant="outline" className="border-neutral-600" onClick={() => setDetailTimingEvent(null)}>Close</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Out-of-sequence confirmation gate — cross-phase or a second open
          station clock elsewhere. Mirrors FleetRentalRegistry.jsx's
          override-with-reason pattern rather than a silent recording. */}
      <Dialog open={!!pendingScan} onOpenChange={(open) => { if (!open) { setPendingScan(null); setConfirmNote(''); } }}>
        <DialogContent className="bg-neutral-900 text-white border-neutral-700">
          <DialogHeader><DialogTitle>Confirm Out-of-Sequence Scan</DialogTitle></DialogHeader>
          <p className="text-sm text-neutral-300">{pendingScan?.reasonText}</p>
          <div>
            <Label className="text-xs text-neutral-400">Reason (required, min 10 characters)</Label>
            <Textarea
              rows={3}
              value={confirmNote}
              onChange={(e) => setConfirmNote(e.target.value)}
              className="bg-neutral-800 border-neutral-700 text-white mt-1"
              placeholder="Explain why this scan should be recorded out of sequence…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-neutral-600" onClick={() => { setPendingScan(null); setConfirmNote(''); }}>Cancel</Button>
            <Button
              onClick={confirmPendingScan}
              disabled={confirmNote.trim().length < 10 || confirmingScan}
              className="bg-amber-600 hover:bg-amber-700 text-white border-0"
            >
              {confirmingScan ? 'Recording…' : 'Confirm & Record Anyway'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showCameraScanner && (
        <CameraQrScanner onScan={handleCameraScan} onCancel={() => setShowCameraScanner(false)} />
      )}
    </div>
  );
}
