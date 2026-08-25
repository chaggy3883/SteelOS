import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/ui/StatusBadge';
import { Loader2 } from 'lucide-react';

// Read-only detail view for a progress billing (InvoiceReceivable) — the
// drill-down target for billing period, amounts, and status cells. There's
// no direct FK from an AIA billing to specific SOV lines in this data model,
// so this shows the project's current Schedule of Values as the composing
// context rather than fabricating a period-specific link.
export default function InvoiceReceivableDetailModal({ open, onOpenChange, invoiceId }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [project, setProject] = useState(null);
  const [sovLines, setSovLines] = useState([]);

  useEffect(() => {
    if (!open || !invoiceId) return;
    let cancelled = false;
    setLoading(true);
    setInvoice(null); setProject(null); setSovLines([]);

    (async () => {
      try {
        const invoiceRecord = await db.entities.InvoiceReceivable.get(invoiceId);
        if (!invoiceRecord) return;
        const [projectRecord, sovRows] = await Promise.all([
          invoiceRecord.project_id ? db.entities.Project.get(invoiceRecord.project_id).catch(() => null) : Promise.resolve(null),
          invoiceRecord.project_id ? db.entities.SovLine.filter({ project_id: invoiceRecord.project_id }, '-created_date', 200).catch(() => []) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setInvoice(invoiceRecord);
        setProject(projectRecord);
        setSovLines(sovRows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, invoiceId]);

  const sovBilledTotal = sovLines.reduce((s, l) => s + (Number(l.current_billed_amount) || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !invoice ? (
          <div className="py-10 text-center">
            <p className="text-sm text-destructive">Could not load this progress billing.</p>
            <div className="flex justify-center mt-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span>Progress Billing — {invoice.billing_period}</span>
                <StatusBadge status={invoice.payment_status} />
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Project</p>
                {project ? (
                  <button className="font-medium text-primary hover:underline" onClick={() => navigate(`/projects/${project.id}`)}>{project.name}</button>
                ) : <p className="font-medium">—</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Expected Payment Date</p>
                <p className="font-medium">{invoice.expected_payment_date || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Gross Amount</p>
                <p className="font-mono font-bold">${(invoice.gross_amount || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Retainage Held</p>
                <p className="font-mono font-bold">${(invoice.retainage_held || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Net Billing</p>
                <p className="font-mono font-bold">${(invoice.net_billing || 0).toLocaleString()}</p>
              </div>
            </div>

            {invoice.billing_type === 'time_and_material' ? (
              <div>
                <h4 className="font-semibold text-sm mb-2">Time &amp; Material Breakdown</h4>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-border/50"><td className="py-2 pr-3 text-muted-foreground">Labor</td><td className="py-2 pr-3 text-right font-mono">${(invoice.tm_labor_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>
                    <tr className="border-b border-border/50"><td className="py-2 pr-3 text-muted-foreground">Materials</td><td className="py-2 pr-3 text-right font-mono">${(invoice.tm_material_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>
                    <tr className="border-b border-border/50"><td className="py-2 pr-3 text-muted-foreground">Subcontractors</td><td className="py-2 pr-3 text-right font-mono">${(invoice.tm_subcontractor_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>
                    <tr><td className="py-2 pr-3 text-muted-foreground">Markup</td><td className="py-2 pr-3 text-right font-mono">${(invoice.tm_markup_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>
                  </tbody>
                </table>
                {project && (
                  <button className="text-xs text-primary hover:underline mt-2" onClick={() => navigate(`/projects/${project.id}`, { state: { tab: 'tm-tracking' } })}>
                    View T&amp;M Tracking for this project →
                  </button>
                )}
              </div>
            ) : (
            <div>
              <h4 className="font-semibold text-sm mb-2">Schedule of Values — {project?.name || 'this project'}</h4>
              <p className="text-xs text-muted-foreground mb-2">
                Billings aren't linked to specific SOV lines in this data model — shown for reference as the composing context for this project's billed amounts.
              </p>
              {sovLines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No SOV lines on file for this project.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="py-2 pr-3">Item</th>
                        <th className="py-2 pr-3 text-right">% Complete</th>
                        <th className="py-2 pr-3 text-right">Billed to Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sovLines.map((l) => (
                        <tr key={l.id} className="border-b border-border/50">
                          <td className="py-2 pr-3">{l.item_description}</td>
                          <td className="py-2 pr-3 text-right font-mono">{l.completion_percentage || 0}%</td>
                          <td className="py-2 pr-3 text-right font-mono">${(l.current_billed_amount || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2} className="py-2 pr-3 text-right font-semibold">Total Billed to Date</td>
                        <td className="py-2 pr-3 text-right font-mono font-bold">${sovBilledTotal.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
            )}
          </>
        )}

        {invoice && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
