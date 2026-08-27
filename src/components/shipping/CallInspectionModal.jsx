import React, { useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { logStatusChange } from '@/lib/statusHistory';
import { useAuth } from '@/lib/AuthContext';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { generateBolPdf } from '@/lib/bolPdf';

// Formalizes the physical scan-verification Yard Scanning already performs
// (every load_item already carries a 'Loaded' status once scanned onto the
// trailer there) into an inspection sign-off: the inspector reviews the
// piece list against the load's trailer number, then confirms. No second
// scanning flow is built here — this is a read-only confirmation gate over
// state Yard Scanning already produced.
export default function CallInspectionModal({ open, onOpenChange, load, project, items, onReload }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [trailerConfirm, setTrailerConfirm] = useState('');
  const [confirming, setConfirming] = useState(false);

  const allScanned = items.length > 0 && items.every((i) => i.status === 'Loaded');
  const trailerMatches = trailerConfirm.trim().toLowerCase() === (load?.trailer_number || '').trim().toLowerCase();
  const canConfirm = allScanned && trailerMatches && !!load?.carrier_name;

  const handleClose = (next) => {
    if (!next) setTrailerConfirm('');
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setConfirming(true);
    try {
      const company = await getEffectiveCompany().catch(() => null);
      const { dataUri } = await generateBolPdf({
        company,
        load,
        project,
        carrierLabel: load.carrier_name,
        trailerNumber: load.trailer_number,
        items,
      });
      await db.entities.loads.update(load.id, {
        status: 'Inspected',
        bol_pdf_data_uri: dataUri,
        bol_generated_date: new Date().toISOString(),
      });
      await logStatusChange({
        entityType: 'loads',
        entityId: load.id,
        fieldName: 'status',
        fromValue: load.status,
        toValue: 'Inspected',
        changedBy: user?.full_name || user?.email || 'Unknown',
        note: `Inspection passed on trailer ${load.trailer_number}. BOL generated.`,
      });
      await onReload();
      toast({ title: `${load.load_number_id} inspected`, description: 'BOL generated and attached to the load.' });
      handleClose(false);
    } catch (e) {
      toast({ title: 'Unable to complete inspection', variant: 'destructive' });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Call Inspection — {load?.load_number_id}</DialogTitle>
        </DialogHeader>

        {!allScanned && (
          <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm text-yellow-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            Not every piece has been scanned onto the trailer yet — finish Yard Scan-to-Load before calling inspection.
          </div>
        )}

        <div className="space-y-1.5 text-sm">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 border-b border-border/50 py-1.5 last:border-0">
              <span className="font-mono font-bold">{item.piece?.piece_mark || '—'}</span>
              <span className={item.status === 'Loaded' ? 'text-green-600 flex items-center gap-1' : 'text-muted-foreground'}>
                {item.status === 'Loaded' && <CheckCircle2 className="w-3.5 h-3.5" />}
                {item.status}
              </span>
            </div>
          ))}
        </div>

        <div>
          <Label>Confirm Trailer Number ({load?.trailer_number || '—'})</Label>
          <Input
            value={trailerConfirm}
            onChange={(e) => setTrailerConfirm(e.target.value)}
            placeholder="Re-enter the trailer number to confirm"
            className="mt-1"
          />
        </div>

        {!load?.carrier_name && (
          <p className="text-xs text-red-600">Carrier is required before the BOL can be generated — set it from Load Builder or Load Detail first.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!canConfirm || confirming} className="steel-gradient text-white border-0">
            {confirming ? 'Generating BOL…' : 'Confirm Inspection & Generate BOL'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
