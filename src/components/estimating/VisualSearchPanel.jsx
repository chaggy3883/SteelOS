import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Check, X, ScanSearch, Plus } from 'lucide-react';
import { MIN_SEARCH_THRESHOLD } from '@/hooks/useSymbolSearch';
import CountMarkerSwatch from '@/components/estimating/CountMarkerSwatch';

const NEW_COUNT = '__new__';

// Review bar for Visual Search (useSymbolSearch). Shows progress while the
// sheet is scanned, then the candidates: a "how close a match" slider,
// accept/reject all, and which count the accepted marks are added to — an
// existing count on this page, or a new one (which still goes through Count
// setup and the tally panel's Save, so nothing lands in the takeoff here).
export default function VisualSearchPanel({ search, countRowsOnPage = [], onAddToCount }) {
  const [target, setTarget] = useState(NEW_COUNT);

  useEffect(() => {
    if (search.phase === 'review') setTarget(countRowsOnPage[0]?._key || NEW_COUNT);
    // Only when a new result set arrives.
  }, [search.phase]);

  if (search.phase === 'idle' && !search.error) return null;

  const total = search.visible.length;
  const nAccepted = search.accepted.length;

  return (
    <div className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 space-y-2 text-violet-900">
      {search.phase === 'picking' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm flex items-center gap-2"><ScanSearch className="w-4 h-4" />Drag a box around one symbol on the drawing — IRONSIGHT will look for the others on this page.</p>
          <Button size="sm" variant="outline" onClick={search.cancel}>Cancel</Button>
        </div>
      )}

      {search.phase === 'searching' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />Looking for matches… {Math.round((search.progress || 0) * 100)}%
            <div className="w-40 h-1.5 rounded bg-violet-200 overflow-hidden"><div className="h-full bg-violet-600" style={{ width: `${Math.round((search.progress || 0) * 100)}%` }} /></div>
          </div>
          <Button size="sm" variant="outline" onClick={search.cancel}>Stop</Button>
        </div>
      )}

      {search.phase === 'idle' && search.error && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">{search.error}</p>
          <Button size="sm" variant="outline" onClick={search.clear}>Dismiss</Button>
        </div>
      )}

      {search.phase === 'review' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {total} match{total === 1 ? '' : 'es'} on page {search.searchPage} · {nAccepted} accepted · {search.pendingCount} to review
              <span className="font-normal text-violet-700"> — click a box on the drawing to accept or reject it</span>
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={search.acceptAll} disabled={search.pendingCount === 0}><Check className="w-3.5 h-3.5 mr-1" />Accept the rest</Button>
              <Button size="sm" variant="outline" onClick={search.rejectAll} disabled={search.pendingCount === 0}><X className="w-3.5 h-3.5 mr-1" />Reject the rest</Button>
              <Button size="sm" variant="ghost" onClick={search.clear}>Close</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              How close a match:
              <input
                type="range"
                min={MIN_SEARCH_THRESHOLD}
                max={0.99}
                step={0.01}
                value={search.threshold}
                onChange={(e) => search.setThreshold(Number(e.target.value))}
              />
              <span className="font-mono w-10">{Math.round(search.threshold * 100)}%</span>
            </label>
            <span className="text-violet-700">Lower finds more (and more wrong ones); higher finds only near-exact copies.</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span>Add the {nAccepted} accepted to</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
              {countRowsOnPage.map((r) => (
                <option key={r._key} value={r._key}>{r.label || 'Count'} ({r.points?.length || r.quantity || 0} so far)</option>
              ))}
              <option value={NEW_COUNT}>A new count…</option>
            </select>
            {target !== NEW_COUNT && (() => {
              const row = countRowsOnPage.find((r) => r._key === target);
              return row ? <CountMarkerSwatch color={row.color} symbol={row.symbol} size={16} /> : null;
            })()}
            <Button size="sm" onClick={() => onAddToCount?.(target === NEW_COUNT ? null : target, search.accepted)} disabled={nAccepted === 0}>
              <Plus className="w-3.5 h-3.5 mr-1" />{target === NEW_COUNT ? 'Set up the count' : 'Add marks'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
