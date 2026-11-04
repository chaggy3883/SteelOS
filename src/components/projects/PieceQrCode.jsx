import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { generateLabelQrDataUrl } from '@/lib/labelQr';

// The piece's scannable QR code, drawn from its qr_payload_string with the
// same encoder the printed labels use (labelQr.js), so what's on screen
// scans exactly like the label.
export default function PieceQrCode({ payload, size = 160 }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    if (!payload) return undefined;
    generateLabelQrDataUrl(payload, { widthPx: size * 2 })
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [payload, size]);

  if (!payload) return <p className="text-xs text-muted-foreground">No QR code yet.</p>;
  if (failed) return <p className="text-xs text-destructive">Could not draw the QR code.</p>;
  return (
    <div className="flex flex-col items-center gap-1">
      {src
        ? <img src={src} alt={`QR code ${payload}`} width={size} height={size} className="bg-white rounded border" />
        : <div style={{ width: size, height: size }} className="flex items-center justify-center rounded border"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
      <span className="font-mono text-[10px] text-muted-foreground break-all text-center">{payload}</span>
    </div>
  );
}
