import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

// Single shared definition — previously duplicated in ReceivingKiosk.jsx.
export const PO_STATUS_STYLES = {
  'Fully Received': 'border-transparent bg-green-500/10 text-green-600',
  'Partial Receipt': 'border-transparent bg-orange-500/10 text-orange-600',
};
export const DEFAULT_PO_STATUS_STYLE = 'border-transparent bg-muted text-muted-foreground';

// Receiving logs don't have a dedicated "condition" field — ReceivingKiosk's
// own submitReceiving() writes it into notes as "Condition: <value>", so
// this pulls it back out for display; anything not following that
// convention (e.g. logs created via ProcurementModule's simpler form) just
// falls back to showing the raw notes text.
const extractCondition = (notes) => {
  const match = notes?.match(/Condition:\s*(.+)/i);
  return match?.[1] || notes || '—';
};

export default function PurchaseOrderDetailModal({ open, onOpenChange, poId, showCosts = true }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [po, setPo] = useState(null);
  const [lines, setLines] = useState([]);
  const [logs, setLogs] = useState([]);
  const [project, setProject] = useState(null);
  const [vendor, setVendor] = useState(null);

  useEffect(() => {
    if (!open || !poId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPo(null);
    setLines([]);
    setLogs([]);
    setProject(null);
    setVendor(null);

    (async () => {
      try {
        const poRecord = await db.entities.purchase_orders.get(poId);
        if (!poRecord) throw new Error('Purchase order not found');
        const [lineList, logList, projectRecord, vendorRecord] = await Promise.all([
          db.entities.purchase_order_lines.filter({ po_id: poId }, 'line_number', 200),
          db.entities.receiving_logs.filter({ po_id: poId }, '-created_date', 100),
          poRecord.project_id ? db.entities.Project.get(poRecord.project_id).catch(() => null) : Promise.resolve(null),
          poRecord.vendor_id ? db.entities.Vendor.get(poRecord.vendor_id).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setPo(poRecord);
        setLines(lineList);
        setLogs(logList);
        setProject(projectRecord);
        setVendor(vendorRecord);
      } catch (e) {
        if (!cancelled) setError('Could not load this purchase order.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, poId]);

  const totalOrdered = lines.reduce((sum, l) => sum + (Number(l.quantity_ordered) || 0), 0);
  const totalReceived = lines.reduce((sum, l) => sum + (Number(l.quantity_received) || 0), 0);
  const progressPct = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0;
  const columnCount = showCosts ? 9 : 7;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <div className="flex justify-center mt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        ) : po ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span>{po.po_number}</span>
                <Badge className={PO_STATUS_STYLES[po.status] || DEFAULT_PO_STATUS_STYLE}>{po.status || 'Open'}</Badge>
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Vendor</p>
                <p className="font-medium">{vendor?.name || po.vendor_name || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Project</p>
                <p className="font-medium">{project?.name || 'No project linked'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Payment Terms</p>
                <p className="font-medium">{po.payment_terms || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Order Date</p>
                <p className="font-medium">{po.created_date ? new Date(po.created_date).toLocaleDateString() : '—'}</p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-sm">Receiving Progress</Label>
                <span className="text-sm font-medium">{totalReceived} of {totalOrdered} received</span>
              </div>
              <Progress value={progressPct} className="h-2.5" />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                    <th className="py-2 pr-3">Line</th>
                    <th className="py-2 pr-3">Description</th>
                    <th className="py-2 pr-3">Category</th>
                    <th className="py-2 pr-3">Qty Ordered</th>
                    <th className="py-2 pr-3">Qty Received</th>
                    <th className="py-2 pr-3">Qty Remaining</th>
                    {showCosts && <th className="py-2 pr-3 text-right">Unit Cost</th>}
                    {showCosts && <th className="py-2 pr-3 text-right">Line Total</th>}
                    <th className="py-2 pr-3 text-center">Fully Received</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr><td colSpan={columnCount} className="py-6 text-center text-muted-foreground">No line items.</td></tr>
                  ) : lines.map((line) => {
                    const remaining = line.quantity_remaining || Math.max(0, (Number(line.quantity_ordered) || 0) - (Number(line.quantity_received) || 0));
                    return (
                      <tr key={line.id} className="border-b border-border/60">
                        <td className="py-2 pr-3">{line.line_number}</td>
                        <td className="py-2 pr-3">{line.description}</td>
                        <td className="py-2 pr-3">{line.material_category || '—'}</td>
                        <td className="py-2 pr-3">{line.quantity_ordered} {line.unit_of_measure}</td>
                        <td className="py-2 pr-3">{line.quantity_received}</td>
                        <td className="py-2 pr-3">{remaining}</td>
                        {showCosts && <td className="py-2 pr-3 text-right">${Number(line.unit_cost || 0).toLocaleString()}</td>}
                        {showCosts && <td className="py-2 pr-3 text-right">${Number(line.line_total || 0).toLocaleString()}</td>}
                        <td className="py-2 pr-3 text-center">
                          {line.is_fully_received ? <CheckCircle2 className="w-4 h-4 text-green-500 inline" /> : <XCircle className="w-4 h-4 text-muted-foreground inline" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Receiving History</h4>
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No receiving activity yet.</p>
              ) : (
                <div className="space-y-2">
                  {logs.map((log) => (
                    <div key={log.id} className="p-2.5 rounded-lg border border-border text-sm">
                      <p className="font-medium">
                        {log.created_date ? new Date(log.created_date).toLocaleDateString() : '—'} · Received {log.quantity_received_this_delivery || log.quantity_received || 0}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {log.material_heat_number ? `Heat ${log.material_heat_number} · ` : ''}
                        Condition: {extractCondition(log.notes)}
                        {log.receiver_name ? ` · ${log.receiver_name}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}

        {po && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
