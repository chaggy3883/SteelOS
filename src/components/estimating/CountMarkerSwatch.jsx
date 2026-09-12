import React, { useEffect, useRef } from 'react';
import { drawCountMarker } from '@/lib/countMarkerShapes';

// Tiny canvas-based preview of a Count/Bolt Count dot (color fill or
// fallback symbol) — reused by the color/symbol picker, the tally panel,
// and the Confirmed Measurements table so a dot looks identical off-canvas
// as it does on the drawing itself.
export default function CountMarkerSwatch({ color, symbol, size = 16, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    drawCountMarker(ctx, size / 2, size / 2, { color, symbol }, size / 2 - 2);
  }, [color, symbol, size]);

  return <canvas ref={canvasRef} width={size} height={size} className={`inline-block align-middle ${className}`} />;
}
