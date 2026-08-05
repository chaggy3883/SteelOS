import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { Loader2, ZoomIn, ZoomOut, Maximize, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCanvasTransform } from '@/hooks/useCanvasTransform';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

const VIEWPORT_HEIGHT = 640;

// Phase 1: visual PDF viewer only — page render, page nav, zoom, and pan.
// No measurement logic yet. The overlay canvas is sized and positioned
// pixel-identical to the base canvas on every render/zoom/pan so a later
// phase can start drawing markups on it without touching this file's
// layout math again.
export default function BlueprintCanvas({ source }) {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [page, setPage] = useState(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const { scale, pan, setPan, zoomIn, zoomOut, resetTransform } = useCanvasTransform(1);

  const viewportRef = useRef(null);
  const baseCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const dragRef = useRef(null);

  // Loads the document whenever `source` changes (a URL string, or a
  // File/Blob — both accepted so this can be wired directly to the same
  // upload BlueprintTakeoff already does). Destroys the previous document
  // on every change/unmount so pdfjs frees its worker-side resources.
  useEffect(() => {
    if (!source) {
      setPdfDoc(null);
      setNumPages(0);
      return;
    }
    let cancelled = false;
    let doc = null;
    setIsLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const params = typeof source === 'string' ? { url: source } : { data: await source.arrayBuffer() };
        doc = await pdfjsLib.getDocument(params).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(1);
      } catch (e) {
        console.error('BlueprintCanvas failed to load PDF', e);
        if (!cancelled) setLoadError('Could not load this PDF for preview.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      doc?.destroy();
    };
  }, [source]);

  // Fetches the page proxy for the current page number, and resets the
  // transform to a fit-to-width scale for that page's native size — this
  // only runs on document/page change, not on every zoom/pan action.
  useEffect(() => {
    if (!pdfDoc) {
      setPage(null);
      return;
    }
    let cancelled = false;
    pdfDoc.getPage(pageNum).then((p) => {
      if (cancelled) return;
      setPage(p);
      const natural = p.getViewport({ scale: 1 });
      setPageSize({ width: natural.width, height: natural.height });
      const containerWidth = viewportRef.current?.clientWidth || natural.width;
      const fit = Math.min(2, Math.max(0.1, (containerWidth - 32) / natural.width));
      resetTransform(fit);
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNum, resetTransform]);

  // Renders the current page at the current scale onto the base canvas.
  // Cancels any in-flight render task before starting a new one — pdfjs
  // does not allow two concurrent render() calls against the same canvas,
  // and rapid zoom/pan/page changes would otherwise queue up renders and
  // leak RenderTask objects.
  useEffect(() => {
    if (!page) return;
    const baseCanvas = baseCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!baseCanvas) return;

    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;

    baseCanvas.width = Math.ceil(viewport.width * dpr);
    baseCanvas.height = Math.ceil(viewport.height * dpr);
    baseCanvas.style.width = `${viewport.width}px`;
    baseCanvas.style.height = `${viewport.height}px`;

    if (overlayCanvas) {
      overlayCanvas.width = Math.ceil(viewport.width * dpr);
      overlayCanvas.height = Math.ceil(viewport.height * dpr);
      overlayCanvas.style.width = `${viewport.width}px`;
      overlayCanvas.style.height = `${viewport.height}px`;
    }

    renderTaskRef.current?.cancel();

    const ctx = baseCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const task = page.render({ canvasContext: ctx, viewport });
    renderTaskRef.current = task;
    task.promise.catch((e) => {
      if (e?.name !== 'RenderingCancelledException') console.error('BlueprintCanvas render failed', e);
    });

    return () => {
      renderTaskRef.current?.cancel();
    };
  }, [page, scale]);

  const handlePointerDown = (e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPan: pan };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current) return;
    const { startX, startY, startPan } = dragRef.current;
    setPan({ x: startPan.x + (e.clientX - startX), y: startPan.y + (e.clientY - startY) });
  };

  const handlePointerUp = (e) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const viewportCenter = () => {
    const el = viewportRef.current;
    if (!el) return undefined;
    return { x: el.clientWidth / 2, y: el.clientHeight / 2 };
  };

  const handleFitToWidth = () => {
    const containerWidth = viewportRef.current?.clientWidth || pageSize.width;
    if (!pageSize.width) return;
    resetTransform(Math.min(2, Math.max(0.1, (containerWidth - 32) / pageSize.width)));
  };

  if (!source) return null;

  return (
    <div className="border rounded-lg overflow-hidden bg-muted/20">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setPageNum((n) => Math.max(1, n - 1))}
            disabled={pageNum <= 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-20 text-center">
            Page {numPages ? pageNum : 0} of {numPages}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setPageNum((n) => Math.min(numPages, n + 1))}
            disabled={pageNum >= numPages}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => zoomOut(viewportCenter())}>
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-12 text-center">{Math.round(scale * 100)}%</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => zoomIn(viewportCenter())}>
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleFitToWidth} title="Fit to width">
            <Maximize className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="relative overflow-hidden bg-neutral-700"
        style={{ height: VIEWPORT_HEIGHT, cursor: dragRef.current ? 'grabbing' : 'grab' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-amber-300 px-4 text-center">
            {loadError}
          </div>
        )}
        <div
          className="absolute top-0 left-0"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <canvas ref={baseCanvasRef} className="block shadow-lg" />
          <canvas ref={overlayCanvasRef} className="absolute inset-0 pointer-events-none" />
        </div>
      </div>
    </div>
  );
}
