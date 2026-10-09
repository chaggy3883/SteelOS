import React, { useEffect, useState } from 'react';
import { Printer, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateLabelQrDataUrl } from '@/lib/labelQr';
import { generateLabelPdf } from '@/lib/labelPdf';

export default function PrintableLabelSheet({ open, onClose, onPrinted, size, title, subtitle, qrPayload }) {
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [generating, setGenerating] = useState(false);

  // Regenerated whenever the sheet opens on a new payload — same encoder
  // (labelQr.js) the PDF embeds, so the on-screen preview is an accurate
  // stand-in for what actually prints, not just a placeholder icon.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setQrDataUrl(null);
    generateLabelQrDataUrl(qrPayload).then((url) => { if (!cancelled) setQrDataUrl(url); });
    return () => { cancelled = true; };
  }, [open, qrPayload]);

  if (!open) return null;

  // PDF generation (not an ambiguous OS print-dialog signal like the old
  // window.print()/afterprint approach) is what marks the job Printed — it
  // only fires once the PDF has actually been built and handed to the
  // browser to download.
  const handlePrintClick = async () => {
    setGenerating(true);
    try {
      await generateLabelPdf({ size, title, subtitle, qrPayload });
      onPrinted?.();
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
        <div>
          <h3 className="font-semibold">Label Preview — {size.label}</h3>
          <p className="text-xs text-muted-foreground">Confirm the layout, then generate the print-ready PDF.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handlePrintClick} disabled={generating} className="gap-2 steel-gradient text-white border-0">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            {generating ? 'Generating…' : 'Print Label (PDF)'}
          </Button>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 bg-muted/30">
        <div
          className="border-2 border-foreground rounded-md flex flex-col items-center justify-center gap-2 p-4 bg-background"
          style={{ width: `${size.widthIn}in`, height: `${size.heightIn}in` }}
        >
          <p className="font-bold text-lg text-center leading-tight">{title}</p>
          <p className="text-xs text-center text-muted-foreground leading-tight">{subtitle}</p>
          {qrDataUrl ? (
            <img src={qrDataUrl} alt={`QR code for ${qrPayload}`} className="w-16 h-16 flex-shrink-0" />
          ) : (
            <div className="w-16 h-16 flex-shrink-0 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          <p className="font-mono text-[10px] text-center break-all px-2">{qrPayload}</p>
        </div>
      </div>
    </div>
  );
}
