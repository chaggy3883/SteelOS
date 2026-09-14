import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, FileCheck } from 'lucide-react';
import { openDocumentViewer } from '@/lib/openDocumentViewer';

const vehicleLabel = (v) => (v || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Read-only drill-down for an AdHocShipment row — the Ad-Hoc Shipments list's
// standing-rule click target, mirroring LoadDetailModal's shape for formal
// loads but without any status/weight concepts this entity doesn't have.
export default function AdHocShipmentDetailModal({ open, onOpenChange, shipmentId }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [shipment, setShipment] = useState(null);
  const [project, setProject] = useState(null);

  useEffect(() => {
    if (!open || !shipmentId) return;
    let cancelled = false;
    setLoading(true);
    setShipment(null);
    setProject(null);

    (async () => {
      try {
        const record = await db.entities.AdHocShipment.get(shipmentId);
        if (!record) return;
        const projectRecord = record.project_id ? await db.entities.Project.get(record.project_id).catch(() => null) : null;
        if (cancelled) return;
        setShipment(record);
        setProject(projectRecord);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, shipmentId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !shipment ? (
          <div className="py-10 text-center">
            <p className="text-sm text-destructive">Could not load this shipment.</p>
            <div className="flex justify-center mt-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{shipment.shipment_number_id}</DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Project</p>
                {project ? (
                  <button className="font-medium text-primary hover:underline text-left" onClick={() => navigate(`/projects/${project.id}`)}>
                    {project.name}
                  </button>
                ) : <p className="font-medium">No specific project</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ship Date</p>
                <p className="font-medium">{shipment.ship_date || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Carrier</p>
                <p className="font-medium">{shipment.carrier || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Vehicle</p>
                <p className="font-medium">{vehicleLabel(shipment.vehicle_type)}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">Destination</p>
                <p className="font-medium whitespace-pre-line">{shipment.destination_address || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created By</p>
                <p className="font-medium">{shipment.created_by || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="font-medium">{shipment.created_date ? new Date(shipment.created_date).toLocaleDateString() : '—'}</p>
              </div>
            </div>

            {shipment.notes && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Notes</p>
                <p className="text-sm whitespace-pre-line">{shipment.notes}</p>
              </div>
            )}

            <div>
              <h4 className="font-semibold text-sm mb-2">Line Items</h4>
              {(shipment.line_items || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No line items.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="py-2 pr-3">Description</th>
                        <th className="py-2 pr-3 text-right">Qty</th>
                        <th className="py-2 pr-3">Unit</th>
                        <th className="py-2 pr-3">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(shipment.line_items || []).map((li, idx) => (
                        <tr key={idx} className="border-b border-border/50">
                          <td className="py-2 pr-3">{li.description}</td>
                          <td className="py-2 pr-3 text-right font-mono">{li.quantity}</td>
                          <td className="py-2 pr-3">{li.unit || '—'}</td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{li.source_qr_payload ? 'Scanned' : 'Manual'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {shipment && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            {shipment.bol_pdf_data_uri && (
              <Button variant="outline" className="gap-2" onClick={() => openDocumentViewer(shipment.bol_pdf_data_uri, `BOL-${shipment.shipment_number_id || ''}.pdf`)}>
                <FileCheck className="w-4 h-4" />View / Print BOL
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
