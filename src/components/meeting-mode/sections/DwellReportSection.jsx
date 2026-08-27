import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { db } from '@/api/apiClient';
import { getStationBottlenecks, getStationDwellVariance, getStalePieces, stationName } from '@/lib/shopOpsMetrics';

// Shop-floor dwell/bottleneck data only — pieces, station_logs,
// piece_production_logs, and the production SystemSetting row are the only
// entities this component ever fetches. None of them carry a cost or dollar
// figure, so there is nothing pricing-related in this section's state even
// in principle. Same source functions ShopOperations.jsx's Bottleneck Radar
// tab already uses (src/lib/shopOpsMetrics.js), reused verbatim here.
export default function DwellReportSection() {
  const [pieces, setPieces] = useState([]);
  const [stationLogs, setStationLogs] = useState([]);
  const [pieceProductionLogs, setPieceProductionLogs] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [pieceData, logsData, pieceProductionLogData, settingsRows] = await Promise.all([
          db.entities.pieces.list('-created_date', 500),
          db.entities.station_logs.list('-created_date', 500),
          db.entities.piece_production_logs.filter({ status: 'Complete' }, '-created_date', 1000),
          db.entities.SystemSetting.filter({ setting_group: 'production' }, '-created_date', 1),
        ]);
        if (cancelled) return;
        setPieces(pieceData);
        setStationLogs(logsData);
        setPieceProductionLogs(pieceProductionLogData);
        setSettings(settingsRows[0] || null);
      } catch (e) {
        if (!cancelled) { setPieces([]); setStationLogs([]); setPieceProductionLogs([]); setSettings(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="h-full flex items-center justify-center"><p className="text-2xl text-slate-400">Loading dwell report…</p></div>;
  }

  const bottleneckThreshold = settings?.station_bottleneck_threshold || 50;
  const dwellThresholdPct = settings?.station_dwell_bottleneck_threshold_pct || 25;
  const staleHours = settings?.stale_piece_alert_hours || 8;

  const bottlenecks = getStationBottlenecks(pieces, bottleneckThreshold);
  const stationSignals = getStationDwellVariance(stationLogs, pieces, pieceProductionLogs, bottlenecks, dwellThresholdPct);
  const stalePieces = getStalePieces(stationLogs, staleHours);
  const pieceById = new Map(pieces.map((p) => [p.id, p]));

  return (
    <div className="h-full overflow-y-auto p-8">
      <h2 className="text-2xl font-semibold mb-1">Dwell Report</h2>
      <p className="text-sm text-slate-500 mb-6">
        Station bottleneck alert (queue threshold: {bottleneckThreshold} • dwell threshold: +{dwellThresholdPct}%)
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
        {stationSignals.map((s) => (
          <div key={s.stationId} className={`rounded-lg border px-4 py-3 ${s.isBottleneck ? 'border-red-500/50 bg-red-500/10' : 'border-slate-800'}`}>
            <p className="text-sm font-medium">{stationName(s.stationId)}</p>
            <p className={`text-2xl font-bold mt-1 ${s.isBottleneck ? 'text-red-400' : ''}`}>{s.count}</p>
            <p className="text-xs text-slate-500 mt-1">
              {s.avgActualMinutes != null ? `${s.avgActualMinutes.toFixed(0)}m avg actual` : 'No dwell data'}
              {s.avgTargetMinutes != null && ` / ${s.avgTargetMinutes.toFixed(0)}m target`}
            </p>
            {s.dwellVariancePct != null && (
              <p className={`text-sm font-semibold mt-1 ${s.dwellVariancePct > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {s.dwellVariancePct > 0 ? '+' : ''}{s.dwellVariancePct.toFixed(0)}% dwell
              </p>
            )}
          </div>
        ))}
      </div>

      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-400" /> Stale Pieces (over {staleHours}h at a station)
      </h3>
      {stalePieces.length === 0 ? (
        <p className="text-sm text-slate-500">No pieces have been sitting longer than {staleHours} hours.</p>
      ) : (
        <div className="space-y-2">
          {stalePieces.map((log) => {
            const piece = pieceById.get(log.piece_id);
            return (
              <div key={log.id} className="flex items-center justify-between rounded-lg border border-slate-800 px-4 py-3 text-sm">
                <span className="font-medium">{piece?.piece_mark || log.piece_id}</span>
                <span className="text-slate-500">{stationName(log.station_id)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
