import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Printer, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { buildPieceLabelsPdf } from '@/lib/pieceLabelPdf';
import { normalizePieceLabelSettings, labelSizeText } from '@/lib/pieceLabelSettings';
import { downloadFile } from '@/lib/downloadFile';

// Preview + print for the selected pieces' sticker labels. The PDF is one
// label per page at the company's label size (Admin → Piece Labels), so the
// label printer's own driver prints it 1:1 — pick that printer in the print
// dialog and set scale to "Actual size" / 100%.
export default function PieceLabelPrintDialog({ open, onClose, pieces, project, sequenceAreas }) {
  const [settings, setSettings] = useState(null);
  const [pdf, setPdf] = useState(null); // { url, blob, filename }
  const [error, setError] = useState(null);
  const frameRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    let url = null;
    setPdf(null);
    setError(null);
    (async () => {
      try {
        const company = await getEffectiveCompany().catch(() => null);
        const s = normalizePieceLabelSettings(company?.piece_label_settings);
        if (cancelled) return;
        setSettings(s);
        const { blob, filename } = await buildPieceLabelsPdf({ pieces, project, sequenceAreas, settings: s });
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPdf({ url, blob, filename });
      } catch (e) {
        console.error('Piece labels failed', e);
        if (!cancelled) setError(e?.message || 'Could not build the labels.');
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [open, pieces, project, sequenceAreas]);

  const handlePrint = () => {
    if (!pdf) return;
    try {
      frameRef.current?.contentWindow?.focus();
      frameRef.current?.contentWindow?.print();
    } catch {
      window.open(pdf.url, '_blank');
    }
  };

  const missingQr = pieces.filter((p) => !p.qr_payload_string).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Print labels — {pieces.length} piece{pieces.length === 1 ? '' : 's'}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {settings ? `${labelSizeText(settings)} labels, one per page` : 'Loading label settings…'} — the size is set by an admin in Admin → Piece Labels.
          In the print window pick your label printer and print at actual size (100%).
        </p>
        {missingQr > 0 && (
          <p className="text-xs text-amber-600">{missingQr} selected piece{missingQr === 1 ? ' has' : 's have'} no QR code yet and will print without one.</p>
        )}
        <div className="h-[420px] rounded border bg-muted/30 flex items-center justify-center overflow-hidden">
          {error ? (
            <p className="text-sm text-destructive px-4 text-center">{error}</p>
          ) : pdf ? (
            <iframe ref={frameRef} title="Label preview" src={pdf.url} className="w-full h-full bg-white" />
          ) : (
            <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Building labels…</span>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant="outline" disabled={!pdf} onClick={() => downloadFile(pdf.blob, pdf.filename)}>
            <Download className="w-4 h-4 mr-1.5" />Download PDF
          </Button>
          <Button disabled={!pdf} onClick={handlePrint}><Printer className="w-4 h-4 mr-1.5" />Print</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
