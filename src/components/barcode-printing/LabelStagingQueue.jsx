import React, { useMemo } from 'react';
import { Printer, PackageCheck, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';

function isTagged(printJobs, targetId, labelType) {
  return printJobs.some((j) => j.target_record_id === targetId && j.label_type === labelType && j.status === 'Printed');
}

export default function LabelStagingQueue({ pieces, manifests, printJobs, onPrintPiece, onPrintManifest }) {
  const piecesAwaiting = useMemo(
    () => pieces.filter((p) => !isTagged(printJobs, p.id, 'Piece_Mark')),
    [pieces, printJobs]
  );
  const manifestsAwaiting = useMemo(
    () => manifests.filter((m) => !isTagged(printJobs, m.id, 'Shipping_Manifest')),
    [manifests, printJobs]
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <PackageCheck className="w-4 h-4 text-primary" />Pieces Awaiting Tagging ({piecesAwaiting.length})
        </h4>
        {piecesAwaiting.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">All received pieces are tagged.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {piecesAwaiting.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">{p.piece_mark}</p>
                  <p className="text-xs text-muted-foreground truncate">{p.material_shape}</p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5 flex-shrink-0" onClick={() => onPrintPiece(p)}>
                  <Printer className="w-3.5 h-3.5" />Tag
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Truck className="w-4 h-4 text-primary" />Loads Awaiting Manifest Tag ({manifestsAwaiting.length})
        </h4>
        {manifestsAwaiting.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">All built loads have a manifest tag.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {manifestsAwaiting.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">{m.driver_name}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">{m.manifest_qr_payload_string}</p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5 flex-shrink-0" onClick={() => onPrintManifest(m)}>
                  <Printer className="w-3.5 h-3.5" />Tag
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
