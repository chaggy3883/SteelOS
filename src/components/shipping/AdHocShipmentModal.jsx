import React, { useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, QrCode, Camera } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { generateBolPdf } from '@/lib/bolPdf';
import { openDocumentViewer } from '@/lib/openDocumentViewer';
import { matchPieceByScan } from '@/lib/pieceScan';
import CameraQrScanner, { useIsTouchPrimaryDevice } from '@/components/shared/CameraQrScanner';

const VEHICLE_TYPES = ['pickup_truck', 'flatbed', 'other'];
const vehicleLabel = (v) => (v || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const emptyForm = () => ({
  project_id: '',
  ship_date: new Date().toISOString().slice(0, 10),
  carrier: '',
  vehicle_type: 'flatbed',
  destination_address: '',
  notes: '',
});

const emptyLineForm = () => ({ description: '', quantity: 1, unit: '', source_qr_payload: null });

const nextShipmentNumber = (shipments) => {
  const max = shipments.reduce((m, s) => {
    const match = /^AH-(\d{3})$/.exec(s.shipment_number_id || '');
    return match ? Math.max(m, parseInt(match[1], 10)) : m;
  }, 0);
  return `AH-${String(max + 1).padStart(3, '0')}`;
};

// Single-step "build it and print it" BOL tool for shipments that never went
// through the formal Load Builder pipeline (a partial pallet quantity broken
// out ad hoc, etc.) — no Draft/Staged/Loaded/Inspected progression, unlike
// loads. Reuses generateBolPdf (the same template/letterhead formal loads
// use) rather than a second PDF layout; see bolPdf.js's showWeightColumn/
// itemsCountLabel/loadNumberLabel/secondColumnLabel overrides added for this.
export default function AdHocShipmentModal({ open, onOpenChange, projects = [], pieces = [], shipments = [], onCreated }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const changedBy = user?.full_name || user?.email || 'Unknown';
  const touchPrimary = useIsTouchPrimaryDevice();

  const [form, setForm] = useState(emptyForm());
  const [lineItems, setLineItems] = useState([]);
  const [lineForm, setLineForm] = useState(emptyLineForm());
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [scanValue, setScanValue] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedProject = useMemo(() => projects.find((p) => p.id === form.project_id) || null, [projects, form.project_id]);

  const resetAll = () => {
    setForm(emptyForm());
    setLineItems([]);
    setLineForm(emptyLineForm());
    setScanValue('');
  };

  const handleClose = (next) => {
    if (!next && !saving) resetAll();
    onOpenChange(next);
  };

  const applyScan = (value) => {
    const { piece, ambiguous } = matchPieceByScan(pieces, value, form.project_id || undefined);
    if (ambiguous) {
      toast({ title: 'Multiple pieces match that piece mark', description: 'Scan the QR code instead of typing the piece mark.', variant: 'destructive' });
      return;
    }
    if (!piece) {
      toast({ title: 'No tracked item found for that code', description: 'Enter the description manually instead.', variant: 'destructive' });
      return;
    }
    setLineForm((f) => ({
      ...f,
      description: [piece.piece_mark, [piece.material_shape, piece.dimensions].filter(Boolean).join(' ')].filter(Boolean).join(' — '),
      unit: f.unit || 'ea',
      source_qr_payload: piece.qr_payload_string || value,
    }));
    toast({ title: `${piece.piece_mark} pulled in`, description: 'Adjust the quantity, then Add Line.' });
  };

  const handleCameraScan = (decodedText) => {
    setShowCameraScanner(false);
    setScanValue(decodedText);
    applyScan(decodedText);
  };

  const handleScanSubmit = () => {
    if (!scanValue.trim()) return;
    applyScan(scanValue.trim());
    setScanValue('');
  };

  const addLine = () => {
    if (!lineForm.description.trim()) {
      toast({ title: 'Description is required', variant: 'destructive' });
      return;
    }
    setLineItems((items) => [...items, {
      description: lineForm.description.trim(),
      quantity: Number(lineForm.quantity) || 1,
      unit: lineForm.unit.trim(),
      source_qr_payload: lineForm.source_qr_payload || null,
    }]);
    setLineForm(emptyLineForm());
  };

  const removeLine = (idx) => setLineItems((items) => items.filter((_, i) => i !== idx));

  const canGenerate = form.destination_address.trim() && form.carrier.trim() && lineItems.length > 0;

  const handleGenerate = async () => {
    if (!canGenerate) {
      toast({ title: 'Destination, carrier, and at least one line item are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const company = await getEffectiveCompany().catch(() => null);
      const shipmentNumber = nextShipmentNumber(shipments);
      const items = lineItems.map((li, idx) => ({ sequence_number: idx + 1, ...li }));
      const { dataUri, filename } = await generateBolPdf({
        company,
        load: { load_number_id: shipmentNumber },
        project: { name: selectedProject?.name || 'Shipment Destination', address: form.destination_address },
        carrierLabel: form.carrier.trim(),
        trailerNumber: vehicleLabel(form.vehicle_type),
        items,
        loadNumberLabel: 'Shipment #:',
        secondColumnLabel: 'VEHICLE',
        showWeightColumn: false,
        itemsCountLabel: 'Total Line Items',
      });
      await db.entities.AdHocShipment.create({
        project_id: form.project_id || null,
        shipment_number_id: shipmentNumber,
        ship_date: form.ship_date,
        carrier: form.carrier.trim(),
        vehicle_type: form.vehicle_type,
        destination_address: form.destination_address.trim(),
        line_items: lineItems,
        notes: form.notes.trim(),
        created_by: changedBy,
        bol_pdf_data_uri: dataUri,
        bol_generated_date: new Date().toISOString(),
      });
      await onCreated?.();
      toast({ title: `${shipmentNumber} created`, description: 'BOL generated and saved.' });
      openDocumentViewer(dataUri, filename);
      handleClose(false);
    } catch (e) {
      toast({ title: 'Unable to generate shipment BOL', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ad-Hoc Shipment — Quick BOL</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Project <span className="text-xs text-muted-foreground font-normal">(optional)</span></Label>
            <Select value={form.project_id || '__none__'} onValueChange={(v) => setForm((f) => ({ ...f, project_id: v === '__none__' ? '' : v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="No specific project" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No specific project</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Ship Date</Label>
            <Input type="date" value={form.ship_date} onChange={(e) => setForm((f) => ({ ...f, ship_date: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>Carrier</Label>
            <Input value={form.carrier} onChange={(e) => setForm((f) => ({ ...f, carrier: e.target.value }))} className="mt-1" placeholder="e.g. Arrow Logistics" />
          </div>
          <div>
            <Label>Vehicle Type</Label>
            <Select value={form.vehicle_type} onValueChange={(v) => setForm((f) => ({ ...f, vehicle_type: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VEHICLE_TYPES.map((v) => <SelectItem key={v} value={v}>{vehicleLabel(v)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Destination Address</Label>
            <Textarea value={form.destination_address} onChange={(e) => setForm((f) => ({ ...f, destination_address: e.target.value }))} className="mt-1" rows={2} placeholder="Jobsite address" />
          </div>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-3">
          <h4 className="font-semibold text-sm">Line Items</h4>

          {lineItems.length > 0 && (
            <div className="space-y-1.5">
              {lineItems.map((li, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 text-sm rounded-md bg-muted/50 px-2.5 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate">{li.description}</p>
                    <p className="text-xs text-muted-foreground">{li.quantity} {li.unit}{li.source_qr_payload && ' • scanned'}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => removeLine(idx)}>
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 pt-1 border-t border-border/50">
            {touchPrimary && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowCameraScanner(true)}>
                <Camera className="w-3.5 h-3.5" />Scan to Pull In a Tracked Item
              </Button>
            )}
            <div className="flex flex-col gap-2 md:flex-row">
              <Input
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScanSubmit()}
                placeholder="Scan a piece QR payload (optional)"
                className="text-xs"
              />
              <Button variant="outline" size="sm" className="gap-2" onClick={handleScanSubmit}>
                <QrCode className="w-3.5 h-3.5" />Pull In
              </Button>
              {!touchPrimary && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowCameraScanner(true)}>
                  <Camera className="w-3.5 h-3.5" />Camera
                </Button>
              )}
            </div>

            <div className="grid grid-cols-[1fr_80px_80px_auto] gap-2 items-end">
              <div>
                <Label className="text-xs">Description</Label>
                <Input value={lineForm.description} onChange={(e) => setLineForm((f) => ({ ...f, description: e.target.value }))} className="mt-1" placeholder="e.g. 3/4in A325 Bolts (partial pallet)" />
              </div>
              <div>
                <Label className="text-xs">Qty</Label>
                <Input type="number" value={lineForm.quantity} onChange={(e) => setLineForm((f) => ({ ...f, quantity: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Unit</Label>
                <Input value={lineForm.unit} onChange={(e) => setLineForm((f) => ({ ...f, unit: e.target.value }))} className="mt-1" placeholder="ea" />
              </div>
              <Button size="sm" className="gap-1.5 steel-gradient text-white border-0" onClick={addLine}>
                <Plus className="w-3.5 h-3.5" />Add Line
              </Button>
            </div>
          </div>
        </div>

        <div>
          <Label>Notes <span className="text-xs text-muted-foreground font-normal">(optional)</span></Label>
          <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1" rows={2} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          <Button onClick={handleGenerate} disabled={!canGenerate || saving} className="steel-gradient text-white border-0">
            {saving ? 'Generating…' : 'Generate BOL & Save'}
          </Button>
        </DialogFooter>
      </DialogContent>

      {showCameraScanner && (
        <CameraQrScanner onScan={handleCameraScan} onCancel={() => setShowCameraScanner(false)} />
      )}
    </Dialog>
  );
}
