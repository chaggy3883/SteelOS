import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CheckCircle2, CircleDot, ArrowRight } from 'lucide-react';
import { stationName } from '@/lib/shopStations';
import { getRouteProgress, routeLabel } from '@/lib/shopRoutes';

const STATE_CLASSES = {
  done: 'border-green-500/40 bg-green-500/10 text-green-700',
  current: 'border-primary bg-primary/10 text-primary font-semibold',
  next: 'border-blue-500/40 bg-blue-500/5 text-blue-700',
  todo: 'border-border text-muted-foreground',
};

// Route progress strip: done / current / next for one shop-floor piece.
// The whole strip is a button — clicking opens the piece's station history.
export function RouteProgressStrip({ route, routeSource, currentStationId, completedIds, config, onOpenHistory, compact = false }) {
  if (!route) {
    return (
      <button type="button" onClick={onOpenHistory} className="text-[11px] text-muted-foreground hover:underline underline-offset-2" title="View station history">
        No route set — view station history
      </button>
    );
  }
  const progress = getRouteProgress(route, currentStationId, completedIds);
  const doneCount = progress.filter((p) => p.state === 'done').length;
  return (
    <button
      type="button"
      onClick={onOpenHistory}
      title={`${routeLabel(route, config)}${routeSource ? ` (${routeSource})` : ''} — click for station history`}
      className="flex flex-wrap items-center gap-1 text-left hover:opacity-90"
    >
      {!compact && <span className="text-[11px] text-muted-foreground mr-1">{route.name} route · {doneCount}/{progress.length} done:</span>}
      {progress.map((p, i) => (
        <React.Fragment key={`${p.stationId}-${p.index}`}>
          {i > 0 && <ArrowRight className="w-3 h-3 text-muted-foreground" />}
          <span className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${STATE_CLASSES[p.state]}`}>
            {p.state === 'done' && <CheckCircle2 className="w-3 h-3" />}
            {p.state === 'current' && <CircleDot className="w-3 h-3" />}
            {stationName(p.stationId, config)}
            {p.state === 'next' && <span className="opacity-70">(next)</span>}
          </span>
        </React.Fragment>
      ))}
    </button>
  );
}

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

// Every station_logs row for one piece, newest first; each row expands to
// the full record.
export function StationHistoryDialog({ piece, route, config, onClose }) {
  const [logs, setLogs] = useState(null);
  const [openId, setOpenId] = useState(null);
  useEffect(() => {
    if (!piece) return;
    setLogs(null);
    setOpenId(null);
    db.entities.station_logs.filter({ piece_id: piece.id }, '-start_time', 500).then(setLogs).catch(() => setLogs([]));
  }, [piece?.id]);

  return (
    <Dialog open={!!piece} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{piece?.piece_mark} — Station History</DialogTitle></DialogHeader>
        {route && <p className="text-xs text-muted-foreground">Route: {routeLabel(route, config)}</p>}
        <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
          {logs === null ? (
            <div className="h-16 rounded bg-muted animate-pulse" />
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No station work logged for this piece yet.</p>
          ) : logs.map((log) => (
            <button key={log.id} type="button" onClick={() => setOpenId(openId === log.id ? null : log.id)} className="w-full rounded-lg border border-border p-2 text-left text-sm hover:bg-muted/50">
              <div className="flex items-center justify-between">
                <span className="font-medium">{stationName(log.station_id, config)}</span>
                <span className={log.status === 'Complete' ? 'text-green-700' : 'text-muted-foreground'}>{log.status}{log.auto_paused ? ' (shift-end fail-safe)' : ''}</span>
              </div>
              <p className="text-xs text-muted-foreground">{fmt(log.start_time)} • {log.elapsed_minutes || 0} min • Employee {log.employee_id || '—'}</p>
              {openId === log.id && (
                <div className="mt-2 grid grid-cols-3 gap-1 border-t border-border pt-2 text-xs">
                  <span className="text-muted-foreground">Started</span><span className="col-span-2">{fmt(log.start_time)}</span>
                  <span className="text-muted-foreground">Ended</span><span className="col-span-2">{fmt(log.end_time)}</span>
                  <span className="text-muted-foreground">Minutes</span><span className="col-span-2">{log.elapsed_minutes || 0}</span>
                  <span className="text-muted-foreground">Employee</span><span className="col-span-2">{log.employee_id || '—'}</span>
                  <span className="text-muted-foreground">Station #</span><span className="col-span-2">{log.station_id}</span>
                  <span className="text-muted-foreground">Log ID</span><span className="col-span-2 font-mono">{log.id}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
