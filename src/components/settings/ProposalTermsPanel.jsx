import React, { useEffect, useRef, useState } from 'react';
import { db } from '@/api/apiClient';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { Upload, FileText, Trash2, Loader2, Eye, ArrowUp, ArrowDown, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { openDocumentViewer } from '@/lib/openDocumentViewer';

// Company-supplied legal/boilerplate pages (standard terms & conditions,
// warranty language, payment terms, ...) that get appended, in sort_order,
// as extra pages after every proposal PDF's main pricing content — see
// bidProposalPdf.js, the only reader of these rows.
export default function ProposalTermsPanel() {
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pendingName, setPendingName] = useState('');
  const [reorderingId, setReorderingId] = useState(null);

  // Clarifications text is a short, plain free-text blurb rendered directly
  // on the proposal's pricing page (see bidProposalPdfLayout.js's
  // drawClarifications) — distinct from the uploaded terms documents below,
  // which are large, multi-page legal pages appended after the signature
  // block. Kept in this same panel only because they're both "text that
  // shows up on the proposal PDF" and an admin editing one will likely want
  // the other nearby, not because they're the same feature.
  const [company, setCompany] = useState(null);
  const [clarificationsText, setClarificationsText] = useState('');
  const [savingClarifications, setSavingClarifications] = useState(false);
  // Additional Notes is its own distinct section on the proposal PDF,
  // rendered immediately after Clarifications — a separate company field
  // with the same save/omit-when-blank behavior, not the same textarea.
  const [additionalNotesText, setAdditionalNotesText] = useState('');
  const [savingAdditionalNotes, setSavingAdditionalNotes] = useState(false);

  useEffect(() => { loadDocs(); loadCompany(); }, []);

  const loadDocs = async () => {
    setLoading(true);
    try {
      const rows = await db.entities.CompanyProposalTerms.filter({ is_active: true }, 'sort_order', 200);
      setDocs(rows);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const loadCompany = async () => {
    try {
      const row = await getEffectiveCompany();
      setCompany(row);
      setClarificationsText(row?.clarifications_text || '');
      setAdditionalNotesText(row?.additional_notes_text || '');
    } catch (e) { console.error(e); }
  };

  const handleSaveClarifications = async () => {
    if (!company) return;
    setSavingClarifications(true);
    try {
      const updated = await db.entities.Company.update(company.id, { clarifications_text: clarificationsText.trim() });
      setCompany(updated);
      toast({ title: 'Clarifications saved' });
    } catch (e) {
      toast({ title: 'Unable to save clarifications', variant: 'destructive' });
    } finally {
      setSavingClarifications(false);
    }
  };

  const handleSaveAdditionalNotes = async () => {
    if (!company) return;
    setSavingAdditionalNotes(true);
    try {
      const updated = await db.entities.Company.update(company.id, { additional_notes_text: additionalNotesText.trim() });
      setCompany(updated);
      toast({ title: 'Additional Notes saved' });
    } catch (e) {
      toast({ title: 'Unable to save additional notes', variant: 'destructive' });
    } finally {
      setSavingAdditionalNotes(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file });
      const nextSortOrder = docs.reduce((max, d) => Math.max(max, Number(d.sort_order) || 0), 0) + 1;
      const created = await db.entities.CompanyProposalTerms.create({
        document_name: pendingName.trim() || file.name,
        file_url,
        sort_order: nextSortOrder,
      });
      setDocs((prev) => [...prev, created]);
      setPendingName('');
      toast({ title: 'Document uploaded', description: file.name });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeDoc = async (id) => {
    await db.entities.CompanyProposalTerms.update(id, { is_active: false });
    setDocs((prev) => prev.filter((d) => d.id !== id));
  };

  // Swaps this row's sort_order with its neighbor in the given direction —
  // the order shown here is exactly the page order appended to the PDF, so
  // reordering has to persist immediately, not just reorder local state.
  const moveDoc = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= docs.length) return;
    const current = docs[index];
    const target = docs[targetIndex];
    setReorderingId(current.id);
    try {
      const [updatedCurrent, updatedTarget] = await Promise.all([
        db.entities.CompanyProposalTerms.update(current.id, { sort_order: target.sort_order }),
        db.entities.CompanyProposalTerms.update(target.id, { sort_order: current.sort_order }),
      ]);
      setDocs((prev) => {
        const next = [...prev];
        next[index] = updatedTarget;
        next[targetIndex] = updatedCurrent;
        return next;
      });
    } finally {
      setReorderingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="steel-card p-6 space-y-3">
        <h3 className="font-semibold">Clarifications</h3>
        <p className="text-sm text-muted-foreground">
          Short, plain-text notes shown directly on the proposal's pricing page (between Inclusions/Exclusions and the
          signature block) — not the multi-page legal terms document below, which is appended after the signature
          block instead. Leave blank to omit this section from the proposal entirely.
        </p>
        <Textarea
          value={clarificationsText}
          onChange={(e) => setClarificationsText(e.target.value)}
          rows={4}
          placeholder="e.g. Pricing valid for 30 days. Field measurements to be verified prior to fabrication."
        />
        <Button size="sm" onClick={handleSaveClarifications} disabled={savingClarifications || !company}>
          {savingClarifications ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save Clarifications
        </Button>
      </div>

      <div className="steel-card p-6 space-y-3">
        <h3 className="font-semibold">Additional Notes</h3>
        <p className="text-sm text-muted-foreground">
          Short, plain-text notes shown as their own section on the proposal's pricing page, immediately after
          Clarifications — a separate section, not appended to it. Leave blank to omit this section entirely.
        </p>
        <Textarea
          value={additionalNotesText}
          onChange={(e) => setAdditionalNotesText(e.target.value)}
          rows={4}
          placeholder="e.g. With tariffs in place, review clauses 6.2 and 7.5 in the following terms and conditions."
        />
        <Button size="sm" onClick={handleSaveAdditionalNotes} disabled={savingAdditionalNotes || !company}>
          {savingAdditionalNotes ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save Additional Notes
        </Button>
      </div>

      <div className="steel-card p-6 space-y-3">
        <h3 className="font-semibold">Upload Proposal Terms Document</h3>
        <p className="text-sm text-muted-foreground">
          Upload standard terms &amp; conditions, warranty language, payment terms, or any other page your company
          wants appended to the end of every proposal PDF sent to customers.
        </p>
        <div>
          <Label className="text-xs">Document Name</Label>
          <Input placeholder="e.g. Standard Terms & Conditions" value={pendingName} onChange={(e) => setPendingName(e.target.value)} className="mt-1" />
        </div>
        <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleFileChange} />
        <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
          Upload Document
        </Button>
      </div>

      <div className="steel-card p-6 space-y-3">
        <h3 className="font-semibold">Appended Proposal Pages</h3>
        <p className="text-xs text-muted-foreground">Pages are appended to every proposal PDF in this order.</p>
        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No terms documents uploaded yet.</p>
        ) : (
          <div className="space-y-2">
            {docs.map((doc, index) => (
              <div key={doc.id} className="border rounded-lg p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                  <p className="text-sm font-medium truncate" title={doc.document_name}>{doc.document_name}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === 0 || reorderingId} onClick={() => moveDoc(index, -1)}>
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === docs.length - 1 || reorderingId} onClick={() => moveDoc(index, 1)}>
                    <ArrowDown className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openDocumentViewer(doc.file_url, doc.document_name)}>
                    <Eye className="w-3.5 h-3.5 mr-1.5" />View
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeDoc(doc.id)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
