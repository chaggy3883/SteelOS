import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { validateBatchRows } from '@/lib/detailerImportValidation';
import { commitBatch, detectRevisions } from '@/lib/detailerImportCommit';
import { isDrawingFile } from '@/lib/detailerImportParser';
import { getDetailerImportFileUrl } from '@/lib/detailerImportBlobStore';
import { openDocumentViewer } from '@/lib/openDocumentViewer';
import RevisionCompareModal from '@/components/detailer-imports/RevisionCompareModal';
import SequenceAreaSelect from '@/components/projects/SequenceAreaSelect';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, CheckCircle2, FileText, Eye } from 'lucide-react';

// STAGE 3: opens against one DetailerImportBatch, re-validates every staged
// DetailerImportedPiece row batch-wide (duplicate piece marks, missing
// fields, catalog-shape matching — none of which can be checked at parse
// time, since they need every row in the batch at once), persists the
// recomputed validation_status/errors/warnings, then lets the user commit
// non-error rows onto real PieceMark records via commitBatch.
export default function BatchReviewModal({ batch, onClose, onBatchUpdated }) {
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [checkingRevisions, setCheckingRevisions] = useState(false);
  const [pendingRevisions, setPendingRevisions] = useState(null); // [{row, pieceMark, changes}] | null
  const [currentUser, setCurrentUser] = useState(null);
  const [sequenceAreas, setSequenceAreas] = useState([]);
  const [viewingFileId, setViewingFileId] = useState(null);

  useEffect(() => { runValidation(); }, [batch.id]);
  useEffect(() => { db.auth.me().then((me) => setCurrentUser(me || null)).catch(() => setCurrentUser(null)); }, []);
  useEffect(() => {
    db.entities.ProjectSequenceArea.filter({ project_id: batch.project_id }, 'sort_order', 200)
      .then(setSequenceAreas)
      .catch(() => setSequenceAreas([]));
  }, [batch.project_id]);

  // Drawing files (PDFs, or anything else non-parsable and not a CNC file)
  // never produce a staged DetailerImportedPiece row of their own — without
  // this section they were accepted at upload and then had nothing in the
  // review UI to show for it, effectively vanishing. Listed here from
  // batch.uploaded_files directly (not from `rows`) since that's the only
  // place they're recorded before commit.
  const drawingFiles = (batch.uploaded_files || []).filter((f) => isDrawingFile(f.file_name));

  const viewDrawingFile = async (fileEntry) => {
    setViewingFileId(fileEntry.file_id);
    try {
      const url = await getDetailerImportFileUrl(fileEntry.file_id);
      if (!url) {
        toast({ title: 'File not found', variant: 'destructive' });
        return;
      }
      openDocumentViewer(url, fileEntry.file_name);
    } catch (error) {
      console.error(error);
      toast({ title: 'Unable to open file', variant: 'destructive' });
    } finally {
      setViewingFileId(null);
    }
  };

  const handleRowSequenceAreaChange = async (row, sequenceAreaId) => {
    try {
      const updated = await db.entities.DetailerImportedPiece.update(row.id, { sequence_area_id: sequenceAreaId });
      setRows((current) => current.map((r) => (r.id === row.id ? updated : r)));
    } catch (error) {
      console.error(error);
      toast({ title: 'Unable to save sequence/area', variant: 'destructive' });
    }
  };

  const runValidation = async () => {
    setLoading(true);
    try {
      const [stagedRows, catalog] = await Promise.all([
        db.entities.DetailerImportedPiece.filter({ batch_id: batch.id }, 'piece_mark', 2000),
        db.entities.steel_catalog.list('size_designation', 5000),
      ]);

      const validated = validateBatchRows(stagedRows, catalog.map((c) => c.size_designation));
      await Promise.all(validated.map((row, index) => {
        const original = stagedRows[index];
        const changed = row.validation_status !== original.validation_status
          || JSON.stringify(row.validation_errors) !== JSON.stringify(original.validation_errors || [])
          || JSON.stringify(row.validation_warnings) !== JSON.stringify(original.validation_warnings || []);
        return changed
          ? db.entities.DetailerImportedPiece.update(row.id, {
            validation_status: row.validation_status,
            validation_errors: row.validation_errors,
            validation_warnings: row.validation_warnings,
          })
          : Promise.resolve(row);
      }));

      setRows(validated);

      if (batch.import_status === 'parsed') {
        const updatedBatch = await db.entities.DetailerImportBatch.update(batch.id, { import_status: 'validated' });
        onBatchUpdated(updatedBatch);
      }
    } catch (error) {
      console.error(error);
      toast({ title: 'Unable to validate batch', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Stage 11: detect changed-existing-piece rows before touching anything.
  // No revisions found -> commit exactly as before (unaffected fast path).
  // Revisions found -> open RevisionCompareModal and wait for an explicit
  // per-piece choice; nothing commits until that modal's own action fires.
  const handleCommit = async () => {
    setCheckingRevisions(true);
    try {
      const revisions = await detectRevisions(batch, rows);
      if (revisions.length === 0) {
        await runCommit(new Set());
      } else {
        setPendingRevisions(revisions);
      }
    } catch (error) {
      console.error(error);
      toast({ title: 'Unable to check for revisions', variant: 'destructive' });
    } finally {
      setCheckingRevisions(false);
    }
  };

  const runCommit = async (confirmedRowIds) => {
    setCommitting(true);
    try {
      const skipRowIds = pendingRevisions
        ? new Set(pendingRevisions.map((r) => r.row.id).filter((id) => !confirmedRowIds.has(id)))
        : new Set();
      const changedBy = currentUser?.full_name || currentUser?.email || 'Unknown';
      const result = await commitBatch(batch, rows, { skipRowIds, changedBy });
      setRows((current) => current.map((row) => (
        row.committed || row.validation_status === 'error' || skipRowIds.has(row.id)
          ? row
          : { ...row, committed: true }
      )));
      onBatchUpdated(result.batch);
      setPendingRevisions(null);
      toast({
        title: `Committed batch: ${result.created} created, ${result.updated} updated`,
        description: [
          result.skipped > 0 ? `${result.skipped} row${result.skipped === 1 ? '' : 's'} skipped due to errors.` : null,
          result.revisionsSkipped > 0 ? `${result.revisionsSkipped} revision${result.revisionsSkipped === 1 ? '' : 's'} left unconfirmed — not applied.` : null,
          result.drawingsMatched > 0 ? `${result.drawingsMatched} drawing${result.drawingsMatched === 1 ? '' : 's'} matched and attached by filename.` : null,
        ].filter(Boolean).join(' ') || undefined,
      });
    } catch (error) {
      console.error(error);
      toast({ title: 'Commit failed', variant: 'destructive' });
    } finally {
      setCommitting(false);
    }
  };

  const validCount = rows.filter((r) => r.validation_status === 'valid').length;
  const warningCount = rows.filter((r) => r.validation_status === 'warning').length;
  const errorCount = rows.filter((r) => r.validation_status === 'error').length;
  const committedCount = rows.filter((r) => r.committed).length;
  const committableCount = rows.filter((r) => !r.committed && r.validation_status !== 'error').length;

  return (
    <>
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Review &amp; Commit — {batch.detailer_name}</DialogTitle>
          <DialogDescription>
            Commit promotes every row below (except Error rows, which are skipped) onto a PieceMark in this batch's project — matching an existing piece mark updates it, otherwise a new PieceMark is created.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{rows.length} row{rows.length === 1 ? '' : 's'}</span>
              <span>•</span>
              <span className="text-green-500">{validCount} valid</span>
              <span>•</span>
              <span className="text-yellow-600">{warningCount} warning</span>
              <span>•</span>
              <span className="text-red-500">{errorCount} error</span>
              <span>•</span>
              <span>{committedCount} committed</span>
            </div>

            <div className="flex-1 overflow-auto border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b border-border sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Piece Mark</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Assembly</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Material</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Grade</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Length</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Qty</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Sequence/Area</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Notes</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Committed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 font-medium">{row.piece_mark || '—'}</td>
                      <td className="px-3 py-2">{row.assembly || '—'}</td>
                      <td className="px-3 py-2">{row.material_profile || '—'}</td>
                      <td className="px-3 py-2">{row.material_grade || '—'}</td>
                      <td className="px-3 py-2">{row.finished_length || '—'}</td>
                      <td className="px-3 py-2">{row.quantity ?? '—'}</td>
                      <td className="px-3 py-2">
                        <SequenceAreaSelect
                          projectId={batch.project_id}
                          sequenceAreas={sequenceAreas}
                          value={row.sequence_area_id}
                          onChange={(v) => handleRowSequenceAreaChange(row, v)}
                          onCreated={(created) => setSequenceAreas((prev) => [...prev, created])}
                          triggerClassName="h-7 w-32 text-xs"
                        />
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={row.validation_status} /></td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {[...(row.validation_errors || []), ...(row.validation_warnings || [])].join('; ') || '—'}
                      </td>
                      <td className="px-3 py-2">
                        {row.committed ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {drawingFiles.length > 0 && (
              <div className="border border-border rounded-lg">
                <div className="px-3 py-2 border-b border-border bg-muted/30">
                  <p className="text-sm font-semibold">Attached Drawings</p>
                  <p className="text-xs text-muted-foreground">
                    Non-parsable files (PDFs, etc.) uploaded with this batch — matched to a piece mark by filename and attached automatically when the batch is committed.
                  </p>
                </div>
                <div className="divide-y divide-border/50">
                  {drawingFiles.map((f) => (
                    <div key={f.file_id} className="flex items-center gap-2 px-3 py-2 text-xs">
                      <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />
                      <span className="flex-1 min-w-0 truncate font-medium">{f.file_name}</span>
                      <span className="text-muted-foreground flex-shrink-0">
                        {(f.uploaded_at || batch.created_date) ? new Date(f.uploaded_at || batch.created_date).toLocaleDateString() : '—'}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1 flex-shrink-0"
                        disabled={viewingFileId === f.file_id}
                        onClick={() => viewDrawingFile(f)}
                      >
                        <Eye className="w-3.5 h-3.5" /> View
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            onClick={handleCommit}
            disabled={loading || committing || checkingRevisions || committableCount === 0}
            className="steel-gradient text-white border-0"
          >
            {committing || checkingRevisions ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Commit Batch {committableCount > 0 ? `(${committableCount})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <RevisionCompareModal
      open={!!pendingRevisions}
      revisions={pendingRevisions || []}
      committing={committing}
      onCancel={() => setPendingRevisions(null)}
      onConfirm={(confirmedRowIds) => runCommit(confirmedRowIds)}
    />
    </>
  );
}
