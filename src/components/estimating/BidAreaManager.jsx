import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Layers, Plus, ArrowUp, ArrowDown, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import MathDrill from '@/components/estimating/MathDrill';
import { buildAreaBreakdown, automaticAreaPercents, areaFollowsTakeoff } from '@/lib/areaBreakdown';

const emptyAreaForm = () => ({ name: '', contract_value_pct: 0 });

// Bid-stage management of Build Areas — same ProjectSequenceArea entity
// ProjectDetail.jsx/ProjectManagement.jsx already use for piece assignment
// and Shop Drawing grouping, scoped here by bid_id (no project_id exists
// yet, since a bid isn't a project until won). Reordering follows
// MaterialShapeTypeDetailModal.jsx's adjacent sort_order swap pattern,
// applied to production_priority instead, so priorities stay a clean
// gap-free sequence rather than free-text numbers a user could duplicate.
export default function BidAreaManager({ bid, onSaved }) {
  const { toast } = useToast();
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingArea, setEditingArea] = useState(null); // 'new' | area object | null
  const [areaForm, setAreaForm] = useState(emptyAreaForm());
  const [saving, setSaving] = useState(false);
  // The bid's saved Full Takeoff lines, for each Area's automatic % of the
  // project (by tons — areaBreakdown.js).
  const [takeoffLines, setTakeoffLines] = useState([]);

  const referenceTotal = bid?.bid_quoted_price || bid?.bid_total_cost || 0;

  useEffect(() => { if (bid?.id) loadAreas(); }, [bid?.id, bid?.updated_date]);

  const loadAreas = async () => {
    setLoading((was) => was && areas.length === 0);
    try {
      const [rows, lines] = await Promise.all([
        db.entities.ProjectSequenceArea.filter({ bid_id: bid.id }, 'production_priority', 200),
        db.entities.MaterialTakeoffLine.filter({ bid_id: bid.id }, 'created_date', 2000).catch(() => []),
      ]);
      setAreas(rows || []);
      setTakeoffLines((lines || []).map((l, i) => ({
        sequence_area_id: l.sequence_area_id || null,
        tons: Number(l.total_tons) || 0,
        label: `Line ${i + 1} — ${l.material_size || l.size_value || l.shape_code || 'material'}`,
      })));
    } catch (e) {
      toast({ title: 'Unable to load Areas', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const breakdown = buildAreaBreakdown(areas, takeoffLines);
  const breakdownByKey = new Map(breakdown.rows.map((r) => [r.key, r]));
  const autoPct = automaticAreaPercents(areas, takeoffLines);
  const hasTakeoffTons = breakdown.totals.tons > 0;

  // Back to following the takeoff: store the automatic % now.
  const applyTakeoffPct = async (area) => {
    try {
      await db.entities.ProjectSequenceArea.update(area.id, { contract_value_pct: autoPct.get(area.id) ?? 0, pct_source: 'takeoff' });
      await loadAreas();
      onSaved?.();
      toast({ title: `${area.name} now follows the takeoff` });
    } catch (e) {
      toast({ title: 'Unable to update Area', variant: 'destructive' });
    }
  };

  const startAddArea = () => { setEditingArea('new'); setAreaForm(emptyAreaForm()); };
  const startEditArea = (area) => { setEditingArea(area); setAreaForm({ name: area.name || '', contract_value_pct: area.contract_value_pct || 0 }); };

  const handleSaveArea = async () => {
    if (!areaForm.name.trim()) { toast({ title: 'Area name is required', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      if (editingArea && editingArea !== 'new') {
        // A % typed different from what the Area already had becomes a
        // hand-set % (the takeoff stops changing it); same % keeps its source.
        const typedPct = Number(areaForm.contract_value_pct) || 0;
        const changedPct = Math.abs(typedPct - (Number(editingArea.contract_value_pct) || 0)) > 1e-9;
        await db.entities.ProjectSequenceArea.update(editingArea.id, {
          name: areaForm.name.trim(),
          contract_value_pct: typedPct,
          ...(changedPct ? { pct_source: 'manual' } : {}),
        });
      } else {
        // A new Area follows the takeoff; it has no lines yet, so 0% until
        // lines are assigned and the takeoff is saved.
        await db.entities.ProjectSequenceArea.create({
          bid_id: bid.id,
          name: areaForm.name.trim(),
          contract_value_pct: 0,
          pct_source: 'takeoff',
          production_priority: areas.length,
        });
      }
      setEditingArea(null);
      await loadAreas();
      onSaved?.();
      toast({ title: 'Area saved' });
    } catch (e) {
      toast({ title: 'Unable to save Area', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteArea = async (area) => {
    try {
      await db.entities.ProjectSequenceArea.delete(area.id);
      setEditingArea(null);
      await loadAreas();
      onSaved?.();
      toast({ title: 'Area deleted' });
    } catch (e) {
      toast({ title: 'Unable to delete Area', variant: 'destructive' });
    }
  };

  const moveArea = async (area, direction) => {
    const idx = areas.findIndex((a) => a.id === area.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= areas.length) return;
    const neighbor = areas[swapIdx];
    try {
      await Promise.all([
        db.entities.ProjectSequenceArea.update(area.id, { production_priority: neighbor.production_priority ?? swapIdx }),
        db.entities.ProjectSequenceArea.update(neighbor.id, { production_priority: area.production_priority ?? idx }),
      ]);
      await loadAreas();
    } catch (e) {
      toast({ title: 'Unable to reorder Areas', variant: 'destructive' });
    }
  };

  const totalPct = areas.reduce((s, a) => s + (Number(a.contract_value_pct) || 0), 0);
  const totalOk = Math.abs(totalPct - 100) < 0.01;

  if (loading) return <div className="steel-card p-5 text-sm text-muted-foreground">Loading Areas…</div>;

  return (
    <div className="steel-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Layers className="w-4 h-4" /> Build Areas</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Break this bid into named Areas — each carries a % of the total contract value and a shop
            production sequence. On win, each Area auto-generates a linked SOV line in Accounting.
            Each Area's % is worked out automatically from the Full Takeoff (its tons ÷ the project's tons)
            whenever the takeoff is saved; type a % in an Area to set it by hand instead.
          </p>
        </div>
        <Button size="sm" onClick={startAddArea}><Plus className="w-3.5 h-3.5 mr-1" />Add Area</Button>
      </div>

      {areas.length === 0 ? (
        <div className="text-center py-8">
          <Layers className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No Areas defined for this bid yet.</p>
        </div>
      ) : (
        <>
          <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 mb-3 ${totalOk ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
            {totalOk ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            <span>Total: {totalPct.toFixed(1)}% of contract value{!totalOk && ' — does not sum to 100%'}</span>
            {breakdown.unassigned && breakdown.unassigned.tons > 0 && (
              <span className="text-xs">· {breakdown.unassigned.tons.toFixed(2)} t of the takeoff isn't in an Area yet</span>
            )}
            {referenceTotal > 0 && <span className="text-xs text-muted-foreground ml-auto">Bid reference total: ${referenceTotal.toLocaleString()}</span>}
          </div>

          <div className="rounded-lg border border-border overflow-hidden divide-y divide-border/50">
            {areas.map((area, idx) => (
              <div key={area.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex flex-col -my-1">
                  <button type="button" onClick={() => moveArea(area, -1)} disabled={idx === 0} className="text-muted-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => moveArea(area, 1)} disabled={idx === areas.length - 1} className="text-muted-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <span className="text-xs font-mono text-muted-foreground w-6 flex-shrink-0">#{idx + 1}</span>
                <button type="button" onClick={() => startEditArea(area)} className="flex-1 min-w-0 text-left font-medium text-sm text-primary hover:underline truncate">
                  {area.name}
                </button>
                {(() => {
                  const b = breakdownByKey.get(area.id);
                  const manual = !areaFollowsTakeoff(area);
                  return (
                    <>
                      <span className="text-xs text-muted-foreground flex-shrink-0 hidden sm:inline">
                        {hasTakeoffTons ? <>{(b?.tons ?? 0).toFixed(2)} t · <MathDrill value={`${(b?.pctTons ?? 0).toFixed(1)}% of project`} title={`${area.name} — share of project`} lines={b?.steps || []} /></> : 'No takeoff tons yet'}
                      </span>
                      <span className="text-sm font-mono w-16 text-right flex-shrink-0" title={manual ? 'Set by hand — the takeoff does not change it' : 'Follows the takeoff (by tons)'}>{(Number(area.contract_value_pct) || 0).toFixed(1)}%</span>
                      {manual
                        ? <button type="button" onClick={() => applyTakeoffPct(area)} className="text-[11px] text-primary underline underline-offset-2 flex-shrink-0" title={`Use the takeoff's ${(autoPct.get(area.id) ?? 0).toFixed(1)}%`}>Use takeoff %</button>
                        : <span className="text-[10px] text-muted-foreground flex-shrink-0 w-[72px]">auto</span>}
                    </>
                  );
                })()}
                <button type="button" onClick={() => handleDeleteArea(area)} className="text-muted-foreground hover:text-destructive p-1 flex-shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={!!editingArea} onOpenChange={(open) => !open && setEditingArea(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editingArea === 'new' ? 'Add Area' : 'Edit Area'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Area Name</Label>
              <Input autoFocus value={areaForm.name} onChange={(e) => setAreaForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. A1, Monumental Stairs" className="mt-1" />
            </div>
            <div>
              <Label>% of Contract Value</Label>
              <Input type="number" min="0" max="100" step="0.1" value={areaForm.contract_value_pct} onChange={(e) => setAreaForm((f) => ({ ...f, contract_value_pct: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingArea(null)}>Cancel</Button>
            <Button onClick={handleSaveArea} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
