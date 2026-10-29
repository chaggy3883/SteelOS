import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, FileDown } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { exportMarkedUpPdf, markupsFromAcceptedItems, markupsFromDrawingMarkups, loadTakeoffPdfBytes, downloadPdfBytes } from '@/lib/takeoffMarkupPdfExport';
import { parsePageList } from '@/lib/drawingMarkups';
import { revisionCloudMarkups } from '@/lib/pdfRevisionOverlay';

const ANCHOR_FOR_EXPORT = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

// Export the takeoff's markups onto (or into) the original PDF. "Flatten"
// burns them into the drawing so every viewer shows them and nobody can
// move them; "Editable" adds them as standard PDF markups other PDF viewers
// can select, move and edit. The original stored PDF is never changed — a
// new file downloads.
export default function MarkupPdfExportDialog({
  open, onOpenChange, takeoffId, takeoffName, rows, toolSet, numPages = 1, currentPage = 1,
  legendSettings = {}, legendForPage, revisionCompare, author,
  // General drawing markups (text boxes, clouds, stamps …) — exported too.
  drawingMarkups = [], initialPageText = null,
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState('burn');
  const [pageChoice, setPageChoice] = useState('all');
  const [pageText, setPageText] = useState('');
  const [legendChoice, setLegendChoice] = useState('placed');
  const [includeClouds, setIncludeClouds] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPageText(initialPageText || String(currentPage));
    if (initialPageText) setPageChoice('list');
    setBusy(false);
  }, [open, currentPage, initialPageText]);

  const cloudPages = Object.entries(revisionCompare?.pages || {}).filter(([, p]) => p?.clouds?.length);
  const pages = pageChoice === 'all' ? Array.from({ length: numPages }, (_, i) => i + 1)
    : pageChoice === 'current' ? [currentPage]
      : parsePageList(pageText, numPages);
  const pageSet = new Set(pages || []);
  const markupCount = rows.filter((r) => r.source === 'measurement' && r.is_accepted !== false && pageSet.has(Number(r.page_number || 1))).length;
  const drawingCount = drawingMarkups.filter((m) => pageSet.has(Number(m.page_number || 1))).length;

  const handleExport = async () => {
    if (!pages?.length) { toast({ title: 'Check the page list', description: 'Use page numbers like 1-3, 5.', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      const bytes = await loadTakeoffPdfBytes(takeoffId);
      if (!bytes) {
        toast({ title: "This drawing isn't stored on this device", description: 'Re-attach the PDF, then export again.', variant: 'destructive' });
        return;
      }
      const pageRows = rows.filter((r) => pageSet.has(Number(r.page_number || 1)));
      const markups = markupsFromAcceptedItems(pageRows.filter((r) => r.source === 'measurement'), { toolSet, author });
      markups.push(...markupsFromDrawingMarkups(drawingMarkups.filter((m) => pageSet.has(Number(m.page_number || 1))), { author }));
      if (includeClouds) {
        cloudPages.forEach(([pageNum, p]) => {
          if (!pageSet.has(Number(pageNum))) return;
          // Saved clouds are already in pdf space (renderScale 1).
          const boxes = p.clouds.map((c) => ({ ...c }));
          markups.push(...revisionCloudMarkups(boxes, { page_number: Number(pageNum), renderScale: 1 }));
        });
      }
      const legends = [];
      if (legendChoice !== 'none' && legendForPage) {
        pages.forEach((pageNum) => {
          const setting = legendSettings[pageNum] || {};
          if (legendChoice === 'placed' && !setting.on) return;
          const legend = legendForPage(pageNum, setting);
          if (!legend?.rows?.length) return;
          if (setting.anchor === 'custom' && setting.pdfX != null) legends.push({ page_number: pageNum, legend, font_size: 8, pdfX: setting.pdfX, pdfY: setting.pdfY });
          else legends.push({ page_number: pageNum, legend, font_size: 8, anchor: ANCHOR_FOR_EXPORT.has(setting.anchor) ? setting.anchor : 'bottom-right' });
        });
      }
      if (!markups.length && !legends.length) {
        toast({ title: 'Nothing to export on those pages', description: 'No confirmed markups, legends or change clouds there.', variant: 'destructive' });
        return;
      }
      const result = await exportMarkedUpPdf(bytes, { markups, legends, mode, author, title: takeoffName || undefined });
      const suffix = mode === 'burn' ? 'marked-up' : 'editable-markups';
      downloadPdfBytes(result.bytes, `${(takeoffName || 'takeoff').replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'takeoff'}-${suffix}.pdf`);
      toast({
        title: 'Marked-up PDF downloaded',
        description: `${result.drawn} item${result.drawn === 1 ? '' : 's'} added${result.skipped ? `, ${result.skipped} skipped (no drawing geometry or page out of range)` : ''}.`,
      });
      onOpenChange(false);
    } catch (e) {
      console.error('Marked-up PDF export failed', e);
      const encrypted = /encrypt/i.test(e?.message || '');
      toast({
        title: encrypted ? 'This PDF is locked (encrypted)' : 'Could not export the PDF',
        description: encrypted
          ? 'The drawing has security settings that stop markups being added. Ask for an unlocked copy, re-attach it, then export again.'
          : (e?.message || 'See console for details.'),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const radio = (name, value, current, set, label, help) => (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="radio" name={name} className="mt-1" checked={current === value} onChange={() => set(value)} />
      <span><span className="text-sm font-medium">{label}</span>{help && <span className="block text-xs text-muted-foreground">{help}</span>}</span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export marked-up PDF</DialogTitle>
          <DialogDescription>Downloads a new PDF of the drawing with your takeoff on it. The stored drawing isn&apos;t changed.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How</p>
            {radio('pdf-mode', 'burn', mode, setMode, 'Flatten onto drawing', 'Markups become part of the sheet — everyone sees them, nobody can move them. Best for printing or sending to the field.')}
            {radio('pdf-mode', 'annotations', mode, setMode, 'Editable markups', 'Markups stay separate so other PDF programs can select, move or delete them.')}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pages</p>
            {radio('pdf-pages', 'all', pageChoice, setPageChoice, `All ${numPages} page${numPages === 1 ? '' : 's'}`)}
            {radio('pdf-pages', 'current', pageChoice, setPageChoice, `Only this page (${currentPage})`)}
            <div className="flex items-center gap-2">
              {radio('pdf-pages', 'list', pageChoice, setPageChoice, 'These pages:')}
              <Input className="h-8 w-40" value={pageText} onChange={(e) => { setPageText(e.target.value); setPageChoice('list'); }} placeholder="1-3, 5" />
            </div>
            {pageChoice === 'list' && pages === null && <p className="text-xs text-red-600">Use page numbers like 1-3, 5.</p>}
            <p className="text-xs text-muted-foreground">{markupCount} confirmed markup{markupCount === 1 ? '' : 's'} and {drawingCount} drawing note{drawingCount === 1 ? '' : 's'} (text, clouds, stamps…) on {pages?.length || 0} page{pages?.length === 1 ? '' : 's'}.</p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Legend</p>
            {radio('pdf-legend', 'placed', legendChoice, setLegendChoice, 'Only on pages where I turned the legend on', 'Placed where it sits on screen.')}
            {radio('pdf-legend', 'every', legendChoice, setLegendChoice, 'On every exported page with markups', 'Bottom-right unless you placed it somewhere else.')}
            {radio('pdf-legend', 'none', legendChoice, setLegendChoice, 'No legend')}
          </div>

          {cloudPages.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeClouds} onChange={(e) => setIncludeClouds(e.target.checked)} />
              Include revision change clouds ({cloudPages.reduce((n, [, p]) => n + p.clouds.length, 0)} saved)
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleExport} disabled={busy || !pages?.length}>
            {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5 mr-1.5" />}Export PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
