import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { getActiveStations, stationName } from '@/lib/shopStations';
import { matchesQuery } from '@/lib/globalSearchSources';
import { pieceLocation, isPastReceiving, formatDuration } from '@/lib/pieceLocation';

const STATE_TONE = {
  working: 'bg-green-500/10 text-green-700',
  paused: 'bg-blue-500/10 text-blue-700',
  done: 'bg-primary/10 text-primary',
  inspection: 'bg-amber-500/10 text-amber-700',
  rejected: 'bg-red-500/10 text-red-600',
  waiting: 'bg-muted text-muted-foreground',
  received: 'bg-muted text-muted-foreground',
};
const STATE_LABEL = {
  working: 'Being worked', paused: 'Paused', done: 'Done — ready for next station', inspection: 'Waiting for inspection',
  rejected: 'Failed inspection', waiting: 'Not started', received: 'Received',
};

// Shop Management → Pieces in the Shop: every piece that has left Receiving,
// where it is (the last station it was scanned at), its status there, and
// how long it has been in that status — longest first, so stalled steel
// floats to the top. Refreshes the "time in status" every minute.
export default function ShopPiecesInShop({ pieces = [], stationLogs = [], projects = [] }) {
  const [query, setQuery] = useState('');
  const [stationFilter, setStationFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const rows = useMemo(() => pieces
    .filter((p) => (p.field_status || 'In_Shop') === 'In_Shop' && isPastReceiving(p, stationLogs))
    .map((p) => {
      const loc = pieceLocation(p, stationLogs);
      const active = stationLogs.find((l) => l.piece_id === p.id && l.status === 'In_Progress');
      return { piece: p, loc, worker: active?.employee_id || '', sinceMs: loc.since ? new Date(loc.since).getTime() : now };
    })
    .filter((r) => stationFilter === 'all' || Number(r.piece.current_station_id) === Number(stationFilter))
    .filter((r) => stateFilter === 'all' || r.loc.state === stateFilter)
    .filter((r) => {
      if (!query.trim()) return true;
      const proj = projectById.get(r.piece.project_id);
      return matchesQuery([r.piece.piece_mark, r.piece.serial_number, r.piece.material_shape, proj?.name, proj?.project_number, stationName(r.piece.current_station_id)], query);
    })
    .sort((a, b) => a.sinceMs - b.sinceMs), [pieces, stationLogs, stationFilter, stateFilter, query, projectById, now]);

  const counts = useMemo(() => {
    const c = {};
    rows.forEach((r) => { c[r.loc.state] = (c[r.loc.state] || 0) + 1; });
    return c;
  }, [rows]);

  return (
    <div className="steel-card p-4 space-y-3">
      <div>
        <h3 className="font-semibold">Pieces in the Shop</h3>
        <p className="text-xs text-muted-foreground">Every piece past Receiving: where it was last scanned, its status there, and how long it has been in that status (longest first).</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search piece, serial, project…" className="pl-9" aria-label="Search pieces in the shop" />
        </div>
        <select aria-label="Station" value={stationFilter} onChange={(e) => setStationFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">All stations</option>
          {getActiveStations().map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select aria-label="Status" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">All statuses</option>
          {Object.entries(STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-muted-foreground">{rows.length} piece{rows.length === 1 ? '' : 's'}:</span>
        {Object.entries(counts).map(([k, n]) => <span key={k} className={`rounded-full px-2 py-0.5 ${STATE_TONE[k]}`}>{STATE_LABEL[k]} {n}</span>)}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide text-left">
              <th className="py-2 px-3">Piece</th>
              <th className="py-2 px-3">Project</th>
              <th className="py-2 px-3">Station</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3 text-right">Time in status</th>
              <th className="py-2 px-3">Worker</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ piece, loc, worker }) => {
              const proj = projectById.get(piece.project_id);
              return (
                <tr key={piece.id} className="border-b border-border/50">
                  <td className="py-2 px-3">
                    <p className="font-mono font-medium">{piece.piece_mark}</p>
                    <p className="text-xs text-muted-foreground font-mono">{piece.serial_number || ''}</p>
                  </td>
                  <td className="py-2 px-3">{proj ? [proj.project_number, proj.name].filter(Boolean).join(' — ') : '—'}</td>
                  <td className="py-2 px-3">{stationName(piece.current_station_id)}</td>
                  <td className="py-2 px-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[loc.state]}`}>{STATE_LABEL[loc.state]}</span></td>
                  <td className="py-2 px-3 text-right tabular-nums" title={loc.since ? new Date(loc.since).toLocaleString() : ''}>{formatDuration(loc.since, now)}</td>
                  <td className="py-2 px-3 font-mono text-xs">{worker || '—'}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No pieces past Receiving match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
