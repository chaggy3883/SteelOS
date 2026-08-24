import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { resolveActorRole, dispatchRfiNotification } from '@/lib/salesNotifications';
import { MessageSquare, Plus, Search, AlertCircle, Clock, CheckCircle2, FileWarning, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { generateDelayImpactNoticePDF } from '@/lib/delayNoticePdf';
import { useAuth } from '@/lib/AuthContext';
import { logStatusChange } from '@/lib/statusHistory';
import StatusHistoryModal from '@/components/shared/StatusHistoryModal';

// RFI status lifecycle: draft -> submitted -> answered -> closed, with a
// void branch reachable from any active state and a reopen path back out of
// answered/closed/void. 'under_review' is a legacy in-flight status from
// before this control existed (still present on older records) — it's no
// longer a reachable target, but is treated as equivalent to 'submitted' so
// records already sitting in it still get a valid forward path.
const RFI_STATUS_LABELS = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review',
  answered: 'Answered', closed: 'Closed', void: 'Void',
};

const RFI_STATUS_FILTER_OPTIONS = ['all', 'draft', 'submitted', 'under_review', 'answered', 'closed', 'void'];

const RFI_STATUS_TRANSITIONS = {
  draft: [
    { to: 'submitted', label: 'Submit' },
    { to: 'void', label: 'Void', requiresNote: true },
  ],
  submitted: [
    { to: 'answered', label: 'Answered' },
    { to: 'void', label: 'Void', requiresNote: true },
  ],
  under_review: [
    { to: 'answered', label: 'Answered' },
    { to: 'void', label: 'Void', requiresNote: true },
  ],
  answered: [
    { to: 'closed', label: 'Close' },
    { to: 'submitted', label: 'Reopen', reopen: true, requiresNote: true },
    { to: 'void', label: 'Void', requiresNote: true },
  ],
  closed: [
    { to: 'submitted', label: 'Reopen', reopen: true, requiresNote: true },
    { to: 'void', label: 'Void', requiresNote: true },
  ],
  void: [
    { to: 'draft', label: 'Reopen', reopen: true, requiresNote: true },
  ],
};

const nextStatusOptions = (status) => RFI_STATUS_TRANSITIONS[status] || RFI_STATUS_TRANSITIONS.draft;

// date_required is this app's "response due date" field for an RFI.
const isRfiOverdue = (rfi) => !!(rfi.date_required && new Date(rfi.date_required) < new Date() && !['closed', 'void'].includes(rfi.status));

// Open-ended while active (counts up to today); pins to the last update once
// closed/voided so the counter stops advancing after the RFI is done.
const daysRfiOpen = (rfi) => {
  const start = rfi.date_submitted || rfi.created_date;
  if (!start) return null;
  const end = ['closed', 'void'].includes(rfi.status) ? (rfi.updated_date || rfi.created_date) : new Date().toISOString();
  return Math.max(0, Math.floor((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)));
};

// Mirrors Intelligence.jsx's STEEL_SYSTEM_PROMPT verbatim — same
// structural-steel-expert persona for every AI call in this app, not a
// generic one invented for this feature.
const STEEL_SYSTEM_PROMPT = `You are an expert Senior Structural Steel Estimator and ERP specialist with 25+ years of experience reviewing structural steel fabrication contracts and specifications.

You have deep expertise in:
- AISC standards and certifications
- AWS D1.1 and D1.5 Structural Welding Codes
- CSI Division 05 (Metals) specifications
- SSPC/AMPP surface preparation standards
- OSHA construction safety regulations
- Structural steel fabrication processes (fit-up, welding, painting, galvanizing)
- Contract risk analysis for steel fabricators
- Material traceability (MTRs, heat numbers, charpy testing)
- Inspection hold points, witness points, third-party inspection
- Erection, temporary bracing, and connection design

When reviewing documents, you reason through them EXACTLY as an experienced structural steel professional would.`;

