import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { validateBatchRows } from '@/lib/detailerImportValidation';
import { commitBatch } from '@/lib/detailerImportCommit';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, CheckCircle2 } from 'lucide-react';

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

  useEffect(() => { runValidation(); }, [batch.id]);

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

  const handleCommit = async () => {
    setCommitting(true);
    try {
      const result = await commitBatch(batch, rows);
      setRows((current) => current.map((row) => (
        row.committed || row.validation_status === 'error'
          ? row
          : { ...row, committed: true }
      )));
      onBatchUpdated(result.batch);
      toast({
        title: `Committed batch: ${result.created} created, ${result.updated} updated`,
        description: result.skipped > 0 ? `${result.skipped} row${result.skipped === 1 ? '' : 's'} skipped due to errors.` : undefined,
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
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            onClick={handleCommit}
            disabled={loading || committing || committableCount === 0}
            className="steel-gradient text-white border-0"
          >
            {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Commit Batch {committableCount > 0 ? `(${committableCount})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
