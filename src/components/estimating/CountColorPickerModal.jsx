import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GripVertical, X } from 'lucide-react';
import CountMarkerSwatch from './CountMarkerSwatch';
import { COUNT_COLOR_PALETTE, COUNT_SYMBOL_SET } from '@/lib/countMarkerPalette';

// Step 2 of the Count/Bolt Count engine, shown right after
// CountSetupModal. A ~20-swatch grid styled after Word/Excel's standard
// color picker — colors already used by another group ON THE CURRENT PAGE
// are disabled, since the palette resets fresh on every new page. Once all
// 20 are taken here, the grid swaps to a symbol picker instead (spec: fall
// back to distinguishing groups by dot shape once colors run out).
export default function CountColorPickerModal({ open, usedColors = new Set(), usedSymbols = new Set(), onConfirm, onCancel }) {
  const [pos, setPos] = useState({ x: 360, y: 160 });

  const handleDragStart = (e) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = pos;
    const handleMove = (moveEvent) => {
      setPos({ x: startPos.x + (moveEvent.clientX - startX), y: startPos.y + (moveEvent.clientY - startY) });
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  if (!open) return null;

  const paletteExhausted = COUNT_COLOR_PALETTE.every((c) => usedColors.has(c));
  // Once every symbol is also taken on this page (27+ distinct groups),
  // stop disabling them — the spec calls for cycling back through the
  // symbol set at that point rather than a dead-end picker with nothing
  // selectable.
  const symbolsFullyExhausted = COUNT_SYMBOL_SET.every((s) => usedSymbols.has(s));

  return (
    <div style={{ position: 'fixed', left: pos.x, top: pos.y }} className="z-[70] w-72 rounded-lg border bg-card shadow-2xl">
      <div
        onMouseDown={handleDragStart}
        className="flex items-center gap-2 px-3 py-2 border-b text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-move select-none"
      >
        <GripVertical className="w-4 h-4" />
        {paletteExhausted ? 'Pick a Symbol' : 'Pick a Color'}
        <Button size="icon" variant="ghost" className="h-5 w-5 ml-auto" onClick={onCancel}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="p-3 space-y-2">
        {paletteExhausted ? (
          <>
            <p className="text-xs text-muted-foreground">
              All 20 colors are already used on this page — pick a symbol to distinguish this group instead.
              {symbolsFullyExhausted && ' Every symbol is in use too, so groups will start repeating shapes.'}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {COUNT_SYMBOL_SET.map((s) => {
                const used = !symbolsFullyExhausted && usedSymbols.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={used}
                    onClick={() => onConfirm?.({ symbol: s })}
                    className={`h-10 rounded-md border flex items-center justify-center ${used ? 'opacity-25 cursor-not-allowed' : 'hover:border-primary hover:bg-primary/5 cursor-pointer'}`}
                    title={used ? 'Already used on this page' : s}
                  >
                    <CountMarkerSwatch symbol={s} size={20} />
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Colors already used on this page are disabled.</p>
            <div className="grid grid-cols-5 gap-2">
              {COUNT_COLOR_PALETTE.map((c) => {
                const used = usedColors.has(c);
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={used}
                    onClick={() => onConfirm?.({ color: c })}
                    className={`h-8 w-8 rounded-md border-2 border-black/10 ${used ? 'opacity-25 cursor-not-allowed' : 'hover:border-primary cursor-pointer'}`}
                    style={{ backgroundColor: c }}
                    title={used ? 'Already used on this page' : c}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
