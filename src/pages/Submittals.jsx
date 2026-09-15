import React, { useState, useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSearchParams } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { resolveActorRole, dispatchSubmittalNotification } from '@/lib/salesNotifications';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { ClipboardList, Plus, Search, Paperclip, FileText, Download, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { saveDocumentFile, resolveDocumentUrl } from '@/lib/documentBlobStore';
import { getShopDrawingFileUrl } from '@/lib/shopDrawingBlobStore';
import { openDocumentViewer } from '@/lib/openDocumentViewer';
import { downloadFile } from '@/lib/downloadFile';
import { generateSubmittalTransmittalPdf } from '@/lib/submittalTransmittalPdf';
import { useAuth } from '@/lib/AuthContext';
import { logStatusChange } from '@/lib/statusHistory';
import StatusHistoryModal from '@/components/shared/StatusHistoryModal';
import { archiveDocument } from '@/lib/documentArchive';
import RemoveDocumentDialog from '@/components/documents/RemoveDocumentDialog';

// Submittal workflow mirrors RFI's (RFIs.jsx): draft -> submitted ->
// [under_review] -> resolved -> closed, plus a Revise & Resubmit branch that
// is unique to submittals — a 'revise_and_resubmit' outcome creates the next
// revision under the SAME submittal_number rather than a new record.
const SUBMITTAL_STATUS_LABELS = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review',
  approved: 'Approved', revise_and_resubmit: 'Revise & Resubmit', closed: 'Closed',
};

const REVIEW_OUTCOME_LABELS = { reviewed: 'Reviewed', reviewed_as_noted: 'Reviewed as Noted', revise_and_resubmit: 'Revise & Resubmit' };

// The five real-world folder categories this list is organized by (per the
// actual project transmittal log), derived from status + is_third_party
// rather than stored directly — 'approved' folds in both review outcomes
// that resolve to status 'approved', plus a fully 'closed' submittal (closed
// only reaches that state from approved). is_third_party always wins, since
// visibility-only submittals from another GC/trade aren't part of this
// company's own review cycle regardless of their status.
const SUBMITTAL_CATEGORIES = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'approved', label: 'Approved' },
  { key: 'revise_and_resubmit', label: 'Revise & Resubmit' },
  { key: 'other_gc', label: 'Other GC Submittals' },
  { key: 'other', label: 'Other Submittals' },
];

function getSubmittalCategory(s) {
  if (s.is_third_party) return 'other_gc';
  if (s.status === 'revise_and_resubmit') return 'revise_and_resubmit';
  if (s.status === 'approved' || s.status === 'closed') return 'approved';
  if (s.status === 'submitted' || s.status === 'under_review') return 'submitted';
  return 'other';
}

// Action kinds: 'status' is a plain field flip (mirrors RFI's transitions);
// 'review' records the GC/CM's disposition (review_outcome/reviewer_initials/
// date_reviewed) and derives the resulting status; 'revision' creates the
// next revision under the same submittal_number when the prior cycle came
// back Revise & Resubmit.
const SUBMITTAL_STATUS_TRANSITIONS = {
  draft: [
    { kind: 'status', to: 'submitted', label: 'Submit' },
  ],
  submitted: [
    { kind: 'status', to: 'under_review', label: 'Start Review' },
    { kind: 'review', outcome: 'reviewed', to: 'approved', label: 'Record: Reviewed' },
    { kind: 'review', outcome: 'reviewed_as_noted', to: 'approved', label: 'Record: Reviewed as Noted' },
    { kind: 'review', outcome: 'revise_and_resubmit', to: 'revise_and_resubmit', label: 'Record: Revise & Resubmit', requiresNote: true },
  ],
  under_review: [
    { kind: 'review', outcome: 'reviewed', to: 'approved', label: 'Record: Reviewed' },
    { kind: 'review', outcome: 'reviewed_as_noted', to: 'approved', label: 'Record: Reviewed as Noted' },
    { kind: 'review', outcome: 'revise_and_resubmit', to: 'revise_and_resubmit', label: 'Record: Revise & Resubmit', requiresNote: true },
  ],
  approved: [
    { kind: 'status', to: 'closed', label: 'Close' },
  ],
  revise_and_resubmit: [
    { kind: 'revision', label: 'Create Revision & Resubmit' },
  ],
  closed: [
    { kind: 'status', to: 'approved', label: 'Reopen', requiresNote: true },
  ],
};

const nextSubmittalActions = (status) => SUBMITTAL_STATUS_TRANSITIONS[status] || SUBMITTAL_STATUS_TRANSITIONS.draft;

const emptyCreateForm = {
  project_id: '', bid_id: '', spec_section: '', submittal_description: '',
  submitted_by_company: '', submitted_by_contact_name: '', submitted_by_contact_title: '',
  reviewer_company: '', reviewer_contact_name: '', notes: '', is_third_party: false,
  attached_shop_drawing_ids: [], other_attachment_ids: [],
};

