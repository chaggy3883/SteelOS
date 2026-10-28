import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, GitCompare, Crosshair, Save, ZoomIn, ZoomOut, AlertTriangle, ArrowRightLeft } from 'lucide-react';
import { loadTakeoffPdfBytes } from '@/lib/takeoffMarkupPdfExport';
import {
  buildRevisionOverlay, findChangedRegions, boxesToPdfSpace, computeAlignmentTransform, renderPdfPageToImageData, toImageData,
} from '@/lib/pdfRevisionOverlay';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

// Old ink red, new ink blue, ink on both light gray.
const OVERLAY_COLORS = { removed: [220, 38, 38], added: [37, 99, 235], same: [190, 190, 190] };
// Both sheets are rendered at the same pixels-per-point so their grids line
// up; big sheets get less than 2 px/pt to keep the compare quick.
const MAX_RENDER_DIM = 2400;
const ALIGN_STEPS = [
  { sheet: 'old', text: 'Click point 1 on the OLD sheet (a grid-line crossing works well)' },
  { sheet: 'new', text: 'Click the same point 1 on the NEW sheet' },
  { sheet: 'old', text: 'Click point 2 on the OLD sheet, well away from point 1' },
  { sheet: 'new', text: 'Click the same point 2 on the NEW sheet' },
];

async function bytesForSession(takeoffId, fallbackUrl) {
  const stored = takeoffId ? await loadTakeoffPdfBytes(takeoffId) : null;
  if (stored) return stored;
  if (!fallbackUrl) return null;
  const res = await fetch(fallbackUrl);
  return new Uint8Array(await res.arrayBuffer());
}

async function renderPage(bytes, pageNumber, renderScale) {
  const task = pdfjsLib.getDocument({ data: bytes });
  try {
    const doc = await task.promise;
    if (pageNumber < 1 || pageNumber > doc.numPages) throw new Error(`That drawing only has ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}.`);
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = renderScale || Math.min(2, MAX_RENDER_DIM / Math.max(base.width, base.height));
    const image = await renderPdfPageToImageData(page, scale);
    return { image, scale };
  } finally {
    task.destroy();
  }
}

// pdf-space (old → new) similarity transform → the same transform in the
// rendered images' pixel space (both rendered at `s` px/pt).
const toPixelTransform = (t, s) => (t ? { ...t, e: t.e * s, f: t.f * s } : null);

