import React, { useState } from 'react';
import { UploadCloud, FileText, Trash2, Loader2, AlertTriangle, PlusCircle } from 'lucide-react';
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

// Parts & Hardware's equivalent of PieceMarkPdfIntake.jsx — same drag-drop,
// same filename-becomes-mark-number matching/creation, same QR generation
// (all shared via pieceFileIntake.js so the two never drift onto separate
// algorithms), but for the bulk item_types instead of Piece_Mark, and with a
// quantity prompt on creation since a single dropped spec sheet (e.g.
// "3/4 A325N bolt.pdf") represents a bulk count of physical items, not one
// individually-tracked piece the way a Piece_Mark drawing does.
//
// `pieces` is intentionally the project's FULL piece list (not pre-filtered
// to parts) for auto-matching, matching PieceMarkPdfIntake.jsx's own
// unscoped matching convention — a dropped file matches by filename against
// any existing piece_mark/part_number in the project, regardless of type.
export default function PartsHardwarePdfIntake({ project, pieces, sequenceAreas, onPieceCreated, onSequenceAreaCreated }) {
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(null); // { current, total } | null
  // mode: 'create' (default) or 'existing'.
  const [unmatchedFiles, setUnmatchedFiles] = useState([]); // { id, file, mode, markInput, itemType, quantity, assignTo, sequenceAreaId }
  const [busyFileIds, setBusyFileIds] = useState(new Set());

  // Manual "attach to existing" only offers parts/hardware rows, not
  // structural Piece_Mark records — a fresh, more correct scope for this
  // surface's own picker (PieceMarkPdfIntake.jsx's equivalent dropdown
  // predates this distinction and is left as-is to avoid an unrelated
  // behavior change there).
  const existingParts = pieces.filter((p) => (p.item_type || 'Piece_Mark') !== 'Piece_Mark');

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const pdfFiles = files.filter(isPdf);
    const skipped = files.length - pdfFiles.length;
    if (skipped > 0) {
      toast({ title: `${skipped} file(s) skipped`, description: 'Only PDF files are supported for part/hardware spec sheets.', variant: 'destructive' });
    }
    if (pdfFiles.length === 0) return;

    setProcessing({ current: 0, total: pdfFiles.length });
    let matchedCount = 0;
    const stillUnmatched = [];
    for (let i = 0; i < pdfFiles.length; i++) {
      setProcessing({ current: i + 1, total: pdfFiles.length });
      const file = pdfFiles[i];
      const matched = matchFilenameToPiece(pieces, file.name);
      if (matched) {
        try {
          await attachFileToPiece(matched, file);
          matchedCount += 1;
        } catch (e) {
          stillUnmatched.push({ id: createDocumentId(), file, mode: 'create', markInput: stripFileExtension(file.name), itemType: 'Loose_Part', quantity: '1', assignTo: '', sequenceAreaId: null });
        }
      } else {
        stillUnmatched.push({ id: createDocumentId(), file, mode: 'create', markInput: stripFileExtension(file.name), itemType: 'Loose_Part', quantity: '1', assignTo: '', sequenceAreaId: null });
      }
    }
    setProcessing(null);

    if (matchedCount > 0) {
      toast({ title: `${matchedCount} file${matchedCount === 1 ? '' : 's'} auto-matched and attached by filename` });
    }
    if (stillUnmatched.length > 0) {
      setUnmatchedFiles((prev) => [...prev, ...stillUnmatched]);
      toast({ title: `${stillUnmatched.length} file${stillUnmatched.length === 1 ? '' : 's'} need review`, description: 'No part/hardware matched the filename — create a new one or attach to an existing one below.', variant: 'destructive' });
    }
  };

  const updateUnmatched = (id, patch) => {
    setUnmatchedFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const removeUnmatched = (id) => setUnmatchedFiles((prev) => prev.filter((f) => f.id !== id));

  const confirmCreate = async (item) => {
    const mark = item.markInput.trim();
    if (!mark) return;
    if (pieces.some((p) => normalizeScanValue(p.piece_mark) === normalizeScanValue(mark))) {
      toast({ title: `Part/hardware mark "${mark}" already exists on this project`, description: 'Use "Attach to existing" instead.', variant: 'destructive' });
      return;
    }
    setBusyFileIds((prev) => new Set(prev).add(item.id));
    try {
      const created = await createPieceFromFile({
        project, file: item.file, itemType: item.itemType, markOverride: mark,
        quantity: Number(item.quantity) || 1, sequenceAreaId: item.sequenceAreaId,
      });
      onPieceCreated?.(created);
      setUnmatchedFiles((prev) => prev.filter((f) => f.id !== item.id));
      toast({ title: `${mark} created from ${item.file.name}` });
    } catch (e) {
      toast({ title: 'Unable to create part/hardware', variant: 'destructive' });
    } finally {
      setBusyFileIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
    }
  };

  const confirmUnmatchedAssignment = async (item) => {
    const piece = pieces.find((p) => p.id === item.assignTo);
    if (!piece) return;
    setBusyFileIds((prev) => new Set(prev).add(item.id));
    try {
      await attachFileToPiece(piece, item.file);
      setUnmatchedFiles((prev) => prev.filter((f) => f.id !== item.id));
      toast({ title: `${item.file.name} attached to ${piece.part_number || piece.piece_mark}` });
    } catch (e) {
      toast({ title: 'Unable to attach file', variant: 'destructive' });
    } finally {
      setBusyFileIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
    }
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
          Drag &amp; drop spec sheet PDFs here — auto-matched to a part/hardware mark by filename, or create a new one
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

      {processing && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Processing file {processing.current} of {processing.total}…
        </p>
      )}

      {unmatchedFiles.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-700">
            <AlertTriangle className="w-4 h-4" />No filename match — {unmatchedFiles.length} file{unmatchedFiles.length === 1 ? '' : 's'} need review
          </div>
          <div className="space-y-2">
            {unmatchedFiles.map((f) => (
              <div key={f.id} className="rounded-lg border border-border bg-background p-2 text-xs space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded bg-red-500/10 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{f.file.name}</p>
                    <p className="text-muted-foreground">{formatSize(f.file.size)}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 rounded-md border border-border p-0.5">
                    <button
                      type="button"
                      onClick={() => updateUnmatched(f.id, { mode: 'create' })}
                      className={cn('px-2 py-1 rounded text-xs font-medium', f.mode === 'create' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
                    >
                      Create New
                    </button>
                    <button
                      type="button"
                      onClick={() => updateUnmatched(f.id, { mode: 'existing' })}
                      className={cn('px-2 py-1 rounded text-xs font-medium', f.mode === 'existing' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
                    >
                      Attach to Existing
                    </button>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 flex-shrink-0" onClick={() => removeUnmatched(f.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </Button>
                </div>

                {f.mode === 'create' ? (
                  <div className="flex items-center gap-2 pl-11 flex-wrap">
                    <Select value={f.itemType} onValueChange={(v) => updateUnmatched(f.id, { itemType: v })}>
                      <SelectTrigger className="h-7 w-32 text-xs flex-shrink-0"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ITEM_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      value={f.markInput}
                      onChange={(e) => updateUnmatched(f.id, { markInput: e.target.value })}
                      placeholder="Part number"
                      className="h-7 w-32 text-xs"
                    />
                    <Input
                      type="number"
                      min="1"
                      value={f.quantity}
                      onChange={(e) => updateUnmatched(f.id, { quantity: e.target.value })}
                      placeholder="Qty"
                      title="Quantity — how many physical items this spec sheet represents"
                      className="h-7 w-20 text-xs"
                    />
                    <SequenceAreaSelect
                      projectId={project?.id}
                      sequenceAreas={sequenceAreas || []}
                      value={f.sequenceAreaId}
                      onChange={(v) => updateUnmatched(f.id, { sequenceAreaId: v })}
                      onCreated={onSequenceAreaCreated}
                      triggerClassName="h-7 w-36 text-xs flex-shrink-0"
                    />
                    <Button size="sm" className="h-7 flex-shrink-0" disabled={!f.markInput.trim() || busyFileIds.has(f.id)} onClick={() => confirmCreate(f)}>
                      {busyFileIds.has(f.id) ? 'Creating…' : <><PlusCircle className="w-3.5 h-3.5 mr-1" />Create</>}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 pl-11">
                    <Select value={f.assignTo} onValueChange={(v) => updateUnmatched(f.id, { assignTo: v })}>
                      <SelectTrigger className="h-7 w-56 text-xs flex-shrink-0"><SelectValue placeholder="Assign to part/hardware…" /></SelectTrigger>
                      <SelectContent>
                        {existingParts.map((p) => <SelectItem key={p.id} value={p.id}>{p.part_number || p.piece_mark} ({(p.item_type || '').replace(/_/g, ' ')})</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-7 flex-shrink-0" disabled={!f.assignTo || busyFileIds.has(f.id)} onClick={() => confirmUnmatchedAssignment(f)}>
                      {busyFileIds.has(f.id) ? 'Attaching…' : 'Attach'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
