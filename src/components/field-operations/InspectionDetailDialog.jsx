import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { CheckCircle2, XCircle, AlertTriangle, FileText, Eye, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import PdfViewerModal from '@/components/shared/PdfViewerModal';
import { downloadFile } from '@/lib/downloadFile';
import { getPersonTierMismatch } from '@/lib/heavyEquipmentChecklists';

const isPdfName = (name) => !!name?.match(/\.pdf$/i);

// Read-only drill-down for a single inspection record — mirrors
// RepairDetailDialog's shape (row click -> full record, no edit surface).
export default function InspectionDetailDialog({ inspection, open, onOpenChange, assets = [] }) {
  const navigate = useNavigate();
  const [certDoc, setCertDoc] = useState(null);
  const [pdfViewer, setPdfViewer] = useState(null);

  useEffect(() => {
    if (open && inspection?.cert_document_id) {
      db.entities.Document.get(inspection.cert_document_id).then(setCertDoc).catch(() => setCertDoc(null));
    } else {
      setCertDoc(null);
    }
  }, [open, inspection?.cert_document_id]);

  if (!inspection) return null;

  const asset = assets.find((a) => a.id === inspection.asset_id);
  const mismatch = getPersonTierMismatch(inspection.inspection_type, inspection.competent_person, inspection.qualified_person);
  const items = Array.isArray(inspection.checklist_items) ? inspection.checklist_items : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{inspection.inspection_type?.replace(/_/g, ' ') || 'Inspection'} Record</span>
            <Badge variant={inspection.status_passed ? 'secondary' : 'destructive'} className="text-[10px]">
              {inspection.status_passed ? 'Passed' : 'Failed'}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {mismatch && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{mismatch}</span>
          </div>
        )}

        <div className="space-y-2">
          {[
            ['Asset', asset?.asset_name || inspection.asset_id || '—', inspection.asset_id ? () => navigate(`/field-operations?asset=${inspection.asset_id}`) : null],
            ['Executed', inspection.executed_date || '—'],
            ['Expiration', inspection.expiration_date || '—'],
            ['Inspector', inspection.inspector_name || '—'],
            ['Person Tier', [
              inspection.competent_person ? 'Competent Person (1926.32(f))' : null,
              inspection.qualified_person ? 'Qualified Person (1926.32(m))' : null,
            ].filter(Boolean).join(' • ') || '—'],
          ].map(([label, value, onClick]) => (
            <div key={label} className="grid grid-cols-3 gap-2 text-sm border-b border-border/50 pb-2">
              <span className="text-muted-foreground">{label}</span>
              {onClick ? (
                <button onClick={onClick} className="col-span-2 font-medium text-left text-primary hover:underline">{value}</button>
              ) : (
                <span className="col-span-2 font-medium">{value}</span>
              )}
            </div>
          ))}
        </div>

        {items.length > 0 && (
          <div>
            <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-2">
              Checklist ({items.filter((i) => i.pass).length}/{items.length} passed)
            </h5>
            <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin">
              {items.map((it, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded bg-muted/50 text-xs">
                  {it.pass ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0 mt-0.5" />}
                  <div className="min-w-0">
                    <p>{it.item}</p>
                    {it.notes && <p className="text-muted-foreground mt-0.5">{it.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {inspection.cert_document_id && (
          <div className="flex items-center gap-2 p-2 rounded-lg border border-border text-xs">
            <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="truncate flex-1">{certDoc?.file_name || 'Certificate / checklist document'}</span>
            {certDoc?.file_url && isPdfName(certDoc.file_name) && (
              <button className="text-muted-foreground hover:text-primary" onClick={() => setPdfViewer({ source: certDoc.file_url, fileName: certDoc.file_name })}>
                <Eye className="w-4 h-4" />
              </button>
            )}
            {certDoc?.file_url && !isPdfName(certDoc.file_name) && (
              <button className="text-muted-foreground hover:text-primary" onClick={() => downloadFile(certDoc.file_url, certDoc.file_name)}>
                <Download className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>

        <PdfViewerModal open={!!pdfViewer} onOpenChange={(o) => { if (!o) setPdfViewer(null); }} source={pdfViewer?.source} fileName={pdfViewer?.fileName} />
      </DialogContent>
    </Dialog>
  );
}
