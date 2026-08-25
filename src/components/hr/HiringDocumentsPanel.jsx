import React, { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import FileDropzone from '@/components/ui/FileDropzone';
import { useToast } from '@/components/ui/use-toast';
import { downloadFile } from '@/lib/downloadFile';
import { FileText, Eye, Download, Trash2 } from 'lucide-react';
import {
  HIRING_DOCUMENT_TYPES,
  listHiringDocuments,
  uploadHiringDocument,
  openHiringDocument,
  removeHiringDocument,
} from '@/lib/hiringDocumentsApi';

// Shared document upload/list surface for both sides of the hire workflow —
// a candidate's resume/application/cover letter before a decision is made,
// and the same records once moveCandidateDocumentsToEmployee() has landed
// them on the employee record. `ownerType` ('candidate' | 'employee') picks
// which entity/blob-store namespace to read and write; `allowUpload=false`
// renders it read-only for the Candidate Archive view.
export default function HiringDocumentsPanel({ ownerType, ownerId, allowUpload = true, uploadedByName }) {
  const { toast } = useToast();
  const [documents, setDocuments] = useState([]);
  const [docType, setDocType] = useState(HIRING_DOCUMENT_TYPES[0]);
  const [loading, setLoading] = useState(true);

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const rows = await listHiringDocuments(ownerType, ownerId);
      setDocuments(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDocuments(); }, [ownerType, ownerId]);

  const handleFileSelected = async (file) => {
    try {
      await uploadHiringDocument(ownerType, ownerId, docType, file, uploadedByName);
      await loadDocuments();
      toast({ title: `${docType.replace(/_/g, ' ')} uploaded` });
    } catch (e) {
      toast({ title: 'Unable to upload document', variant: 'destructive' });
    }
  };

  const handleView = async (doc) => {
    const url = await openHiringDocument(doc);
    if (!url) {
      toast({ title: 'No file stored on this device for this record', variant: 'destructive' });
      return;
    }
    window.open(url, '_blank', 'noopener');
  };

  const handleDownload = async (doc) => {
    const url = await openHiringDocument(doc);
    if (!url) {
      toast({ title: 'No file stored on this device for this record', variant: 'destructive' });
      return;
    }
    downloadFile(url, doc.file_name);
  };

  const handleDelete = async (doc) => {
    await removeHiringDocument(ownerType, doc);
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    toast({ title: 'Document removed' });
  };

  return (
    <div className="space-y-3">
      {allowUpload && (
        <div className="steel-card p-4 space-y-3">
          <div>
            <Label className="text-xs">Document Type</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="mt-1 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HIRING_DOCUMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <FileDropzone accept="image/*,.pdf,.doc,.docx" label={`Drag & drop a ${docType.replace(/_/g, ' ').toLowerCase()}, or click to browse`} onFileSelected={handleFileSelected} />
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground py-2 text-center">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2 text-center">No documents on file yet.</p>
        ) : documents.map((doc) => (
          <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5 text-sm">
            <button onClick={() => handleView(doc)} className="flex items-center gap-2 min-w-0 text-left hover:underline">
              <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="min-w-0">
                <span className="font-medium truncate block">{doc.file_name}</span>
                <span className="text-xs text-muted-foreground">{doc.document_type.replace(/_/g, ' ')} • {doc.uploaded_date}{doc.uploaded_by ? ` • ${doc.uploaded_by}` : ''}</span>
              </span>
            </button>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleView(doc)} title="View"><Eye className="w-3.5 h-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDownload(doc)} title="Download"><Download className="w-3.5 h-3.5" /></Button>
              {allowUpload && (
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(doc)} title="Remove"><Trash2 className="w-3.5 h-3.5" /></Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
