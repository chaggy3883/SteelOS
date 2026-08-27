import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, FileCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import StatusHistoryModal from '@/components/shared/StatusHistoryModal';
import { openDocumentViewer } from '@/lib/openDocumentViewer';

const STATUS_STYLES = {
  Draft: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  Staged: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  Partial_Loaded: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  Loaded: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  Inspected: 'bg-teal-500/10 text-teal-600 border-teal-500/20',
  In_Transit: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  Delivered: 'bg-green-500/10 text-green-600 border-green-500/20',
  Field_Issue: 'bg-red-500/10 text-red-500 border-red-500/20',
};

// Read-only "full record" view for a Load — the drill-down target for load
// number, piece count, total weight, destination, and status cells across
// Shipping.jsx, LoadBuilder, and YardScanning. Self-fetches everything so it
// can be opened from any of those three surfaces without prop-drilling their
// partially-loaded lists.
export default function LoadDetailModal({ open, onOpenChange, loadId, onViewPiece, onViewManifest }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [load, setLoad] = useState(null);
  const [items, setItems] = useState([]);
  const [project, setProject] = useState(null);
  const [carrier, setCarrier] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [showStatusHistory, setShowStatusHistory] = useState(false);

  useEffect(() => {
    if (!open || !loadId) return;
    let cancelled = false;
    setLoading(true);
    setLoad(null); setItems([]); setProject(null); setCarrier(null); setManifest(null);

    (async () => {
      try {
        const loadRecord = await db.entities.loads.get(loadId);
        if (!loadRecord) return;
        const [itemRows, manifestRows, projectRecord, carrierRecord] = await Promise.all([
          db.entities.load_items.filter({ load_id: loadId }, 'sequence_number', 200).catch(() => []),
          db.entities.shipping_manifests.filter({ load_id: loadId }, '-created_date', 5).catch(() => []),
          loadRecord.project_id ? db.entities.Project.get(loadRecord.project_id).catch(() => null) : Promise.resolve(null),
          loadRecord.carrier_vendor_id ? db.entities.Vendor.get(loadRecord.carrier_vendor_id).catch(() => null) : Promise.resolve(null),
        ]);
        const itemsWithPieces = await Promise.all(itemRows.map(async (item) => {
          const piece = await db.entities.pieces.get(item.piece_id).catch(() => null);
          return { ...item, piece };
        }));
        if (cancelled) return;
        setLoad(loadRecord);
        setItems(itemsWithPieces);
        setProject(projectRecord);
        setCarrier(carrierRecord);
        setManifest(manifestRows[0] || null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, loadId]);

  const totalWeight = items.reduce((sum, i) => sum + (i.piece?.weight || 0), 0);
  const capacity = load?.max_weight_capacity_lbs || 45000;
  const isOverweight = totalWeight > capacity;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !load ? (
          <div className="py-10 text-center">
            <p className="text-sm text-destructive">Could not load this shipment.</p>
            <div className="flex justify-center mt-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span>{load.load_number_id}</span>
                <button type="button" onClick={() => setShowStatusHistory(true)}>
                  <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border', STATUS_STYLES[load.status] || STATUS_STYLES.Draft)}>
                    {(load.status || 'Draft').replace(/_/g, ' ')}
                  </span>
                </button>
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Project / Destination</p>
                {project ? (
                  <button className="font-medium text-primary hover:underline text-left" onClick={() => navigate(`/projects/${project.id}`)}>
                    {project.name}
                    {(project.city || project.state) && <span className="block text-xs text-muted-foreground font-normal">{[project.city, project.state].filter(Boolean).join(', ')}</span>}
                  </button>
                ) : <p className="font-medium">—</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Trailer Number</p>
                <p className="font-medium">{load.trailer_number || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Carrier</p>
                {load.carrier_name ? (
                  <p className="font-medium">{load.carrier_name}</p>
                ) : carrier ? (
                  <button className="font-medium text-primary hover:underline" onClick={() => navigate(`/crm/directory?vendor=${carrier.id}`)}>{carrier.name}</button>
                ) : <p className="font-medium">—</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Weight</p>
                <p className={cn('font-mono font-bold flex items-center gap-1.5', isOverweight && 'text-red-500')}>
                  {isOverweight && <AlertTriangle className="w-3.5 h-3.5" />}
                  {totalWeight.toLocaleString()} / {capacity.toLocaleString()} lbs
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pieces</p>
                <p className="font-mono font-bold">{items.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="font-medium">{load.created_date ? new Date(load.created_date).toLocaleDateString() : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last Updated</p>
                <p className="font-medium">{load.updated_date ? new Date(load.updated_date).toLocaleDateString() : '—'}</p>
              </div>
            </div>

            {manifest && (
              <div className="rounded-lg border border-border p-3 space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm">Shipping Manifest</h4>
                  <button className="text-primary hover:underline text-xs" onClick={() => onViewManifest?.(manifest.id)}>View Manifest</button>
                </div>
                <p className="text-xs text-muted-foreground">Driver: {manifest.driver_name || '—'} • Trailer: {(manifest.trailer_type || '').replace(/_/g, ' ')}</p>
              </div>
            )}

            <div>
              <h4 className="font-semibold text-sm mb-2">Load Items</h4>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pieces staged on this load yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="py-2 pr-3">Seq</th>
                        <th className="py-2 pr-3">Piece Mark</th>
                        <th className="py-2 pr-3 text-right">Weight</th>
                        <th className="py-2 pr-3">Item Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} className="border-b border-border/50">
                          <td className="py-2 pr-3">{item.sequence_number}</td>
                          <td className="py-2 pr-3">
                            {item.piece ? (
                              <button className="font-mono font-bold text-primary hover:underline" onClick={() => onViewPiece?.({ pieceId: item.piece.id })}>
                                {item.piece.piece_mark}
                              </button>
                            ) : '—'}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">{(item.piece?.weight || 0).toLocaleString()} lbs</td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{item.status}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2} className="py-2 pr-3 text-right font-semibold">Total</td>
                        <td className="py-2 pr-3 text-right font-mono font-bold">{totalWeight.toLocaleString()} lbs</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {load && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            {load.bol_pdf_data_uri && (
              <Button variant="outline" className="gap-2" onClick={() => openDocumentViewer(load.bol_pdf_data_uri, `BOL-${load.load_number_id || ''}.pdf`)}>
                <FileCheck className="w-4 h-4" />View / Print BOL
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
      <StatusHistoryModal
        open={showStatusHistory}
        onOpenChange={setShowStatusHistory}
        entityType="loads"
        entityId={load?.id}
        fieldName="status"
        title={`${load?.load_number_id || 'Load'} — Status History`}
      />
    </Dialog>
  );
}
