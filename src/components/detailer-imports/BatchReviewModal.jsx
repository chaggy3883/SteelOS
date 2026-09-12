import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { validateBatchRows } from '@/lib/detailerImportValidation';
import { commitBatch, detectRevisions } from '@/lib/detailerImportCommit';
import { isDrawingFile } from '@/lib/detailerImportParser';
import { deriveShapeFromProfile } from '@/lib/materialProfileMatch';
import { calculateUnitWeight, calculateAssemblyTotalWeights, isAssemblyMainPiece } from '@/lib/detailerImportWeight';
import { normalizeScanValue } from '@/lib/pieceScan';
import { getDetailerImportFileUrl } from '@/lib/detailerImportBlobStore';
import { openDocumentViewer } from '@/lib/openDocumentViewer';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { generateDetailerImportBatchReviewPdf } from '@/lib/detailerImportBatchReviewPdf';
import { generateDetailerImportBatchReviewXlsx } from '@/lib/detailerImportBatchReviewXlsx';
import RevisionCompareModal from '@/components/detailer-imports/RevisionCompareModal';
import SequenceAreaSelect from '@/components/projects/SequenceAreaSelect';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, CheckCircle2, FileText, Eye, FileDown, FileSpreadsheet } from 'lucide-react';

// Column definitions shared by both export formats — a plain {key, label,
// width?} list, same generic shape requisitionPdfExport.js's {columns, rows}
// already uses, so detailerImportBatchReviewPdf.js/detailerImportBatchReviewXlsx.js
// stay entirely agnostic of what a DetailerImportedPiece is. `width` is a
// relative weight the PDF generator turns into an actual column width; the
// Excel generator ignores it (a spreadsheet's columns are user-resizable).
const EXPORT_COLUMNS = [
  { key: 'piece_mark', label: 'Piece Mark', width: 1 },
  { key: 'assembly', label: 'Assembly', width: 1 },
  { key: 'shape', label: 'Shape', width: 0.7 },
  { key: 'material_profile', label: 'Material', width: 1.2 },
  { key: 'material_grade', label: 'Grade', width: 0.8 },
  { key: 'finished_length', label: 'Length', width: 1 },
  { key: 'quantity', label: 'Qty', width: 0.6 },
  { key: 'weight', label: 'Weight (lbs)', width: 0.9 },
  { key: 'assembly_total_weight', label: 'Assembly Total (lbs)', width: 1.2 },
  { key: 'sequence_area', label: 'Sequence/Area', width: 1.1 },
  { key: 'status', label: 'Status', width: 0.8 },
  { key: 'validation', label: 'Validation', width: 2.2 },
  { key: 'notes', label: 'Notes', width: 1.6 },
  { key: 'committed', label: 'Committed', width: 0.7 },
];

