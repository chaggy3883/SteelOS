import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, CopyPlus } from 'lucide-react';
import { toolLabel, measurementSummary } from '@/lib/takeoffGeometry';
import { formatFeetInchesFraction } from '@/lib/fractionInches';
import { planCarryForward, buildCarriedRow, REVIEW_FLAG_TEXT } from '@/lib/takeoffCarryForward';

const measured = (r) => (r.tool === 'count' || r.tool === 'bolt_count' ? `${r.points?.length || r.quantity || 0} pcs` : (measurementSummary(r, formatFeetInchesFraction) || '—'));

// Copy confirmed markups from the older revision's takeoff into this one.
// Each markup is moved by its page's saved line-up (RevisionCompareDialog)
// and flagged "Check — area changed" when it lands in a saved change cloud.
// Markups are only ever ADDED — anything already brought over is shown but
// can't be added twice, and nothing in this takeoff is replaced.
export default function CarryForwardDialog({ open, onOpenChange, previousTakeoffId, currentRows = [], revisionCompare, onApply }) {
  const [older, setOlder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [useLineUp, setUseLineUp] = useState(true);
  const [picked, setPicked] = useState(() => new Set());

  useEffect(() => {
    if (!open || !previousTakeoffId) return;
    setLoading(true);
    db.entities.blueprint_takeoffs.get(previousTakeoffId)
      .then(setOlder)
      .catch(() => setOlder(null))
      .finally(() => setLoading(false));
  }, [open, previousTakeoffId]);

  // Saved compares are keyed by NEW page; the plan wants them by OLD page.
  const pageMap = useMemo(() => {
    const map = {};
    Object.entries(revisionCompare?.pages || {}).forEach(([newPage, p]) => {
      if (!p || (p.previous_takeoff_id && p.previous_takeoff_id !== previousTakeoffId)) return;
      map[Number(p.old_page_number || newPage)] = { newPage: Number(newPage), transform: useLineUp ? p.transform || null : null, clouds: p.clouds || [], compared: true };
    });
    return map;
  }, [revisionCompare, previousTakeoffId, useLineUp]);

  const plan = useMemo(
    () => planCarryForward(older?.accepted_items || [], { fromTakeoffId: previousTakeoffId, existingRows: currentRows, pageMap }),
    [older, previousTakeoffId, currentRows, pageMap],
  );

  // Default: everything not already brought over.
  useEffect(() => {
    setPicked(new Set(plan.filter((p) => !p.alreadyCarried).map((p) => p.key)));
  }, [older, open]);

  const toggle = (key) => setPicked((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const selectable = plan.filter((p) => !p.alreadyCarried);
  const chosen = plan.filter((p) => picked.has(p.key) && !p.alreadyCarried);
  const flaggedCount = chosen.filter((p) => p.flagged).length;
  const anyCompared = plan.some((p) => p.compared);
  const anyLineUp = Object.values(revisionCompare?.pages || {}).some((p) => p?.transform);

  const handleApply = () => {
    const rows = chosen.map((item) => buildCarriedRow(item, { fromTakeoffId: previousTakeoffId, newId: () => crypto.randomUUID() }));
    onApply?.(rows, { flagged: flaggedCount });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[88vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CopyPlus className="w-5 h-5" />Bring markups forward from {older?.takeoff_name || 'the older revision'}</DialogTitle>
          <DialogDescription>
            Ticked markups are added to this takeoff. Nothing here is replaced. Markups that land in a changed area are flagged so you can check them.
          </DialogDescription>
        </DialogHeader>

        {!anyCompared && (
          <p className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 flex gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
            No pages have been compared yet, so markups are copied to the same spot and nothing can be flagged. Compare the sheets first to line them up and find changed areas.
          </p>
        )}
        {anyLineUp && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useLineUp} onChange={(e) => setUseLineUp(e.target.checked)} />
            Move markups by the saved sheet line-up
          </label>
        )}

        <div className="flex items-center gap-2 text-xs">
          <Button size="sm" variant="outline" onClick={() => setPicked(new Set(selectable.map((p) => p.key)))}>Tick all</Button>
          <Button size="sm" variant="outline" onClick={() => setPicked(new Set())}>Tick none</Button>
          <span className="text-muted-foreground">{chosen.length} of {selectable.length} ticked{flaggedCount ? ` · ${flaggedCount} will be flagged` : ''}</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto border rounded-md">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading the older takeoff…</p>
          ) : plan.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">The older takeoff has no confirmed markups to bring over.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left sticky top-0">
                <tr>
                  <th className="p-2 w-8" />
                  <th className="p-2">Page</th>
                  <th className="p-2">Tool</th>
                  <th className="p-2">Markup</th>
                  <th className="p-2">Measured</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((p) => (
                  <tr key={p.key} className={`border-t ${p.alreadyCarried ? 'opacity-50' : 'cursor-pointer hover:bg-muted/40'}`} onClick={() => !p.alreadyCarried && toggle(p.key)}>
                    <td className="p-2"><input type="checkbox" disabled={p.alreadyCarried} checked={picked.has(p.key) && !p.alreadyCarried} onChange={() => toggle(p.key)} onClick={(e) => e.stopPropagation()} /></td>
                    <td className="p-2 whitespace-nowrap">{p.page === p.newPage ? p.page : `${p.page} → ${p.newPage}`}</td>
                    <td className="p-2">{toolLabel(p.sourceRow.tool)}</td>
                    <td className="p-2">
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: p.sourceRow.color || '#94a3b8' }} />
                      {p.sourceRow.label || [p.sourceRow.shape_type, p.sourceRow.size_designation].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="p-2 whitespace-nowrap">{measured(p.sourceRow)}</td>
                    <td className="p-2">
                      {p.alreadyCarried ? <Badge variant="outline">Already brought over</Badge>
                        : p.flagged ? <Badge variant="outline" className="text-amber-700 border-amber-300"><AlertTriangle className="w-3 h-3 mr-1" />{REVIEW_FLAG_TEXT}</Badge>
                          : p.compared ? <Badge variant="outline" className="text-green-700 border-green-300">No change found</Badge>
                            : <span className="text-muted-foreground">Page not compared</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleApply} disabled={chosen.length === 0}>Add {chosen.length} markup{chosen.length === 1 ? '' : 's'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
