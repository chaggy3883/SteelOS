import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { UploadCloud, FileText, Eye, Download, Trash2, Loader2, Paperclip, FolderOpen, AlertTriangle, Cpu, PlusCircle, QrCode, Printer } from 'lucide-react';
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
import { createDocumentId, pieceDocumentsKey, getDocumentRecords } from '@/lib/pieceMarkDocumentStore';
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
export default function PieceMarkPdfIntake({ project, pieces, phasingMode, sequenceAreas, onPieceUpdated, onPieceCreated, onSequenceAreaCreated }) {
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(null); // { current, total } | null
  // mode: 'create' (default) or 'existing'. markInput/sequenceAreaId only
  // apply to 'create'; assignTo only applies to 'existing'.
  const [unmatchedFiles, setUnmatchedFiles] = useState([]); // { id, file, mode, markInput, assignTo, sequenceAreaId }
  const [busyFileIds, setBusyFileIds] = useState(new Set());
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
          stillUnmatched.push({ id: createDocumentId(), file, mode: 'create', markInput: stripFileExtension(file.name), assignTo: '', sequenceAreaId: null });
        }
      } else {
        stillUnmatched.push({ id: createDocumentId(), file, mode: 'create', markInput: stripFileExtension(file.name), assignTo: '', sequenceAreaId: null });
      }
    }
    setProcessing(null);

    if (matchedCount > 0) {
      toast({ title: `${matchedCount} PDF${matchedCount === 1 ? '' : 's'} auto-matched and attached by filename` });
    }
    if (stillUnmatched.length > 0) {
      setUnmatchedFiles((prev) => [...prev, ...stillUnmatched]);
      toast({ title: `${stillUnmatched.length} PDF${stillUnmatched.length === 1 ? '' : 's'} need review`, description: 'No piece mark matched the filename — create a new piece or attach to an existing one below.', variant: 'destructive' });
    }
  };

  const updateUnmatched = (id, patch) => {
    setUnmatchedFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const removeUnmatched = (id) => setUnmatchedFiles((prev) => prev.filter((f) => f.id !== id));

  // Default action for an unmatched file — create a brand-new piece from it
  // rather than requiring it be assigned to something that already exists.
  // Still guards against colliding with an existing piece_mark (e.g. the
  // user hand-edited markInput to something already in use) the same way
  // ProjectDetail.jsx's manual "Add Part" form does, pointing them at
  // "attach to an existing piece instead" rather than silently creating a
  // second PieceMark with the same mark.
  const confirmCreate = async (item) => {
    const mark = item.markInput.trim();
    if (!mark) return;
    if (pieces.some((p) => normalizeScanValue(p.piece_mark) === normalizeScanValue(mark))) {
      toast({ title: `Piece mark "${mark}" already exists on this project`, description: 'Use "Attach to existing piece" instead.', variant: 'destructive' });
      return;
    }
    setBusyFileIds((prev) => new Set(prev).add(item.id));
    try {
      const created = await createPieceFromFile({ project, file: item.file, itemType: 'Piece_Mark', markOverride: mark, sequenceAreaId: item.sequenceAreaId });
      onPieceCreated?.(created);
      setUnmatchedFiles((prev) => prev.filter((f) => f.id !== item.id));
      toast({ title: `${mark} created from ${item.file.name}` });
    } catch (e) {
      toast({ title: 'Unable to create piece', variant: 'destructive' });
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
      toast({ title: `${item.file.name} attached to ${piece.piece_mark}` });
    } catch (e) {
      toast({ title: 'Unable to attach file', variant: 'destructive' });
    } finally {
      setBusyFileIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
    }
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
                      Create New Piece
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
                  <div className="flex items-center gap-2 pl-11">
                    <Input
                      value={f.markInput}
                      onChange={(e) => updateUnmatched(f.id, { markInput: e.target.value })}
                      placeholder="Piece mark"
                      className="h-7 w-36 text-xs"
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
                      <SelectTrigger className="h-7 w-44 text-xs flex-shrink-0"><SelectValue placeholder="Assign to piece mark…" /></SelectTrigger>
                      <SelectContent>
                        {pieces.map((p) => <SelectItem key={p.id} value={p.id}>{p.piece_mark} ({piecePhaseKey(p)})</SelectItem>)}
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

      {pieces.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Button size="sm" disabled={selectedPieces.length === 0} onClick={() => setPrintOpen(true)}>
            <Printer className="w-4 h-4 mr-1.5" />Print labels{selectedPieces.length ? ` (${selectedPieces.length})` : ''}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set(pieces.map((p) => p.id)))}>Select all</Button>
          {selectedPieces.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>}
          <span className="text-xs text-muted-foreground">Tick the pieces to print QR sticker labels for.</span>
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
                  <button type="button" className="text-muted-foreground hover:text-primary flex-shrink-0" title="View" onClick={() => openDocumentViewer(objectUrls[doc.id], doc.filename)}>
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
