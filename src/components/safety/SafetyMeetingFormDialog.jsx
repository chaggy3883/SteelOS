import React, { useState } from 'react';
import { db } from '@/api/apiClient';
import { saveDocumentRecords } from '@/lib/inspectionDocumentStore';
import { Brain, RefreshCw, CheckCircle2, X, UserPlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import InspectionDocumentUpload from '@/components/shared/InspectionDocumentUpload';
import EmployeeMultiSelect from '@/components/safety/EmployeeMultiSelect';

export const MEETING_TYPES = [
  { value: 'toolbox_talk', label: 'Toolbox Talk' },
  { value: 'orientation', label: 'Orientation' },
  { value: 'incident_review', label: 'Incident Review' },
  { value: 'monthly', label: 'Monthly Safety Meeting' },
];

const emptyForm = () => ({
  meeting_date: new Date().toISOString().slice(0, 10),
  meeting_type: 'toolbox_talk',
  topic: '',
  location: '',
  project_id: '',
  presenter_name: '',
  content: '',
});

const toDocumentRef = ({ id, filename, mimetype, size, uploadDate }) => ({ id, filename, mimetype, size, uploadDate });

const TALK_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    hazards: { type: 'array', items: { type: 'string' } },
    controls: { type: 'array', items: { type: 'string' } },
    osha_reference: { type: 'string' },
    discussion_questions: { type: 'array', items: { type: 'string' } },
  },
};

const buildTalkPrompt = (topic) => `You are a construction safety trainer preparing a weekly toolbox talk for a structural steel fabrication and erection crew. Topic: "${topic}".
Produce:
- 3 to 6 specific hazards a crew would realistically face related to this topic
- 3 to 6 practical controls or mitigations for those hazards
- the single most relevant OSHA 29 CFR 1926 reference (a short citation, e.g. "1926.501(b)(1)")
- 3 to 5 open discussion questions to engage the crew in conversation
Keep every item concise — one sentence each. Leave a field empty rather than guessing if you can't produce a confident answer.`;

// Builds the human-readable draft text the presenter reviews/edits before
// accepting — never anything the caller writes to the record directly.
const buildDraftText = (topic, response) => {
  const hazards = Array.isArray(response?.hazards) ? response.hazards.map(String).filter(Boolean) : [];
  const controls = Array.isArray(response?.controls) ? response.controls.map(String).filter(Boolean) : [];
  const questions = Array.isArray(response?.discussion_questions) ? response.discussion_questions.map(String).filter(Boolean) : [];
  const oshaRef = String(response?.osha_reference || '').trim();
  const hasStructuredContent = hazards.length > 0 || controls.length > 0 || questions.length > 0 || oshaRef;

  if (hasStructuredContent) {
    return [
      `Topic: ${topic}`,
      '',
      'Hazards:',
      ...(hazards.length ? hazards.map((h) => `- ${h}`) : ['- (none identified — add manually)']),
      '',
      'Controls:',
      ...(controls.length ? controls.map((c) => `- ${c}`) : ['- (none identified — add manually)']),
      '',
      oshaRef ? `OSHA Reference: ${oshaRef}` : 'OSHA Reference: (not identified — add manually)',
      '',
      'Discussion Questions:',
      ...(questions.length ? questions.map((q) => `- ${q}`) : ['- (none identified — add manually)']),
    ].join('\n');
  }

  // Local/no-proxy fallback (see localData.js InvokeLLM) only ever echoes
  // {content, summary} — still surfaced in the review pane rather than
  // silently discarded, so the presenter always has something to react to.
  const fallback = String(response?.content || response?.summary || '').trim();
  return fallback || `Topic: ${topic}\n\n(AI could not generate content for this topic — write the talk manually below.)`;
};

