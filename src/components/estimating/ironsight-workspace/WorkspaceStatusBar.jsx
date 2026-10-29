import React, { useEffect, useState } from 'react';
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Magnet, Grid3x3, Ruler, Rows3, FileText } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useLiveStore } from '@/hooks/useWorkspaceLayout';
import { ZOOM_PRESETS } from '@/lib/ironsightView';
import { formatFeetInchesFraction } from '@/lib/fractionInches';

// Real-world distance text in the user's units.
export function formatUnits(ft, units) {
  if (!Number.isFinite(ft)) return '—';
  if (units === 'decimal-ft') return `${ft.toFixed(2)}'`;
  if (units === 'metric') return `${(ft * 0.3048).toFixed(3)} m`;
  return formatFeetInchesFraction(ft);
}

function Toggle({ on, onClick, title, icon: Icon, label }) {
  return (
    <button type="button" onClick={onClick} title={title} className={`h-5 px-1.5 inline-flex items-center gap-1 rounded text-[11px] ${on ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
      <Icon className="w-3 h-3" />{label}
    </button>
  );
}

// Status bar: page x of y with first/prev/next/last and a jump box, zoom %
// with presets, the scale where the cursor is (click → Scale dialog), the
// cursor's position in real units, and the Snap / Grid / Ortho / Continuous
// toggles.
export default function WorkspaceStatusBar({
  pageNum, numPages, pageLabel, onGoToPage, viewStore, cursorStore, onZoomPreset, resolveScale, onOpenScale,
  units, snap, grid, ortho, continuous, onToggle, hasFile,
}) {
  const view = useLiveStore(viewStore);
  const cursor = useLiveStore(cursorStore);
  const [jump, setJump] = useState(String(pageNum));
  useEffect(() => { setJump(String(pageNum)); }, [pageNum]);
  const commitJump = () => {
    const n = parseInt(jump, 10);
    if (Number.isFinite(n) && n >= 1 && n <= numPages) onGoToPage(n); else setJump(String(pageNum));
  };

  const onPage = cursor && cursor.page === pageNum;
  const sc = resolveScale(onPage ? { pdfX: cursor.pdfX, pdfY: cursor.pdfY } : null);
  const scaleText = !sc ? 'No scale — click to set' : sc.blocked ? `${sc.name || 'Viewport'}: scale not set` : `${sc.label}${sc.source === 'viewport' ? ` (${sc.name || 'viewport'})` : sc.source === 'legacy' ? ' (whole set)' : ''}`;
  let coords = '—';
  if (onPage) {
    if (sc?.ptsPerFt) coords = `X ${formatUnits(cursor.pdfX / sc.ptsPerFt, units)}   Y ${formatUnits(cursor.pdfY / sc.ptsPerFt, units)}`;
    else coords = `X ${(cursor.pdfX / 72).toFixed(2)} in   Y ${(cursor.pdfY / 72).toFixed(2)} in (paper)`;
  }
  const navBtn = 'h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted disabled:opacity-30';

  return (
    <div className="h-7 flex items-center gap-3 px-2 border-t bg-muted/40 text-[11px] flex-shrink-0 overflow-x-auto whitespace-nowrap">
      <div className="flex items-center gap-0.5">
        <button type="button" className={navBtn} onClick={() => onGoToPage(1)} disabled={!hasFile || pageNum <= 1} title="First page (Ctrl+Home)"><ChevronsLeft className="w-3.5 h-3.5" /></button>
        <button type="button" className={navBtn} onClick={() => onGoToPage(pageNum - 1)} disabled={!hasFile || pageNum <= 1} title="Previous page (PageUp)"><ChevronLeft className="w-3.5 h-3.5" /></button>
        <input
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitJump(); }}
          onBlur={commitJump}
          className="w-10 h-5 text-center rounded border border-input bg-background text-[11px]"
          aria-label="Go to page"
        />
        <span className="text-muted-foreground">of {numPages}{pageLabel ? ` · ${pageLabel}` : ''}</span>
        <button type="button" className={navBtn} onClick={() => onGoToPage(pageNum + 1)} disabled={!hasFile || pageNum >= numPages} title="Next page (PageDown)"><ChevronRight className="w-3.5 h-3.5" /></button>
        <button type="button" className={navBtn} onClick={() => onGoToPage(numPages)} disabled={!hasFile || pageNum >= numPages} title="Last page (Ctrl+End)"><ChevronsRight className="w-3.5 h-3.5" /></button>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={!hasFile} className="h-5 px-1.5 rounded border border-input bg-background min-w-14 text-center" title="Zoom">
            {Math.round((view?.scale || 1) * 100)}%
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top">
          <DropdownMenuItem className="text-xs" onSelect={() => onZoomPreset('page')}>Fit page</DropdownMenuItem>
          <DropdownMenuItem className="text-xs" onSelect={() => onZoomPreset('width')}>Fit width</DropdownMenuItem>
          <DropdownMenuSeparator />
          {ZOOM_PRESETS.map((z) => <DropdownMenuItem key={z} className="text-xs" onSelect={() => onZoomPreset(z)}>{Math.round(z * 100)}%</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" onClick={onOpenScale} disabled={!hasFile} className={`h-5 px-1.5 rounded inline-flex items-center gap-1 hover:bg-muted ${sc?.ptsPerFt ? '' : 'text-amber-700'}`} title="Drawing scale here — click to calibrate or pick a scale">
        <Ruler className="w-3 h-3" />{scaleText}
      </button>
      <span className="font-mono text-muted-foreground min-w-[220px]">{coords}</span>
      <div className="ml-auto flex items-center gap-1">
        <Toggle on={snap} onClick={() => onToggle('snap')} title="Snap to the drawing's line work (Alt while clicking = no snap)" icon={Magnet} label="Snap" />
        <Toggle on={grid} onClick={() => onToggle('grid')} title="Show a ½ inch paper grid" icon={Grid3x3} label="Grid" />
        <Toggle on={ortho} onClick={() => onToggle('ortho')} title="Keep lines horizontal/vertical (Shift does this for one click)" icon={Ruler} label="Ortho" />
        <Toggle on={!continuous} onClick={() => onToggle('single')} title="Single page" icon={FileText} label="Single" />
        <Toggle on={continuous} onClick={() => onToggle('continuous')} title="Continuous — the pages above and below show while you pan" icon={Rows3} label="Continuous" />
      </div>
    </div>
  );
}
