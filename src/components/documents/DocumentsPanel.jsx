import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { UploadCloud, FileText, Search, Eye, Download, ExternalLink, X, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/use-toast';
import { openDocumentViewer } from '@/lib/openDocumentViewer';
import { downloadFile } from '@/lib/downloadFile';
import { resolveDocumentUrl, saveDocumentFile } from '@/lib/documentBlobStore';
import { DOCUMENT_TYPE_OPTIONS, LINKED_DOCUMENT_CATEGORIES, documentTypeLabel } from '@/lib/documentCategories';
import { archiveDocument } from '@/lib/documentArchive';
import RemoveDocumentDialog from '@/components/documents/RemoveDocumentDialog';

const isPdfName = (name) => !!name?.match(/\.pdf$/i);

const formatSize = (bytes) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

// The one place every project (and pre-win bid) file lives: drag-drop with a
// confirmed manual type pick, filter/search across a large category list, and
// — for categories that already have a real dedicated system — the actual
// underlying records instead of a disconnected upload bucket.
export default function DocumentsPanel({ projectId, bidId, onOpenHandoffTab }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dragging, setDragging] = useState(false);
  const [pendingFiles, setPendingFiles] = useState(null); // File[] awaiting type confirmation
  const [pendingRows, setPendingRows] = useState([]); // [{file, name, document_type}]
  const [batchDescription, setBatchDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [linkedRecords, setLinkedRecords] = useState([]);
  const [linkedLoading, setLinkedLoading] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);

  const scopeFilter = projectId ? { project_id: projectId } : { bid_id: bidId };

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const docs = await db.entities.Document.filter(scopeFilter, '-created_date', 300);
      setDocuments(docs.filter((d) => !d.is_archived));
    } catch (e) {
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDocuments(); }, [projectId, bidId]);

  const activeLinkedCategory = projectId
    ? LINKED_DOCUMENT_CATEGORIES.find((c) => c.key === typeFilter)
    : null;

  useEffect(() => {
    if (!activeLinkedCategory) { setLinkedRecords([]); return; }
    let cancelled = false;
    setLinkedLoading(true);
    activeLinkedCategory.query(projectId)
      .then((rows) => { if (!cancelled) setLinkedRecords(rows || []); })
      .catch(() => { if (!cancelled) setLinkedRecords([]); })
      .finally(() => { if (!cancelled) setLinkedLoading(false); });
    return () => { cancelled = true; };
  }, [activeLinkedCategory, projectId]);

  // Backstop: defeats the browser's native file-open fallback for a drop that
  // lands just outside the coded dropzone (same fix already established for
  // PieceMarkPdfIntake.jsx — applied here from the start, not re-discovered).
  useEffect(() => {
    const preventDefault = (e) => e.preventDefault();
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  const openTypePicker = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setPendingFiles(files);
    setPendingRows(files.map((file) => ({ file, name: file.name, document_type: '' })));
    setBatchDescription('');
  };

  const dropZoneProps = {
    onDragOver: (e) => { e.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => { e.preventDefault(); setDragging(false); openTypePicker(e.dataTransfer.files); },
  };

  const updatePendingRow = (idx, patch) => {
    setPendingRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const allTypesChosen = pendingRows.length > 0 && pendingRows.every((r) => !!r.document_type);

  const cancelUpload = () => { setPendingFiles(null); setPendingRows([]); };

  const confirmUpload = async () => {
    if (!allTypesChosen) return;
    setSaving(true);
    try {
      for (const row of pendingRows) {
        const { file_url } = await db.integrations.Core.UploadFile({ file: row.file });
        const created = await db.entities.Document.create({
          name: row.name || row.file.name,
          document_type: row.document_type,
          description: batchDescription || undefined,
          file_url,
          file_name: row.file.name,
          file_size: row.file.size,
          file_type: row.file.type,
          status: 'uploaded',
          ...(projectId ? { project_id: projectId } : { bid_id: bidId }),
        });
        await saveDocumentFile(created.id, row.file);
      }
      toast({ title: `${pendingRows.length} document${pendingRows.length === 1 ? '' : 's'} added` });
      cancelUpload();
      loadDocuments();
    } catch (e) {
      toast({ title: 'Upload failed', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const resolveOrWarn = async (doc) => {
    const url = await resolveDocumentUrl(doc);
    if (!url) {
      toast({ title: 'File unavailable', description: 'This file was uploaded before file persistence was fixed and cannot be recovered — please re-upload it.', variant: 'destructive' });
    }
    return url;
  };

  const openFile = async (doc) => {
    const url = await resolveOrWarn(doc);
    if (!url) return;
    if (isPdfName(doc.file_name)) openDocumentViewer(url, doc.file_name || doc.name);
    else downloadFile(url, doc.file_name || doc.name);
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    await archiveDocument(removeTarget);
    setRemoveTarget(null);
    toast({ title: 'Document removed' });
    loadDocuments();
  };

  const openLinkedRecord = (category, record) => {
    const link = category.linkFor(record);
    if (link.type === 'tab') onOpenHandoffTab?.();
    else navigate(link.to);
  };

  const filteredDocuments = useMemo(() => documents.filter((d) => {
    const matchesSearch = !search
      || d.name?.toLowerCase().includes(search.toLowerCase())
      || d.description?.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === 'all' || d.document_type === typeFilter;
    return matchesSearch && matchesType;
  }), [documents, search, typeFilter]);

  const filterOptions = [
    { value: 'all', label: 'All Types' },
    ...DOCUMENT_TYPE_OPTIONS,
    ...(projectId ? LINKED_DOCUMENT_CATEGORIES.map((c) => ({ value: c.key, label: `↳ ${c.label} (linked)` })) : []),
  ];

  return (
    <div className="space-y-4">
      <div
        {...dropZoneProps}
        onClick={() => document.getElementById('documents-panel-file-input')?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
        )}
      >
        <UploadCloud className="w-6 h-6 text-muted-foreground" />
        <p className="text-sm font-medium">Drag &amp; drop files here, or click to browse</p>
        <p className="text-xs text-muted-foreground">You'll pick the document type for each file before it's added.</p>
        <input
          id="documents-panel-file-input"
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { openTypePicker(e.target.files); e.target.value = ''; }}
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search documents..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-64"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent className="max-h-96">
            {filterOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {activeLinkedCategory ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Showing real {activeLinkedCategory.label} records — not a separate upload bucket.
          </p>
          {linkedLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading…</div>
          ) : linkedRecords.length === 0 ? (
            <div className="text-center py-10">
              <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No {activeLinkedCategory.label} records for this project yet</p>
            </div>
          ) : (
            <div className="space-y-1">
              {linkedRecords.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => openLinkedRecord(activeLinkedCategory, r)}
                  className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ExternalLink className="w-4 h-4 text-primary shrink-0" />
                    <p className="text-sm font-medium truncate">{activeLinkedCategory.titleOf(r)}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{activeLinkedCategory.label}</Badge>
                </button>
              ))}
            </div>
          )}
          {filteredDocuments.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground pt-3 border-t border-border">Uploaded files tagged "{activeLinkedCategory.label}":</p>
              <DocumentRows docs={filteredDocuments} onOpen={openFile} onRemove={setRemoveTarget} />
            </>
          )}
        </div>
      ) : loading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading documents…</div>
      ) : filteredDocuments.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No documents found</p>
        </div>
      ) : (
        <DocumentRows docs={filteredDocuments} onOpen={openFile} onRemove={setRemoveTarget} />
      )}

      <Dialog open={!!pendingFiles} onOpenChange={(open) => !open && cancelUpload()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add {pendingRows.length} Document{pendingRows.length === 1 ? '' : 's'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {pendingRows.map((row, idx) => (
              <div key={idx} className="border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Input value={row.name} onChange={(e) => updatePendingRow(idx, { name: e.target.value })} className="flex-1" />
                  <span className="text-xs text-muted-foreground shrink-0">{formatSize(row.file.size)}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => {
                    setPendingRows((rows) => rows.filter((_, i) => i !== idx));
                  }}><X className="w-3.5 h-3.5" /></Button>
                </div>
                <Select value={row.document_type} onValueChange={(v) => updatePendingRow(idx, { document_type: v })}>
                  <SelectTrigger className={cn(!row.document_type && 'text-muted-foreground')}>
                    <SelectValue placeholder="Select document type…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-96">
                    {DOCUMENT_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <Textarea
              placeholder="Description (optional, applied to all files above)"
              value={batchDescription}
              onChange={(e) => setBatchDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelUpload}>Cancel</Button>
            <Button
              className="steel-gradient text-white border-0"
              disabled={!allTypesChosen || saving}
              onClick={confirmUpload}
            >
              {saving ? 'Adding…' : `Add ${pendingRows.length} Document${pendingRows.length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RemoveDocumentDialog
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        onConfirm={confirmRemove}
      />
    </div>
  );
}

function DocumentRows({ docs, onOpen, onRemove }) {
  return (
    <div className="space-y-1">
      {docs.map((doc) => (
        <div
          key={doc.id}
          className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
        >
          <button
            type="button"
            onClick={() => onOpen(doc)}
            className="flex items-center gap-3 min-w-0 flex-1 text-left"
          >
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate" title={doc.name}>{doc.name}</p>
              <p className="text-xs text-muted-foreground">{documentTypeLabel(doc.document_type)} • v{doc.version || 1}</p>
            </div>
          </button>
          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusBadge status={doc.ai_processing_status} label={doc.ai_processing_status} />
            {isPdfName(doc.file_name) ? <Eye className="w-4 h-4 text-muted-foreground" /> : <Download className="w-4 h-4 text-muted-foreground" />}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              title="Remove"
              onClick={() => onRemove(doc)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
