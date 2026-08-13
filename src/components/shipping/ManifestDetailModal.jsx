import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Printer } from 'lucide-react';
import { LABEL_STOCK_SIZES, buildZplPayload } from '@/lib/zplLabels';
import PrintableLabelSheet from '@/components/barcode-printing/PrintableLabelSheet';

// Read-only detail + print view for a shipping manifest — the drill-down
// target for "manifest number" (the manifest_qr_payload_string is the only
// number-like identifier this entity has; there's no separate numeric
// manifest_number field). Print logic mirrors YardScanning's
// openPrintSheet/handleTagPrinted exactly, kept local here since this modal
// needs to be reachable from places YardScanning's own print state isn't.
export default function ManifestDetailModal({ open, onOpenChange, manifestId, onViewLoad }) {
  const [loading, setLoading] = useState(false);
  const [manifest, setManifest] = useState(null);
  const [load, setLoad] = useState(null);
  const [printSheet, setPrintSheet] = useState(null);

  useEffect(() => {
    if (!open || !manifestId) return;
    let cancelled = false;
    setLoading(true);
    setManifest(null); setLoad(null);

    (async () => {
      try {
        const manifestRecord = await db.entities.shipping_manifests.get(manifestId);
        if (!manifestRecord) return;
        const loadRecord = manifestRecord.load_id ? await db.entities.loads.get(manifestRecord.load_id).catch(() => null) : null;
        if (cancelled) return;
        setManifest(manifestRecord);
        setLoad(loadRecord);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, manifestId]);

  const openPrintSheet = () => {
    if (!manifest) return;
    setPrintSheet({
      size: LABEL_STOCK_SIZES.Shipping_Manifest,
      title: 'Master Shipping Manifest',
      subtitle: `${load?.load_number_id || ''} — ${manifest.driver_name}`,
      qrPayload: manifest.manifest_qr_payload_string,
      targetRecordId: manifest.id,
    });
  };

  const handleTagPrinted = async () => {
    if (!printSheet?.targetRecordId) return;
    await db.entities.print_label_jobs.create({
      label_type: 'Shipping_Manifest',
      target_record_id: printSheet.targetRecordId,
      zpl_payload_string: buildZplPayload({ labelType: 'Shipping_Manifest', title: printSheet.title, subtitle: printSheet.subtitle, qrPayload: printSheet.qrPayload }),
      status: 'Printed',
      created_at: new Date().toISOString(),
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : !manifest ? (
            <div className="py-10 text-center">
              <p className="text-sm text-destructive">Could not find this manifest.</p>
              <div className="flex justify-center mt-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></div>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Shipping Manifest — {load?.load_number_id || manifest.load_id}</DialogTitle>
              </DialogHeader>

              <div className="space-y-1.5 text-sm">
                {[
                  ['Driver', manifest.driver_name],
                  ['Driver Phone', manifest.driver_phone],
                  ['Trailer Type', (manifest.trailer_type || '').replace(/_/g, ' ')],
                  ['License Plate', manifest.license_plate],
                  ['Manifest Code', manifest.manifest_qr_payload_string],
                  ['Signed BOL', manifest.signed_bol_file_uri],
                  ['Delivery Ticket', manifest.delivery_ticket_file_uri],
                ].filter(([, v]) => v).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-b border-border/50 py-1 last:border-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium text-right font-mono">{value}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {manifest && (
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button variant="outline" className="gap-2" onClick={openPrintSheet}><Printer className="w-4 h-4" />Print</Button>
              {load && <Button className="steel-gradient text-white border-0" onClick={() => onViewLoad?.(load.id)}>View Load</Button>}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <PrintableLabelSheet
        open={!!printSheet}
        onClose={() => setPrintSheet(null)}
        onPrinted={handleTagPrinted}
        size={printSheet?.size || LABEL_STOCK_SIZES.Shipping_Manifest}
        title={printSheet?.title}
        subtitle={printSheet?.subtitle}
        qrPayload={printSheet?.qrPayload}
      />
    </>
  );
}
