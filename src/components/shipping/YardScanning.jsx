import React, { useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { QrCode, PackageCheck, Ban, MapPin, Upload, Truck, Printer, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { LABEL_STOCK_SIZES, buildZplPayload } from '@/lib/zplLabels';
import PrintableLabelSheet from '@/components/barcode-printing/PrintableLabelSheet';

const TRAILER_TYPES = ['Flatbed', 'Drop_Deck', 'Stretch', 'Step_Deck'];
const emptyManifestForm = () => ({ driver_name: '', driver_phone: '', trailer_type: 'Flatbed', license_plate: '' });

export default function YardScanning({ pieces, loads, loadItems, manifests, onReload, onViewLoad, onViewPiece, onViewManifest }) {
  const { toast } = useToast();
  const [selectedLoadId, setSelectedLoadId] = useState(loads[0]?.id || null);
  const [scanValue, setScanValue] = useState('');
  const [showManifestForm, setShowManifestForm] = useState(false);
  const [manifestForm, setManifestForm] = useState(emptyManifestForm());
  const [savingManifest, setSavingManifest] = useState(false);
  const [deliveryTicketUri, setDeliveryTicketUri] = useState('');
  const [printSheet, setPrintSheet] = useState(null);

  const selectedLoad = useMemo(() => loads.find((l) => l.id === selectedLoadId) || null, [loads, selectedLoadId]);
  const items = useMemo(
    () => loadItems.filter((li) => li.load_id === selectedLoadId).map((li) => ({ ...li, piece: pieces.find((p) => p.id === li.piece_id) })),
    [loadItems, selectedLoadId, pieces]
  );
  const manifest = useMemo(() => manifests.find((m) => m.load_id === selectedLoadId) || null, [manifests, selectedLoadId]);
  const loadedCount = items.filter((i) => i.status === 'Loaded').length;
  const allLoaded = items.length > 0 && loadedCount === items.length;
  const capacity = selectedLoad?.max_weight_capacity_lbs || 45000;
  const isOverweight = !!selectedLoad && (selectedLoad.total_weight_lbs || 0) > capacity;
  const overweightBlocked = isOverweight && !selectedLoad?.is_overweight_permit_authorized;
  const canGenerateManifest = allLoaded && !manifest && !overweightBlocked;

  const showLoadingPanel = selectedLoad && ['Draft', 'Staged', 'Loaded'].includes(selectedLoad.status);
  const showTransitPanel = selectedLoad && ['In_Transit', 'Field_Issue'].includes(selectedLoad.status) && manifest;
  const showDeliveredPanel = selectedLoad && selectedLoad.status === 'Delivered';

  const handleScanToLoad = async () => {
    const value = scanValue.trim();
    const piece = pieces.find((p) => p.qr_payload_string === value || p.piece_mark === value);
    const item = piece && items.find((i) => i.piece_id === piece.id && i.status !== 'Loaded');
    if (!piece || !item) {
      toast({ title: 'Scan mismatch — blocked', description: 'This QR payload does not match a staged item on this load.', variant: 'destructive' });
      return;
    }
    await db.entities.load_items.update(item.id, { status: 'Loaded' });
    await onReload();
    toast({ title: `${piece.piece_mark} loaded onto ${selectedLoad.load_number_id}` });
    setScanValue('');
  };

  const submitManifest = async () => {
    if (!manifestForm.driver_name.trim()) {
      toast({ title: 'Driver name is required', variant: 'destructive' });
      return;
    }
    setSavingManifest(true);
    try {
      const created = await db.entities.shipping_manifests.create({
        load_id: selectedLoad.id,
        driver_name: manifestForm.driver_name.trim(),
        driver_phone: manifestForm.driver_phone.trim(),
        trailer_type: manifestForm.trailer_type,
        license_plate: manifestForm.license_plate.trim(),
        manifest_qr_payload_string: `QR-${selectedLoad.load_number_id}-MASTER`,
        signed_bol_file_uri: '',
        delivery_ticket_file_uri: '',
      });
      await db.entities.loads.update(selectedLoad.id, { status: 'In_Transit' });
      await onReload();
      setShowManifestForm(false);
      setManifestForm(emptyManifestForm());
      toast({ title: 'Shipping manifest generated', description: created.manifest_qr_payload_string });
    } catch (e) {
      toast({ title: 'Unable to generate manifest', variant: 'destructive' });
    } finally {
      setSavingManifest(false);
    }
  };

  const handleMasterReceiptScan = async () => {
    const value = scanValue.trim();
    if (!manifest || value !== manifest.manifest_qr_payload_string) {
      toast({ title: 'Master QR mismatch — blocked', description: 'This code does not match the manifest for this load.', variant: 'destructive' });
      return;
    }
    await db.entities.loads.update(selectedLoad.id, { status: 'Delivered' });
    await Promise.all(items.filter((i) => i.status !== 'Field_Rejected').map((i) => db.entities.pieces.update(i.piece_id, { field_status: 'On_Site' })));
    await onReload();
    toast({ title: `${selectedLoad.load_number_id} delivered`, description: 'Linked pieces marked On-Site.' });
    setScanValue('');
  };

  const rejectItem = async (item) => {
    await db.entities.load_items.update(item.id, { status: 'Field_Rejected' });
    await db.entities.loads.update(selectedLoad.id, { status: 'Field_Issue' });
    await onReload();
    toast({ title: `${item.piece?.piece_mark} flagged as field-rejected`, variant: 'destructive' });
  };

  const openPrintSheet = () => {
    if (!manifest) return;
    setPrintSheet({
      size: LABEL_STOCK_SIZES.Shipping_Manifest,
      title: 'Master Shipping Manifest',
      subtitle: `${selectedLoad?.load_number_id || ''} — ${manifest.driver_name}`,
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

  const saveDeliveryTicket = async () => {
    if (!deliveryTicketUri.trim()) return;
    await db.entities.shipping_manifests.update(manifest.id, { delivery_ticket_file_uri: deliveryTicketUri.trim() });
    await onReload();
    setDeliveryTicketUri('');
    toast({ title: 'Delivery ticket recorded' });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {loads.map((load) => (
          <div
            key={load.id}
            className={cn(
              'rounded-lg border px-3 py-2 text-sm transition-colors flex items-center gap-2',
              load.id === selectedLoadId ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted/50'
            )}
          >
            <button onClick={() => setSelectedLoadId(load.id)} className="text-left">
              <p className="font-semibold">{load.load_number_id}</p>
              <p className="text-xs text-muted-foreground">{load.status}</p>
            </button>
            <button
              type="button"
              title="View load details"
              onClick={(e) => { e.stopPropagation(); onViewLoad?.(load.id); }}
              className="text-muted-foreground hover:text-primary flex-shrink-0"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {!selectedLoad ? (
        <p className="text-sm text-muted-foreground p-6 text-center">Build a load in Load Builder first.</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
          <div className="steel-card p-4 space-y-3">
            {showLoadingPanel && (
              <>
                <div className="flex items-center gap-2">
                  <QrCode className="w-5 h-5 text-primary" />
                  <span className="text-sm font-medium">Yard Scan-to-Load</span>
                  <span className="ml-auto text-xs text-muted-foreground">{loadedCount} / {items.length} loaded</span>
                </div>
                <div className="flex flex-col gap-2 md:flex-row">
                  <Input value={scanValue} onChange={(e) => setScanValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleScanToLoad()} placeholder="Scan a piece QR payload" />
                  <Button onClick={handleScanToLoad} className="steel-gradient text-white border-0">Scan</Button>
                </div>
                {overweightBlocked && (
                  <p className="text-xs text-red-600">This load is overweight and unauthorized — resolve it in Load Builder before continuing.</p>
                )}
                <Button className="w-full gap-2 steel-gradient text-white border-0" disabled={!canGenerateManifest} onClick={() => setShowManifestForm(true)}>
                  <Truck className="w-4 h-4" />Generate Shipping Manifest
                </Button>
              </>
            )}

            {showTransitPanel && (
              <>
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-primary" />
                  <span className="text-sm font-medium">Jobsite Master Receipt Scan</span>
                </div>
                <div className="flex flex-col gap-2 md:flex-row">
                  <Input value={scanValue} onChange={(e) => setScanValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleMasterReceiptScan()} placeholder="Scan the master manifest QR code" />
                  <Button onClick={handleMasterReceiptScan} className="steel-gradient text-white border-0">Receive Load</Button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button
                    className="text-xs text-muted-foreground font-mono truncate hover:underline text-left"
                    onClick={() => onViewManifest?.(manifest.id)}
                  >
                    Master code: {manifest.manifest_qr_payload_string}
                  </button>
                  <button
                    type="button"
                    title="Print Tracking Tag"
                    onClick={openPrintSheet}
                    className="p-1.5 rounded-md hover:bg-muted flex-shrink-0"
                  >
                    <Printer className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
              </>
            )}

            {showDeliveredPanel && (
              <>
                <div className="flex items-center gap-2 text-green-600 font-semibold">
                  <PackageCheck className="w-5 h-5" />{selectedLoad.load_number_id} delivered — pieces marked On-Site
                </div>
                <div>
                  <Label className="text-xs">Delivery Ticket File URI</Label>
                  <div className="flex gap-2 mt-1">
                    <Input value={deliveryTicketUri} onChange={(e) => setDeliveryTicketUri(e.target.value)} placeholder="/uploads/delivery-ticket.pdf" />
                    <Button variant="outline" className="gap-2" onClick={saveDeliveryTicket}><Upload className="w-4 h-4" />Save</Button>
                  </div>
                  {manifest?.delivery_ticket_file_uri && <p className="text-xs text-muted-foreground mt-1">On file: {manifest.delivery_ticket_file_uri}</p>}
                </div>
              </>
            )}
          </div>

          <div className="steel-card p-4 space-y-2">
            <h4 className="font-semibold text-sm mb-2">{selectedLoad.load_number_id} — Items</h4>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">No pieces staged on this load yet.</p>
            ) : items.map((item) => (
              <div key={item.id} className="rounded-lg border border-border p-2 text-xs flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <button className="font-mono font-bold truncate hover:underline text-left block" onClick={() => onViewPiece?.({ pieceId: item.piece_id })}>
                    {item.piece?.piece_mark}
                  </button>
                  <p className="text-muted-foreground">Seq #{item.sequence_number} • {item.status}</p>
                </div>
                {(showTransitPanel || showDeliveredPanel) && item.status === 'Loaded' && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => rejectItem(item)}>
                    <Ban className="w-3.5 h-3.5 text-red-500" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={showManifestForm} onOpenChange={setShowManifestForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Generate Shipping Manifest</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Driver Name</Label>
              <Input value={manifestForm.driver_name} onChange={(e) => setManifestForm((f) => ({ ...f, driver_name: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Driver Phone</Label>
              <Input value={manifestForm.driver_phone} onChange={(e) => setManifestForm((f) => ({ ...f, driver_phone: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Trailer Type</Label>
              <Select value={manifestForm.trailer_type} onValueChange={(v) => setManifestForm((f) => ({ ...f, trailer_type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRAILER_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>License Plate</Label>
              <Input value={manifestForm.license_plate} onChange={(e) => setManifestForm((f) => ({ ...f, license_plate: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManifestForm(false)}>Cancel</Button>
            <Button onClick={submitManifest} disabled={savingManifest} className="steel-gradient text-white border-0">
              {savingManifest ? 'Generating…' : 'Generate & Depart'}
            </Button>
          </DialogFooter>
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
    </div>
  );
}
