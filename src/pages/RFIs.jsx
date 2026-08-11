import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
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

  useEffect(() => { loadData(); }, []);

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
    if (!contract?.rfi_response_window_days || !rfi.date_submitted || ['answered', 'closed'].includes(rfi.status)) {
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
      await db.entities.RFI.create({ ...form, rfi_number: `RFI-${String(rfiCount).padStart(3,'0')}`, status: 'draft', date_submitted: new Date().toISOString().split('T')[0] });
      toast({ title: 'RFI created!' });
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
      status: selectedRfi.status || 'draft',
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
      status: selectedRfi.status || 'draft',
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
      const payload = aiDraftUsed ? { ...editForm, ai_generated: true } : editForm;
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
    overdue: rfis.filter(r => r.date_required && new Date(r.date_required) < new Date() && r.status !== 'closed').length,
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
            {['all','draft','submitted','under_review','answered','closed'].map(s => (
              <SelectItem key={s} value={s}>{s === 'all' ? 'All Statuses' : s.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</SelectItem>
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
            const isOverdue = r.date_required && new Date(r.date_required) < new Date() && r.status !== 'closed';
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
                      <StatusBadge status={r.status} />
                      <span className={`text-xs font-medium ${PRIORITY_COLORS[r.priority]}`}>{r.priority?.toUpperCase()}</span>
                      {isOverdue && <span className="text-xs bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full">OVERDUE</span>}
                      {isContractuallyDelinquent && <span className="text-xs bg-red-600/10 text-red-600 px-2 py-0.5 rounded-full font-medium">{daysDelayed}d PAST CONTRACT WINDOW</span>}
                    </div>
                    <p className="font-medium text-sm">{r.subject}</p>
                    {proj && <p className="text-xs text-muted-foreground mt-1">{proj.project_number} — {proj.name}</p>}
                    {linkedBid && <p className="text-xs text-muted-foreground mt-0.5">Estimate: {linkedBid.bid_number}</p>}
                    {r.date_required && <p className="text-xs text-muted-foreground mt-1">Required by: {r.date_required}</p>}
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

      <Dialog open={!!selectedRfi} onOpenChange={(o) => { if (!o) { setSelectedRfi(null); setEditingRfi(false); setAiDraftUsed(false); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedRfi && !editingRfi && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-primary">{selectedRfi.rfi_number}</span>
                  <span>{selectedRfi.subject}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={selectedRfi.status} />
                <span className={`text-xs font-medium ${PRIORITY_COLORS[selectedRfi.priority]}`}>{selectedRfi.priority?.toUpperCase()}</span>
                {selectedRfi.ai_generated && <span className="text-xs bg-purple-500/10 text-purple-500 px-2 py-0.5 rounded-full font-medium">AI GENERATED</span>}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Project', value: selectedRfiProject ? `${selectedRfiProject.project_number} — ${selectedRfiProject.name}` : '—' },
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
                <Button onClick={startEditingRfi} className="steel-gradient text-white border-0">Edit</Button>
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
                    <Label>Status</Label>
                    <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['draft','submitted','under_review','answered','closed'].map(s => (
                          <SelectItem key={s} value={s}>{s.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
    </div>
  );
}