// Save-on-blur text/number cell shared by every editable column below —
// uncontrolled (defaultValue, not value) so typing isn't fought by the
// row's own re-render on every other cell's blur, same idiom as the Yield
// Tracking table in Production.jsx. A committed row renders as plain text
// instead: its fields have already been promoted onto a real PieceMark, so
// editing here would silently diverge from that record instead of fixing it.
function EditableCell({ value, onSave, disabled, type = 'text', placeholder, className = '' }) {
  if (disabled) {
    return <span className="block px-1 py-1 truncate">{(value ?? '') === '' ? '—' : value}</span>;
  }
  return (
    <Input
      type={type}
      defaultValue={value ?? ''}
      placeholder={placeholder}
      onBlur={(event) => onSave(type === 'number' ? event.target.value : event.target.value.trim())}
      className={`h-7 text-xs ${className}`}
    />
  );
}

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
  const [catalogRows, setCatalogRows] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

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

  // Backing store for every inline-editable cell below (piece mark, shape,
  // material, grade, length, quantity, notes) — same save-on-blur idiom as
  // handleRowSequenceAreaChange, just generalized to any field. Doesn't
  // re-run batch-wide validation itself; a corrected row picks up its new
  // validation_status the next time this modal opens (runValidation) or via
  // its own "Re-validate" action, same as before this field became editable.
  const handleRowFieldChange = async (row, field, value) => {
    try {
      const updated = await db.entities.DetailerImportedPiece.update(row.id, { [field]: value });
      setRows((current) => current.map((r) => (r.id === row.id ? updated : r)));
    } catch (error) {
      console.error(error);
      toast({ title: `Unable to save ${field.replace(/_/g, ' ')}`, variant: 'destructive' });
    }
  };

  // Set of DetailerImportedPiece ids, same idiom as the app's other bulk
  // row-selection queues (QrExportQueue.jsx, AdminEmployees.jsx) — a Set
  // rather than an array so toggling one row is an O(1) has/add/delete
  // rather than an array scan. Committed rows stay selectable here even
  // though they're no longer inline-editable — exporting a paper record of
  // an already-committed batch is a normal, legitimate use case, unlike
  // editing it.
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const toggleRowSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds((prev) => (allSelected ? new Set() : new Set(rows.map((r) => r.id))));
  };

  // Flattens a staged row into the plain, column-key-addressable shape both
  // export generators expect (see EXPORT_COLUMNS above) — resolving
  // sequence_area_id to its display name and the assembly-total figure here
  // so the export files never need their own copy of that lookup/weight
  // logic. assembly_total_weight is computed against the FULL batch's rows
  // (not just the selected ones) via calculateAssemblyTotalWeights, since a
  // minor part's contribution to its assembly's true total doesn't depend on
  // whether that minor part row itself happens to be checked.
  const buildExportRows = (selectedRows) => {
    const assemblyWeights = calculateAssemblyTotalWeights(rows, catalogRows);
    return selectedRows.map((row) => {
      const total = isAssemblyMainPiece(row) ? assemblyWeights.get(normalizeScanValue(row.assembly)) : null;
      const sequenceArea = sequenceAreas.find((a) => a.id === row.sequence_area_id);
      return {
        piece_mark: row.piece_mark || '',
        assembly: row.assembly || '',
        shape: row.shape || deriveShapeFromProfile(row.material_profile) || '',
        material_profile: row.material_profile || '',
        material_grade: row.material_grade || '',
        finished_length: row.finished_length || '',
        quantity: row.quantity ?? '',
        weight: row.weight ?? '',
        assembly_total_weight: total != null ? Math.round(total) : '',
        sequence_area: sequenceArea?.name || '',
        status: row.validation_status || '',
        validation: [...(row.validation_errors || []), ...(row.validation_warnings || [])].join('; '),
        notes: row.notes || '',
        committed: row.committed ? 'Yes' : 'No',
      };
    });
  };

  // Shared by both "Export Selected to PDF"/"Export Selected to Excel"
  // buttons — only the checked rows go out, never the full batch. Company
  // info + the uploading user's email (batch.created_by_email — distinct
  // from currentUser, who is whoever is exporting right now, possibly a
  // different person than whoever uploaded the batch) are resolved here
  // once and passed to whichever generator ran.
  const handleExport = async (format) => {
    const selectedRows = rows.filter((r) => selectedIds.has(r.id));
    if (selectedRows.length === 0) return;
    const setBusy = format === 'pdf' ? setExportingPdf : setExportingExcel;
    setBusy(true);
    try {
      const company = await getEffectiveCompany().catch(() => null);
      const generatedBy = currentUser?.full_name || currentUser?.email || 'Unknown';
      const exportArgs = {
        company,
        batch,
        uploaderEmail: batch.created_by_email || '',
        generatedBy,
        columns: EXPORT_COLUMNS,
        rows: buildExportRows(selectedRows),
      };
      if (format === 'pdf') {
        await generateDetailerImportBatchReviewPdf(exportArgs);
      } else {
        generateDetailerImportBatchReviewXlsx(exportArgs);
      }
    } catch (error) {
      console.error(error);
      toast({ title: `Unable to export to ${format === 'pdf' ? 'PDF' : 'Excel'}`, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const runValidation = async () => {
    setLoading(true);
    try {
      const [stagedRows, catalog] = await Promise.all([
        db.entities.DetailerImportedPiece.filter({ batch_id: batch.id }, 'piece_mark', 2000),
        db.entities.steel_catalog.list('size_designation', 5000),
      ]);
      setCatalogRows(catalog);

      const validated = validateBatchRows(stagedRows, catalog.map((c) => c.size_designation));
      // A row whose source file didn't supply its own weight (KISS/Tekla
      // detail lines commonly don't — see detailerImportParser.js) gets one
      // filled in here from the shape's weight-per-ft reference data, same
      // as validation_status is (re)computed every time this screen opens.
      // Never overwrites a weight the file DID provide — that's real data
      // and outranks this estimate.
      const withWeights = validated.map((row) => (
        row.weight != null ? row : { ...row, weight: calculateUnitWeight(row, catalog) }
      ));

      await Promise.all(withWeights.map((row, index) => {
        const original = stagedRows[index];
        const changed = row.validation_status !== original.validation_status
          || JSON.stringify(row.validation_errors) !== JSON.stringify(original.validation_errors || [])
          || JSON.stringify(row.validation_warnings) !== JSON.stringify(original.validation_warnings || [])
          || (row.weight ?? null) !== (original.weight ?? null);
        return changed
          ? db.entities.DetailerImportedPiece.update(row.id, {
            validation_status: row.validation_status,
            validation_errors: row.validation_errors,
            validation_warnings: row.validation_warnings,
            weight: row.weight ?? null,
          })
          : Promise.resolve(row);
      }));

      setRows(withWeights);

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

  // Keyed by normalized assembly value -> summed lbs across every row sharing
  // it (main piece + minor/welded-on parts) — recomputed straight from the
  // live `rows` state so an in-progress weight/quantity/length edit is
  // reflected immediately, without waiting for the next validation pass.
  const assemblyWeights = calculateAssemblyTotalWeights(rows, catalogRows);

  return (
    <>
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[95vw] w-full max-h-[90vh]">
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
            <div className="flex flex-wrap items-center justify-between gap-2">
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
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={selectedIds.size === 0 || exportingPdf}
                  onClick={() => handleExport('pdf')}
                >
                  <FileDown className="w-3.5 h-3.5" /> {exportingPdf ? 'Exporting…' : 'Export Selected to PDF'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={selectedIds.size === 0 || exportingExcel}
                  onClick={() => handleExport('excel')}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> {exportingExcel ? 'Exporting…' : 'Export Selected to Excel'}
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b border-border sticky top-0">
                  <tr>
                    <th className="px-3 py-2 w-8">
                      <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} aria-label="Select all rows" />
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Piece Mark</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Assembly</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Shape</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Material</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Grade</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Length</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Qty</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Weight</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Assembly Total</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Sequence/Area</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Validation</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Notes</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Committed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const locked = row.committed;
                    return (
                    <tr key={row.id} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2">
                        <Checkbox checked={selectedIds.has(row.id)} onCheckedChange={() => toggleRowSelected(row.id)} aria-label={`Select row ${row.piece_mark || ''}`} />
                      </td>
                      <td className="px-3 py-2 font-medium">
                        <EditableCell value={row.piece_mark} disabled={locked} onSave={(v) => handleRowFieldChange(row, 'piece_mark', v)} />
                      </td>
                      <td className="px-3 py-2">{row.assembly || '—'}</td>
                      <td className="px-3 py-2">
                        <EditableCell
                          value={row.shape || deriveShapeFromProfile(row.material_profile)}
                          disabled={locked}
                          onSave={(v) => handleRowFieldChange(row, 'shape', v)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <EditableCell value={row.material_profile} disabled={locked} onSave={(v) => handleRowFieldChange(row, 'material_profile', v)} />
                      </td>
                      <td className="px-3 py-2">
                        <EditableCell value={row.material_grade} disabled={locked} onSave={(v) => handleRowFieldChange(row, 'material_grade', v)} />
                      </td>
                      <td className="px-3 py-2">
                        <EditableCell value={row.finished_length} disabled={locked} onSave={(v) => handleRowFieldChange(row, 'finished_length', v)} />
                      </td>
                      <td className="px-3 py-2">
                        <EditableCell
                          type="number"
                          value={row.quantity ?? ''}
                          disabled={locked}
                          className="w-16"
                          onSave={(v) => handleRowFieldChange(row, 'quantity', v === '' ? null : Number(v))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <EditableCell
                          type="number"
                          value={row.weight ?? ''}
                          disabled={locked}
                          className="w-16"
                          placeholder="lbs"
                          onSave={(v) => handleRowFieldChange(row, 'weight', v === '' ? null : Number(v))}
                        />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {(() => {
                          if (!isAssemblyMainPiece(row)) return '—';
                          const total = assemblyWeights.get(normalizeScanValue(row.assembly));
                          return total != null ? `${Math.round(total).toLocaleString()} lbs` : '—';
                        })()}
                      </td>
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
                        <EditableCell value={row.notes} disabled={locked} placeholder="Add note…" className="w-36" onSave={(v) => handleRowFieldChange(row, 'notes', v)} />
                      </td>
                      <td className="px-3 py-2">
                        {row.committed ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : '—'}
                      </td>
                    </tr>
                    );
                  })}
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