// Create-Meeting form: date/type/topic/location/project/presenter, an
// optional AI-drafted talk outline that requires explicit review + accept
// before it lands in `content`, an attendee sign-in roster (employees +
// free-text guests), and document attachments for scanned sign-in sheets.
// Nothing under db.entities is touched until Log Meeting is clicked.
export default function SafetyMeetingFormDialog({ open, onOpenChange, projects = [], employees = [], onCreated }) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm());
  const [generating, setGenerating] = useState(false);
  const [aiDraft, setAiDraft] = useState(null);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);
  const [guestInput, setGuestInput] = useState('');
  const [guests, setGuests] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  const activeEmployees = employees.filter((e) => e.is_active_login !== false);
  const notYetMarked = activeEmployees.filter((e) => !selectedEmployeeIds.includes(e.id));
  const attendanceCount = selectedEmployeeIds.length + guests.length;

  const resetAndClose = () => {
    setForm(emptyForm());
    setAiDraft(null);
    setSelectedEmployeeIds([]);
    setGuestInput('');
    setGuests([]);
    setPendingFiles([]);
    onOpenChange(false);
  };

  const handleGenerateTalk = async () => {
    if (!form.topic.trim()) {
      toast({ title: 'Enter a topic first', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const response = await db.integrations.Core.InvokeLLM({
        prompt: buildTalkPrompt(form.topic.trim()),
        response_json_schema: TALK_RESPONSE_SCHEMA,
      });
      setAiDraft(buildDraftText(form.topic.trim(), response));
      toast({ title: 'Talk outline generated', description: 'Review and edit it below, then Accept — nothing is saved yet.' });
    } catch (e) {
      toast({ title: 'Unable to generate talk content', description: e?.message || undefined, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const acceptAiDraft = () => {
    setForm((f) => ({ ...f, content: aiDraft }));
    setAiDraft(null);
    toast({ title: 'AI content accepted into the meeting record' });
  };

  const addGuest = () => {
    const name = guestInput.trim();
    if (!name) return;
    setGuests((g) => [...g, name]);
    setGuestInput('');
  };

  const removeGuest = (index) => setGuests((g) => g.filter((_, i) => i !== index));

  const handleSave = async () => {
    if (!form.meeting_date) {
      toast({ title: 'Meeting date is required', variant: 'destructive' });
      return;
    }
    if (!form.topic.trim()) {
      toast({ title: 'Topic is required', variant: 'destructive' });
      return;
    }
    if (!form.presenter_name.trim()) {
      toast({ title: 'Presenter name is required', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const employeeAttendees = employees
        .filter((e) => selectedEmployeeIds.includes(e.id))
        .map((e) => ({ employee_id: e.id, name: e.full_name }));
      const guestAttendees = guests.map((name) => ({ employee_id: null, name }));

      const created = await db.entities.SafetyMeeting.create({
        meeting_date: form.meeting_date,
        meeting_type: form.meeting_type,
        topic: form.topic.trim(),
        location: form.location.trim(),
        project_id: form.project_id || '',
        presenter_name: form.presenter_name.trim(),
        content: form.content.trim(),
        attendees: [...employeeAttendees, ...guestAttendees],
        documents: [],
      });

      if (pendingFiles.length > 0) {
        const storageKey = `safety_meeting_documents_${created.id}`;
        const documents = pendingFiles.map((f) => ({ ...f, uploadDate: new Date().toISOString() }));
        await saveDocumentRecords(storageKey, documents);
        await db.entities.SafetyMeeting.update(created.id, { documents: documents.map(toDocumentRef) });
        created.documents = documents.map(toDocumentRef);
      }

      toast({ title: 'Safety meeting logged' });
      onCreated?.(created);
      resetAndClose();
    } catch (e) {
      toast({ title: 'Unable to log safety meeting', description: e?.message || undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetAndClose(); else onOpenChange(true); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Log Safety Meeting</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Meeting Date <span className="text-red-500">*</span></Label>
              <Input type="date" value={form.meeting_date} onChange={(e) => setForm((f) => ({ ...f, meeting_date: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Meeting Type</Label>
              <Select value={form.meeting_type} onValueChange={(v) => setForm((f) => ({ ...f, meeting_type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{MEETING_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Topic <span className="text-red-500">*</span></Label>
              <Input value={form.topic} onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))} placeholder="e.g. Fall Protection at Height" className="mt-1" />
            </div>
            <div>
              <Label>Location</Label>
              <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="e.g. Jobsite trailer, shop floor" className="mt-1" />
            </div>
            <div>
              <Label>Project (optional)</Label>
              <Select value={form.project_id} onValueChange={(v) => setForm((f) => ({ ...f, project_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="No specific project" /></SelectTrigger>
                <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Presenter Name <span className="text-red-500">*</span></Label>
              <Input value={form.presenter_name} onChange={(e) => setForm((f) => ({ ...f, presenter_name: e.target.value }))} className="mt-1" />
            </div>
          </div>

          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Label className="text-sm">Meeting Content</Label>
              <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={generating} onClick={handleGenerateTalk}>
                {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                {generating ? 'Generating…' : 'Generate Talk (AI)'}
              </Button>
            </div>

            {aiDraft !== null && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <p className="text-xs text-primary font-medium">AI draft — review and edit before accepting. Nothing is saved yet.</p>
                <Textarea value={aiDraft} onChange={(e) => setAiDraft(e.target.value)} rows={8} className="text-sm font-mono" />
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setAiDraft(null)}>Discard</Button>
                  <Button type="button" size="sm" className="gap-1.5 steel-gradient text-white border-0" onClick={acceptAiDraft}>
                    <CheckCircle2 className="w-3.5 h-3.5" />Accept &amp; Use This Content
                  </Button>
                </div>
              </div>
            )}

            <Textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="Write the talk content directly, or generate a draft above and accept it into this field."
              rows={6}
              className="text-sm"
            />
          </div>

          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Sign-In / Attendance</Label>
              <Badge variant="secondary">{attendanceCount} attendee{attendanceCount === 1 ? '' : 's'}</Badge>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Employees</Label>
              <div className="mt-1">
                <EmployeeMultiSelect employees={employees} selectedIds={selectedEmployeeIds} onChange={setSelectedEmployeeIds} disabled={saving} />
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Visitors / Subcontractors (not in the system)</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={guestInput}
                  onChange={(e) => setGuestInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addGuest(); } }}
                  placeholder="Type a name and press Enter"
                  disabled={saving}
                />
                <Button type="button" variant="outline" size="icon" onClick={addGuest} disabled={saving}><UserPlus className="w-4 h-4" /></Button>
              </div>
              {guests.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {guests.map((name, i) => (
                    <Badge key={`${name}-${i}`} variant="outline" className="gap-1 pr-1">
                      {name}
                      <button type="button" onClick={() => removeGuest(i)} className="ml-0.5 rounded-full hover:bg-muted-foreground/20"><X className="w-3 h-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {notYetMarked.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {notYetMarked.length} of {activeEmployees.length} active employees not yet marked present.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-border p-3">
            <Label className="text-sm mb-2 block">Attach Documents (e.g. scanned paper sign-in sheet)</Label>
            <InspectionDocumentUpload pendingFiles={pendingFiles} onPendingFilesChange={setPendingFiles} savedDocuments={[]} disabled={saving} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0 gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? 'Saving…' : 'Log Meeting'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
