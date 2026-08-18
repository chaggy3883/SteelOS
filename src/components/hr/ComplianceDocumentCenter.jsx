import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { FileText, Eye } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import FileDropzone from '@/components/ui/FileDropzone';
import PdfViewerModal from '@/components/shared/PdfViewerModal';

const DOCUMENT_TYPES = ['Drivers_License', 'SSN_Card', 'Birth_Cert', 'Training_Cert', 'I9_Form', 'EVerify_Confirmation'];

const isPdfDataUri = (uri) => /^data:application\/pdf/i.test(uri || '');

export default function ComplianceDocumentCenter({ employee }) {
  const { toast } = useToast();
  const [documents, setDocuments] = useState([]);
  const [docType, setDocType] = useState('Drivers_License');
  const [loading, setLoading] = useState(true);
  const [pdfViewer, setPdfViewer] = useState(null);

  const loadDocuments = async () => {
    try {
      const rows = await db.entities.employee_documents.filter({ employee_id: employee.id }, '-created_date', 100);
      setDocuments(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDocuments(); }, [employee.id]);

  const handleFileSelected = (file) => {
    const reader = new FileReader();
    reader.onload = async () => {
      await db.entities.employee_documents.create({
        employee_id: employee.id,
        document_type_key: docType,
        file_uri: reader.result,
        uploaded_at: new Date().toISOString(),
      });
      await loadDocuments();
      toast({ title: `${docType.replace(/_/g, ' ')} uploaded` });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="steel-card p-4">
      <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-primary" />Compliance Document Center</h4>

      <div className="mb-3">
        <Label className="text-xs">Document Type</Label>
        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger className="mt-1 w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DOCUMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <FileDropzone accept="image/*,.pdf" label={`Drag & drop a ${docType.replace(/_/g, ' ')} scan, or click to browse`} onFileSelected={handleFileSelected} className="w-full" />

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground py-2 text-center">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2 text-center">No documents on file yet.</p>
        ) : documents.map((doc) => (
          <div key={doc.id} className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-medium truncate">{doc.document_type_key.replace(/_/g, ' ')}</p>
                <p className="text-xs text-muted-foreground">{new Date(doc.uploaded_at).toLocaleDateString()}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {isPdfDataUri(doc.file_uri) && (
                <button
                  onClick={() => setPdfViewer({ source: doc.file_uri, fileName: `${doc.document_type_key}.pdf` })}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Eye className="w-3.5 h-3.5" />Open
                </button>
              )}
              <a href={doc.file_uri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <Eye className="w-3.5 h-3.5" />View
              </a>
            </div>
          </div>
        ))}
      </div>

      <PdfViewerModal
        open={!!pdfViewer}
        onOpenChange={(o) => { if (!o) setPdfViewer(null); }}
        source={pdfViewer?.source}
        fileName={pdfViewer?.fileName}
      />
    </div>
  );
}
