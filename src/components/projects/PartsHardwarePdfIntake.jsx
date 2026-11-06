import React, { useState } from 'react';
import { UploadCloud, FileText, Trash2, Loader2, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { normalizeScanValue } from '@/lib/pieceScan';
import { createDocumentId } from '@/lib/pieceMarkDocumentStore';
import { stripFileExtension, matchFilenameToPiece, attachFileToPiece, createPieceFromFile } from '@/lib/pieceFileIntake';
import SequenceAreaSelect from '@/components/projects/SequenceAreaSelect';

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const ITEM_TYPES = ['Loose_Part', 'Bolt', 'Embed', 'Misc_Metal'];
const typeLabel = (t) => String(t || '').replace(/_/g, ' ');

// Parts & Hardware's drawing / spec-sheet intake — the same flow as the
// Piece Marks section (PieceMarkPdfIntake.jsx): every dropped PDF goes into
// an upload list (ticked, part # from the file name), you set type, quantity
// and area per row or for all ticked rows, and one Submit saves them. A part
// # that already exists on the project gets the file added to it; anything
// else becomes a new part/hardware item (bulk item_types — counted, not
// individually tracked, so each carries a quantity). Matching, creation and
// QR all go through pieceFileIntake.js so the two sections never drift.
export default function PartsHardwarePdfIntake({ project, pieces, sequenceAreas, onPieceCreated, onSequenceAreaCreated }) {
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(null); // { current, total } | null
  const [staged, setStaged] = useState([]); // { id, file, selected, markInput, itemType, quantity, sequenceAreaId, error }

  const handleFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const pdfFiles = files.filter(isPdf);
    const skipped = files.length - pdfFiles.length;
    if (skipped > 0) {
      toast({ title: `${skipped} file(s) skipped`, description: 'Only PDF files are supported for part/hardware drawings and spec sheets.', variant: 'destructive' });
    }
    if (pdfFiles.length === 0) return;
    setStaged((prev) => {
      const seen = new Set(prev.map((f) => `${f.file.name}|${f.file.size}`));
      const added = pdfFiles
        .filter((file) => !seen.has(`${file.name}|${file.size}`))
        .map((file) => ({ id: createDocumentId(), file, selected: true, markInput: stripFileExtension(file.name), itemType: 'Loose_Part', quantity: '1', sequenceAreaId: null, error: null }));
      return [...prev, ...added];
    });
  };

  const update = (id, patch) => setStaged((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const remove = (id) => setStaged((prev) => prev.filter((f) => f.id !== id));
  const selected = staged.filter((f) => f.selected);
  const allSelected = staged.length > 0 && selected.length === staged.length;
  const setAll = (on) => setStaged((prev) => prev.map((f) => ({ ...f, selected: on })));
  const setForSelected = (patch) => setStaged((prev) => prev.map((f) => (f.selected ? { ...f, ...patch } : f)));
  const targetFor = (f) => (f.markInput.trim() ? matchFilenameToPiece(pieces, f.markInput.trim()) : null);

  // Submit every ticked file, one at a time. An existing part # (or one
  // created earlier in this same submit) gets the file; anything else is
  // created. Failures stay listed with the reason; the rest leave the list.
  const submit = async () => {
    const queue = staged.filter((f) => f.selected);
    if (!queue.length) return;
    const byMark = new Map(pieces.map((p) => [normalizeScanValue(p.piece_mark), p]));
    let created = 0;
    let attached = 0;
    const failed = new Map();
    const done = new Set();
    setProcessing({ current: 0, total: queue.length });
    for (let i = 0; i < queue.length; i += 1) {
      const item = queue[i];
      setProcessing({ current: i + 1, total: queue.length });
      const mark = item.markInput.trim();
      if (!mark) { failed.set(item.id, 'Enter a part number.'); continue; }
      // Exact piece mark, else an imported assembly's copies ("2B9" -> 2B9-1 …,
      // which share one set of drawings).
      const existing = byMark.get(normalizeScanValue(mark)) || matchFilenameToPiece(pieces, mark);
      try {
        if (existing) {
          await attachFileToPiece(existing, item.file);
          attached += 1;
        } else {
          const piece = await createPieceFromFile({
            project, file: item.file, itemType: item.itemType, markOverride: mark,
            quantity: Number(item.quantity) || 1, sequenceAreaId: item.sequenceAreaId,
          });
          byMark.set(normalizeScanValue(mark), piece);
          onPieceCreated?.(piece);
          created += 1;
        }
        done.add(item.id);
      } catch (e) {
        failed.set(item.id, e?.message || 'Could not save this file.');
      }
    }
    setProcessing(null);
    setStaged((prev) => prev
      .filter((f) => !done.has(f.id))
      .map((f) => (failed.has(f.id) ? { ...f, error: failed.get(f.id) } : f)));
    const parts = [];
    if (created) parts.push(`${created} new part${created === 1 ? '' : 's'}/hardware`);
    if (attached) parts.push(`${attached} file${attached === 1 ? '' : 's'} added to existing items`);
    if (parts.length) toast({ title: `Submitted: ${parts.join(', ')}` });
    if (failed.size) toast({ title: `${failed.size} file${failed.size === 1 ? '' : 's'} not saved`, description: [...failed.values()][0], variant: 'destructive' });
  };

  const dropZoneProps = {
    onDragOver: (e) => { e.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); },
  };

  return (
    <div className="space-y-3 mb-4">
      <div
        {...dropZoneProps}
        onClick={() => document.getElementById('parts-hardware-pdf-intake-input')?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center cursor-pointer transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
        )}
      >
        <UploadCloud className="w-5 h-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Drag &amp; drop part/hardware drawings or spec sheet PDFs here — review them in the list, then Submit
        </p>
        <input
          id="parts-hardware-pdf-intake-input"
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {staged.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
              <input type="checkbox" aria-label="Select all uploaded part files" checked={allSelected} onChange={(e) => setAll(e.target.checked)} />
              Uploaded files — {staged.length} ({selected.length} selected)
            </label>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select value="" onValueChange={(v) => setForSelected({ itemType: v })} disabled={!selected.length}>
                <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Set type for selected…" /></SelectTrigger>
                <SelectContent>
                  {ITEM_TYPES.map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}
                </SelectContent>
              </Select>
              {(sequenceAreas || []).length > 0 && (
                <Select value="" onValueChange={(v) => setForSelected({ sequenceAreaId: v === 'unassigned' ? null : v })} disabled={!selected.length}>
                  <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Set area for selected…" /></SelectTrigger>
                  <SelectContent>
                    {sequenceAreas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Button size="sm" variant="ghost" disabled={!selected.length || !!processing} onClick={() => setStaged((prev) => prev.filter((f) => !f.selected))}>
                <Trash2 className="w-3.5 h-3.5 mr-1" />Remove
              </Button>
              <Button size="sm" disabled={!selected.length || !!processing} onClick={submit}>
                {processing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5 mr-1" />}
                {processing ? `Submitting ${processing.current} of ${processing.total}…` : `Submit ${selected.length}`}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Part numbers come from the file names — edit any before submitting. Quantity is how many of that item the drawing covers.
            A part number that already exists adds the file to it.
          </p>
          <div className="max-h-[420px] overflow-y-auto rounded-md border border-border bg-background">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60">
                <tr className="text-left text-muted-foreground uppercase tracking-wide">
                  <th className="py-1.5 px-2 w-8" />
                  <th className="py-1.5 px-2">File</th>
                  <th className="py-1.5 px-2">Part #</th>
                  <th className="py-1.5 px-2">Type</th>
                  <th className="py-1.5 px-2">Qty</th>
                  <th className="py-1.5 px-2">Area / sequence</th>
                  <th className="py-1.5 px-2">Will</th>
                  <th className="py-1.5 px-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {staged.map((f) => {
                  const target = targetFor(f);
                  return (
                    <tr key={f.id} className={cn('border-t border-border/60', f.selected && 'bg-primary/5')}>
                      <td className="py-1.5 px-2">
                        <input type="checkbox" aria-label={`Select ${f.file.name}`} checked={f.selected} onChange={(e) => update(f.id, { selected: e.target.checked })} />
                      </td>
                      <td className="py-1.5 px-2 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                          <span className="truncate max-w-[200px]" title={f.file.name}>{f.file.name}</span>
                          <span className="text-muted-foreground whitespace-nowrap">{formatSize(f.file.size)}</span>
                        </div>
                        {f.error && <p className="text-destructive mt-0.5">{f.error}</p>}
                      </td>
                      <td className="py-1.5 px-2">
                        <Input value={f.markInput} onChange={(e) => update(f.id, { markInput: e.target.value, error: null })} placeholder="Part number" className="h-7 w-28 text-xs" />
                      </td>
                      <td className="py-1.5 px-2">
                        {target ? <span className="text-muted-foreground">{typeLabel(target.item_type || 'Piece_Mark')}</span> : (
                          <Select value={f.itemType} onValueChange={(v) => update(f.id, { itemType: v })}>
                            <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ITEM_TYPES.map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        {target ? <span className="text-muted-foreground">{target.quantity ?? '—'}</span> : (
                          <Input type="number" min="1" value={f.quantity} onChange={(e) => update(f.id, { quantity: e.target.value })} className="h-7 w-16 text-xs" aria-label={`Quantity for ${f.file.name}`} />
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        {target ? <span className="text-muted-foreground">{(target.phase || '').trim() || 'Unassigned'}</span> : (
                          <SequenceAreaSelect
                            projectId={project?.id}
                            sequenceAreas={sequenceAreas || []}
                            value={f.sequenceAreaId}
                            onChange={(v) => update(f.id, { sequenceAreaId: v })}
                            onCreated={onSequenceAreaCreated}
                            triggerClassName="h-7 w-32 text-xs"
                          />
                        )}
                      </td>
                      <td className="py-1.5 px-2 whitespace-nowrap">
                        {!f.markInput.trim() ? <span className="text-destructive">Needs a part #</span>
                          : target ? <span className="text-amber-700">Add to {target.part_number || target.piece_mark}</span>
                            : <span className="text-green-700">New {typeLabel(f.itemType).toLowerCase()}</span>}
                      </td>
                      <td className="py-1.5 px-2">
                        <button type="button" title="Remove from the list" className="text-muted-foreground hover:text-destructive" onClick={() => remove(f.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
