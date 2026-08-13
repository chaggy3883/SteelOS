import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import {
  getStationBottlenecks, getStationDwellVariance, getStalePieces, computeEfficiencyPct,
  getCapacityStatus, STATIONS, stationName, HEATMAP_COLOR, normalizeTargetMinutes,
} from '@/lib/shopOpsMetrics';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Clock, Gauge, CheckCircle2 } from 'lucide-react';

const REFRESH_INTERVAL_MS = 45000;

// Matches ShopFabrication.jsx's SHIFT_END_HOUR=17 fail-safe convention — this
// app has no real shift-scheduling entity, so "current shift" here is a
// presentational label derived from the same single day-shift cutoff, not a
// stored schedule.
const SHIFT_END_HOUR = 17;
const currentShiftLabel = (now) => (now.getHours() < SHIFT_END_HOUR ? '1st Shift' : '2nd Shift');

export default function ShopFloorCommandCenter() {
  const [pieces, setPieces] = useState([]);
  const [stationLogs, setStationLogs] = useState([]);
  const [pieceProductionLogs, setPieceProductionLogs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [detailStation, setDetailStation] = useState(null);
  const [detailPiece, setDetailPiece] = useState(null);

  const loadAll = async () => {
    try {
      const [pieceData, logsData, pplData, projectData, settingsRows] = await Promise.all([
        db.entities.pieces.list('-created_date', 500),
        db.entities.station_logs.list('-created_date', 500),
        db.entities.piece_production_logs.filter({ status: 'Complete' }, '-created_date', 1000),
        db.entities.Project.filter({ is_archived: false }, 'name', 200),
        db.entities.SystemSetting.filter({ setting_group: 'production' }, '-created_date', 1),
      ]);
      setPieces(pieceData);
      setStationLogs(logsData);
      setPieceProductionLogs(pplData);
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

  const bottleneckThreshold = settings?.station_bottleneck_threshold || 50;
  const dwellThresholdPct = settings?.station_dwell_bottleneck_threshold_pct || 25;
  const staleHours = settings?.stale_piece_alert_hours || 8;

  const headcountBottlenecks = useMemo(() => getStationBottlenecks(pieces, bottleneckThreshold), [pieces, bottleneckThreshold]);
  const stationSignals = useMemo(
    () => getStationDwellVariance(stationLogs, pieces, pieceProductionLogs, headcountBottlenecks, dwellThresholdPct),
    [stationLogs, pieces, pieceProductionLogs, headcountBottlenecks, dwellThresholdPct]
  );
  const stalePieces = useMemo(() => getStalePieces(stationLogs, staleHours, now), [stationLogs, staleHours, now]);

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

  if (loading) return <div className="p-6 bg-black min-h-screen"><div className="h-96 bg-neutral-800 rounded-xl animate-pulse" /></div>;

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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {STATIONS.map((station) => {
          const signal = stationSignals.find((s) => s.stationId === station.id) || { stationId: station.id, count: 0, avgActualMinutes: null, isBottleneck: false, signal: 'None' };
          const status = stationHeatmapStatus(signal);
          return (
            <button
              key={station.id}
              onClick={() => setDetailStation(signal)}
              className={`rounded-2xl border-2 p-4 text-center transition-colors ${HEATMAP_COLOR[status]} ${status === 'Red' ? 'border-red-500 animate-pulse' : status === 'Yellow' ? 'border-yellow-500' : 'border-green-600'}`}
            >
              <p className="text-sm font-semibold uppercase tracking-wide">{station.name}</p>
              <p className="text-4xl font-bold mt-2">{signal.count}</p>
              <p className="text-xs mt-1 opacity-80">pieces at station</p>
              <p className="text-lg font-semibold mt-2">{signal.avgActualMinutes != null ? `${signal.avgActualMinutes.toFixed(0)}m avg dwell` : 'No dwell data'}</p>
            </button>
          );
        })}
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

      {/* Station detail dialog */}
      <Dialog open={!!detailStation} onOpenChange={(open) => !open && setDetailStation(null)}>
        <DialogContent className="bg-neutral-900 text-white border-neutral-700 max-h-[80vh] overflow-y-auto">
          {detailStation && (
            <>
              <DialogHeader><DialogTitle>{stationName(detailStation.stationId)} — Station Detail</DialogTitle></DialogHeader>
              <div className="space-y-2 text-sm">
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
                      {pieces.filter((p) => Number(p.current_station_id) === detailStation.stationId).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => { setDetailPiece(p); setDetailStation(null); }}
                          className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-neutral-800 transition-colors"
                        >
                          <span className="font-medium">{p.piece_mark}</span>
                          <span className="text-neutral-400 text-xs">{p.workflow_status?.replace(/_/g, ' ')}</span>
                        </button>
                      ))}
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
                <div><p className="text-xs text-neutral-500">Workflow Status</p><p className="font-medium">{detailPiece.workflow_status?.replace(/_/g, ' ') || '—'}</p></div>
                <div><p className="text-xs text-neutral-500">Field Status</p><p className="font-medium">{detailPiece.field_status?.replace(/_/g, ' ') || '—'}</p></div>
              </div>
              <DialogFooter>
                <Button variant="outline" className="border-neutral-600" onClick={() => setDetailPiece(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
