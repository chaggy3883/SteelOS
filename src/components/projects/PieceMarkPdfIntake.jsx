import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { UploadCloud, FileText, Eye, Download, Trash2, Loader2, Paperclip, FolderOpen, Cpu, PlusCircle, QrCode, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { downloadFile } from '@/lib/downloadFile';
import { openDocumentViewer } from '@/lib/openDocumentViewer';
import StatusBadge from '@/components/ui/StatusBadge';
import { normalizeScanValue } from '@/lib/pieceScan';
import { createDocumentId, pieceDocumentsKey, getDocumentRecords, pieceDocumentRef, deleteDocumentRecords } from '@/lib/pieceMarkDocumentStore';
import { saveCncFile, getCncFileUrl, deleteCncFile } from '@/lib/cncFileStore';
import { stripFileExtension, matchFilenameToPiece, attachFileToPiece, createPieceFromFile } from '@/lib/pieceFileIntake';
import SequenceAreaSelect from '@/components/projects/SequenceAreaSelect';
import PieceQrCode from '@/components/projects/PieceQrCode';
import PieceLabelPrintDialog from '@/components/projects/PieceLabelPrintDialog';

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const piecePhaseKey = (p) => (p.phase || '').trim() || 'Unassigned';

// Bulk PDF intake for the Piece Marks section — a single drop zone (plus one
// on every phase/area folder, all wired to this same routing logic) accepts
// multiple PDFs at once, auto-matches each by filename to a piece_mark, and
// falls back to a per-file "create a new piece from this file" (default) or
// "attach to an existing piece instead" choice for anything unmatched. Where
// a matched file lands is always driven by which piece it matched (its own
// phase/area), never by which zone physically received the drop.
export default function PieceMarkPdfIntake({ project, pieces, phasingMode, sequenceAreas, onPieceUpdated, onPieceCreated, onPieceDeleted, onSequenceAreaCreated }) {
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(null); // { current, total } | null
  // mode: 'create' (default) or 'existing'. markInput/sequenceAreaId only
  // apply to 'create'; assignTo only applies to 'existing'.
  const [unmatchedFiles, setUnmatchedFiles] = useState([]); // { id, file, mode, markInput, assignTo, sequenceAreaId }
  const [viewingDocsFor, setViewingDocsFor] = useState(null); // PieceMark | null
  const [viewingDocs, setViewingDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [objectUrls, setObjectUrls] = useState({});
  const [cncDialogFor, setCncDialogFor] = useState(null); // PieceMark | null
  const [qrFor, setQrFor] = useState(null); // PieceMark whose QR code is shown
  // Pieces ticked for sticker labels (PieceLabelPrintDialog).
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [printOpen, setPrintOpen] = useState(false);
  const selectedPieces = React.useMemo(() => pieces.filter((p) => selectedIds.has(p.id)), [pieces, selectedIds]);
  const togglePiece = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleGroup = (rows, on) => setSelectedIds((prev) => {
    const next = new Set(prev);
    rows.forEach((p) => (on ? next.add(p.id) : next.delete(p.id)));
    return next;
  });
  const [cncUrl, setCncUrl] = useState(null);
  const [cncLoading, setCncLoading] = useState(false);
  const [cncSaving, setCncSaving] = useState(false);

  const groups = React.useMemo(() => {
    const map = new Map();
    pieces.forEach((p) => {
      const key = piecePhaseKey(p);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    });
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [pieces]);

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const pdfFiles = files.filter(isPdf);
    const skipped = files.length - pdfFiles.length;
    if (skipped > 0) {
      toast({ title: `${skipped} file(s) skipped`, description: 'Only PDF files are supported for piece mark drawings.', variant: 'destructive' });
    }
    if (pdfFiles.length === 0) return;

    // Every dropped PDF lands in the upload list, ticked, with its piece mark
    // taken from the file name. Nothing is written until Submit — the same
    // file dropped twice is only listed once.
    setUnmatchedFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.file.name}|${f.file.size}`));
      const added = pdfFiles
        .filter((file) => !seen.has(`${file.name}|${file.size}`))
        .map((file) => ({ id: createDocumentId(), file, selected: true, markInput: stripFileExtension(file.name), sequenceAreaId: null, error: null }));
      return [...prev, ...added];
    });
  };

  const updateUnmatched = (id, patch) => {
    setUnmatchedFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const removeUnmatched = (id) => setUnmatchedFiles((prev) => prev.filter((f) => f.id !== id));

  const stagedSelected = unmatchedFiles.filter((f) => f.selected);
  const allStagedSelected = unmatchedFiles.length > 0 && stagedSelected.length === unmatchedFiles.length;
  const setAllStaged = (on) => setUnmatchedFiles((prev) => prev.map((f) => ({ ...f, selected: on })));
  const setAreaForSelected = (areaId) => setUnmatchedFiles((prev) => prev.map((f) => (f.selected ? { ...f, sequenceAreaId: areaId } : f)));
  const removeSelectedStaged = () => setUnmatchedFiles((prev) => prev.filter((f) => !f.selected));

  // What Submit will do with a staged file: add the drawing to the piece that
  // already has this mark, or create a new piece.
  const stagedTarget = (f) => (f.markInput.trim() ? matchFilenameToPiece(pieces, f.markInput.trim()) : null);

  // Submit every ticked file, one at a time (each is a storage write). A
  // file whose mark matches an existing piece — or one created earlier in
  // this same submit — is added to that piece; anything else becomes a new
  // piece. Files that fail stay in the list with the reason; the rest leave.
  const submitStaged = async () => {
    const queue = unmatchedFiles.filter((f) => f.selected);
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
      if (!mark) { failed.set(item.id, 'Enter a piece mark.'); continue; }
      const existing = byMark.get(normalizeScanValue(mark));
      try {
        if (existing) {
          await attachFileToPiece(existing, item.file);
          attached += 1;
        } else {
          const piece = await createPieceFromFile({ project, file: item.file, itemType: 'Piece_Mark', markOverride: mark, sequenceAreaId: item.sequenceAreaId });
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
    setUnmatchedFiles((prev) => prev
      .filter((f) => !done.has(f.id))
      .map((f) => (failed.has(f.id) ? { ...f, error: failed.get(f.id) } : f)));
    const parts = [];
    if (created) parts.push(`${created} new piece${created === 1 ? '' : 's'}`);
    if (attached) parts.push(`${attached} drawing${attached === 1 ? '' : 's'} added to existing pieces`);
    if (parts.length) toast({ title: `Submitted: ${parts.join(', ')}` });
    if (failed.size) {
      toast({ title: `${failed.size} file${failed.size === 1 ? '' : 's'} not saved`, description: [...failed.values()][0], variant: 'destructive' });
    }
  };

  // Delete pieces (and their stored drawings / CNC file). Asks first; warns
  // louder when a piece is already past "not started" in the shop.
  const deletePieces = async (list) => {
    if (!list.length) return;
    const started = list.filter((p) => p.status && p.status !== 'not_started');
    const names = list.slice(0, 8).map((p) => p.piece_mark).join(', ') + (list.length > 8 ? ` and ${list.length - 8} more` : '');
    const warn = started.length ? `\n\n${started.length} of these ${started.length === 1 ? 'is' : 'are'} already in the shop (${started.map((p) => p.piece_mark).slice(0, 5).join(', ')}). Their shop history stays, but the piece is gone.` : '';
    if (!window.confirm(`Delete ${list.length === 1 ? 'piece' : `${list.length} pieces`} ${names}? ${list.length === 1 ? 'Its drawings are' : 'Their drawings are'} deleted too. This can't be undone.${warn}`)) return;
    let removed = 0;
    let firstError = null;
    for (const p of list) {
      try {
        await db.entities.PieceMark.delete(p.id);
        removed += 1;
        onPieceDeleted?.(p.id);
        setSelectedIds((prev) => { const next = new Set(prev); next.delete(p.id); return next; });
        deleteDocumentRecords(pieceDocumentsKey(p.id)).catch(() => {});
        if (p.cnc_file_url) deleteCncFile(p.id).catch(() => {});
      } catch (e) {
        firstError = firstError || e?.message || 'Could not delete.';
      }
    }
    if (removed) toast({ title: `Deleted ${removed} piece${removed === 1 ? '' : 's'}` });
    if (firstError) toast({ title: 'Some pieces were not deleted', description: firstError, variant: 'destructive' });
  };

  const openDocsFor = async (piece) => {
    setViewingDocsFor(piece);
    setDocsLoading(true);
    try {
      const docs = await getDocumentRecords(pieceDocumentsKey(piece.id));
      setViewingDocs(docs);
      const urls = {};
      docs.forEach((d) => { if (d.blob) urls[d.id] = URL.createObjectURL(d.blob); });
      setObjectUrls(urls);
    } finally {
      setDocsLoading(false);
    }
  };

  const closeDocsDialog = () => {
    Object.values(objectUrls).forEach((url) => URL.revokeObjectURL(url));
    setObjectUrls({});
    setViewingDocsFor(null);
    setViewingDocs([]);
  };

  // Stage 9: one CNC cut/program file per piece mark — a separate, unrelated
  // domain from the drawing PDFs above (per-piece machine handoff file vs.
  // detailer drawings), so it gets its own store (cncFileStore.js) and its
  // own single-file dialog rather than reusing the multi-doc drawings flow.
  const openCncDialog = async (piece) => {
    setCncDialogFor(piece);
    setCncUrl(null);
    if (!piece.cnc_file_url) return;
    setCncLoading(true);
    try {
      const url = await getCncFileUrl(piece.id);
      setCncUrl(url);
    } finally {
      setCncLoading(false);
    }
  };

  const closeCncDialog = () => {
    if (cncUrl) URL.revokeObjectURL(cncUrl);
    setCncUrl(null);
    setCncDialogFor(null);
  };

  const handleCncFileSelect = async (file) => {
    if (!file || !cncDialogFor) return;
    setCncSaving(true);
    try {
      await saveCncFile(cncDialogFor.id, file);
      const updated = await db.entities.PieceMark.update(cncDialogFor.id, { cnc_file_url: file.name });
      onPieceUpdated?.(updated);
      setCncDialogFor(updated);
      const url = await getCncFileUrl(updated.id);
      setCncUrl(url);
      toast({ title: `CNC file attached to ${updated.piece_mark}` });
    } catch (e) {
      toast({ title: 'Unable to attach CNC file', variant: 'destructive' });
    } finally {
      setCncSaving(false);
    }
  };

  const handleRemoveCncFile = async () => {
    if (!cncDialogFor) return;
    setCncSaving(true);
    try {
      await deleteCncFile(cncDialogFor.id);
      const updated = await db.entities.PieceMark.update(cncDialogFor.id, { cnc_file_url: null });
      onPieceUpdated?.(updated);
      if (cncUrl) URL.revokeObjectURL(cncUrl);
      setCncUrl(null);
      setCncDialogFor(updated);
    } catch (e) {
      toast({ title: 'Unable to remove CNC file', variant: 'destructive' });
    } finally {
      setCncSaving(false);
    }
  };

  const dropZoneProps = {
    onDragOver: (e) => { e.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); },
  };

  // Backstop: the coded drop zones above are correctly guarded, but they're
  // small islands inside card padding, header chrome, and gaps between
  // stacked phase groups — none of which prevent dragover/drop. A drop
  // landing just outside a zone's exact boundary would otherwise fall
  // through to the browser's native "open file" behavior (replacing the
  // whole tab). This only ever preventDefaults — it never calls handleFiles
  // itself — so legitimate drops inside a real drop zone still get processed
  // exactly once by that zone's own onDrop.
  useEffect(() => {
    const preventDefault = (e) => e.preventDefault();
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  const phaseNoun = phasingMode === 'area' ? 'area' : 'phase/sequence';

  return (
    <div className="space-y-4">
      <div
        {...dropZoneProps}
        onClick={() => document.getElementById('piece-mark-pdf-intake-input')?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
        )}
      >
        <UploadCloud className="w-6 h-6 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Drag &amp; drop PDFs here (a whole folder's worth, or select multiple) — auto-matched to a piece mark by filename and filed under its {phaseNoun}
        </p>
        <input
          id="piece-mark-pdf-intake-input"
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {unmatchedFiles.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
              <input type="checkbox" aria-label="Select all uploaded files" checked={allStagedSelected} onChange={(e) => setAllStaged(e.target.checked)} />
              Uploaded drawings — {unmatchedFiles.length} file{unmatchedFiles.length === 1 ? '' : 's'} ({stagedSelected.length} selected)
            </label>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {(sequenceAreas || []).length > 0 && (
                <Select value="" onValueChange={(v) => setAreaForSelected(v === 'unassigned' ? null : v)} disabled={!stagedSelected.length}>
                  <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Set area for selected…" /></SelectTrigger>
                  <SelectContent>
                    {sequenceAreas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Button size="sm" variant="ghost" disabled={!stagedSelected.length || !!processing} onClick={removeSelectedStaged}>
                <Trash2 className="w-3.5 h-3.5 mr-1" />Remove
              </Button>
              <Button size="sm" disabled={!stagedSelected.length || !!processing} onClick={submitStaged}>
                {processing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5 mr-1" />}
                {processing ? `Submitting ${processing.current} of ${processing.total}…` : `Submit ${stagedSelected.length}`}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Piece marks come from the file names — edit any before submitting. The area picker sets the area for every ticked file.
            A mark that already exists adds the drawing to that piece.
          </p>
          <div className="max-h-[420px] overflow-y-auto rounded-md border border-border bg-background">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60">
                <tr className="text-left text-muted-foreground uppercase tracking-wide">
                  <th className="py-1.5 px-2 w-8" />
                  <th className="py-1.5 px-2">File</th>
                  <th className="py-1.5 px-2">Piece mark</th>
                  <th className="py-1.5 px-2">{phasingMode === 'area' ? 'Area' : 'Area / sequence'}</th>
                  <th className="py-1.5 px-2">Will</th>
                  <th className="py-1.5 px-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {unmatchedFiles.map((f) => {
                  const target = stagedTarget(f);
                  return (
                    <tr key={f.id} className={cn('border-t border-border/60', f.selected && 'bg-primary/5')}>
                      <td className="py-1.5 px-2">
                        <input type="checkbox" aria-label={`Select ${f.file.name}`} checked={f.selected} onChange={(e) => updateUnmatched(f.id, { selected: e.target.checked })} />
                      </td>
                      <td className="py-1.5 px-2 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                          <span className="truncate max-w-[220px]" title={f.file.name}>{f.file.name}</span>
                          <span className="text-muted-foreground whitespace-nowrap">{formatSize(f.file.size)}</span>
                        </div>
                        {f.error && <p className="text-destructive mt-0.5">{f.error}</p>}
                      </td>
                      <td className="py-1.5 px-2">
                        <Input value={f.markInput} onChange={(e) => updateUnmatched(f.id, { markInput: e.target.value, error: null })} placeholder="Piece mark" className="h-7 w-32 text-xs" />
                      </td>
                      <td className="py-1.5 px-2">
                        {target ? (
                          <span className="text-muted-foreground">{piecePhaseKey(target)}</span>
                        ) : (
                          <SequenceAreaSelect
                            projectId={project?.id}
                            sequenceAreas={sequenceAreas || []}
                            value={f.sequenceAreaId}
                            onChange={(v) => updateUnmatched(f.id, { sequenceAreaId: v })}
                            onCreated={onSequenceAreaCreated}
                            triggerClassName="h-7 w-36 text-xs"
                          />
                        )}
                      </td>
                      <td className="py-1.5 px-2 whitespace-nowrap">
                        {!f.markInput.trim() ? <span className="text-destructive">Needs a mark</span>
                          : target ? <span className="text-amber-700">Add to {target.piece_mark}</span>
                            : <span className="text-green-700">New piece</span>}
                      </td>
                      <td className="py-1.5 px-2">
                        <button type="button" title="Remove from the list" className="text-muted-foreground hover:text-destructive" onClick={() => removeUnmatched(f.id)}>
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


      {pieces.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Button size="sm" disabled={selectedPieces.length === 0} onClick={() => setPrintOpen(true)}>
            <Printer className="w-4 h-4 mr-1.5" />Print labels{selectedPieces.length ? ` (${selectedPieces.length})` : ''}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set(pieces.map((p) => p.id)))}>Select all</Button>
          {selectedPieces.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>}
          {selectedPieces.length > 0 && (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deletePieces(selectedPieces)}>
              <Trash2 className="w-4 h-4 mr-1.5" />Delete ({selectedPieces.length})
            </Button>
          )}
          <span className="text-xs text-muted-foreground">Tick pieces to print QR sticker labels or delete them.</span>
        </div>
      )}

      <div className="space-y-3">
        {groups.map(([phase, rows]) => {
          const groupAll = rows.length > 0 && rows.every((p) => selectedIds.has(p.id));
          return (
          <div
            key={phase}
            {...dropZoneProps}
            className={cn('rounded-lg border overflow-hidden transition-colors', dragging ? 'border-primary' : 'border-border')}
          >
            <div className="p-3 bg-muted/30 border-b border-border flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-muted-foreground" />
              <h4 className="font-semibold text-sm">{phase}</h4>
              <span className="text-xs text-muted-foreground">{rows.length} piece{rows.length === 1 ? '' : 's'}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2 px-3 w-8">
                      <input type="checkbox" aria-label={`Select all pieces in ${phase}`} checked={groupAll} onChange={(e) => toggleGroup(rows, e.target.checked)} />
                    </th>
                    <th className="text-left py-2 px-3">Piece Mark</th>
                    <th className="text-left py-2 px-3">Serial #</th>
                    <th className="text-left py-2 px-3">Assembly</th>
                    <th className="text-left py-2 px-3">Grade</th>
                    <th className="text-right py-2 px-3">Weight</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-right py-2 px-3">Drawings</th>
                    <th className="text-right py-2 px-3">CNC File</th>
                    <th className="py-2 px-3 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className={cn('border-b border-border/50 hover:bg-muted/50', selectedIds.has(p.id) && 'bg-primary/5')}>
                      <td className="py-2 px-3">
                        <input type="checkbox" aria-label={`Select ${p.piece_mark}`} checked={selectedIds.has(p.id)} onChange={() => togglePiece(p.id)} />
                      </td>
                      <td className="py-2 px-3 font-mono font-medium">{p.piece_mark}</td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {p.qr_payload_string && (
                            <button type="button" title="Show this piece's QR code" className="inline-flex text-muted-foreground hover:text-primary" onClick={() => setQrFor(p)}>
                              <QrCode className="w-4 h-4" />
                            </button>
                          )}
                          <span className="font-mono text-sm font-medium">{p.serial_number || '—'}</span>
                        </span>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{p.assembly || '—'}</td>
                      <td className="py-2 px-3">{p.material_grade || '—'}</td>
                      <td className="py-2 px-3 text-right">{p.weight_lbs ? `${p.weight_lbs} lbs` : '—'}</td>
                      <td className="py-2 px-3"><StatusBadge status={p.status} /></td>
                      <td className="py-2 px-3 text-right">
                        <button type="button" title="View attached drawings" className="text-muted-foreground hover:text-primary inline-flex" onClick={() => openDocsFor(p)}>
                          <Paperclip className="w-4 h-4" />
                        </button>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          title={p.cnc_file_url ? `CNC file: ${p.cnc_file_url}` : 'Attach CNC file'}
                          className={cn('inline-flex', p.cnc_file_url ? 'text-primary hover:text-primary/80' : 'text-muted-foreground hover:text-primary')}
                          onClick={() => openCncDialog(p)}
                        >
                          <Cpu className="w-4 h-4" />
                        </button>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button type="button" title={`Delete ${p.piece_mark}`} className="inline-flex text-muted-foreground hover:text-destructive" onClick={() => deletePieces([p])}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          );
        })}
      </div>

      <PieceLabelPrintDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        pieces={selectedPieces}
        project={project}
        sequenceAreas={sequenceAreas || []}
      />

      <Dialog open={!!qrFor} onOpenChange={(o) => !o && setQrFor(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>{qrFor?.piece_mark} — {qrFor?.serial_number || 'No serial'}</DialogTitle></DialogHeader>
          <div className="flex justify-center py-2">
            <PieceQrCode payload={qrFor?.qr_payload_string} size={200} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQrFor(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingDocsFor} onOpenChange={(o) => !o && closeDocsDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{viewingDocsFor?.piece_mark} — Attached Drawings</DialogTitle></DialogHeader>
          {docsLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : viewingDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No PDFs attached to this piece yet.</p>
          ) : (
            <div className="space-y-1.5">
              {viewingDocs.map((doc) => (
                <div key={doc.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-xs">
                  <div className="w-9 h-9 rounded bg-red-500/10 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{doc.filename}</p>
                    <p className="text-muted-foreground">{formatSize(doc.size)}{doc.uploadDate ? ` • ${new Date(doc.uploadDate).toLocaleDateString()}` : ''}</p>
                  </div>
                  <button type="button" className="text-muted-foreground hover:text-primary flex-shrink-0" title="View" onClick={() => openDocumentViewer(pieceDocumentRef(viewingDocsFor.id, doc.id), doc.filename)}>
                    <Eye className="w-4 h-4" />
                  </button>
                  <button type="button" className="text-muted-foreground hover:text-primary flex-shrink-0" title="Download" onClick={() => downloadFile(objectUrls[doc.id], doc.filename)}>
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!cncDialogFor} onOpenChange={(o) => !o && closeCncDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{cncDialogFor?.piece_mark} — CNC File</DialogTitle></DialogHeader>
          {cncLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : cncDialogFor?.cnc_file_url ? (
            <div className="flex items-center gap-2 rounded-lg border border-border p-2 text-xs">
              <div className="w-9 h-9 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Cpu className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{cncDialogFor.cnc_file_url}</p>
                <p className="text-muted-foreground">Attached — hand this off to CNC software manually; no machine communication happens here.</p>
              </div>
              <button type="button" className="text-muted-foreground hover:text-primary flex-shrink-0" title="Download" disabled={!cncUrl} onClick={() => downloadFile(cncUrl, cncDialogFor.cnc_file_url)}>
                <Download className="w-4 h-4" />
              </button>
              <button type="button" className="text-muted-foreground hover:text-destructive flex-shrink-0" title="Remove" disabled={cncSaving} onClick={handleRemoveCncFile}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">No CNC file attached to this piece yet. Attach one so shop floor scanning can hand it off for the operator to load into CNC software manually.</p>
              <label
                htmlFor="piece-mark-cnc-file-input"
                className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <UploadCloud className="w-6 h-6 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{cncSaving ? 'Attaching…' : 'Click to select a CNC file'}</span>
              </label>
              <input
                id="piece-mark-cnc-file-input"
                type="file"
                className="hidden"
                disabled={cncSaving}
                onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) handleCncFileSelect(file); }}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeCncDialog}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