export default function RFIs() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [rfis, setRfis] = useState([]);
  const [projects, setProjects] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ project_id: '', bid_id: '', subject: '', description: '', priority: 'medium' });
  const [saving, setSaving] = useState(false);
  const [generatingNoticeId, setGeneratingNoticeId] = useState(null);
  const [bids, setBids] = useState([]);
  const [selectedRfi, setSelectedRfi] = useState(null);
  const [editingRfi, setEditingRfi] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [draftingResponse, setDraftingResponse] = useState(false);
  const [aiDraftUsed, setAiDraftUsed] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [statusChangeForm, setStatusChangeForm] = useState({ to: '', note: '', response: '' });
  const [savingStatusChange, setSavingStatusChange] = useState(false);
  const [historyRfi, setHistoryRfi] = useState(null);

  useEffect(() => { loadData(); }, []);

  // Deep link from the Salesman Dashboard's Recent RFIs widget ('/rfis?open=<id>').
  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId || rfis.length === 0) return;
    const match = rfis.find((r) => r.id === openId);
    if (match) { setSelectedRfi(match); setEditingRfi(false); }
  }, [searchParams, rfis]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [rfiData, projData, contractData, bidData] = await Promise.all([
        db.entities.RFI.list('-created_date', 100),
        db.entities.Project.filter({ is_archived: false }, 'name', 50),
        db.entities.Contract.list('-created_date', 100),
        db.entities.Bid.list('-created_date', 200),
      ]);
      setRfis(rfiData);
      setProjects(projData);
      setContracts(contractData);
      setBids(bidData);
    } catch (e) {} finally { setLoading(false); }
  };

  // Days elapsed past the contractually mandated RFI-response window for this
  // RFI's project's Contract (if one has been scanned in the Legal module) —
  // distinct from date_required, which is just a PM-set internal target date.
  const getContractDelinquency = (rfi) => {
    const contract = contracts.find(c => c.project_id === rfi.project_id);
    if (!contract?.rfi_response_window_days || !rfi.date_submitted || ['answered', 'closed', 'void'].includes(rfi.status)) {
      return { contract: null, daysDelayed: 0 };
    }
    const daysSinceSubmitted = Math.floor((new Date() - new Date(rfi.date_submitted)) / (1000 * 60 * 60 * 24));
    const daysDelayed = daysSinceSubmitted - contract.rfi_response_window_days;
    return { contract, daysDelayed: daysDelayed > 0 ? daysDelayed : 0 };
  };

  const handleGenerateDelayNotice = async (rfi) => {
    const { contract, daysDelayed } = getContractDelinquency(rfi);
    if (!contract || daysDelayed <= 0) return;
    setGeneratingNoticeId(rfi.id);
    try {
      const project = projects.find(p => p.id === rfi.project_id);
      const { blob, filename } = generateDelayImpactNoticePDF({ rfi, contract, daysDelayed, project });
      const file = new File([blob], filename, { type: 'application/pdf' });
      const { file_url } = await db.integrations.Core.UploadFile({ file });

      await db.entities.Document.create({
        project_id: rfi.project_id,
        name: filename,
        file_url,
        file_name: filename,
        file_size: blob.size,
        file_type: 'application/pdf',
        document_type: 'delay_notice',
        status: 'uploaded',
      });

      await db.entities.change_orders.create({
        project_id: rfi.project_id,
        change_order_id: `CO-DELAY-${rfi.rfi_number}`,
        description: `Schedule impact from unanswered ${rfi.rfi_number} (${rfi.subject}) — ${daysDelayed} day(s) beyond the contractual RFI response window. Delay Impact Notice attached as supporting legal evidence.`,
        cost_impact: 0,
        schedule_impact: daysDelayed,
        status: 'Pending Review',
        attachment_path: file_url,
      });

      await db.entities.LegalAuditEvent.create({
        project_id: rfi.project_id,
        event_type: 'delay_impact_notice_generated',
        related_entity_type: 'RFI',
        related_entity_id: rfi.id,
        description: `Delay Impact Notice generated for ${rfi.rfi_number} — ${daysDelayed} day(s) delayed beyond the contractual response window.`,
        severity: 'warning',
      });

      toast({ title: 'Delay Impact Notice generated', description: `Logged to the Change Order queue for ${project?.name || rfi.project_id}.` });
    } catch (e) {
      toast({ title: 'Unable to generate notice', variant: 'destructive' });
    } finally {
      setGeneratingNoticeId(null);
    }
  };

  const handleSave = async () => {
    if (!form.subject || !form.project_id) return;
    setSaving(true);
    try {
      const rfiCount = rfis.filter(r => r.project_id === form.project_id).length + 1;
      const createdAt = new Date().toISOString();
      const project = projects.find(p => p.id === form.project_id);
      const actorRole = resolveActorRole(user?.roles);
      const created = await db.entities.RFI.create({
        ...form,
        rfi_number: `RFI-${String(rfiCount).padStart(3,'0')}`,
        status: 'draft',
        date_submitted: createdAt.split('T')[0],
        created_by_role: actorRole,
        pending_salesman_response: actorRole !== 'salesman' && !!project?.salesman_id,
      });
      await logStatusChange({
        entityType: 'RFI',
        entityId: created.id,
        fieldName: 'status',
        fromValue: null,
        toValue: 'draft',
        changedBy: user?.full_name || user?.email || 'Unknown',
        note: 'RFI created.',
      });

      let recipientCount = 0;
      try {
        recipientCount = await dispatchRfiNotification(created, project, actorRole, user?.employee_id, user?.full_name || user?.email);
      } catch (notifyError) {}

      toast({ title: 'RFI created!', description: recipientCount > 0 ? `Notified ${recipientCount} teammate${recipientCount === 1 ? '' : 's'}.` : undefined });
      setOpen(false);
      setForm({ project_id: '', bid_id: '', subject: '', description: '', priority: 'medium' });
      loadData();
    } catch (e) {
      toast({ title: 'Error', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const startEditingRfi = () => {
    setEditForm({
      subject: selectedRfi.subject || '',
      priority: selectedRfi.priority || 'medium',
      assigned_to: selectedRfi.assigned_to || '',
      date_required: selectedRfi.date_required || '',
      date_answered: selectedRfi.date_answered || '',
      response: selectedRfi.response || '',
      csi_section: selectedRfi.csi_section || '',
      drawing_reference: selectedRfi.drawing_reference || '',
      spec_reference: selectedRfi.spec_reference || '',
      cost_impact: selectedRfi.cost_impact || 'none',
      schedule_impact: selectedRfi.schedule_impact || 'none',
      notes: selectedRfi.notes || '',
    });
    setAiDraftUsed(false);
    setEditingRfi(true);
  };

  const cancelEditingRfi = () => {
    setEditingRfi(false);
    setEditForm({
      subject: selectedRfi.subject || '',
      priority: selectedRfi.priority || 'medium',
      assigned_to: selectedRfi.assigned_to || '',
      date_required: selectedRfi.date_required || '',
      date_answered: selectedRfi.date_answered || '',
      response: selectedRfi.response || '',
      csi_section: selectedRfi.csi_section || '',
      drawing_reference: selectedRfi.drawing_reference || '',
      spec_reference: selectedRfi.spec_reference || '',
      cost_impact: selectedRfi.cost_impact || 'none',
      schedule_impact: selectedRfi.schedule_impact || 'none',
      notes: selectedRfi.notes || '',
    });
    setAiDraftUsed(false);
  };

  // Drafting assistance only — extracts nothing, changes nothing, submits
  // nothing. The model just proposes text into editForm.response exactly
  // like the user typing it themselves; the human still reviews, can edit
  // freely, and still clicks Save.
  const handleDraftAiResponse = async () => {
    if (!selectedRfi) return;
    setDraftingResponse(true);
    try {
      const prompt = `${STEEL_SYSTEM_PROMPT}

You are drafting a response to a Request for Information (RFI) on a structural steel project. Draft a professional, technically precise RFI response addressing the question raised. Cite the relevant drawing and/or spec references back if they were given. If you cannot determine a confident, technically sound answer from the information provided, say so plainly in the response instead of guessing — recommend who should weigh in (e.g. the Engineer of Record or the detailer) rather than fabricating a technical answer.

PROJECT: ${selectedRfiProject?.name || 'Unknown'} (${selectedRfiProject?.project_number || ''})
RFI SUBJECT: ${selectedRfi.subject || 'Not specified'}
RFI DESCRIPTION: ${selectedRfi.description || 'No description provided.'}
CSI SECTION: ${selectedRfi.csi_section || 'Not specified'}
DRAWING REFERENCE: ${selectedRfi.drawing_reference || 'Not specified'}
SPEC REFERENCE: ${selectedRfi.spec_reference || 'Not specified'}

Draft the response now.`;

      const response = await db.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            draft_response: { type: 'string' },
            confident: { type: 'boolean' },
          },
        },
      });

      const draftText = String(response?.draft_response || '').trim();
      if (!draftText) {
        toast({ title: 'AI did not return a draft', description: 'Try again, or draft the response manually.', variant: 'destructive' });
        return;
      }

      setEditForm(f => ({ ...f, response: draftText }));
      setAiDraftUsed(true);
      toast({
        title: 'Draft response ready',
        description: response?.confident === false ? 'AI flagged low confidence in this draft — review carefully before saving.' : 'Review and edit before saving.',
      });
    } catch (e) {
      toast({ title: 'Unable to draft response', description: e?.message || 'The AI draft failed unexpectedly.', variant: 'destructive' });
    } finally {
      setDraftingResponse(false);
    }
  };

  const handleSaveRfiEdit = async () => {
    if (!selectedRfi) return;
    setSavingEdit(true);
    try {
      // Transparency flag, not an accuracy claim — sticks whether the user
      // saves the draft verbatim or edits it first; either way AI assisted.
      const payload = aiDraftUsed ? { ...editForm, ai_generated: true } : { ...editForm };
      // A salesman saving a non-blank response clears the "needs my reply"
      // flag the Salesman Dashboard's Recent RFIs widget shows a Respond
      // button for.
      if (selectedRfi.pending_salesman_response && (editForm.response || '').trim()) {
        payload.pending_salesman_response = false;
      }
      const updated = await db.entities.RFI.update(selectedRfi.id, payload);
      setRfis(prev => prev.map(r => r.id === selectedRfi.id ? updated : r));
      setSelectedRfi(updated);
      setEditingRfi(false);
      toast({ title: 'RFI updated' });
    } catch (e) {
      toast({ title: 'Unable to save changes', variant: 'destructive' });
    } finally {
      setSavingEdit(false);
    }
  };

  const openChangeStatus = () => {
    setStatusChangeForm({ to: '', note: '', response: selectedRfi?.response || '' });
    setChangingStatus(true);
  };

  const pickStatusOption = (option) => {
    setStatusChangeForm(f => ({
      ...f,
      to: option.to,
      note: '',
      response: option.to === 'answered' ? (selectedRfi?.response || f.response || '') : f.response,
    }));
  };

  const handleChangeStatus = async () => {
    if (!selectedRfi || !statusChangeForm.to) return;
    const option = nextStatusOptions(selectedRfi.status).find(o => o.to === statusChangeForm.to);
    if (!option) return;
    if (option.requiresNote && !statusChangeForm.note.trim()) {
      toast({ title: 'A note is required for this change', description: 'Void and reopen transitions must explain why.', variant: 'destructive' });
      return;
    }
    if (statusChangeForm.to === 'answered' && !statusChangeForm.response.trim()) {
      toast({ title: 'Response text is required', description: 'Enter the RFI response before marking it Answered.', variant: 'destructive' });
      return;
    }
    setSavingStatusChange(true);
    try {
      const changedAt = new Date().toISOString();
      const fromStatus = selectedRfi.status;
      const payload = { status: statusChangeForm.to };
      if (statusChangeForm.to === 'answered') {
        payload.response = statusChangeForm.response.trim();
        payload.date_answered = changedAt.split('T')[0];
        if (selectedRfi.pending_salesman_response) payload.pending_salesman_response = false;
      }
      const updated = await db.entities.RFI.update(selectedRfi.id, payload);
      await logStatusChange({
        entityType: 'RFI',
        entityId: selectedRfi.id,
        fieldName: 'status',
        fromValue: fromStatus,
        toValue: statusChangeForm.to,
        changedBy: user?.full_name || user?.email || 'Unknown',
        note: statusChangeForm.note.trim(),
      });
      setRfis(prev => prev.map(r => r.id === selectedRfi.id ? updated : r));
      setSelectedRfi(updated);
      setChangingStatus(false);
      toast({ title: `Status changed to ${RFI_STATUS_LABELS[statusChangeForm.to] || statusChangeForm.to}` });
    } catch (e) {
      toast({ title: 'Unable to change status', variant: 'destructive' });
    } finally {
      setSavingStatusChange(false);
    }
  };

  const filtered = rfis.filter(r => {
    const matchSearch = !search || r.subject?.toLowerCase().includes(search.toLowerCase()) || r.rfi_number?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const PRIORITY_COLORS = { low: 'text-gray-400', medium: 'text-yellow-500', high: 'text-orange-500', critical: 'text-red-500' };
  const IMPACT_OPTIONS = ['none', 'potential', 'confirmed'];
  const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  const selectedRfiProject = selectedRfi ? projects.find(p => p.id === selectedRfi.project_id) : null;

  const stats = {
    total: rfis.length,
    open: rfis.filter(r => ['submitted','under_review'].includes(r.status)).length,
    answered: rfis.filter(r => r.status === 'answered').length,
    overdue: rfis.filter(isRfiOverdue).length,
  };

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="RFIs"
        subtitle="Requests for Information across all projects"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="steel-gradient text-white border-0"><Plus className="w-4 h-4 mr-2" />New RFI</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create RFI</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div>
                  <Label>Project *</Label>
                  <Select value={form.project_id} onValueChange={v => setForm(f => ({ ...f, project_id: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select project" /></SelectTrigger>
                    <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Estimate / Bid</Label>
                  <Select value={form.bid_id} onValueChange={v => setForm(f => ({ ...f, bid_id: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Link to an estimate (optional)" /></SelectTrigger>
                    <SelectContent>{bids.map(b => <SelectItem key={b.id} value={b.id}>{b.bid_number} — {b.job_name || 'Untitled Bid'}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Subject *</Label><Input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} className="mt-1" /></div>
                <div>
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{['low','medium','high','critical'].map(p => <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="mt-1" rows={4} /></div>
                <Button onClick={handleSave} disabled={saving || !form.subject || !form.project_id} className="w-full steel-gradient text-white border-0">
                  {saving ? 'Creating...' : 'Create RFI'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total RFIs', value: stats.total, icon: MessageSquare, color: 'text-blue-500' },
          { label: 'Open', value: stats.open, icon: Clock, color: 'text-orange-500' },
          { label: 'Answered', value: stats.answered, icon: CheckCircle2, color: 'text-green-500' },
          { label: 'Overdue', value: stats.overdue, icon: AlertCircle, color: 'text-red-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search RFIs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            {RFI_STATUS_FILTER_OPTIONS.map(s => (
              <SelectItem key={s} value={s}>{s === 'all' ? 'All Statuses' : (RFI_STATUS_LABELS[s] || s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 steel-card">
            <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No RFIs found</p>
          </div>
        ) : (
          filtered.map(r => {
            const proj = projects.find(p => p.id === r.project_id);
            const linkedBid = bids.find(b => b.id === r.bid_id);
            const isOverdue = isRfiOverdue(r);
            const daysOpen = daysRfiOpen(r);
            const { daysDelayed } = getContractDelinquency(r);
            const isContractuallyDelinquent = daysDelayed > 0;
            return (
              <div
                key={r.id}
                onClick={() => { setSelectedRfi(r); setEditingRfi(false); }}
                className={`steel-card p-4 border-l-4 cursor-pointer hover:bg-muted/50 transition-colors ${isContractuallyDelinquent ? 'border-l-red-600' : isOverdue ? 'border-l-red-500' : r.priority === 'critical' ? 'border-l-red-400' : r.priority === 'high' ? 'border-l-orange-400' : 'border-l-blue-400'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-mono font-bold text-primary">{r.rfi_number}</span>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setHistoryRfi(r); }} className="cursor-pointer">
                        <StatusBadge status={r.status} label={RFI_STATUS_LABELS[r.status]} />
                      </button>
                      <span className={`text-xs font-medium ${PRIORITY_COLORS[r.priority]}`}>{r.priority?.toUpperCase()}</span>
                      {isOverdue && <span className="text-xs bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full">OVERDUE</span>}
                      {isContractuallyDelinquent && <span className="text-xs bg-red-600/10 text-red-600 px-2 py-0.5 rounded-full font-medium">{daysDelayed}d PAST CONTRACT WINDOW</span>}
                    </div>
                    <p className="font-medium text-sm">{r.subject}</p>
                    {proj && <p className="text-xs text-muted-foreground mt-1">{proj.project_number} — {proj.name}</p>}
                    {linkedBid && <p className="text-xs text-muted-foreground mt-0.5">Estimate: {linkedBid.bid_number}</p>}
                    <p className="text-xs text-muted-foreground mt-1">
                      {daysOpen != null && <span>{daysOpen}d open</span>}
                      {daysOpen != null && r.date_required && <span> • </span>}
                      {r.date_required && <span>Required by: {r.date_required}</span>}
                    </p>
                  </div>
                  {isContractuallyDelinquent && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-500/30 hover:bg-red-500/10 flex-shrink-0"
                      disabled={generatingNoticeId === r.id}
                      onClick={(e) => { e.stopPropagation(); handleGenerateDelayNotice(r); }}
                    >
                      <FileWarning className="w-3.5 h-3.5 mr-1.5" />
                      {generatingNoticeId === r.id ? 'Generating…' : 'Generate Delay Impact Notice'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <Dialog open={!!selectedRfi} onOpenChange={(o) => { if (!o) { setSelectedRfi(null); setEditingRfi(false); setAiDraftUsed(false); setChangingStatus(false); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedRfi && !editingRfi && !changingStatus && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-primary">{selectedRfi.rfi_number}</span>
                  <span>{selectedRfi.subject}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => setHistoryRfi(selectedRfi)} className="cursor-pointer">
                  <StatusBadge status={selectedRfi.status} label={RFI_STATUS_LABELS[selectedRfi.status]} />
                </button>
                <span className={`text-xs font-medium ${PRIORITY_COLORS[selectedRfi.priority]}`}>{selectedRfi.priority?.toUpperCase()}</span>
                {selectedRfi.ai_generated && <span className="text-xs bg-purple-500/10 text-purple-500 px-2 py-0.5 rounded-full font-medium">AI GENERATED</span>}
                {isRfiOverdue(selectedRfi) && <span className="text-xs bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full">OVERDUE</span>}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Project', value: selectedRfiProject ? `${selectedRfiProject.project_number} — ${selectedRfiProject.name}` : '—' },
                  { label: 'Days Open', value: daysRfiOpen(selectedRfi) != null ? `${daysRfiOpen(selectedRfi)} day(s)` : '—' },
                  { label: 'Date Submitted', value: selectedRfi.date_submitted || '—' },
                  { label: 'Date Required', value: selectedRfi.date_required || '—' },
                  { label: 'Date Answered', value: selectedRfi.date_answered || '—' },
                  { label: 'Submitted By', value: selectedRfi.submitted_by || '—' },
                  { label: 'Assigned To', value: selectedRfi.assigned_to || '—' },
                  { label: 'CSI Section', value: selectedRfi.csi_section || '—' },
                  { label: 'Drawing Reference', value: selectedRfi.drawing_reference || '—' },
                  { label: 'Spec Reference', value: selectedRfi.spec_reference || '—' },
                  { label: 'Cost Impact', value: capitalize(selectedRfi.cost_impact || 'none') },
                  { label: 'Schedule Impact', value: capitalize(selectedRfi.schedule_impact || 'none') },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium">{value}</p>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Description</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">{selectedRfi.description || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Response</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">{selectedRfi.response || 'No response yet'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">{selectedRfi.notes || 'No notes'}</p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setSelectedRfi(null)}>Close</Button>
                <Button variant="outline" onClick={openChangeStatus}>Change Status</Button>
                <Button onClick={startEditingRfi} className="steel-gradient text-white border-0">Edit</Button>
              </div>
            </>
          )}

          {selectedRfi && changingStatus && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-primary">{selectedRfi.rfi_number}</span>
                  <span className="text-sm text-muted-foreground font-normal">Change Status</span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Current status:</span>
                  <StatusBadge status={selectedRfi.status} label={RFI_STATUS_LABELS[selectedRfi.status]} />
                </div>

                <div>
                  <Label>New Status</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {nextStatusOptions(selectedRfi.status).map(option => (
                      <Button
                        key={option.to}
                        type="button"
                        size="sm"
                        variant={statusChangeForm.to === option.to ? 'default' : 'outline'}
                        className={statusChangeForm.to === option.to ? 'steel-gradient text-white border-0' : ''}
                        onClick={() => pickStatusOption(option)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {statusChangeForm.to === 'answered' && (
                  <div>
                    <Label>Response *</Label>
                    <Textarea
                      value={statusChangeForm.response}
                      onChange={e => setStatusChangeForm(f => ({ ...f, response: e.target.value }))}
                      className="mt-1"
                      rows={4}
                      placeholder="Enter the RFI response — required to mark this Answered."
                    />
                  </div>
                )}

                {statusChangeForm.to && (
                  <div>
                    <Label>
                      Note {nextStatusOptions(selectedRfi.status).find(o => o.to === statusChangeForm.to)?.requiresNote ? '*' : '(optional)'}
                    </Label>
                    <Textarea
                      value={statusChangeForm.note}
                      onChange={e => setStatusChangeForm(f => ({ ...f, note: e.target.value }))}
                      className="mt-1"
                      rows={2}
                      placeholder={nextStatusOptions(selectedRfi.status).find(o => o.to === statusChangeForm.to)?.requiresNote
                        ? 'Required — explain why this RFI is being voided or reopened.'
                        : 'Optional context for this status change.'}
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
                    disabled={!statusChangeForm.to || savingStatusChange}
                    className="steel-gradient text-white border-0"
                  >
                    {savingStatusChange ? 'Saving…' : 'Confirm Change'}
                  </Button>
                </div>
              </div>
            </>
          )}

          {selectedRfi && editingRfi && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-primary">{selectedRfi.rfi_number}</span>
                  <span className="text-sm text-muted-foreground font-normal">Edit RFI</span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <div>
                  <Label>Subject</Label>
                  <Input value={editForm.subject} onChange={e => setEditForm(f => ({ ...f, subject: e.target.value }))} className="mt-1" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Priority</Label>
                    <Select value={editForm.priority} onValueChange={v => setEditForm(f => ({ ...f, priority: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['low','medium','high','critical'].map(p => <SelectItem key={p} value={p}>{capitalize(p)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Assigned To</Label>
                    <Input value={editForm.assigned_to} onChange={e => setEditForm(f => ({ ...f, assigned_to: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label>Date Required</Label>
                    <Input type="date" value={editForm.date_required} onChange={e => setEditForm(f => ({ ...f, date_required: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label>Date Answered</Label>
                    <Input type="date" value={editForm.date_answered} onChange={e => setEditForm(f => ({ ...f, date_answered: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label>CSI Section</Label>
                    <Input value={editForm.csi_section} onChange={e => setEditForm(f => ({ ...f, csi_section: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label>Drawing Reference</Label>
                    <Input value={editForm.drawing_reference} onChange={e => setEditForm(f => ({ ...f, drawing_reference: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label>Spec Reference</Label>
                    <Input value={editForm.spec_reference} onChange={e => setEditForm(f => ({ ...f, spec_reference: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label>Cost Impact</Label>
                    <Select value={editForm.cost_impact} onValueChange={v => setEditForm(f => ({ ...f, cost_impact: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {IMPACT_OPTIONS.map(o => <SelectItem key={o} value={o}>{capitalize(o)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Schedule Impact</Label>
                    <Select value={editForm.schedule_impact} onValueChange={v => setEditForm(f => ({ ...f, schedule_impact: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {IMPACT_OPTIONS.map(o => <SelectItem key={o} value={o}>{capitalize(o)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <Label>Response</Label>
                    {['submitted', 'under_review'].includes(selectedRfi.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={handleDraftAiResponse}
                        disabled={draftingResponse}
                      >
                        <Sparkles className="w-3.5 h-3.5" />{draftingResponse ? 'Drafting…' : 'Draft Response with AI'}
                      </Button>
                    )}
                  </div>
                  <Textarea value={editForm.response} onChange={e => setEditForm(f => ({ ...f, response: e.target.value }))} className="mt-1" rows={3} />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} className="mt-1" rows={2} />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={cancelEditingRfi}>Cancel</Button>
                  <Button onClick={handleSaveRfiEdit} disabled={savingEdit} className="steel-gradient text-white border-0">
                    {savingEdit ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <StatusHistoryModal
        open={!!historyRfi}
        onOpenChange={(o) => !o && setHistoryRfi(null)}
        entityType="RFI"
        entityId={historyRfi?.id}
        fieldName="status"
        title={historyRfi ? `${historyRfi.rfi_number} — Status History` : 'Status History'}
      />
    </div>
  );
}