import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/api/apiClient';
import { buildMaterialOptimizationReport } from '@/lib/materialOptimizationReport';
import { exportNodeToPdf } from '@/lib/exportNodeToPdf';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Download, Loader2, Package, Boxes, Recycle, Scale, Percent } from 'lucide-react';

const money = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);

// STAGE 12: read-only rollup over already-committed MaterialOptimizationRun
// rows for one project — never re-runs the optimizer, never writes anything.
// pieces: the parent MaterialOptimization.jsx page's already-loaded PieceMark
// list for this project, reused here (keyed by id) rather than fetched again,
// since it's the only source for a remnant-cut piece's length (see
// materialOptimizationReport.js's header comment).
export default function MaterialOptimizationReportPanel({ projectId, projectName, pieces, onViewGroup }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState(null);
  const [runCount, setRunCount] = useState(0);
  const reportRef = useRef(null);

  const pieceMarksById = useMemo(() => new Map((pieces || []).map((p) => [p.id, p])), [pieces]);

  useEffect(() => { if (projectId) loadReport(); }, [projectId, pieces]);

  const loadReport = async () => {
    setLoading(true);
    try {
      const runs = await db.entities.MaterialOptimizationRun.filter({ project_id: projectId }, '-created_date', 1000);
      setRunCount(runs.length);
      if (runs.length === 0) {
        setReport(buildMaterialOptimizationReport({ runs: [], pieceMarksById, purchaseOrderLines: [] }));
        return;
      }
      const runIds = new Set(runs.map((r) => r.id));
      const allPoLines = await db.entities.purchase_order_lines.list('-created_date', 5000);
      const relevantPoLines = allPoLines.filter((l) => l.material_optimization_run_id && runIds.has(l.material_optimization_run_id));
      setReport(buildMaterialOptimizationReport({ runs, pieceMarksById, purchaseOrderLines: relevantPoLines }));
    } catch (e) {
      toast({ title: 'Unable to build material optimization report', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => exportNodeToPdf(reportRef.current, `material-optimization-report-${(projectName || 'project').replace(/[^a-z0-9]+/gi, '-')}.pdf`);

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  if (!report || runCount === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No committed material optimization runs yet for this project — commit a cut plan from the Groups tab first.</p>;
  }

  const { totals } = report;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5"><Download className="w-3.5 h-3.5" />Export to PDF</Button>
      </div>

      <div ref={reportRef} className="space-y-6 bg-background p-1">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Package className="w-4 h-4 text-blue-500" /><p className="text-xs text-muted-foreground">Material Required</p></div>
            <p className="text-xl font-bold">{totals.required_display || '0\''}</p>
          </div>
          <div className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Recycle className="w-4 h-4 text-green-500" /><p className="text-xs text-muted-foreground">In Inventory (Remnants)</p></div>
            <p className="text-xl font-bold">{totals.in_inventory_display || '0\''}</p>
          </div>
          <div className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Boxes className="w-4 h-4 text-orange-500" /><p className="text-xs text-muted-foreground">Purchased New Stock</p></div>
            <p className="text-xl font-bold">{totals.purchased_display || '0\''}</p>
          </div>
          <div className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Percent className="w-4 h-4 text-primary" /><p className="text-xs text-muted-foreground">Utilization</p></div>
            <p className="text-xl font-bold">{pct(totals.utilization_pct)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Scale className="w-4 h-4 text-muted-foreground" /><p className="text-xs text-muted-foreground">Waste / Remnant Left On Purchased Stock</p></div>
            <p className="text-lg font-semibold">{totals.waste_in}" waste total, {totals.remnant_in}" left as new remnant</p>
          </div>
          <div className="steel-card p-4">
            <p className="text-xs text-muted-foreground mb-1">Estimated vs. Actual Material Cost</p>
            <p className="text-lg font-semibold">
              {money(totals.estimated_cost ?? totals.estimated_cost_partial)} est.
              {totals.estimated_cost === null && <span className="text-xs font-normal text-muted-foreground"> (partial — some stock has no vendor cost on file)</span>}
              {' vs. '}
              {money(totals.actual_cost)} actual{totals.actual_cost !== null && totals.actual_cost !== totals.estimated_cost && ' (received to date)'}
            </p>
          </div>
        </div>

        <div className="steel-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stock Lengths Required</p></div>
          {report.stockLengthSummary.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No new stock purchased — every piece was covered by on-hand remnants.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-2 px-4">Stock Length</th>
                  <th className="text-right py-2 px-4">Quantity Required</th>
                </tr>
              </thead>
              <tbody>
                {report.stockLengthSummary.map((row) => (
                  <tr key={row.length_in} className="border-b border-border/50 last:border-0">
                    <td className="py-2 px-4 font-mono">{row.length_in}"</td>
                    <td className="py-2 px-4 text-right font-mono">{row.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="steel-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">By Material (Shape + Grade)</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-2 px-4">Material</th>
                  <th className="text-right py-2 px-4">Required</th>
                  <th className="text-right py-2 px-4">In Inventory</th>
                  <th className="text-right py-2 px-4">To Purchase</th>
                  <th className="text-right py-2 px-4">Waste (in)</th>
                  <th className="text-right py-2 px-4">Remnant (in)</th>
                  <th className="text-right py-2 px-4">Utilization</th>
                  <th className="text-right py-2 px-4">Est. Cost</th>
                  <th className="text-right py-2 px-4">Actual Cost</th>
                </tr>
              </thead>
              <tbody>
                {report.groups.map((g) => (
                  <tr
                    key={g.group_key}
                    role="button"
                    tabIndex={0}
                    onClick={() => onViewGroup?.(g.group_key)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onViewGroup?.(g.group_key); }}
                    className="border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/40"
                  >
                    <td className="py-2 px-4 font-medium">{g.material_profile || '(no profile)'} — {g.material_grade || '(no grade)'}</td>
                    <td className="py-2 px-4 text-right font-mono">{g.required_display}</td>
                    <td className="py-2 px-4 text-right font-mono">{g.in_inventory_display}</td>
                    <td className="py-2 px-4 text-right font-mono">{g.purchased_display}</td>
                    <td className="py-2 px-4 text-right font-mono">{g.waste_in}</td>
                    <td className="py-2 px-4 text-right font-mono">{g.remnant_in}</td>
                    <td className="py-2 px-4 text-right font-mono">{pct(g.utilization_pct)}</td>
                    <td className="py-2 px-4 text-right font-mono">{money(g.estimated_cost)}</td>
                    <td className="py-2 px-4 text-right font-mono">{money(g.actual_cost)}{g.actual_cost !== null && !g.actual_cost_complete && <span className="text-muted-foreground"> (partial)</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