// Compact search + checkbox list for attaching EXISTING ShopDrawing/Document
// records rather than re-uploading the same file a second time — same
// search/select-existing-record shape either attachment type uses.
function AttachmentPicker({ title, items, selectedIds, onToggle, search, onSearchChange, getPrimary, getSecondary, emptyLabel }) {
  const q = search.trim().toLowerCase();
  const filtered = items.filter((it) => !q || getPrimary(it).toLowerCase().includes(q) || (getSecondary(it) || '').toLowerCase().includes(q));
  return (
    <div>
      <Label>{title}</Label>
      <div className="relative mt-1">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input placeholder="Search..." value={search} onChange={(e) => onSearchChange(e.target.value)} className="pl-8 h-8 text-sm" />
      </div>
      <div className="mt-2 max-h-36 overflow-y-auto border border-border rounded-lg divide-y divide-border">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground p-2">{emptyLabel}</p>
        ) : filtered.map((it) => (
          <label key={it.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-muted/50">
            <Checkbox checked={selectedIds.includes(it.id)} onCheckedChange={() => onToggle(it.id)} />
            <span className="flex-1 truncate">{getPrimary(it)}{getSecondary(it) ? ` — ${getSecondary(it)}` : ''}</span>
          </label>
        ))}
      </div>
      {selectedIds.length > 0 && <p className="text-xs text-muted-foreground mt-1">{selectedIds.length} selected</p>}
    </div>
  );
}

