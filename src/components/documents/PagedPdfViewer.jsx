import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ZoomIn, ZoomOut, Maximize, MoveHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import BlueprintCanvas from '@/components/estimating/BlueprintCanvas';

// Every page of a PDF, for anywhere a document is opened to read (the
// document viewer tab, a piece's drawing on the shop floor). BlueprintCanvas
// draws one page at a time and its page controls live in IRONSIGHT's
// workspace — on its own it only ever showed page 1 of a spec book or a
// multi-sheet drawing. This adds the page bar: first/prev/next/last, type a
// page number, zoom and fit, plus keys (PageUp/PageDown, ←/→, Home/End).
// Pages are stacked (continuous): drag up/down past the edge of a page and
// the next one comes into view.
export default function PagedPdfViewer({ source, className = '' }) {
  const canvasRef = useRef(null);
  const [{ pageNum, numPages }, setPageInfo] = useState({ pageNum: 1, numPages: 0 });
  const [typed, setTyped] = useState('1');

  const onPageChange = useCallback((info) => {
    setPageInfo({ pageNum: info.pageNum, numPages: info.numPages });
    setTyped(String(info.pageNum));
  }, []);

  // Fit the first page to the window once the file is in (the window can
  // still be settling its size when the page first draws).
  const fittedRef = useRef(false);
  useEffect(() => { fittedRef.current = false; }, [source]);
  const onPageSizeChange = useCallback(() => {
    if (fittedRef.current) return;
    fittedRef.current = true;
    // After this render (the canvas applies the new page size first).
    setTimeout(() => canvasRef.current?.fitPage(), 50);
    setTimeout(() => canvasRef.current?.fitPage(), 400);
  }, []);

  const go = useCallback((n) => {
    if (!numPages) return;
    const target = Math.min(numPages, Math.max(1, Math.round(n)));
    canvasRef.current?.goToPage(target);
  }, [numPages]);

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'PageDown' || e.key === 'ArrowRight') { e.preventDefault(); go(pageNum + 1); }
      else if (e.key === 'PageUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(pageNum - 1); }
      else if (e.key === 'Home') { e.preventDefault(); go(1); }
      else if (e.key === 'End') { e.preventDefault(); go(numPages); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, pageNum, numPages]);

  const commitTyped = () => {
    const n = Number(typed);
    if (Number.isFinite(n) && n >= 1) go(n);
    else setTyped(String(pageNum));
  };

  const iconBtn = 'h-8 w-8 p-0';
  return (
    <div className={`h-full w-full flex flex-col min-h-0 ${className}`}>
      <div className="flex flex-wrap items-center justify-center gap-1 border-b bg-muted/40 px-2 py-1.5 flex-shrink-0 text-sm">
        <Button size="sm" variant="ghost" className={iconBtn} title="First page (Home)" disabled={pageNum <= 1} onClick={() => go(1)}><ChevronsLeft className="w-4 h-4" /></Button>
        <Button size="sm" variant="ghost" className={iconBtn} title="Previous page (PageUp / ←)" disabled={pageNum <= 1} onClick={() => go(pageNum - 1)}><ChevronLeft className="w-4 h-4" /></Button>
        <span className="flex items-center gap-1.5 px-1">
          Page
          <input
            aria-label="Page number"
            className="h-7 w-14 rounded-md border border-input bg-background px-1 text-center text-sm tabular-nums"
            value={typed}
            inputMode="numeric"
            onChange={(e) => setTyped(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') commitTyped(); }}
            onBlur={commitTyped}
          />
          <span className="tabular-nums text-muted-foreground">of {numPages || '…'}</span>
        </span>
        <Button size="sm" variant="ghost" className={iconBtn} title="Next page (PageDown / →)" disabled={!numPages || pageNum >= numPages} onClick={() => go(pageNum + 1)}><ChevronRight className="w-4 h-4" /></Button>
        <Button size="sm" variant="ghost" className={iconBtn} title="Last page (End)" disabled={!numPages || pageNum >= numPages} onClick={() => go(numPages)}><ChevronsRight className="w-4 h-4" /></Button>
        <span className="mx-2 h-5 w-px bg-border" />
        <Button size="sm" variant="ghost" className={iconBtn} title="Zoom out" onClick={() => canvasRef.current?.zoomOut()}><ZoomOut className="w-4 h-4" /></Button>
        <Button size="sm" variant="ghost" className={iconBtn} title="Zoom in" onClick={() => canvasRef.current?.zoomIn()}><ZoomIn className="w-4 h-4" /></Button>
        <Button size="sm" variant="ghost" className={iconBtn} title="Fit page" onClick={() => canvasRef.current?.fitPage()}><Maximize className="w-4 h-4" /></Button>
        <Button size="sm" variant="ghost" className={iconBtn} title="Fit width" onClick={() => canvasRef.current?.fitWidth()}><MoveHorizontal className="w-4 h-4" /></Button>
      </div>
      <div className="flex-1 min-h-0">
        <BlueprintCanvas ref={canvasRef} source={source} fillHeight continuous onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
      </div>
    </div>
  );
}
