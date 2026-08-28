import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { getEffectiveCompanyId } from '@/lib/tenantContext';
import { optimizeCutPlan, compareStockLengthOptions, toPiecesAssigned, getPieceLengthInches } from '@/lib/materialOptimizer';
import { normalizeMaterialProfile } from '@/lib/materialProfileMatch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Scissors, CheckCircle2, AlertTriangle } from 'lucide-react';

// STAGE 5: one panel per material group (shape + grade). Shows the pieces in
// the group, the stock-length comparison (compareStockLengthOptions), a live
// preview of the chosen length's cut plan (optimizeCutPlan) — re-runnable
// against a different length before anything is written — and the commit
// action that writes one MaterialOptimizationRun.
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

  const piecesById = useMemo(() => new Map(group.pieces.map((p) => [p.id, p])), [group.pieces]);

  useEffect(() => { loadData(); }, [group.group_key]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [catalog, runs] = await Promise.all([
        db.entities.steel_catalog.list('size_designation', 5000),
        db.entities.MaterialOptimizationRun.filter({ project_id: projectId, material_group_key: group.group_key }, '-created_date', 50),
      ]);
      const normalizedProfile = normalizeMaterialProfile(group.material_profile);
      const match = normalizedProfile ? catalog.find((c) => normalizeMaterialProfile(c.size_designation) === normalizedProfile) : null;
      setCatalogMatch(match || null);
      setPastRuns(runs);

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

  const runComparison = () => {
    const kerf = parseFloat(kerfInput) || 0;
    if (stockOptions.length === 0) {
      setComparison([]);
      return;
    }
    setComparison(compareStockLengthOptions(group.pieces, stockOptions.map((o) => o.stock_length_in), kerf));
    setSelectedLength(null);
    setPreviewPlan(null);
  };

  useEffect(() => {
    if (stockOptions.length > 0) runComparison();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockOptions]);

  const previewLength = (stockLengthIn) => {
    const kerf = parseFloat(kerfInput) || 0;
    const plan = optimizeCutPlan(group.pieces, [stockLengthIn], kerf);
    setSelectedLength(stockLengthIn);
    setPreviewPlan(plan);
  };

  const handleCommit = async () => {
    if (!previewPlan || previewPlan.bins.length === 0) return;
    setCommitting(true);
    try {
      const kerf = parseFloat(kerfInput) || 0;
      const record = await db.entities.MaterialOptimizationRun.create({
        company_id: getEffectiveCompanyId(),
        project_id: projectId,
        material_group_key: group.group_key,
        stock_length_used: selectedLength,
        quantity_of_stock_required: previewPlan.totals.quantity_of_stock_required,
        pieces_assigned: toPiecesAssigned(previewPlan.bins),
        remnant_length_in: previewPlan.totals.remnant_length_in,
        waste_in: previewPlan.totals.waste_in,
        utilization_pct: previewPlan.totals.utilization_pct,
        kerf_allowance_used: kerf,
      });
      setPastRuns((current) => [record, ...current]);
      toast({ title: `Committed: ${previewPlan.totals.quantity_of_stock_required} stock length(s), ${previewPlan.totals.utilization_pct}% utilization` });
    } catch (e) {
      toast({ title: 'Commit failed', variant: 'destructive' });
    } finally {
      setCommitting(false);
    }
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

      {!catalogMatch ? (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs">
          <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
          <p>No steel_catalog shape matches "{group.material_profile || '(blank)'}" — add it under Admin &gt; Steel Inventory Catalog, then set up stock lengths for it, before this group can be optimized.</p>
        </div>
      ) : stockOptions.length === 0 ? (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs">
          <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
          <p>No active stock lengths configured for {catalogMatch.size_designation} — add them under Admin &gt; Steel Inventory Catalog.</p>
        </div>
      ) : (
        <>
          <div className="flex items-end gap-3">
            <div>
              <Label className="text-xs">Kerf Allowance (in)</Label>
              <Input value={kerfInput} onChange={(e) => setKerfInput(e.target.value)} placeholder="e.g. 0.125" className="mt-1 w-32" />
            </div>
            <Button variant="outline" size="sm" onClick={runComparison}>Recalculate</Button>
          </div>

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

          {previewPlan && (
            <div className="steel-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold flex items-center gap-2"><Scissors className="w-4 h-4" /> Cut Plan Preview — {selectedLength}" stock</h4>
                <Button size="sm" onClick={handleCommit} disabled={committing || previewPlan.bins.length === 0} className="steel-gradient text-white border-0">
                  {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Commit Plan
                </Button>
              </div>
              {previewPlan.unpackablePieces.length > 0 && (
                <p className="text-xs text-destructive">{previewPlan.unpackablePieces.length} piece(s) excluded — too long for this stock length or an unparseable finished length.</p>
              )}
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
            </div>
          )}
        </>
      )}

      {pastRuns.length > 0 && (
        <div className="steel-card p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Committed Runs</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-1 pr-3">Date</th>
                <th className="py-1 pr-3">Stock Length</th>
                <th className="py-1 pr-3">Stock Required</th>
                <th className="py-1 pr-3">Utilization</th>
                <th className="py-1 pr-3">Waste (in)</th>
              </tr>
            </thead>
            <tbody>
              {pastRuns.map((run) => (
                <tr key={run.id} className="border-b border-border/50 last:border-0">
                  <td className="py-1 pr-3">{run.created_date ? new Date(run.created_date).toLocaleString() : '—'}</td>
                  <td className="py-1 pr-3">{run.stock_length_used}"</td>
                  <td className="py-1 pr-3">{run.quantity_of_stock_required}</td>
                  <td className="py-1 pr-3">{run.utilization_pct}%</td>
                  <td className="py-1 pr-3">{run.waste_in}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
