import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Images, Bookmark, Layers, Search, ChevronRight, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const TABS = [
  { id: 'thumbnails', label: 'Thumbnails', icon: Images },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
  { id: 'layers', label: 'Layers', icon: Layers },
  { id: 'search', label: 'Search', icon: Search },
];

// ---------------------------------------------------------------- thumbnails

function Thumb({ pdfDoc, num, active, label, scaleInfo, cache, onClick, onScaleClick }) {
  const ref = useRef(null);
  const [src, setSrc] = useState(() => cache.get(num) || null);
  useEffect(() => {
    if (src || !pdfDoc || !ref.current) return undefined;
    let cancelled = false;
    const el = ref.current;
    const io = new IntersectionObserver(async (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      try {
        const p = await pdfDoc.getPage(num);
        const nat = p.getViewport({ scale: 1 });
        const s = 150 / nat.width;
        const vp = p.getViewport({ scale: s });
        const c = document.createElement('canvas');
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const url = c.toDataURL('image/png');
        cache.set(num, url);
        if (!cancelled) setSrc(url);
      } catch (e) {
        console.warn('IRONSIGHT: thumbnail failed for page', num, e);
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => { cancelled = true; io.disconnect(); };
  }, [pdfDoc, num, src, cache]);

  return (
    <div ref={ref} className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        className={`relative w-[150px] min-h-[100px] bg-white rounded border-2 overflow-hidden ${active ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-muted-foreground/40'}`}
        title={`Go to page ${num}`}
      >
        {src ? <img src={src} alt={`Page ${num}`} className="block w-full" /> : <div className="h-[100px] flex items-center justify-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /></div>}
      </button>
      <div className="flex items-center gap-1 text-[11px]">
        <span className={active ? 'font-semibold' : 'text-muted-foreground'}>{label ? `${label} (${num})` : num}</span>
        <button
          type="button"
          onClick={onScaleClick}
          title="Page scale — click to set or check it"
          className={`rounded px-1 border text-[10px] ${scaleInfo?.ok ? 'border-green-300 text-green-700 bg-green-50' : 'border-amber-300 text-amber-700 bg-amber-50'}`}
        >
          {scaleInfo?.label || 'No scale'}
        </button>
      </div>
    </div>
  );
}

function ThumbnailsTab({ pdfDoc, numPages, pageNum, pageLabels, scaleInfoFor, onGoToPage, onScaleClick }) {
  const cacheRef = useRef(new Map());
  const docRef = useRef(pdfDoc);
  if (docRef.current !== pdfDoc) { docRef.current = pdfDoc; cacheRef.current = new Map(); }
  if (!pdfDoc) return <p className="p-3 text-xs text-muted-foreground">No drawing loaded.</p>;
  return (
    <div className="p-2 space-y-3 flex flex-col items-center">
      {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
        <Thumb
          key={`${n}`}
          pdfDoc={pdfDoc}
          num={n}
          active={n === pageNum}
          label={pageLabels?.[n - 1] && pageLabels[n - 1] !== String(n) ? pageLabels[n - 1] : null}
          scaleInfo={scaleInfoFor(n)}
          cache={cacheRef.current}
          onClick={() => onGoToPage(n)}
          onScaleClick={() => onScaleClick(n)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- bookmarks

async function destToPage(pdfDoc, dest) {
  try {
    const explicit = typeof dest === 'string' ? await pdfDoc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || !explicit.length) return null;
    const target = explicit[0];
    if (Number.isInteger(target)) return target + 1;
    if (target && typeof target === 'object') return (await pdfDoc.getPageIndex(target)) + 1;
  } catch (e) {
    console.warn('IRONSIGHT: could not resolve bookmark', e);
  }
  return null;
}

function OutlineNode({ node, pdfDoc, onGoToPage, depth }) {
  const [open, setOpen] = useState(depth < 1);
  const has = node.items?.length > 0;
  return (
    <div>
      <div className="flex items-start gap-0.5" style={{ paddingLeft: depth * 10 }}>
        <button type="button" className={`mt-0.5 ${has ? '' : 'invisible'}`} onClick={() => setOpen((o) => !o)}>
          <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        <button
          type="button"
          className="text-left text-xs hover:underline flex-1"
          style={{ fontWeight: node.bold ? 600 : 400, fontStyle: node.italic ? 'italic' : 'normal' }}
          onClick={async () => { const n = await destToPage(pdfDoc, node.dest); if (n) onGoToPage(n); }}
        >
          {node.title || '(untitled)'}
        </button>
      </div>
      {open && has && node.items.map((child, i) => <OutlineNode key={i} node={child} pdfDoc={pdfDoc} onGoToPage={onGoToPage} depth={depth + 1} />)}
    </div>
  );
}

function BookmarksTab({ pdfDoc, onGoToPage }) {
  const [outline, setOutline] = useState(undefined);
  useEffect(() => {
    if (!pdfDoc) { setOutline(null); return undefined; }
    let cancelled = false;
    setOutline(undefined);
    pdfDoc.getOutline().then((o) => { if (!cancelled) setOutline(o || []); }).catch(() => { if (!cancelled) setOutline([]); });
    return () => { cancelled = true; };
  }, [pdfDoc]);
  if (outline === undefined) return <p className="p-3 text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Reading bookmarks…</p>;
  if (!outline?.length) return <p className="p-3 text-xs text-muted-foreground">This drawing has no bookmarks.</p>;
  return <div className="p-2 space-y-0.5">{outline.map((n, i) => <OutlineNode key={i} node={n} pdfDoc={pdfDoc} onGoToPage={onGoToPage} depth={0} />)}</div>;
}

// ---------------------------------------------------------------- layers

function LayersTab({ ocConfig, ocVersion, onToggleLayer }) {
  if (!ocConfig) return <p className="p-3 text-xs text-muted-foreground">This drawing has no layers.</p>;
  const groups = [];
  for (const [id, group] of ocConfig) groups.push({ id, name: group.name, visible: group.visible });
  if (!groups.length) return <p className="p-3 text-xs text-muted-foreground">This drawing has no layers.</p>;
  return (
    <div className="p-2 space-y-1" data-version={ocVersion}>
      <p className="text-[11px] text-muted-foreground mb-1">Turn PDF layers on or off. View only — measurements and the stored drawing are not changed.</p>
      {groups.map((g) => (
        <label key={g.id} className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={g.visible} onChange={(e) => onToggleLayer(g.id, e.target.checked)} />
          {g.name || g.id}
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- search

// Finds `query` in every page's text (pdf.js getTextContent). Hit boxes are
// PDF space (pdf.js viewport at scale 1), so they line up with markups.
async function searchDocument(pdfDoc, query, onProgress, isCancelled) {
  const q = query.trim().toLowerCase();
  const hits = [];
  if (!q) return hits;
  for (let n = 1; n <= pdfDoc.numPages; n += 1) {
    if (isCancelled()) return hits;
    const page = await pdfDoc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    text.items.forEach((item) => {
      const str = item.str || '';
      const lower = str.toLowerCase();
      let idx = lower.indexOf(q);
      if (idx < 0) return;
      const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
      const fontH = Math.hypot(tx[2], tx[3]) || 8;
      const width = item.width || fontH * str.length * 0.5;
      const charW = str.length ? width / str.length : width;
      while (idx >= 0) {
        hits.push({
          id: `${n}-${hits.length}`,
          page: n,
          x: tx[4] + idx * charW,
          y: tx[5] - fontH,
          width: Math.max(charW * q.length, 2),
          height: fontH * 1.15,
          snippet: str.length > 70 ? `${str.slice(Math.max(0, idx - 25), idx + q.length + 25)}…` : str,
        });
        idx = lower.indexOf(q, idx + q.length);
      }
    });
    onProgress(n / pdfDoc.numPages, [...hits]);
  }
  return hits;
}

function SearchTab({ pdfDoc, search, onSearchChange, onGoToHit, focusToken }) {
  const [query, setQuery] = useState(search.query || '');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const cancelRef = useRef(false);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, [focusToken]);
  const run = async () => {
    if (!pdfDoc || !query.trim()) return;
    cancelRef.current = false;
    setBusy(true);
    setProgress(0);
    const hits = await searchDocument(pdfDoc, query, (p, partial) => { setProgress(p); onSearchChange({ query, hits: partial, activeId: null }); }, () => cancelRef.current);
    onSearchChange({ query, hits, activeId: hits[0]?.id || null });
    if (hits[0]) onGoToHit(hits[0]);
    setBusy(false);
  };
  const clear = () => { cancelRef.current = true; setQuery(''); onSearchChange({ query: '', hits: [], activeId: null }); };
  return (
    <div className="p-2 space-y-2">
      <div className="flex gap-1">
        <Input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); }} placeholder="Find text in the drawing…" className="h-8 text-xs" />
        <Button size="sm" className="h-8 px-2" onClick={run} disabled={busy || !query.trim()}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}</Button>
        {search.hits.length > 0 && <Button size="sm" variant="ghost" className="h-8 px-2" onClick={clear} title="Clear results"><X className="w-3.5 h-3.5" /></Button>}
      </div>
      {busy && <p className="text-[11px] text-muted-foreground">Searching… {Math.round(progress * 100)}%</p>}
      {!busy && search.query && <p className="text-[11px] text-muted-foreground">{search.hits.length} match{search.hits.length === 1 ? '' : 'es'} for &quot;{search.query}&quot;</p>}
      <div className="space-y-0.5">
        {search.hits.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => { onSearchChange({ ...search, activeId: h.id }); onGoToHit(h); }}
            className={`w-full text-left text-xs rounded px-1.5 py-1 hover:bg-muted ${search.activeId === h.id ? 'bg-orange-100 dark:bg-orange-950' : ''}`}
          >
            <span className="text-muted-foreground mr-1">p.{h.page}</span>{h.snippet}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">Scanned drawings without a text layer can&apos;t be searched (OCR is not available).</p>
    </div>
  );
}

// Left side bar: thumbnails, bookmarks (PDF outline), layers (optional
// content) and text search, picked by the icon strip.
export default function LeftSidebar({ tab, onTabChange, collapsed, onToggleCollapsed, ...props }) {
  return (
    <div className="h-full flex min-h-0 bg-background">
      <div className="w-9 flex-shrink-0 border-r flex flex-col items-center py-1 gap-1 bg-muted/30">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.label}
            onClick={() => { if (collapsed) onToggleCollapsed(); onTabChange(t.id); }}
            className={`h-8 w-8 inline-flex items-center justify-center rounded ${tab === t.id && !collapsed ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
          >
            <t.icon className="w-4 h-4" />
          </button>
        ))}
      </div>
      {!collapsed && (
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="h-7 px-2 flex items-center justify-between border-b text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex-shrink-0">
            {TABS.find((t) => t.id === tab)?.label}
            <button type="button" onClick={onToggleCollapsed} title="Hide panel" className="hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {tab === 'thumbnails' && <ThumbnailsTab {...props} />}
            {tab === 'bookmarks' && <BookmarksTab pdfDoc={props.pdfDoc} onGoToPage={props.onGoToPage} />}
            {tab === 'layers' && <LayersTab ocConfig={props.ocConfig} ocVersion={props.ocVersion} onToggleLayer={props.onToggleLayer} />}
            {tab === 'search' && <SearchTab pdfDoc={props.pdfDoc} search={props.search} onSearchChange={props.onSearchChange} onGoToHit={props.onGoToHit} focusToken={props.searchFocusToken} />}
          </div>
        </div>
      )}
    </div>
  );
}