export default function Submittals() {
  useDocumentTitle('SteelOS — Submittals');
  const { toast } = useToast();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [submittals, setSubmittals] = useState([]);
  const [projects, setProjects] = useState([]);
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyCreateForm);
  const [saving, setSaving] = useState(false);

  // Attachment picker data — loaded per project once one is chosen, since
  // ShopDrawing/Document are both project-scoped.
  const [projectDrawings, setProjectDrawings] = useState([]);
  const [projectDocuments, setProjectDocuments] = useState([]);
  const [drawingSearch, setDrawingSearch] = useState('');
  const [docSearch, setDocSearch] = useState('');

  const [selectedSubmittal, setSelectedSubmittal] = useState(null);
  const [editingSubmittal, setEditingSubmittal] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [statusChangeForm, setStatusChangeForm] = useState({ action: null, note: '', reviewer_initials: '', date_reviewed: '' });
  const [savingStatusChange, setSavingStatusChange] = useState(false);
  const [historySubmittal, setHistorySubmittal] = useState(null);
  const [generatingPdfId, setGeneratingPdfId] = useState(null);
  const [removeAttachmentTarget, setRemoveAttachmentTarget] = useState(null);

  useEffect(() => { loadData(); }, []);

  // Deep link, e.g. from Documents' linked "Submittals" category or a
  // dispatched notification ('/submittals?open=<id>') — same convention as
  // RFIs.jsx.
  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId || submittals.length === 0) return;
    const match = submittals.find((s) => s.id === openId);
    if (match) { setSelectedSubmittal(match); setEditingSubmittal(false); }
  }, [searchParams, submittals]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [submittalData, projData, bidData] = await Promise.all([
        db.entities.Submittal.list('-created_date', 200),
        db.entities.Project.filter({ is_archived: false }, 'name', 50),
        db.entities.Bid.list('-created_date', 200),
      ]);
      setSubmittals(submittalData);
      setProjects(projData);
      setBids(bidData);
    } catch (e) {} finally { setLoading(false); }
  };

  const loadProjectAttachmentSources = async (projectId) => {
    if (!projectId) { setProjectDrawings([]); setProjectDocuments([]); return; }
    try {
      const [drawings, docs] = await Promise.all([
        db.entities.ShopDrawing.filter({ project_id: projectId }, '-created_date', 300),
        db.entities.Document.filter({ project_id: projectId }, '-created_date', 300),
      ]);
      setProjectDrawings(drawings);
      setProjectDocuments(docs.filter((d) => !d.is_archived));
    } catch (e) { setProjectDrawings([]); setProjectDocuments([]); }
  };

  useEffect(() => { loadProjectAttachmentSources(form.project_id); }, [form.project_id]);

  const toggleFormDrawing = (id) => setForm((f) => ({ ...f, attached_shop_drawing_ids: f.attached_shop_drawing_ids.includes(id) ? f.attached_shop_drawing_ids.filter((x) => x !== id) : [...f.attached_shop_drawing_ids, id] }));
  const toggleFormDocument = (id) => setForm((f) => ({ ...f, other_attachment_ids: f.other_attachment_ids.includes(id) ? f.other_attachment_ids.filter((x) => x !== id) : [...f.other_attachment_ids, id] }));
  const toggleEditDrawing = (id) => setEditForm((f) => ({ ...f, attached_shop_drawing_ids: (f.attached_shop_drawing_ids || []).includes(id) ? f.attached_shop_drawing_ids.filter((x) => x !== id) : [...(f.attached_shop_drawing_ids || []), id] }));
  const toggleEditDocument = (id) => setEditForm((f) => ({ ...f, other_attachment_ids: (f.other_attachment_ids || []).includes(id) ? f.other_attachment_ids.filter((x) => x !== id) : [...(f.other_attachment_ids || []), id] }));

  const handleSave = async () => {
    if (!form.submittal_description || !form.project_id) return;
    setSaving(true);
    try {
      const submittalCount = submittals.filter((s) => s.project_id === form.project_id).length + 1;
      const createdAt = new Date().toISOString();
      const project = projects.find((p) => p.id === form.project_id);
      const actorRole = resolveActorRole(user?.roles);
      const created = await db.entities.Submittal.create({
        ...form,
        submittal_number: `SUB-${String(submittalCount).padStart(3, '0')}`,
        status: 'draft',
        date_submitted: createdAt.split('T')[0],
        created_by: user?.employee_id || user?.email || 'Unknown',
      });
      await logStatusChange({
        entityType: 'Submittal',
        entityId: created.id,
        fieldName: 'status',
        fromValue: null,
        toValue: 'draft',
        changedBy: user?.full_name || user?.email || 'Unknown',
        note: 'Submittal created.',
      });

      let recipientCount = 0;
      try {
        recipientCount = await dispatchSubmittalNotification(created, project, 'created', user?.employee_id, user?.full_name || user?.email);
      } catch (notifyError) {}

      toast({ title: 'Submittal created!', description: recipientCount > 0 ? `Notified ${recipientCount} teammate${recipientCount === 1 ? '' : 's'}.` : undefined });
      setOpen(false);
      setForm(emptyCreateForm);
      loadData();
    } catch (e) {
      toast({ title: 'Error', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const startEditingSubmittal = () => {
    setEditForm({
      spec_section: selectedSubmittal.spec_section || '',
      submittal_description: selectedSubmittal.submittal_description || '',
      submitted_by_company: selectedSubmittal.submitted_by_company || '',
      submitted_by_contact_name: selectedSubmittal.submitted_by_contact_name || '',
      submitted_by_contact_title: selectedSubmittal.submitted_by_contact_title || '',
      reviewer_company: selectedSubmittal.reviewer_company || '',
      reviewer_contact_name: selectedSubmittal.reviewer_contact_name || '',
      notes: selectedSubmittal.notes || '',
      is_third_party: !!selectedSubmittal.is_third_party,
      attached_shop_drawing_ids: selectedSubmittal.attached_shop_drawing_ids || [],
      other_attachment_ids: selectedSubmittal.other_attachment_ids || [],
    });
    loadProjectAttachmentSources(selectedSubmittal.project_id);
    setDrawingSearch(''); setDocSearch('');
    setEditingSubmittal(true);
  };

  const handleSaveSubmittalEdit = async () => {
    if (!selectedSubmittal) return;
    setSavingEdit(true);
    try {
      const updated = await db.entities.Submittal.update(selectedSubmittal.id, editForm);
      setSubmittals((prev) => prev.map((s) => (s.id === selectedSubmittal.id ? updated : s)));
      setSelectedSubmittal(updated);
      setEditingSubmittal(false);
      toast({ title: 'Submittal updated' });
    } catch (e) {
      toast({ title: 'Unable to save changes', variant: 'destructive' });
    } finally { setSavingEdit(false); }
  };

  const openChangeStatus = () => {
    setStatusChangeForm({ action: null, note: '', reviewer_initials: selectedSubmittal?.reviewer_initials || '', date_reviewed: new Date().toISOString().split('T')[0] });
    setChangingStatus(true);
  };

  const pickStatusAction = (option) => setStatusChangeForm((f) => ({ ...f, action: option, note: '' }));

  const handleCreateRevision = async () => {
    if (!selectedSubmittal) return;
    setSavingStatusChange(true);
    try {
      const project = projects.find((p) => p.id === selectedSubmittal.project_id);
      const nextRevision = (selectedSubmittal.revision_number || 0) + 1;
      const changedAt = new Date().toISOString();
      const updated = await db.entities.Submittal.update(selectedSubmittal.id, {
        revision_number: nextRevision,
        status: 'submitted',
        date_submitted: changedAt.split('T')[0],
        review_outcome: null,
        date_reviewed: null,
        reviewer_initials: null,
      });
      await logStatusChange({
        entityType: 'Submittal',
        entityId: selectedSubmittal.id,
        fieldName: 'status',
        fromValue: 'revise_and_resubmit',
        toValue: 'submitted',
        changedBy: user?.full_name || user?.email || 'Unknown',
        note: `Revision ${nextRevision} resubmitted.`,
      });
      try { await dispatchSubmittalNotification(updated, project, 'resubmitted', user?.employee_id, user?.full_name || user?.email); } catch (e) {}
      setSubmittals((prev) => prev.map((s) => (s.id === selectedSubmittal.id ? updated : s)));
      setSelectedSubmittal(updated);
      setChangingStatus(false);
      toast({ title: `Revision ${nextRevision} resubmitted` });
    } catch (e) {
      toast({ title: 'Unable to create revision', variant: 'destructive' });
    } finally { setSavingStatusChange(false); }
  };

  const handleChangeStatus = async () => {
    if (!selectedSubmittal || !statusChangeForm.action) return;
    const option = statusChangeForm.action;
    if (option.kind === 'revision') { await handleCreateRevision(); return; }
    if (option.requiresNote && !statusChangeForm.note.trim()) {
      toast({ title: 'A note is required for this change', description: 'Revise & Resubmit and Reopen must explain why.', variant: 'destructive' });
      return;
    }
    if (option.kind === 'review' && !statusChangeForm.reviewer_initials.trim()) {
      toast({ title: 'Reviewer initials are required', variant: 'destructive' });
      return;
    }
    setSavingStatusChange(true);
    try {
      const project = projects.find((p) => p.id === selectedSubmittal.project_id);
      const fromStatus = selectedSubmittal.status;
      const payload = { status: option.to };
      if (option.kind === 'review') {
        payload.review_outcome = option.outcome;
        payload.reviewer_initials = statusChangeForm.reviewer_initials.trim();
        payload.date_reviewed = statusChangeForm.date_reviewed || new Date().toISOString().split('T')[0];
      }
      const updated = await db.entities.Submittal.update(selectedSubmittal.id, payload);
      await logStatusChange({
        entityType: 'Submittal',
        entityId: selectedSubmittal.id,
        fieldName: 'status',
        fromValue: fromStatus,
        toValue: option.to,
        changedBy: user?.full_name || user?.email || 'Unknown',
        note: statusChangeForm.note.trim() || (option.kind === 'review' ? `Review outcome: ${REVIEW_OUTCOME_LABELS[option.outcome]}` : ''),
      });
      if (option.kind === 'review') {
        try { await dispatchSubmittalNotification(updated, project, 'reviewed', user?.employee_id, user?.full_name || user?.email); } catch (e) {}
      }
      setSubmittals((prev) => prev.map((s) => (s.id === selectedSubmittal.id ? updated : s)));
      setSelectedSubmittal(updated);
      setChangingStatus(false);
      toast({ title: `Status changed to ${SUBMITTAL_STATUS_LABELS[option.to] || option.to}` });
    } catch (e) {
      toast({ title: 'Unable to change status', variant: 'destructive' });
    } finally { setSavingStatusChange(false); }
  };

  const resolveOrWarn = async (url, label) => {
    if (!url) { toast({ title: 'File unavailable', description: `${label} could not be found.`, variant: 'destructive' }); return null; }
    return url;
  };

  const openShopDrawing = async (drawing) => {
    const url = await resolveOrWarn(await getShopDrawingFileUrl(drawing.id), drawing.drawing_number);
    if (!url) return;
    if (/\.pdf$/i.test(drawing.file_name || '')) openDocumentViewer(url, drawing.file_name || drawing.drawing_number);
    else downloadFile(url, drawing.file_name || drawing.drawing_number);
  };

  const openOtherDocument = async (docRecord) => {
    const url = await resolveOrWarn(await resolveDocumentUrl(docRecord), docRecord.name);
    if (!url) return;
    if (/\.pdf$/i.test(docRecord.file_name || '')) openDocumentViewer(url, docRecord.file_name || docRecord.name);
    else downloadFile(url, docRecord.file_name || docRecord.name);
  };

  // archiveDocument already strips the id from this (and any other)
  // Submittal's other_attachment_ids in the database — this just mirrors
  // that onto the two pieces of local state that render it.
  const confirmRemoveAttachment = async () => {
    if (!removeAttachmentTarget || !selectedSubmittal) return;
    await archiveDocument(removeAttachmentTarget);
    const updatedIds = (selectedSubmittal.other_attachment_ids || []).filter((id) => id !== removeAttachmentTarget.id);
    setSelectedSubmittal((prev) => (prev ? { ...prev, other_attachment_ids: updatedIds } : prev));
    setSubmittals((prev) => prev.map((s) => (s.id === selectedSubmittal.id ? { ...s, other_attachment_ids: updatedIds } : s)));
    setRemoveAttachmentTarget(null);
    toast({ title: 'Document removed' });
  };

  const handleGenerateTransmittal = async (submittal) => {
    setGeneratingPdfId(submittal.id);
    try {
      const project = projects.find((p) => p.id === submittal.project_id);
      const company = await getEffectiveCompany();
      const [allDrawings, allDocs] = await Promise.all([
        db.entities.ShopDrawing.filter({ project_id: submittal.project_id }, '-created_date', 300),
        db.entities.Document.filter({ project_id: submittal.project_id }, '-created_date', 300),
      ]);
      const attachedDrawings = allDrawings.filter((d) => (submittal.attached_shop_drawing_ids || []).includes(d.id));
      const attachedDocs = allDocs.filter((d) => (submittal.other_attachment_ids || []).includes(d.id));

      const { blob, filename } = await generateSubmittalTransmittalPdf({ company, project, submittal, shopDrawings: attachedDrawings, documents: attachedDocs });
      const file = new File([blob], filename, { type: 'application/pdf' });
      const { file_url } = await db.integrations.Core.UploadFile({ file });

      const document = await db.entities.Document.create({
        project_id: submittal.project_id,
        name: filename,
        file_url,
        file_name: filename,
        file_size: blob.size,
        file_type: 'application/pdf',
        document_type: 'submittal',
        status: 'uploaded',
        is_archived: false,
      });
      await saveDocumentFile(document.id, file);

      toast({ title: 'Transmittal generated', description: `Saved to Documents for ${project?.name || submittal.project_id}.` });
    } catch (e) {
      toast({ title: 'Unable to generate transmittal', variant: 'destructive' });
    } finally { setGeneratingPdfId(null); }
  };

  const projectById = new Map(projects.map((p) => [p.id, p]));

  const filtered = submittals.filter((s) => {
    const q = search.trim().toLowerCase();
    const proj = projectById.get(s.project_id);
    const matchSearch = !q
      || s.submittal_number?.toLowerCase().includes(q)
      || s.submittal_description?.toLowerCase().includes(q)
      || s.spec_section?.toLowerCase().includes(q)
      || proj?.name?.toLowerCase().includes(q);
    const matchCategory = categoryFilter === 'all' || getSubmittalCategory(s) === categoryFilter;
    return matchSearch && matchCategory;
  });

  const selectedSubmittalProject = selectedSubmittal ? projects.find((p) => p.id === selectedSubmittal.project_id) : null;

  const categoryCounts = SUBMITTAL_CATEGORIES.reduce((acc, c) => { acc[c.key] = submittals.filter((s) => getSubmittalCategory(s) === c.key).length; return acc; }, {});

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Submittals"
        subtitle="Shop drawing and product submittal transmittals across all projects"
        actions={
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setForm(emptyCreateForm); setDrawingSearch(''); setDocSearch(''); } }}>
            <DialogTrigger asChild>
              <Button className="steel-gradient text-white border-0"><Plus className="w-4 h-4 mr-2" />New Submittal</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create Submittal</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div>
                  <Label>Project *</Label>
                  <Select value={form.project_id} onValueChange={(v) => setForm((f) => ({ ...f, project_id: v, attached_shop_drawing_ids: [], other_attachment_ids: [] }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select project" /></SelectTrigger>
                    <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Estimate / Bid</Label>
                  <Select value={form.bid_id} onValueChange={(v) => setForm((f) => ({ ...f, bid_id: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Link to an estimate (optional)" /></SelectTrigger>
                    <SelectContent>{bids.map((b) => <SelectItem key={b.id} value={b.id}>{b.bid_number} — {b.job_name || 'Untitled Bid'}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Spec Section</Label>
                  <Input value={form.spec_section} onChange={(e) => setForm((f) => ({ ...f, spec_section: e.target.value }))} className="mt-1" placeholder="e.g. 05 51 00" />
                </div>
                <div><Label>Submittal Description *</Label><Textarea value={form.submittal_description} onChange={(e) => setForm((f) => ({ ...f, submittal_description: e.target.value }))} className="mt-1" rows={2} /></div>

                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Submitted By Company</Label><Input value={form.submitted_by_company} onChange={(e) => setForm((f) => ({ ...f, submitted_by_company: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Contact Name</Label><Input value={form.submitted_by_contact_name} onChange={(e) => setForm((f) => ({ ...f, submitted_by_contact_name: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Contact Title</Label><Input value={form.submitted_by_contact_title} onChange={(e) => setForm((f) => ({ ...f, submitted_by_contact_title: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Reviewer Company</Label><Input value={form.reviewer_company} onChange={(e) => setForm((f) => ({ ...f, reviewer_company: e.target.value }))} className="mt-1" placeholder="GC / CM" /></div>
                  <div className="col-span-2"><Label>Reviewer Contact Name</Label><Input value={form.reviewer_contact_name} onChange={(e) => setForm((f) => ({ ...f, reviewer_contact_name: e.target.value }))} className="mt-1" /></div>
                </div>

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={form.is_third_party} onCheckedChange={(v) => setForm((f) => ({ ...f, is_third_party: !!v }))} />
                  This submittal belongs to another GC/trade — log for visibility only
                </label>

                <AttachmentPicker
                  title="Attach Shop Drawings"
                  items={projectDrawings}
                  selectedIds={form.attached_shop_drawing_ids}
                  onToggle={toggleFormDrawing}
                  search={drawingSearch}
                  onSearchChange={setDrawingSearch}
                  getPrimary={(d) => d.drawing_number || d.file_name || 'Untitled'}
                  getSecondary={(d) => d.description}
                  emptyLabel={form.project_id ? 'No shop drawings found for this project.' : 'Select a project first.'}
                />
                <AttachmentPicker
                  title="Attach Other Documents"
                  items={projectDocuments}
                  selectedIds={form.other_attachment_ids}
                  onToggle={toggleFormDocument}
                  search={docSearch}
                  onSearchChange={setDocSearch}
                  getPrimary={(d) => d.name || d.file_name || 'Untitled'}
                  getSecondary={(d) => d.document_type}
                  emptyLabel={form.project_id ? 'No documents found for this project.' : 'Select a project first.'}
                />

                <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1" rows={2} /></div>
                <Button onClick={handleSave} disabled={saving || !form.submittal_description || !form.project_id} className="w-full steel-gradient text-white border-0">
                  {saving ? 'Creating...' : 'Create Submittal'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {SUBMITTAL_CATEGORIES.map((c) => (
          <button
            type="button"
            key={c.key}
            onClick={() => setCategoryFilter((prev) => (prev === c.key ? 'all' : c.key))}
            className={`steel-card p-4 text-left hover:ring-1 hover:ring-primary/40 transition-shadow ${categoryFilter === c.key ? 'ring-1 ring-primary/60' : ''}`}
          >
            <div className="flex items-center gap-2 mb-1"><ClipboardList className="w-4 h-4 text-primary" /><p className="text-xs text-muted-foreground">{c.label}</p></div>
            <p className="text-2xl font-bold text-primary">{loading ? '—' : categoryCounts[c.key]}</p>
          </button>
        ))}
      </div>

      {categoryFilter !== 'all' && (
        <div className="flex items-center justify-between text-sm mb-4 px-3 py-2 rounded-lg bg-primary/10 text-primary">
          <span>Showing {SUBMITTAL_CATEGORIES.find((c) => c.key === categoryFilter)?.label} submittals.</span>
          <button className="flex items-center gap-1 hover:underline" onClick={() => setCategoryFilter('all')}>Clear filter</button>
        </div>
      )}

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search submittals..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 steel-card">
            <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No submittals found</p>
          </div>
        ) : (
          filtered.map((s) => {
            const proj = projectById.get(s.project_id);
            const linkedBid = bids.find((b) => b.id === s.bid_id);
            return (
              <div
                key={s.id}
                onClick={() => { setSelectedSubmittal(s); setEditingSubmittal(false); }}
                className={`steel-card p-4 border-l-4 cursor-pointer hover:bg-muted/50 transition-colors ${s.status === 'revise_and_resubmit' ? 'border-l-orange-400' : s.status === 'approved' || s.status === 'closed' ? 'border-l-green-400' : 'border-l-blue-400'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-mono font-bold text-primary">{s.submittal_number}{s.revision_number ? ` Rev ${s.revision_number}` : ''}</span>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setHistorySubmittal(s); }} className="cursor-pointer">
                        <StatusBadge status={s.status} label={SUBMITTAL_STATUS_LABELS[s.status]} />
                      </button>
                      {s.is_third_party && <span className="text-xs bg-purple-500/10 text-purple-500 px-2 py-0.5 rounded-full">OTHER GC</span>}
                      {s.spec_section && <span className="text-xs text-muted-foreground">{s.spec_section}</span>}
                    </div>
                    <p className="font-medium text-sm">{s.submittal_description}</p>
                    {proj && <p className="text-xs text-muted-foreground mt-1">{proj.project_number} — {proj.name}</p>}
                    {linkedBid && <p className="text-xs text-muted-foreground mt-0.5">Estimate: {linkedBid.bid_number}</p>}
                    <p className="text-xs text-muted-foreground mt-1">
                      {s.date_submitted && <span>Submitted: {s.date_submitted}</span>}
                      {s.date_reviewed && <span> • Reviewed: {s.date_reviewed}</span>}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <Dialog open={!!selectedSubmittal} onOpenChange={(o) => { if (!o) { setSelectedSubmittal(null); setEditingSubmittal(false); setChangingStatus(false); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedSubmittal && !editingSubmittal && !changingStatus && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-primary">{selectedSubmittal.submittal_number}{selectedSubmittal.revision_number ? ` Rev ${selectedSubmittal.revision_number}` : ''}</span>
                  <span>{selectedSubmittal.submittal_description}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => setHistorySubmittal(selectedSubmittal)} className="cursor-pointer">
                  <StatusBadge status={selectedSubmittal.status} label={SUBMITTAL_STATUS_LABELS[selectedSubmittal.status]} />
                </button>
                {selectedSubmittal.review_outcome && <span className="text-xs bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded-full font-medium">{REVIEW_OUTCOME_LABELS[selectedSubmittal.review_outcome]}</span>}
                {selectedSubmittal.is_third_party && <span className="text-xs bg-purple-500/10 text-purple-500 px-2 py-0.5 rounded-full font-medium">OTHER GC SUBMITTAL</span>}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Project', value: selectedSubmittalProject ? `${selectedSubmittalProject.project_number} — ${selectedSubmittalProject.name}` : '—' },
                  { label: 'Spec Section', value: selectedSubmittal.spec_section || '—' },
                  { label: 'Date Submitted', value: selectedSubmittal.date_submitted || '—' },
                  { label: 'Date Reviewed', value: selectedSubmittal.date_reviewed || '—' },
                  { label: 'Reviewer Initials', value: selectedSubmittal.reviewer_initials || '—' },
                  { label: 'Submitted By', value: [selectedSubmittal.submitted_by_company, selectedSubmittal.submitted_by_contact_name].filter(Boolean).join(' — ') || '—' },
                  { label: 'Submitter Title', value: selectedSubmittal.submitted_by_contact_title || '—' },
                  { label: 'Reviewer', value: [selectedSubmittal.reviewer_company, selectedSubmittal.reviewer_contact_name].filter(Boolean).join(' — ') || '—' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium">{value}</p>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">{selectedSubmittal.notes || 'No notes'}</p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Attached Shop Drawings</p>
                {(selectedSubmittal.attached_shop_drawing_ids || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">None attached</p>
                ) : (
                  <SubmittalAttachedDrawings ids={selectedSubmittal.attached_shop_drawing_ids} projectId={selectedSubmittal.project_id} onOpen={openShopDrawing} />
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Other Attachments</p>
                {(selectedSubmittal.other_attachment_ids || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">None attached</p>
                ) : (
                  <SubmittalAttachedDocuments ids={selectedSubmittal.other_attachment_ids} projectId={selectedSubmittal.project_id} onOpen={openOtherDocument} onRemove={setRemoveAttachmentTarget} />
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 flex-wrap">
                <Button variant="outline" onClick={() => setSelectedSubmittal(null)}>Close</Button>
                <Button
                  variant="outline"
                  className="gap-1.5"
                  disabled={generatingPdfId === selectedSubmittal.id}
                  onClick={() => handleGenerateTransmittal(selectedSubmittal)}
                >
                  <Download className="w-3.5 h-3.5" />{generatingPdfId === selectedSubmittal.id ? 'Generating…' : 'Generate Transmittal'}
                </Button>
                {nextSubmittalActions(selectedSubmittal.status).length > 0 && (
                  <Button variant="outline" onClick={openChangeStatus}>Change Status</Button>
                )}
                <Button onClick={startEditingSubmittal} className="steel-gradient text-white border-0">Edit</Button>
              </div>
            </>
          )}

          {selectedSubmittal && changingStatus && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-primary">{selectedSubmittal.submittal_number}{selectedSubmittal.revision_number ? ` Rev ${selectedSubmittal.revision_number}` : ''}</span>
                  <span className="text-sm text-muted-foreground font-normal">Change Status</span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Current status:</span>
                  <StatusBadge status={selectedSubmittal.status} label={SUBMITTAL_STATUS_LABELS[selectedSubmittal.status]} />
                </div>

                <div>
                  <Label>Action</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {nextSubmittalActions(selectedSubmittal.status).map((option) => (
                      <Button
                        key={option.label}
                        type="button"
                        size="sm"
                        variant={statusChangeForm.action === option ? 'default' : 'outline'}
                        className={statusChangeForm.action === option ? 'steel-gradient text-white border-0' : ''}
                        onClick={() => pickStatusAction(option)}
                      >
                        {option.kind === 'revision' && <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {statusChangeForm.action?.kind === 'review' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Reviewer Initials *</Label>
                      <Input value={statusChangeForm.reviewer_initials} onChange={(e) => setStatusChangeForm((f) => ({ ...f, reviewer_initials: e.target.value }))} className="mt-1" />
                    </div>
                    <div>
                      <Label>Date Reviewed</Label>
                      <Input type="date" value={statusChangeForm.date_reviewed} onChange={(e) => setStatusChangeForm((f) => ({ ...f, date_reviewed: e.target.value }))} className="mt-1" />
                    </div>
                  </div>
                )}

                {statusChangeForm.action?.kind === 'revision' && (
                  <p className="text-sm text-muted-foreground">
                    Creates Revision {(selectedSubmittal.revision_number || 0) + 1} under {selectedSubmittal.submittal_number}, resets status to Submitted with today's date, and clears the prior review outcome.
                  </p>
                )}

                {statusChangeForm.action && statusChangeForm.action.kind !== 'revision' && (
                  <div>
                    <Label>Note {statusChangeForm.action.requiresNote ? '*' : '(optional)'}</Label>
                    <Textarea
                      value={statusChangeForm.note}
                      onChange={(e) => setStatusChangeForm((f) => ({ ...f, note: e.target.value }))}
                      className="mt-1"
                      rows={2}
                      placeholder={statusChangeForm.action.requiresNote ? 'Required — explain why this submittal needs revision or is being reopened.' : 'Optional context for this status change.'}
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div><p>Changed By</p><p className="font-medium text-foreground">{user?.full_name || user?.email || 'Unknown'}</p></div>
                  <div><p>Date</p><p className="font-medium text-foreground">{new Date().toISOString().split('T')[0]}</p></div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setChangingStatus(false)}>Cancel</Button>
                  <Button
                    onClick={handleChangeStatus}
                    disabled={!statusChangeForm.action || savingStatusChange}
                    className="steel-gradient text-white border-0"
                  >
                    {savingStatusChange ? 'Saving…' : 'Confirm'}
                  </Button>
                </div>
              </div>
            </>
          )}

          {selectedSubmittal && editingSubmittal && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-primary">{selectedSubmittal.submittal_number}{selectedSubmittal.revision_number ? ` Rev ${selectedSubmittal.revision_number}` : ''}</span>
                  <span className="text-sm text-muted-foreground font-normal">Edit Submittal</span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <div><Label>Spec Section</Label><Input value={editForm.spec_section} onChange={(e) => setEditForm((f) => ({ ...f, spec_section: e.target.value }))} className="mt-1" /></div>
                <div><Label>Submittal Description</Label><Textarea value={editForm.submittal_description} onChange={(e) => setEditForm((f) => ({ ...f, submittal_description: e.target.value }))} className="mt-1" rows={2} /></div>

                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Submitted By Company</Label><Input value={editForm.submitted_by_company} onChange={(e) => setEditForm((f) => ({ ...f, submitted_by_company: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Contact Name</Label><Input value={editForm.submitted_by_contact_name} onChange={(e) => setEditForm((f) => ({ ...f, submitted_by_contact_name: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Contact Title</Label><Input value={editForm.submitted_by_contact_title} onChange={(e) => setEditForm((f) => ({ ...f, submitted_by_contact_title: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Reviewer Company</Label><Input value={editForm.reviewer_company} onChange={(e) => setEditForm((f) => ({ ...f, reviewer_company: e.target.value }))} className="mt-1" /></div>
                  <div className="col-span-2"><Label>Reviewer Contact Name</Label><Input value={editForm.reviewer_contact_name} onChange={(e) => setEditForm((f) => ({ ...f, reviewer_contact_name: e.target.value }))} className="mt-1" /></div>
                </div>

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={editForm.is_third_party} onCheckedChange={(v) => setEditForm((f) => ({ ...f, is_third_party: !!v }))} />
                  This submittal belongs to another GC/trade — log for visibility only
                </label>

                <AttachmentPicker
                  title="Attach Shop Drawings"
                  items={projectDrawings}
                  selectedIds={editForm.attached_shop_drawing_ids || []}
                  onToggle={toggleEditDrawing}
                  search={drawingSearch}
                  onSearchChange={setDrawingSearch}
                  getPrimary={(d) => d.drawing_number || d.file_name || 'Untitled'}
                  getSecondary={(d) => d.description}
                  emptyLabel="No shop drawings found for this project."
                />
                <AttachmentPicker
                  title="Attach Other Documents"
                  items={projectDocuments}
                  selectedIds={editForm.other_attachment_ids || []}
                  onToggle={toggleEditDocument}
                  search={docSearch}
                  onSearchChange={setDocSearch}
                  getPrimary={(d) => d.name || d.file_name || 'Untitled'}
                  getSecondary={(d) => d.document_type}
                  emptyLabel="No documents found for this project."
                />

                <div><Label>Notes</Label><Textarea value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1" rows={2} /></div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setEditingSubmittal(false)}>Cancel</Button>
                  <Button onClick={handleSaveSubmittalEdit} disabled={savingEdit} className="steel-gradient text-white border-0">
                    {savingEdit ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <StatusHistoryModal
        open={!!historySubmittal}
        onOpenChange={(o) => !o && setHistorySubmittal(null)}
        entityType="Submittal"
        entityId={historySubmittal?.id}
        fieldName="status"
        title={historySubmittal ? `${historySubmittal.submittal_number} — Status History` : 'Status History'}
      />

      <RemoveDocumentDialog
        open={!!removeAttachmentTarget}
        onOpenChange={(o) => !o && setRemoveAttachmentTarget(null)}
        onConfirm={confirmRemoveAttachment}
      />
    </div>
  );
}

// Standing rule 1 (every data point clickable to its source): resolves the
// attached ShopDrawing/Document rows for display in the detail dialog so
// each one opens its real file rather than showing a bare id.
function SubmittalAttachedDrawings({ ids, projectId, onOpen }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let cancelled = false;
    db.entities.ShopDrawing.filter({ project_id: projectId }, '-created_date', 300)
      .then((all) => { if (!cancelled) setRows(all.filter((d) => ids.includes(d.id))); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [ids, projectId]);
  return (
    <div className="space-y-1.5">
      {rows.map((d) => (
        <button key={d.id} type="button" onClick={() => onOpen(d)} className="flex items-center gap-2 text-sm text-primary hover:underline">
          <Paperclip className="w-3.5 h-3.5" />{d.drawing_number || d.file_name}{d.description ? ` — ${d.description}` : ''}
        </button>
      ))}
    </div>
  );
}

function SubmittalAttachedDocuments({ ids, projectId, onOpen, onRemove }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let cancelled = false;
    db.entities.Document.filter({ project_id: projectId }, '-created_date', 300)
      .then((all) => { if (!cancelled) setRows(all.filter((d) => ids.includes(d.id) && !d.is_archived)); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [ids, projectId]);
  return (
    <div className="space-y-1.5">
      {rows.map((d) => (
        <div key={d.id} className="flex items-center gap-2">
          <button type="button" onClick={() => onOpen(d)} className="flex items-center gap-2 text-sm text-primary hover:underline flex-1 min-w-0">
            <FileText className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{d.name || d.file_name}</span>
          </button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive shrink-0" title="Remove" onClick={() => onRemove(d)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
