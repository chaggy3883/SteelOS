import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { optimizeCutPlan, compareStockLengthOptions, getPieceLengthInches, findMatchingRemnants, packPiecesIntoRemnants } from '@/lib/materialOptimizer';
import { commitMaterialOptimizationRun } from '@/lib/materialOptimizationCommit';
import { normalizeMaterialProfile } from '@/lib/materialProfileMatch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import StockMaterialUnitDetailModal from '@/components/shared/StockMaterialUnitDetailModal';
import { Loader2, Scissors, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Recycle } from 'lucide-react';

const emptyPlan = () => ({ bins: [], unpackablePieces: [], totals: { quantity_of_stock_required: 0, total_stock_in: 0, total_piece_in: 0, total_kerf_in: 0, remnant_length_in: 0, waste_in: 0, utilization_pct: 0 } });

// STAGE 5: one panel per material group (shape + grade). Shows the pieces in
// the group, the stock-length comparison (compareStockLengthOptions), a live
// preview of the chosen length's cut plan (optimizeCutPlan) — re-runnable
// against a different length before anything is written.
// STAGE 6/7: commit hands the preview off to materialOptimizationCommit.js,
// which writes the MaterialOptimizationRun, a StockMaterialUnit per bar, and
// (when a preferred vendor is configured) a purchase_order_lines row.
// STAGE 10: before comparing new stock lengths at all, packPiecesIntoRemnants
// checks this group's matching remnant_inventory rows and claims whatever it
// can — only the leftover piece list (remainingPieces) ever reaches the
// new-stock comparison/commit path below, so remnants are used up first.
export default function MaterialOptimizationGroupPanel({ group, projectId }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [stockOptions, setStockOptions] = useState([]);
  const [catalogMatch, setCatalogMatch] = useState(null);
  const [kerfInput, setKerfInput] = useState('0');
  const [comparison, setComparison] = useState([]);
  const [selectedLength, setSelectedLength] = useState(null);
  const [previewPlan, setPreviewPlan] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [pastRuns, setPastRuns] = useState([]);
  const [expandedRunId, setExpandedRunId] = useState(null);
  const [unitsByRun, setUnitsByRun] = useState({});
  const [remnants, setRemnants] = useState([]);
  const [remnantPlan, setRemnantPlan] = useState(null);
  const [settings, setSettings] = useState(null);
  const [remnantThresholdInput, setRemnantThresholdInput] = useState('24');
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [viewingUnitId, setViewingUnitId] = useState(null);

  const piecesById = useMemo(() => new Map(group.pieces.map((p) => [p.id, p])), [group.pieces]);
  const matchingRemnants = useMemo(() => findMatchingRemnants(remnants, group), [remnants, group]);

  useEffect(() => { loadData(); }, [group.group_key]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [catalog, runs, remnantRows, settingsRows] = await Promise.all([
        db.entities.steel_catalog.list('size_designation', 5000),
        db.entities.MaterialOptimizationRun.filter({ project_id: projectId, material_group_key: group.group_key }, '-created_date', 50),
        db.entities.remnant_inventory.filter({ status: 'available' }, '-created_date', 500),
        db.entities.SystemSetting.filter({ setting_group: 'production' }, '-created_date', 1),
      ]);
      const normalizedProfile = normalizeMaterialProfile(group.material_profile);
      const match = normalizedProfile ? catalog.find((c) => normalizeMaterialProfile(c.size_designation) === normalizedProfile) : null;
      setCatalogMatch(match || null);
      setPastRuns(runs);
      setRemnants(remnantRows);

      let settingsRow = settingsRows[0];
      if (!settingsRow) settingsRow = await db.entities.SystemSetting.create({ setting_group: 'production' });
      setSettings(settingsRow);
      setRemnantThresholdInput(String(settingsRow.remnant_minimum_useful_length_in ?? 24));

      if (match) {
        const options = await db.entities.StockLengthOption.filter({ steel_catalog_item_id: match.id, is_active: true }, 'stock_length_in', 200);
        setStockOptions(options);
      } else {
        setStockOptions([]);
      }
    } catch (e) {
      toast({ title: 'Failed to load material optimization data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const saveRemnantThreshold = async () => {
    if (!settings) return;
    setSavingThreshold(true);
    try {
      const value = parseFloat(remnantThresholdInput) || 0;
      const updated = await db.entities.SystemSetting.update(settings.id, { remnant_minimum_useful_length_in: value });
      setSettings(updated);
      toast({ title: 'Remnant threshold saved' });
    } catch (e) {
      toast({ title: 'Unable to save remnant threshold', variant: 'destructive' });
    } finally {
      setSavingThreshold(false);
    }
  };

  // Stage 10: remnants are checked first regardless of whether new-stock
  // comparison is even possible (no catalog match / stock lengths configured
  // yet) — a group can be fully satisfied by existing remnants with zero new
  // stock, which the "no active stock lengths" warning branch below would
  // otherwise mask entirely.
  const runComparison = () => {
    const kerf = parseFloat(kerfInput) || 0;
    const packed = packPiecesIntoRemnants(group.pieces, matchingRemnants, kerf);
    setRemnantPlan(packed);

    if (packed.remainingPieces.length === 0) {
      setComparison([]);
      setSelectedLength(null);
      setPreviewPlan(emptyPlan());
      return;
    }

    if (stockOptions.length === 0) {
      setComparison([]);
      setSelectedLength(null);
      setPreviewPlan(null);
      return;
    }
    setComparison(compareStockLengthOptions(packed.remainingPieces, stockOptions.map((o) => o.stock_length_in), kerf));
    setSelectedLength(null);
    setPreviewPlan(null);
  };

  useEffect(() => {
    if (!loading) runComparison();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, stockOptions, matchingRemnants]);

  const previewLength = (stockLengthIn) => {
    const kerf = parseFloat(kerfInput) || 0;
    const piecesForNewStock = remnantPlan?.remainingPieces ?? group.pieces;
    const plan = optimizeCutPlan(piecesForNewStock, [stockLengthIn], kerf);
    setSelectedLength(stockLengthIn);
    setPreviewPlan(plan);
  };

  const canCommit = !!previewPlan && (previewPlan.bins.length > 0 || (remnantPlan?.bins?.length || 0) > 0);

  const handleCommit = async () => {
    if (!canCommit) return;
    setCommitting(true);
    try {
      const kerf = parseFloat(kerfInput) || 0;
      const plan = previewPlan.bins.length > 0 ? previewPlan : emptyPlan();
      // 0, not null, when nothing new was purchased (remnants covered the
      // whole group) — stock_length_used is a number field with no "N/A".
      const effectiveSelectedLength = plan.bins.length > 0 ? selectedLength : 0;
      const { run, units, purchaseOrderLine, remnantsConsumed } = await commitMaterialOptimizationRun({
        projectId, group, catalogItem: catalogMatch, plan, selectedLength: effectiveSelectedLength, kerf, remnantPlan,
      });
      setPastRuns((current) => [run, ...current]);
      setUnitsByRun((current) => ({ ...current, [run.id]: units }));
      if (remnantsConsumed > 0) {
        setRemnants((current) => current.filter((r) => !remnantPlan.bins.some((b) => b.remnant_id === r.id)));
      }
      const remnantNote = remnantsConsumed > 0 ? `${remnantsConsumed} remnant(s) consumed.` : '';
      toast({
        title: `Committed: ${plan.totals.quantity_of_stock_required} new stock length(s), ${plan.totals.utilization_pct || 0}% utilization`,
        description: [purchaseOrderLine ? `Added to PO line — ${units.length} stock unit(s) marked ordered.` : (units.length > 0 ? 'No preferred vendor configured for this stock length — units left as planned, no PO generated.' : null), remnantNote].filter(Boolean).join(' '),
      });
      setSelectedLength(null);
      setPreviewPlan(null);
      setRemnantPlan(null);
    } catch (e) {
      toast({ title: 'Commit failed', variant: 'destructive' });
    } finally {
      setCommitting(false);
    }
  };

  const toggleRunUnits = async (run) => {
    if (expandedRunId === run.id) {
      setExpandedRunId(null);
      return;
    }
    if (!unitsByRun[run.id]) {
      const units = await db.entities.StockMaterialUnit.filter({ material_optimization_run_id: run.id }, 'unit_number', 500);
      setUnitsByRun((current) => ({ ...current, [run.id]: units }));
    }
    setExpandedRunId(run.id);
  };

  const handleUnitUpdated = (updatedUnit) => {
    setUnitsByRun((current) => {
      const runId = updatedUnit.material_optimization_run_id;
      if (!current[runId]) return current;
      return { ...current, [runId]: current[runId].map((u) => (u.id === updatedUnit.id ? updatedUnit : u)) };
    });
  };

  const totalQuantity = group.pieces.reduce((sum, p) => sum + (Number(p.quantity) || 1), 0);

  if (loading) {
    return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-1 pr-3">Piece Mark</th>
              <th className="py-1 pr-3">Assembly</th>
              <th className="py-1 pr-3">Heat Number</th>
              <th className="py-1 pr-3">Finished Length</th>
              <th className="py-1 pr-3">Parsed (in)</th>
              <th className="py-1 pr-3">Qty</th>
              <th className="py-1 pr-3">Drawing</th>
            </tr>
          </thead>
          <tbody>
            {group.pieces.map((p) => {
              const parsed = getPieceLengthInches(p);
              return (
                <tr key={p.id} className="border-b border-border/50">
                  <td className="py-1 pr-3 font-medium">{p.piece_mark}</td>
                  <td className="py-1 pr-3">{p.assembly || '—'}</td>
                  <td className="py-1 pr-3">{p.heat_number || '—'}</td>
                  <td className="py-1 pr-3">{p.finished_length || '—'}</td>
                  <td className="py-1 pr-3">{parsed != null ? parsed.toFixed(2) : <span className="text-destructive">unparseable</span>}</td>
                  <td className="py-1 pr-3">{p.quantity ?? 1}</td>
                  <td className="py-1 pr-3">{p.drawing_number || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{group.pieces.length} piece mark(s), {totalQuantity} total unit(s)</p>

      <div className="flex items-end gap-6 flex-wrap">
        <div>
          <Label className="text-xs">Kerf Allowance (in)</Label>
          <Input value={kerfInput} onChange={(e) => setKerfInput(e.target.value)} placeholder="e.g. 0.125" className="mt-1 w-32" />
        </div>
        <Button variant="outline" size="sm" onClick={runComparison}>Recalculate</Button>
        <div>
          <Label className="text-xs">Remnant Threshold (in)</Label>
          <p className="text-[11px] text-muted-foreground mb-1">Minimum leftover length worth logging as a reusable remnant.</p>
          <div className="flex gap-1.5">
            <Input value={remnantThresholdInput} onChange={(e) => setRemnantThresholdInput(e.target.value)} className="w-24" />
            <Button variant="outline" size="sm" disabled={savingThreshold} onClick={saveRemnantThreshold}>Save</Button>
          </div>
        </div>
      </div>

      {matchingRemnants.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs space-y-2">
          <p className="font-semibold flex items-center gap-1.5 text-primary"><Recycle className="w-3.5 h-3.5" />{matchingRemnants.length} matching remnant(s) on hand for {group.material_profile} — {group.material_grade}</p>
          {remnantPlan?.bins?.length > 0 ? (
            <div className="space-y-1">
              {remnantPlan.bins.map((bin) => (
                <p key={bin.remnant_id}>
                  Remnant {bin.remnant_id.slice(0, 8)} ({bin.stock_length_in}") covers:{' '}
                  {bin.cuts.map((c) => piecesById.get(c.piece_id)?.piece_mark || c.piece_id).join(', ')}
                  {bin.heat_number ? ` — heat ${bin.heat_number} carried forward` : ' — no heat number on file for this remnant yet'}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">None of this group's pieces fit an on-hand remnant at the current kerf allowance.</p>
          )}
        </div>
      )}

      {!catalogMatch ? (
        (!remnantPlan || remnantPlan.remainingPieces.length > 0) && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs">
            <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
            <p>No steel_catalog shape matches "{group.material_profile || '(blank)'}" — add it under Admin &gt; Steel Inventory Catalog, then set up stock lengths for it, before this group can be optimized.</p>
          </div>
        )
      ) : stockOptions.length === 0 ? (
        (!remnantPlan || remnantPlan.remainingPieces.length > 0) && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs">
            <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
            <p>No active stock lengths configured for {catalogMatch.size_designation} — add them under Admin &gt; Steel Inventory Catalog.</p>
          </div>
        )
      ) : remnantPlan && remnantPlan.remainingPieces.length === 0 ? null : (
        <>
          <div className="steel-card overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Stock Length (in)</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Stock Required</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Utilization</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Waste (in)</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Remnant (in)</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((option) => (
                  <tr key={option.stock_length_in} className={`border-b border-border last:border-0 ${selectedLength === option.stock_length_in ? 'bg-primary/5' : ''}`}>
                    <td className="px-3 py-2 font-mono">{option.stock_length_in}</td>
                    <td className="px-3 py-2">{option.quantity_of_stock_required}</td>
                    <td className="px-3 py-2">{option.utilization_pct}%</td>
                    <td className="px-3 py-2">{option.waste_in}</td>
                    <td className="px-3 py-2">{option.remnant_length_in}</td>
                    <td className="px-3 py-2 text-right">
                      {!option.feasible ? (
                        <span className="text-destructive text-[11px]">{option.unpackablePieces.length} piece(s) too long</span>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => previewLength(option.stock_length_in)}>Use This Length</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </>
      )}

      {previewPlan && (
        <div className="steel-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Scissors className="w-4 h-4" /> Cut Plan Preview — {selectedLength ? `${selectedLength}" stock` : 'remnants only, no new stock required'}
            </h4>
            <Button size="sm" onClick={handleCommit} disabled={committing || !canCommit} className="steel-gradient text-white border-0">
              {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Commit Plan
            </Button>
          </div>
          {previewPlan.unpackablePieces.length > 0 && (
            <p className="text-xs text-destructive">{previewPlan.unpackablePieces.length} piece(s) excluded — too long for this stock length or an unparseable finished length.</p>
          )}
          {previewPlan.bins.length === 0 ? (
            <p className="text-xs text-muted-foreground">Every remaining piece in this group is covered by an on-hand remnant — nothing new to purchase.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-1 pr-3">Stock #</th>
                    <th className="py-1 pr-3">Cut Order</th>
                    <th className="py-1 pr-3">Piece Mark</th>
                    <th className="py-1 pr-3">Heat Number</th>
                    <th className="py-1 pr-3">Length (in)</th>
                    <th className="py-1 pr-3">Remnant (in)</th>
                  </tr>
                </thead>
                <tbody>
                  {previewPlan.bins.map((bin, binIndex) => bin.cuts.map((cut, cutIndex) => (
                    <tr key={`${binIndex}-${cutIndex}`} className="border-b border-border/50">
                      <td className="py-1 pr-3">{binIndex + 1}</td>
                      <td className="py-1 pr-3">{cut.cut_order}</td>
                      <td className="py-1 pr-3 font-medium">{piecesById.get(cut.piece_id)?.piece_mark || cut.piece_id}</td>
                      <td className="py-1 pr-3">{piecesById.get(cut.piece_id)?.heat_number || '—'}</td>
                      <td className="py-1 pr-3">{cut.length_in.toFixed(2)}</td>
                      <td className="py-1 pr-3">{cutIndex === bin.cuts.length - 1 ? (bin.stock_length_in - bin.used_in).toFixed(2) : ''}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {pastRuns.length > 0 && (
        <div className="steel-card p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Committed Runs</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-1 pr-3"></th>
                <th className="py-1 pr-3">Date</th>
                <th className="py-1 pr-3">Stock Length</th>
                <th className="py-1 pr-3">Stock Required</th>
                <th className="py-1 pr-3">Utilization</th>
                <th className="py-1 pr-3">Waste (in)</th>
              </tr>
            </thead>
            <tbody>
              {pastRuns.map((run) => {
                const runExpanded = expandedRunId === run.id;
                const units = unitsByRun[run.id] || [];
                return (
                  <React.Fragment key={run.id}>
                    <tr className="border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/30" onClick={() => toggleRunUnits(run)}>
                      <td className="py-1 pr-3">{runExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                      <td className="py-1 pr-3">{run.created_date ? new Date(run.created_date).toLocaleString() : '—'}</td>
                      <td className="py-1 pr-3">{run.stock_length_used}"</td>
                      <td className="py-1 pr-3">{run.quantity_of_stock_required}</td>
                      <td className="py-1 pr-3">{run.utilization_pct}%</td>
                      <td className="py-1 pr-3">{run.waste_in}</td>
                    </tr>
                    {runExpanded && (
                      <tr>
                        <td colSpan={6} className="py-2 pl-6 pr-3 bg-muted/20">
                          {units.length === 0 ? (
                            <p className="text-muted-foreground py-1">No stock units found.</p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-muted-foreground border-b border-border">
                                  <th className="py-1 pr-3">Unit</th>
                                  <th className="py-1 pr-3">Status</th>
                                  <th className="py-1 pr-3">Heat Number</th>
                                  <th className="py-1 pr-3">Received</th>
                                  <th className="py-1 pr-3">PO Line</th>
                                </tr>
                              </thead>
                              <tbody>
                                {units.map((unit) => (
                                  <tr key={unit.id} className="border-b border-border/30 last:border-0 cursor-pointer hover:bg-muted/40" onClick={() => setViewingUnitId(unit.id)}>
                                    <td className="py-1 pr-3">{unit.unit_number}</td>
                                    <td className="py-1 pr-3 capitalize">{unit.status}</td>
                                    <td className="py-1 pr-3">{unit.heat_number || '—'}</td>
                                    <td className="py-1 pr-3">{unit.received_date ? new Date(unit.received_date).toLocaleDateString() : '—'}</td>
                                    <td className="py-1 pr-3">{unit.purchase_order_line_id ? 'Linked' : '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <StockMaterialUnitDetailModal
        open={!!viewingUnitId}
        onOpenChange={(o) => !o && setViewingUnitId(null)}
        unitId={viewingUnitId}
        onUnitUpdated={handleUnitUpdated}
        remnantThresholdIn={parseFloat(remnantThresholdInput) || settings?.remnant_minimum_useful_length_in || 24}
      />
    </div>
  );
}
