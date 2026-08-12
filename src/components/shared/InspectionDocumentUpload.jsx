import React, { useEffect, useState } from 'react';
import { UploadCloud, FileText, Trash2, Loader2, Eye, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compressImageFile } from '@/lib/imageCompression';
import { createDocumentId } from '@/lib/inspectionDocumentStore';
import { downloadFile } from '@/lib/downloadFile';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import PdfViewerModal from '@/components/shared/PdfViewerModal';
import { useToast } from '@/components/ui/use-toast';

const ACCEPT = '.pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf';

const isImageFile = (file) => file.type.startsWith('image/') || /\.(jpe?g|png)$/i.test(file.name || '');
const isPdfFile = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
const isAllowedFile = (file) => isImageFile(file) || isPdfFile(file);

const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

// Compresses images client-side (re-encoded JPEG, downscaled) before they're
// held in memory or written to IndexedDB; PDFs pass through untouched.
const toStoredBlob = async (file) => {
  if (!isImageFile(file)) return file;
  const dataUri = await compressImageFile(file);
  const response = await fetch(dataUri);
  return response.blob();
};

// Reusable attach-documents control for inspection-style forms. Pending
// files (added this session, not yet written to IndexedDB) and saved
// documents (already persisted under the record's storage key) render in one
// list so a form only needs one "Attached Documents" section regardless of
// whether the record has been saved yet. The caller owns persistence — this
// component only ever hands back in-memory {id, filename, mimetype, size,
// blob} items via onPendingFilesChange; writing them to IndexedDB happens in
// the form's save handler (see RiggingInspectionForm / EquipmentServiceForm).
export default function InspectionDocumentUpload({
  pendingFiles = [],
  onPendingFilesChange,
  savedDocuments = [],
  onDeleteSaved,
  disabled = false,
}) {
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(null); // { current, total } | null
  const [objectUrls, setObjectUrls] = useState({});
  const [viewingImage, setViewingImage] = useState(null);
  const [viewingPdf, setViewingPdf] = useState(null);

  const allDocs = [...savedDocuments, ...pendingFiles];

  useEffect(() => {
    const urls = {};
    allDocs.forEach((doc) => { if (doc.blob) urls[doc.id] = URL.createObjectURL(doc.blob); });
    setObjectUrls(urls);
    return () => { Object.values(urls).forEach((url) => URL.revokeObjectURL(url)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFiles, savedDocuments]);

  const handleFilesAdded = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const valid = files.filter(isAllowedFile);
    if (valid.length < files.length) {
      toast({ title: `${files.length - valid.length} file(s) skipped`, description: 'Only PDF, JPG, and PNG files are supported.', variant: 'destructive' });
    }
    if (valid.length === 0) return;

    setProcessing({ current: 0, total: valid.length });
    const newItems = [];
    for (let i = 0; i < valid.length; i++) {
      setProcessing({ current: i + 1, total: valid.length });
      try {
        const blob = await toStoredBlob(valid[i]);
        newItems.push({ id: createDocumentId(), filename: valid[i].name, mimetype: blob.type || valid[i].type, size: blob.size, blob });
      } catch (e) {
        toast({ title: `Could not process ${valid[i].name}`, description: e?.message || undefined, variant: 'destructive' });
      }
    }
    setProcessing(null);
    if (newItems.length > 0) onPendingFilesChange([...pendingFiles, ...newItems]);
  };

  const removePending = (id) => onPendingFilesChange(pendingFiles.filter((f) => f.id !== id));

  const openDoc = (doc) => {
    const url = objectUrls[doc.id];
    if (!url) return;
    if (isImageFile({ type: doc.mimetype, name: doc.filename })) setViewingImage({ ...doc, url });
    else setViewingPdf({ ...doc, url });
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!disabled) handleFilesAdded(e.dataTransfer.files); }}
        onClick={() => !disabled && document.getElementById('inspection-document-upload-input')?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
        )}
      >
        <UploadCloud className="w-6 h-6 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Drag & drop photos or PDFs here, or click to browse</p>
        <input
          id="inspection-document-upload-input"
          type="file"
          accept={ACCEPT}
          multiple
          disabled={disabled}
          className="hidden"
          onChange={(e) => { handleFilesAdded(e.target.files); e.target.value = ''; }}
        />
      </div>

      {processing && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Processing file {processing.current} of {processing.total}…
        </p>
      )}

      {allDocs.length > 0 && (
        <div className="space-y-1.5">
          {savedDocuments.map((doc) => (
            <div key={doc.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-xs">
              <Thumbnail doc={doc} url={objectUrls[doc.id]} />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{doc.filename}</p>
                <p className="text-muted-foreground">{formatSize(doc.size)}{doc.uploadDate ? ` • ${new Date(doc.uploadDate).toLocaleDateString()}` : ''}</p>
              </div>
              <button type="button" className="text-muted-foreground hover:text-primary flex-shrink-0" onClick={() => openDoc(doc)} title="View">
                <Eye className="w-4 h-4" />
              </button>
              <button type="button" className="text-muted-foreground hover:text-primary flex-shrink-0" onClick={() => downloadFile(objectUrls[doc.id], doc.filename)} title="Download">
                <Download className="w-4 h-4" />
              </button>
              {onDeleteSaved && (
                <button type="button" className="text-muted-foreground hover:text-destructive flex-shrink-0" onClick={() => onDeleteSaved(doc.id)} disabled={disabled} title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {pendingFiles.map((doc) => (
            <div key={doc.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-xs">
              <Thumbnail doc={doc} url={objectUrls[doc.id]} />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{doc.filename}</p>
                <p className="text-muted-foreground">{formatSize(doc.size)} • not yet saved</p>
              </div>
              <button type="button" className="text-muted-foreground hover:text-primary flex-shrink-0" onClick={() => openDoc(doc)} title="Preview">
                <Eye className="w-4 h-4" />
              </button>
              <button type="button" className="text-muted-foreground hover:text-destructive flex-shrink-0" onClick={() => removePending(doc.id)} disabled={disabled} title="Remove">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!viewingImage} onOpenChange={(o) => !o && setViewingImage(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="flex-row items-center justify-between gap-3 pr-8 space-y-0">
            <DialogTitle className="truncate" title={viewingImage?.filename}>{viewingImage?.filename}</DialogTitle>
            <Button size="sm" variant="outline" className="flex-shrink-0" onClick={() => downloadFile(viewingImage?.url, viewingImage?.filename)}>
              <Download className="w-3.5 h-3.5 mr-1.5" />Download
            </Button>
          </DialogHeader>
          {viewingImage && <img src={viewingImage.url} alt={viewingImage.filename} className="w-full h-auto rounded-lg" />}
        </DialogContent>
      </Dialog>

      <PdfViewerModal open={!!viewingPdf} onOpenChange={(o) => !o && setViewingPdf(null)} source={viewingPdf?.url} fileName={viewingPdf?.filename} />
    </div>
  );
}

function Thumbnail({ doc, url }) {
  const isImage = isImageFile({ type: doc.mimetype, name: doc.filename });
  if (isImage && url) {
    return <img src={url} alt={doc.filename} className="w-9 h-9 rounded object-cover flex-shrink-0 border border-border" />;
  }
  return (
    <div className="w-9 h-9 rounded bg-red-500/10 flex items-center justify-center flex-shrink-0">
      <FileText className="w-4 h-4 text-red-500" />
    </div>
  );
}
