import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Loader2, RefreshCw, Trash2, FilePlus2, FolderInput, Link2, Eye } from 'lucide-react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { getDetailerImportFileUrl } from '@/lib/detailerImportBlobStore';
import { parseDrawingFileName } from '@/lib/drawingMatch';
import {
  resolveWaitingDrawings, assignWaitingDrawing, createPieceFromWaiting, keepWaitingAsProjectDocument, deleteWaitingDrawing,
} from '@/lib/drawingIntake';

const SOURCE_LABEL = { detailer_import: 'Detailer Imports', pieces_tab: 'Pieces tab', parts_hardware: 'Parts & Hardware' };

// Project → Pieces: drawings uploaded (anywhere, for this project) whose
// piece isn't in the project yet. They attach by themselves when the piece
// arrives — this list re-checks on open and after every upload/import. For
// ones nobody can match (typo in the name, an erection drawing, a combined
// set), a person can type the mark(s), make a new piece from it, keep it with
// the project's documents, or delete it.
export default function WaitingDrawingsPanel({ project, sequenceAreas = [], refreshKey = 0, onPiecesChanged }) {
  const { toast } = useToast();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null); // record id | 'all'
  const [marks, setMarks] = useState({}); // record id -> typed mark(s)

  const areaName = (id) => sequenceAreas.find((a) => a.id === id)?.name;

  const load = useCallback(async () => {
    if (!project?.id) return;
    const list = await db.entities.ProjectDrawing.filter({ project_id: project.id, status: 'waiting' }, '-created_date', 100000).catch(() => []);
    setRows(list);
  }, [project?.id]);

  // Re-check first: pieces may have been added somewhere else since.
  const recheck = useCallback(async ({ quiet = false } = {}) => {
    if (!project?.id) return;
    setBusy('all');
    try {
      const out = await resolveWaitingDrawings(project.id);
      if (out.attached) {
        toast({ title: `${out.attached} waiting drawing${out.attached === 1 ? '' : 's'} attached to ${out.attached === 1 ? 'its piece' : 'their pieces'}` });
        onPiecesChanged?.();
      } else if (!quiet) {
        toast({ title: 'Nothing new to attach', description: 'No piece in this project matches the drawings still waiting.' });
      }
    } catch (e) {
      if (!quiet) toast({ title: 'Could not re-check drawings', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
      await load();
    }
  }, [project?.id, load, onPiecesChanged, toast]);

  useEffect(() => { recheck({ quiet: true }); }, [project?.id, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows || rows.length === 0) return null;

  const run = async (rec, fn, okTitle) => {
    setBusy(rec.id);
    try {
      const out = await fn();
      if (okTitle) toast({ title: typeof okTitle === 'function' ? okTitle(out) : okTitle });
    } catch (e) {
      toast({ title: 'That didn’t work', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
      await load();
    }
  };

  const view = async (rec) => {
    const url = await getDetailerImportFileUrl(rec.blob_id).catch(() => null);
    if (!url) { toast({ title: 'The file is no longer in this browser', variant: 'destructive' }); return; }
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Clock className="w-4 h-4 text-amber-600" />
        <p className="text-sm font-semibold">Drawings waiting for a piece — {rows.length}</p>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={busy === 'all'} onClick={() => recheck()}>
          {busy === 'all' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}Check again
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        No piece in this project has these marks yet. They attach by themselves when the pieces are imported or added.
        If a name is wrong, type the piece mark (several: 2B9, 2B10) and Assign. Not a piece drawing? Keep it with the project's documents.
      </p>
      <div className="max-h-[320px] overflow-y-auto rounded-md border border-border bg-background">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60">
            <tr className="text-left text-muted-foreground uppercase tracking-wide">
              <th className="py-1.5 px-2">File</th>
              <th className="py-1.5 px-2">Looking for</th>
              <th className="py-1.5 px-2">From</th>
              <th className="py-1.5 px-2">Mark(s)</th>
              <th className="py-1.5 px-2 text-right">Do</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((rec) => {
              const looking = rec.mark_override || parseDrawingFileName(rec.file_name).base;
              const typed = marks[rec.id] ?? '';
              const rowBusy = busy === rec.id || busy === 'all';
              return (
                <tr key={rec.id} className="border-t border-border/60 align-top">
                  <td className="py-1.5 px-2 max-w-[220px]">
                    <button type="button" className="truncate block max-w-full text-left hover:text-primary" title={`View ${rec.file_name}`} onClick={() => view(rec)}>
                      <Eye className="w-3 h-3 inline mr-1" />{rec.file_name}
                    </button>
                    {rec.note && <p className="text-muted-foreground mt-0.5">{rec.note}</p>}
                  </td>
                  <td className="py-1.5 px-2 font-mono">{looking}</td>
                  <td className="py-1.5 px-2 text-muted-foreground whitespace-nowrap">
                    {SOURCE_LABEL[rec.source] || rec.source || '—'}
                    {rec.sequence_area_id && areaName(rec.sequence_area_id) ? <span className="block">{areaName(rec.sequence_area_id)}</span> : null}
                    {rec.uploaded_at ? <span className="block">{new Date(rec.uploaded_at).toLocaleDateString()}</span> : null}
                  </td>
                  <td className="py-1.5 px-2">
                    <div className="flex items-center gap-1">
                      <Input
                        value={typed}
                        placeholder={looking}
                        onChange={(e) => setMarks((m) => ({ ...m, [rec.id]: e.target.value }))}
                        className="h-7 w-28 text-xs"
                        aria-label={`Piece mark for ${rec.file_name}`}
                      />
                      <Button size="sm" variant="outline" className="h-7 px-2" disabled={rowBusy || !typed.trim()} title="Attach to the piece(s) with this mark — or wait for them if they aren't in the project yet"
                        onClick={() => run(rec, () => assignWaitingDrawing(rec, typed.trim()), (out) => (out?.status === 'attached' || out?.status === 'duplicate' ? `Attached to ${(out.attached_to || []).join(', ')}` : `Saved — attaches when ${typed.trim()} is added`)).then(() => onPiecesChanged?.())}>
                        <Link2 className="w-3.5 h-3.5 mr-1" />Assign
                      </Button>
                    </div>
                  </td>
                  <td className="py-1.5 px-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 px-2" disabled={rowBusy} title="Make a new piece (with its own serial and QR) from this drawing"
                        onClick={() => run(rec, () => createPieceFromWaiting(rec, project, typed.trim() || looking), (p) => `New piece ${p.piece_mark}`).then(() => onPiecesChanged?.())}>
                        <FilePlus2 className="w-3.5 h-3.5 mr-1" />New piece
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2" disabled={rowBusy} title="Not a piece drawing (erection drawing, notes, combined set) — keep it with the project's documents"
                        onClick={() => run(rec, () => keepWaitingAsProjectDocument(rec), 'Added to the project documents')}>
                        <FolderInput className="w-3.5 h-3.5 mr-1" />Project doc
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" disabled={rowBusy} title="Delete this drawing"
                        onClick={() => { if (window.confirm(`Delete ${rec.file_name}? It isn't on any piece.`)) run(rec, () => deleteWaitingDrawing(rec), 'Drawing deleted'); }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
