import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/api/apiClient';
import { getEffectiveCompanyId } from '@/lib/tenantContext';
import { openDocumentViewer } from '@/lib/openDocumentViewer';
import { saveDetailerImportFile, getDetailerImportFileUrl, deleteDetailerImportFile, createDetailerImportFileId } from '@/lib/detailerImportBlobStore';
import { parseDetailerImportFile, isParsableDetailerFile } from '@/lib/detailerImportParser';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { FileStack, Upload, Trash2, Eye, FolderOpen, FileScan, ChevronDown, ChevronRight } from 'lucide-react';

// STAGE 1 SHELL + STAGE 2 (CSV/KSS import): the batch/file intake path
// proves association/storage; parsing (this stage) reads a .csv or .kss
// file's content and stages it into DetailerImportedPiece rows for review —
// nothing here writes to PieceMark yet, that promotion step is a later
// stage.
export default function DetailerImports() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [projects, setProjects] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [filterProjectId, setFilterProjectId] = useState('');
  const [detailerName, setDetailerName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [expandedBatchId, setExpandedBatchId] = useState(null);
  const [parsingFileId, setParsingFileId] = useState(null);
  const [expandedFileId, setExpandedFileId] = useState(null);
  const [stagedRowsByFile, setStagedRowsByFile] = useState({});
  const fileObjectUrls = useRef({});

  useEffect(() => () => {
    Object.values(fileObjectUrls.current).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [projectList, batchList] = await Promise.all([
        db.entities.Project.list('name', 500),
        db.entities.DetailerImportBatch.list('-created_date', 200),
      ]);
      setProjects(projectList || []);
      setBatches(batchList || []);
    } catch (error) {
      console.error(error);
      toast({ title: 'Unable to load detailer imports', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const projectsById = useMemo(() => {
    const map = new Map();
    projects.forEach((p) => map.set(p.id, p));
    return map;
  }, [projects]);

  const visibleBatches = useMemo(() => (
    filterProjectId ? batches.filter((b) => b.project_id === filterProjectId) : batches
  ), [batches, filterProjectId]);

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!selectedProjectId) {
      toast({ title: 'Select a project before uploading', variant: 'destructive' });
      return;
    }

    setUploading(true);
    try {
      const uploaded_files = [];
      for (const file of files) {
        const file_id = createDetailerImportFileId();
        await saveDetailerImportFile(file_id, file);
        uploaded_files.push({ file_id, file_name: file.name, file_type: file.type || 'application/octet-stream', file_url: '' });
      }

      const record = await db.entities.DetailerImportBatch.create({
        company_id: getEffectiveCompanyId(),
        project_id: selectedProjectId,
        detailer_name: detailerName.trim() || 'Unspecified',
        uploaded_files,
        import_status: 'uploaded',
        created_by: user?.full_name || user?.email || 'System',
      });

      setBatches((current) => [record, ...current]);
      setExpandedBatchId(record.id);
      toast({ title: `Batch created with ${uploaded_files.length} file${uploaded_files.length === 1 ? '' : 's'}` });
    } catch (error) {
      console.error(error);
      toast({ title: 'Unable to upload files', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    handleFiles(event.dataTransfer.files);
  };

  const deleteBatch = async (batch) => {
    const stagedRows = await db.entities.DetailerImportedPiece.filter({ batch_id: batch.id }, '-created_date', 2000);
    await Promise.all(stagedRows.map((row) => db.entities.DetailerImportedPiece.delete(row.id)));
    await db.entities.DetailerImportBatch.delete(batch.id);
    await Promise.all((batch.uploaded_files || []).map((f) => deleteDetailerImportFile(f.file_id)));
    (batch.uploaded_files || []).forEach((f) => {
      const url = fileObjectUrls.current[f.file_id];
      if (url) {
        URL.revokeObjectURL(url);
        delete fileObjectUrls.current[f.file_id];
      }
    });
    setBatches((current) => current.filter((b) => b.id !== batch.id));
    if (expandedBatchId === batch.id) setExpandedBatchId(null);
    toast({ title: 'Batch removed' });
  };

  const viewFile = async (fileEntry) => {
    let url = fileObjectUrls.current[fileEntry.file_id];
    if (!url) {
      url = await getDetailerImportFileUrl(fileEntry.file_id);
      if (!url) {
        toast({ title: 'File not found', variant: 'destructive' });
        return;
      }
      fileObjectUrls.current[fileEntry.file_id] = url;
    }
    openDocumentViewer(url, fileEntry.file_name);
  };

  const toggleExpanded = (batchId) => {
    setExpandedBatchId((current) => (current === batchId ? null : batchId));
  };

  const parseFile = async (batch, fileEntry) => {
    setParsingFileId(fileEntry.file_id);
    try {
      const url = await getDetailerImportFileUrl(fileEntry.file_id);
      if (!url) {
        toast({ title: 'File not found', variant: 'destructive' });
        return;
      }
      const text = await (await fetch(url)).text();
      const result = parseDetailerImportFile(fileEntry.file_name, text);
      if (!result) {
        toast({ title: `Unsupported file type for parsing: ${fileEntry.file_name}`, variant: 'destructive' });
        return;
      }

      const { rows, fileErrors } = result;

      // Re-parsing replaces this file's previously staged rows so results
      // never accumulate duplicates across repeated attempts.
      const existing = await db.entities.DetailerImportedPiece.filter({ file_id: fileEntry.file_id }, '-created_date', 2000);
      await Promise.all(existing.map((row) => db.entities.DetailerImportedPiece.delete(row.id)));

      if (rows.length > 0) {
        await db.entities.DetailerImportedPiece.bulkCreate(rows.map((row) => ({
          ...row,
          batch_id: batch.id,
          file_id: fileEntry.file_id,
          project_id: batch.project_id,
        })));
      }

      const errorCount = rows.filter((r) => r.validation_status === 'error').length;
      const updatedFiles = (batch.uploaded_files || []).map((f) => (
        f.file_id === fileEntry.file_id
          ? { ...f, parsed: rows.length > 0, parsed_row_count: rows.length, parsed_error_count: errorCount }
          : f
      ));
      const nextStatus = rows.length === 0 ? 'error' : (batch.import_status === 'uploaded' ? 'parsed' : batch.import_status);
      const updatedBatch = await db.entities.DetailerImportBatch.update(batch.id, {
        uploaded_files: updatedFiles,
        import_status: nextStatus,
      });
      setBatches((current) => current.map((b) => (b.id === batch.id ? updatedBatch : b)));
      setStagedRowsByFile((current) => ({ ...current, [fileEntry.file_id]: rows }));
      setExpandedFileId(fileEntry.file_id);

      if (rows.length === 0) {
        toast({ title: `No rows found in ${fileEntry.file_name}`, description: fileErrors.join(' '), variant: 'destructive' });
      } else {
        toast({
          title: `Staged ${rows.length} row${rows.length === 1 ? '' : 's'} from ${fileEntry.file_name}`,
          description: errorCount > 0 ? `${errorCount} row${errorCount === 1 ? '' : 's'} need review.` : undefined,
        });
      }
    } catch (error) {
      console.error(error);
      toast({ title: `Unable to parse ${fileEntry.file_name}`, variant: 'destructive' });
    } finally {
      setParsingFileId(null);
    }
  };

  const toggleStagedRows = async (fileEntry) => {
    if (expandedFileId === fileEntry.file_id) {
      setExpandedFileId(null);
      return;
    }
    if (!stagedRowsByFile[fileEntry.file_id]) {
      const rows = await db.entities.DetailerImportedPiece.filter({ file_id: fileEntry.file_id }, 'piece_mark', 2000);
      setStagedRowsByFile((current) => ({ ...current, [fileEntry.file_id]: rows }));
    }
    setExpandedFileId(fileEntry.file_id);
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading detailer imports…</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Detailer Imports"
        subtitle="Upload detailer-supplied files against a project. This is intake only — parsing and PieceMark creation come in later stages."
      />

      <div className="steel-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <FileStack className="w-4 h-4 text-primary" />
          <h2 className="text-lg font-semibold">New Import Batch</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Project</Label>
            <select
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
            >
              <option value="">Select a project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Detailer Name</Label>
            <Input
              value={detailerName}
              onChange={(event) => setDetailerName(event.target.value)}
              placeholder="e.g. Acme Detailing Co."
              className="mt-2"
            />
          </div>
        </div>

        <div
          onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm ${dragActive ? 'border-primary bg-primary/5' : 'border-border'}`}
        >
          <Upload className="w-6 h-6 text-muted-foreground" />
          <p className="text-muted-foreground">Drag files here, or</p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-muted/50">
            <Upload className="w-4 h-4" />
            {uploading ? 'Uploading…' : 'Browse files'}
            <input type="file" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} disabled={uploading} />
          </label>
          <p className="text-xs text-muted-foreground">Any file type — CSV, KSS, PDF, DSTV, DXF, etc. CSV and KSS files can be parsed into staged rows below.</p>
        </div>
      </div>

      <div className="steel-card p-5 space-y-4 mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-primary" />
            <h2 className="text-lg font-semibold">Import Batches</h2>
          </div>
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={filterProjectId}
            onChange={(event) => setFilterProjectId(event.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {visibleBatches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No import batches yet.</p>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
            {visibleBatches.map((batch) => {
              const project = projectsById.get(batch.project_id);
              const expanded = expandedBatchId === batch.id;
              const fileCount = (batch.uploaded_files || []).length;
              return (
                <div key={batch.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleExpanded(batch.id)}
                    onKeyDown={(event) => { if (event.key === 'Enter') toggleExpanded(batch.id); }}
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/40"
                  >
                    <div>
                      <p className="text-sm font-medium">{project?.name || 'Unknown project'} — {batch.detailer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {fileCount} file{fileCount === 1 ? '' : 's'} • {batch.created_date ? new Date(batch.created_date).toLocaleString() : ''} • {batch.created_by}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={batch.import_status} />
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => { event.stopPropagation(); deleteBatch(batch); }}
                        onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); deleteBatch(batch); } }}
                        className="text-destructive hover:opacity-80"
                        title="Remove batch"
                      >
                        <Trash2 className="w-4 h-4" />
                      </span>
                      <span>{expanded ? '▾' : '▸'}</span>
                    </div>
                  </div>
                  {expanded && (
                    <div className="divide-y divide-border bg-muted/20">
                      {fileCount === 0 ? (
                        <p className="px-4 py-3 text-sm text-muted-foreground">No files on this batch.</p>
                      ) : batch.uploaded_files.map((f) => {
                        const parsable = isParsableDetailerFile(f.file_name);
                        const rowsExpanded = expandedFileId === f.file_id;
                        const stagedRows = stagedRowsByFile[f.file_id] || [];
                        return (
                          <div key={f.file_id}>
                            <div className="flex items-center justify-between px-4 py-2 text-sm gap-2">
                              <span className="truncate">{f.file_name}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                {parsable && f.parsed && (
                                  <span className="text-xs text-muted-foreground mr-1">
                                    {f.parsed_row_count} row{f.parsed_row_count === 1 ? '' : 's'}
                                    {f.parsed_error_count > 0 ? `, ${f.parsed_error_count} need review` : ''}
                                  </span>
                                )}
                                {parsable && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="gap-1"
                                    disabled={parsingFileId === f.file_id}
                                    onClick={() => parseFile(batch, f)}
                                  >
                                    <FileScan className="w-3.5 h-3.5" />
                                    {parsingFileId === f.file_id ? 'Parsing…' : (f.parsed ? 'Re-parse' : 'Parse')}
                                  </Button>
                                )}
                                {parsable && f.parsed && (
                                  <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => toggleStagedRows(f)}>
                                    {rowsExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                    Rows
                                  </Button>
                                )}
                                <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => viewFile(f)}>
                                  <Eye className="w-3.5 h-3.5" /> View
                                </Button>
                              </div>
                            </div>
                            {rowsExpanded && (
                              <div className="px-4 pb-3 overflow-x-auto">
                                {stagedRows.length === 0 ? (
                                  <p className="text-xs text-muted-foreground py-2">No staged rows.</p>
                                ) : (
                                  <table className="w-full text-xs border-collapse">
                                    <thead>
                                      <tr className="text-left text-muted-foreground border-b border-border">
                                        <th className="py-1 pr-3">Piece Mark</th>
                                        <th className="py-1 pr-3">Assembly</th>
                                        <th className="py-1 pr-3">Material</th>
                                        <th className="py-1 pr-3">Grade</th>
                                        <th className="py-1 pr-3">Length</th>
                                        <th className="py-1 pr-3">Qty</th>
                                        <th className="py-1 pr-3">Weight</th>
                                        <th className="py-1 pr-3">Drawing / Rev</th>
                                        <th className="py-1 pr-3">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {stagedRows.map((row) => (
                                        <tr key={row.id} className="border-b border-border/50">
                                          <td className="py-1 pr-3">{row.piece_mark || '—'}</td>
                                          <td className="py-1 pr-3">{row.assembly || '—'}</td>
                                          <td className="py-1 pr-3">{row.material_profile || '—'}</td>
                                          <td className="py-1 pr-3">{row.material_grade || '—'}</td>
                                          <td className="py-1 pr-3">{row.finished_length || '—'}</td>
                                          <td className="py-1 pr-3">{row.quantity ?? '—'}</td>
                                          <td className="py-1 pr-3">{row.weight ?? '—'}</td>
                                          <td className="py-1 pr-3">{row.drawing_number || '—'}{row.revision ? ` / ${row.revision}` : ''}</td>
                                          <td className="py-1 pr-3">
                                            <StatusBadge
                                              status={row.validation_status}
                                              label={row.validation_status === 'error' ? 'error' : 'valid'}
                                              className={row.validation_status === 'error' ? undefined : 'bg-green-500/10 text-green-500 border-green-500/20'}
                                            />
                                            {row.validation_status === 'error' && row.validation_errors?.length > 0 && (
                                              <span className="block text-[11px] text-destructive mt-0.5">{row.validation_errors.join('; ')}</span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