// Compare this takeoff's current page against the same (or another) page of
// an older revision's takeoff. Shows old-only ink in red, new-only in blue,
// unchanged in gray, boxes each changed area, and lists them so a click
// zooms straight to one. Optional two-point line-up for re-plotted or
// shifted sheets. "Save change clouds" stores the boxes (and line-up) on
// this takeoff: they show on the drawing, can go in the exported PDF, and
// flag carried-forward markups that land in them.
export default function RevisionCompareDialog({
  open, onOpenChange, takeoffId, fileUrl, currentPage = 1, revisionCandidates = [], previousTakeoffId,
  savedPage, onLinkPrevious, onSave, onOpenCarryForward,
}) {
  const [olderId, setOlderId] = useState('');
  const [oldPage, setOldPage] = useState(currentPage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [renders, setRenders] = useState(null); // { oldImg, newImg, scale }
  const [transform, setTransform] = useState(null); // pdf space, old → new
  const [allowRotation, setAllowRotation] = useState(false);
  const [alignStep, setAlignStep] = useState(-1); // -1 = not aligning
  const [alignPicks, setAlignPicks] = useState([]);
  const [view, setView] = useState('overlay');
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(null); // null = fit width
  const canvasRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setOlderId(previousTakeoffId || savedPage?.previous_takeoff_id || '');
    setOldPage(savedPage?.old_page_number || currentPage);
    setTransform(savedPage?.transform || null);
    setRenders(null);
    setError(null);
    setAlignStep(-1);
    setAlignPicks([]);
    setView('overlay');
    setSelected(null);
    setZoom(null);
  }, [open]);

  const overlay = useMemo(() => {
    if (!renders) return null;
    try {
      return buildRevisionOverlay(renders.oldImg, renders.newImg, { oldToNew: toPixelTransform(transform, renders.scale) || undefined, colors: OVERLAY_COLORS, tolerancePx: 1 });
    } catch (e) {
      console.error('Revision overlay failed', e);
      return null;
    }
  }, [renders, transform]);
  const regions = useMemo(() => (overlay ? findChangedRegions(overlay) : []), [overlay]);

  const handleCompare = async () => {
    if (!olderId) { setError('Pick the older revision first.'); return; }
    setBusy(true);
    setError(null);
    setRenders(null);
    setSelected(null);
    try {
      const [newBytes, oldBytes] = await Promise.all([bytesForSession(takeoffId, fileUrl), bytesForSession(olderId, null)]);
      if (!newBytes) throw new Error("This takeoff's drawing isn't stored on this device yet — wait for it to finish storing, then try again.");
      if (!oldBytes) throw new Error("The older revision's drawing isn't stored on this device — open that takeoff and re-attach its PDF first.");
      const newR = await renderPage(newBytes, currentPage);
      const oldR = await renderPage(oldBytes, Number(oldPage) || 1, newR.scale);
      setRenders({ oldImg: oldR.image, newImg: newR.image, scale: newR.scale });
      setView('overlay');
      if (olderId !== previousTakeoffId) onLinkPrevious?.(olderId);
    } catch (e) {
      console.error('Revision compare failed', e);
      setError(e?.message || 'Could not compare these drawings.');
    } finally {
      setBusy(false);
    }
  };

  // Paint whichever view is showing, with change boxes and line-up picks.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !renders) return;
    const img = view === 'old' ? renders.oldImg : view === 'new' ? renders.newImg : overlay ? toImageData(overlay) : renders.newImg;
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.putImageData(img, 0, 0);
    if (view !== 'old') {
      regions.forEach((r, i) => {
        ctx.save();
        ctx.strokeStyle = i === selected ? '#f59e0b' : '#dc2626';
        ctx.lineWidth = i === selected ? 5 : 2.5;
        ctx.strokeRect(r.x, r.y, r.width, r.height);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(String(i + 1), r.x + 3, r.y - 4 > 14 ? r.y - 4 : r.y + 18);
        ctx.restore();
      });
    }
    alignPicks.filter((p) => p.sheet === view).forEach((p, i) => {
      const x = p.pdfX * renders.scale;
      const y = p.pdfY * renders.scale;
      ctx.save();
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14);
      ctx.stroke();
      ctx.fillStyle = '#7c3aed';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(String(i + 1), x + 8, y - 8);
      ctx.restore();
    });
  }, [renders, overlay, regions, view, selected, alignPicks]);

  const fitZoom = () => {
    const w = scrollRef.current?.clientWidth || 800;
    return renders ? Math.min(1, (w - 8) / renders.newImg.width) : 1;
  };
  const effectiveZoom = zoom ?? fitZoom();

  const zoomToRegion = (i) => {
    setSelected(i);
    if (view === 'old') setView('overlay');
    const r = regions[i];
    const z = Math.max(effectiveZoom, 0.9);
    setZoom(z);
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el || !r) return;
      el.scrollLeft = (r.x + r.width / 2) * z - el.clientWidth / 2;
      el.scrollTop = (r.y + r.height / 2) * z - el.clientHeight / 2;
    });
  };

  const startAlign = () => {
    setAlignPicks([]);
    setAlignStep(0);
    setView('old');
  };

  const handleCanvasClick = (e) => {
    if (alignStep < 0 || !renders) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * e.currentTarget.width;
    const py = ((e.clientY - rect.top) / rect.height) * e.currentTarget.height;
    const pick = { sheet: ALIGN_STEPS[alignStep].sheet, pdfX: px / renders.scale, pdfY: py / renders.scale };
    const picks = [...alignPicks, pick];
    setAlignPicks(picks);
    if (alignStep < 3) {
      setAlignStep(alignStep + 1);
      setView(ALIGN_STEPS[alignStep + 1].sheet);
      return;
    }
    const [o1, n1, o2, n2] = picks;
    try {
      const fit = computeAlignmentTransform([
        { from: { x: o1.pdfX, y: o1.pdfY }, to: { x: n1.pdfX, y: n1.pdfY } },
        { from: { x: o2.pdfX, y: o2.pdfY }, to: { x: n2.pdfX, y: n2.pdfY } },
      ], { allowRotation, allowScale: true });
      setTransform(fit.transform);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
    setAlignStep(-1);
    setView('overlay');
  };

  const handleSave = () => {
    if (!renders) return;
    const clouds = boxesToPdfSpace(regions, renders.scale).map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height, kind: b.kind }));
    onSave?.({
      page: currentPage,
      previous_takeoff_id: olderId,
      old_page_number: Number(oldPage) || 1,
      transform: transform || null,
      clouds,
      stats: overlay?.stats || null,
      compared_at: new Date().toISOString(),
    });
  };

  const shiftText = transform
    ? `Lined up: moved ${transform.e.toFixed(1)}, ${transform.f.toFixed(1)} pt · scale ×${Math.hypot(transform.a, transform.b).toFixed(4)}${Math.abs(Math.atan2(transform.b, transform.a)) > 1e-6 ? ` · turned ${((Math.atan2(transform.b, transform.a) * 180) / Math.PI).toFixed(2)}°` : ''}`
    : 'Not lined up — sheets compared as-is';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-7xl w-[96vw] h-[90vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GitCompare className="w-5 h-5" />Compare with an older revision — page {currentPage}</DialogTitle>
          <DialogDescription>
            <span className="text-red-600 font-medium">Red</span> was only on the old sheet, <span className="text-blue-600 font-medium">blue</span> is new, gray didn&apos;t change. Boxes mark each changed area.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="space-y-1">
            <span className="block text-xs font-medium">Older revision</span>
            <select className="h-8 w-72 rounded-md border border-input bg-background px-2 text-sm" value={olderId} onChange={(e) => setOlderId(e.target.value)}>
              <option value="">Pick a takeoff…</option>
              {revisionCandidates.map((s) => (
                <option key={s.id} value={s.id} disabled={!s.has_stored_pdf}>
                  {s.takeoff_name || s.file_name || 'Untitled takeoff'}{s.id === previousTakeoffId ? ' (previous revision)' : ''}{s.has_stored_pdf ? '' : ' — PDF not stored'}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium">Its page</span>
            <Input className="h-8 w-20" type="number" min={1} value={oldPage} onChange={(e) => setOldPage(e.target.value)} />
          </label>
          <Button size="sm" onClick={handleCompare} disabled={busy || !olderId}>
            {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" />}{renders ? 'Compare again' : 'Compare'}
          </Button>
          {renders && (
            <>
              <div className="w-px h-6 bg-border mx-1" />
              <div className="flex items-center gap-0.5 rounded-md border p-0.5 text-xs">
                {[['overlay', 'Overlay'], ['old', 'Old sheet'], ['new', 'New sheet']].map(([v, l]) => (
                  <button key={v} type="button" className={`px-2 py-1 rounded ${view === v ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => setView(v)} disabled={alignStep >= 0}>{l}</button>
                ))}
              </div>
              <Button size="sm" variant={alignStep >= 0 ? 'default' : 'outline'} onClick={alignStep >= 0 ? () => { setAlignStep(-1); setView('overlay'); } : startAlign}>
                <Crosshair className="w-3.5 h-3.5 mr-1.5" />{alignStep >= 0 ? 'Stop lining up' : 'Line up sheets (2 points)'}
              </Button>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={allowRotation} onChange={(e) => setAllowRotation(e.target.checked)} />Allow turning
              </label>
              {transform && <Button size="sm" variant="ghost" onClick={() => setTransform(null)}>Undo line-up</Button>}
              <div className="flex items-center gap-1 ml-auto">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom(Math.max(0.1, effectiveZoom / 1.5))}><ZoomOut className="w-4 h-4" /></Button>
                <span className="text-xs w-12 text-center">{Math.round(effectiveZoom * 100)}%</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom(Math.min(4, effectiveZoom * 1.5))}><ZoomIn className="w-4 h-4" /></Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setZoom(null)}>Fit</Button>
              </div>
            </>
          )}
        </div>

        {error && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{error}</p>}
        {alignStep >= 0 && (
          <p className="text-sm rounded-md bg-violet-600 text-white px-3 py-1.5 w-fit">Step {alignStep + 1} of 4 — {ALIGN_STEPS[alignStep].text}</p>
        )}

        <div className="flex-1 min-h-0 flex gap-3">
          <div ref={scrollRef} className="flex-1 min-w-0 overflow-auto rounded-md border bg-neutral-100">
            {!renders ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-6 text-center">
                {busy ? <><Loader2 className="w-5 h-5 animate-spin mr-2" />Rendering both sheets…</> : 'Pick the older revision and click Compare.'}
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                style={{ width: renders.newImg.width * effectiveZoom, height: 'auto', cursor: alignStep >= 0 ? 'crosshair' : 'default', display: 'block' }}
              />
            )}
          </div>

          {renders && (
            <div className="w-72 flex-shrink-0 flex flex-col gap-2 min-h-0">
              <p className="text-xs text-muted-foreground">{shiftText}</p>
              <p className="text-sm font-semibold">{regions.length} changed area{regions.length === 1 ? '' : 's'}</p>
              <div className="flex-1 min-h-0 overflow-y-auto border rounded-md divide-y">
                {regions.length === 0 && <p className="text-xs text-muted-foreground p-3">No differences found on this page.</p>}
                {regions.map((r, i) => (
                  <button
                    key={`${r.x}-${r.y}`}
                    type="button"
                    onClick={() => zoomToRegion(i)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/60 ${selected === i ? 'bg-amber-50' : ''}`}
                  >
                    <span className="font-semibold">Change {i + 1}</span>{' '}
                    <Badge variant="outline" className={`text-[10px] px-1 py-0 ${r.kind === 'added' ? 'text-blue-700 border-blue-300' : r.kind === 'removed' ? 'text-red-700 border-red-300' : ''}`}>
                      {r.kind === 'added' ? 'new' : r.kind === 'removed' ? 'removed' : 'changed'}
                    </Badge>
                    <span className="block text-muted-foreground">
                      {Math.round(r.width / renders.scale)} × {Math.round(r.height / renders.scale)} pt · {r.added} new / {r.removed} removed px
                    </span>
                  </button>
                ))}
              </div>
              <Button onClick={handleSave}><Save className="w-3.5 h-3.5 mr-1.5" />Save change clouds to this takeoff</Button>
              {savedPage && <p className="text-[11px] text-muted-foreground">Saving replaces the {savedPage.clouds?.length || 0} cloud{savedPage.clouds?.length === 1 ? '' : 's'} saved on {new Date(savedPage.compared_at).toLocaleDateString()}.</p>}
              {onOpenCarryForward && <Button variant="outline" onClick={onOpenCarryForward}>Bring markups forward…</Button>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
