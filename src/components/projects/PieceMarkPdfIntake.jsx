import React, { useState } from 'react';
import { UploadCloud, FileText, Eye, Download, Trash2, Loader2, Paperclip, FolderOpen, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { downloadFile } from '@/lib/downloadFile';
import PdfViewerModal from '@/components/shared/PdfViewerModal';
import StatusBadge from '@/components/ui/StatusBadge';
import { scanValueMatches } from '@/lib/pieceScan';
import { createDocumentId, pieceDocumentsKey, getDocumentRecords, saveDocumentRecords } from '@/lib/pieceMarkDocumentStore';

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const piecePhaseKey = (p) => (p.phase || '').trim() || 'Unassigned';

// Matches a detailer PDF export filename to a piece_mark within this
// project's own piece list only — the piece_mark uniqueness scope is
// (project_id, piece_mark), and `pieces` here is already filtered to one
// project, so no explicit project check is needed on top of this.
const matchFilenameToPiece = (pieces, filename) => {
  const stem = String(filename || '').replace(/\.pdf$/i, '');
  return pieces.find((p) => scanValueMatches([p.piece_mark], stem)) || null;
};

// Bulk PDF intake for the Piece Marks section — a single drop zone (plus one
// on every phase/area folder, all wired to this same routing logic) accepts
// multiple PDFs at once, auto-matches each by filename to a piece_mark, and
// falls back to manual assignment for anything unmatched. Where a file lands
// is always driven by which piece it matched (its own phase/area), never by
// which zone physically received the drop.
export default function PieceMarkPdfIntake({ pieces, phasingMode }) {
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(null); // { current, total } | null
  const [unmatchedFiles, setUnmatchedFiles] = useState([]); // { id, file, assignTo }
  const [busyFileIds, setBusyFileIds] = useState(new Set());
  const [viewingDocsFor, setViewingDocsFor] = useState(null); // PieceMark | null
  const [viewingDocs, setViewingDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [objectUrls, setObjectUrls] = useState({});
  const [viewingPdf, setViewingPdf] = useState(null);

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

  const attachFileToPiece = async (piece, file) => {
    const key = pieceDocumentsKey(piece.id);
    const existing = await getDocumentRecords(key);
    const doc = {
      id: createDocumentId(),
      filename: file.name,
      mimetype: file.type || 'application/pdf',
      size: file.size,
      uploadDate: new Date().toISOString(),
      blob: file,
    };
    await saveDocumentRecords(key, [...existing, doc]);
  };

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
          stillUnmatched.push({ id: createDocumentId(), file, assignTo: '' });
        }
      } else {
        stillUnmatched.push({ id: createDocumentId(), file, assignTo: '' });
      }
    }
    setProcessing(null);

    if (matchedCount > 0) {
      toast({ title: `${matchedCount} PDF${matchedCount === 1 ? '' : 's'} auto-matched and attached by filename` });
    }
    if (stillUnmatched.length > 0) {
      setUnmatchedFiles((prev) => [...prev, ...stillUnmatched]);
      toast({ title: `${stillUnmatched.length} PDF${stillUnmatched.length === 1 ? '' : 's'} need manual assignment`, description: 'No piece mark matched the filename — pick one below.', variant: 'destructive' });
    }
  };

  const setUnmatchedAssignment = (id, pieceId) => {
    setUnmatchedFiles((prev) => prev.map((f) => (f.id === id ? { ...f, assignTo: pieceId } : f)));
  };

  const removeUnmatched = (id) => setUnmatchedFiles((prev) => prev.filter((f) => f.id !== id));

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

  const dropZoneProps = {
    onDragOver: (e) => { e.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); },
  };

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
            <AlertTriangle className="w-4 h-4" />Unmatched — {unmatchedFiles.length} file{unmatchedFiles.length === 1 ? '' : 's'} need manual assignment
          </div>
          <div className="space-y-1.5">
            {unmatchedFiles.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-lg border border-border bg-background p-2 text-xs">
                <div className="w-9 h-9 rounded bg-red-500/10 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{f.file.name}</p>
                  <p className="text-muted-foreground">{formatSize(f.file.size)}</p>
                </div>
                <Select value={f.assignTo} onValueChange={(v) => setUnmatchedAssignment(f.id, v)}>
                  <SelectTrigger className="h-7 w-44 text-xs flex-shrink-0"><SelectValue placeholder="Assign to piece mark…" /></SelectTrigger>
                  <SelectContent>
                    {pieces.map((p) => <SelectItem key={p.id} value={p.id}>{p.piece_mark} ({piecePhaseKey(p)})</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" className="h-7 flex-shrink-0" disabled={!f.assignTo || busyFileIds.has(f.id)} onClick={() => confirmUnmatchedAssignment(f)}>
                  {busyFileIds.has(f.id) ? 'Attaching…' : 'Attach'}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 flex-shrink-0" onClick={() => removeUnmatched(f.id)}>
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {groups.map(([phase, rows]) => (
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
                    <th className="text-left py-2 px-3">Piece Mark</th>
                    <th className="text-left py-2 px-3">Assembly</th>
                    <th className="text-left py-2 px-3">Grade</th>
                    <th className="text-right py-2 px-3">Weight</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-right py-2 px-3">Drawings</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-muted/50">
                      <td className="py-2 px-3 font-mono font-medium">{p.piece_mark}</td>
                      <td className="py-2 px-3 text-muted-foreground">{p.assembly || '—'}</td>
                      <td className="py-2 px-3">{p.material_grade || '—'}</td>
                      <td className="py-2 px-3 text-right">{p.weight_lbs ? `${p.weight_lbs} lbs` : '—'}</td>
                      <td className="py-2 px-3"><StatusBadge status={p.status} /></td>
                      <td className="py-2 px-3 text-right">
                        <button type="button" title="View attached drawings" className="text-muted-foreground hover:text-primary inline-flex" onClick={() => openDocsFor(p)}>
                          <Paperclip className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

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
                  <button type="button" className="text-muted-foreground hover:text-primary flex-shrink-0" title="View" onClick={() => setViewingPdf({ ...doc, url: objectUrls[doc.id] })}>
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

      <PdfViewerModal open={!!viewingPdf} onOpenChange={(o) => !o && setViewingPdf(null)} source={viewingPdf?.url} fileName={viewingPdf?.filename} />
    </div>
  );
}
