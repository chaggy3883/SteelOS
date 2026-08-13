import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { createDisciplinaryDocumentId, saveDisciplinaryDocument, getDisciplinaryDocument } from '@/lib/disciplinaryDocumentStore';
import { downloadFile } from '@/lib/downloadFile';
import { Printer, Save, Upload, Download, Eye, FileCheck2, History, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import FileDropzone from '@/components/ui/FileDropzone';
import { useToast } from '@/components/ui/use-toast';

export const ACTION_LEVELS = [
  { value: 'verbal_warning', label: 'Verbal Warning' },
  { value: 'written_warning', label: 'Written Warning' },
  { value: 'final_warning', label: 'Final Warning' },
  { value: 'suspension', label: 'Suspension' },
  { value: 'termination', label: 'Termination' },
];

export const STATUS_LABELS = { draft: 'Draft', printed: 'Printed — Awaiting Signatures', signed_filed: 'Signed & Filed' };
export const STATUS_COLORS = {
  draft: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  printed: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  signed_filed: 'bg-green-500/10 text-green-600 border-green-500/20',
};

const emptyForm = (defaultEmployeeId = '') => ({
  employee_id: defaultEmployeeId,
  action_date: new Date().toISOString().slice(0, 10),
  action_level: 'verbal_warning',
  incident_date: new Date().toISOString().slice(0, 10),
  incident_description: '',
  policy_violated: '',
  prior_actions_referenced: '',
  corrective_action_required: '',
  consequences_if_repeated: '',
  supervisor_name: '',
  witness_name: '',
  employee_statement: '',
});

const formFromRecord = (record) => ({
  employee_id: record.employee_id || '',
  action_date: record.action_date || new Date().toISOString().slice(0, 10),
  action_level: record.action_level || 'verbal_warning',
  incident_date: record.incident_date || '',
  incident_description: record.incident_description || '',
  policy_violated: record.policy_violated || '',
  prior_actions_referenced: record.prior_actions_referenced || '',
  corrective_action_required: record.corrective_action_required || '',
  consequences_if_repeated: record.consequences_if_repeated || '',
  supervisor_name: record.supervisor_name || '',
  witness_name: record.witness_name || '',
  employee_statement: record.employee_statement || '',
});

// Fill-on-screen -> print-for-wet-signatures -> file-the-signed-scan
// disciplinary action workflow. Distinct from EmployeeFilesPanel.jsx's
// free-form "attach any document" flow: this is a structured record with its
// own fields, its own progressive-discipline history pull, and its own
// print/signature/file lifecycle (draft -> printed -> signed_filed).
// Editable until signed_filed; locked (read-only) after that.
export default function DisciplinaryActionDialog({ open, onOpenChange, employees = [], defaultEmployeeId = '', record = null, onSaved }) {
  const { toast } = useToast();
  const [company, setCompany] = useState(null);
  const [form, setForm] = useState(emptyForm(defaultEmployeeId));
  const [savedRecord, setSavedRecord] = useState(record);
  const [priorActions, setPriorActions] = useState([]);
  const [expandedPriorId, setExpandedPriorId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [signedFile, setSignedFile] = useState(null);
  const [filing, setFiling] = useState(false);
  const [signedDocUrl, setSignedDocUrl] = useState(null);
  const [loadingSignedDoc, setLoadingSignedDoc] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(record ? formFromRecord(record) : emptyForm(defaultEmployeeId));
    setSavedRecord(record);
    setSignedFile(null);
    setSignedDocUrl(null);
    getEffectiveCompany().then(setCompany).catch(() => setCompany(null));
  }, [open, record?.id, defaultEmployeeId]);

  useEffect(() => {
    if (!open || !form.employee_id) { setPriorActions([]); return; }
    db.entities.DisciplinaryAction.filter({ employee_id: form.employee_id }, '-action_date', 50)
      .then((rows) => setPriorActions(rows.filter((r) => r.id !== savedRecord?.id)))
      .catch(() => setPriorActions([]));
  }, [open, form.employee_id, savedRecord?.id]);

  const selectedEmployee = employees.find((e) => e.id === form.employee_id);
  const isLocked = savedRecord?.status === 'signed_filed';
  const isExistingRecord = !!savedRecord;

  const selectEmployee = (employeeId) => {
    const emp = employees.find((e) => e.id === employeeId);
    setForm((f) => ({ ...f, employee_id: employeeId, supervisor_name: f.supervisor_name || emp?.supervisor_name || '' }));
  };

  const buildPayload = () => ({
    employee_id: form.employee_id,
    action_date: form.action_date,
    action_level: form.action_level,
    incident_date: form.incident_date,
    incident_description: form.incident_description.trim(),
    policy_violated: form.policy_violated.trim(),
    prior_actions_referenced: form.prior_actions_referenced.trim(),
    corrective_action_required: form.corrective_action_required.trim(),
    consequences_if_repeated: form.consequences_if_repeated.trim(),
    supervisor_name: form.supervisor_name.trim(),
    witness_name: form.witness_name.trim(),
    employee_statement: form.employee_statement.trim(),
  });

  const validate = () => {
    if (!form.employee_id) { toast({ title: 'Select an employee', variant: 'destructive' }); return false; }
    if (!form.action_date) { toast({ title: 'Action date is required', variant: 'destructive' }); return false; }
    if (!form.incident_date) { toast({ title: 'Incident date is required', variant: 'destructive' }); return false; }
    if (!form.incident_description.trim()) { toast({ title: 'Incident description is required', variant: 'destructive' }); return false; }
    if (!form.supervisor_name.trim()) { toast({ title: 'Supervisor name is required', variant: 'destructive' }); return false; }
    return true;
  };

  const persist = async (statusOverride) => {
    const payload = buildPayload();
    const result = savedRecord
      ? await db.entities.DisciplinaryAction.update(savedRecord.id, { ...payload, ...(statusOverride ? { status: statusOverride } : {}) })
      : await db.entities.DisciplinaryAction.create({ ...payload, status: statusOverride || 'draft', signed_document: null });
    setSavedRecord(result);
    onSaved?.(result);
    return result;
  };

  const handleSaveDraft = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await persist();
      toast({ title: 'Draft saved' });
    } catch (e) {
      toast({ title: 'Unable to save draft', description: e?.message || undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await persist('printed');
      toast({ title: 'Marked printed', description: 'Collect wet signatures, then file the signed scan below.' });
      // Let the just-saved values commit to the print block's DOM before the
      // browser snapshots the page for printing.
      setTimeout(() => window.print(), 50);
    } catch (e) {
      toast({ title: 'Unable to save before printing', description: e?.message || undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleFileSignedCopy = async () => {
    if (!signedFile || !savedRecord) return;
    setFiling(true);
    try {
      const key = `disciplinary_signed_document_${savedRecord.id}`;
      await saveDisciplinaryDocument(key, signedFile);
      const signed_document = {
        id: createDisciplinaryDocumentId(),
        filename: signedFile.name,
        mimetype: signedFile.type,
        size: signedFile.size,
        uploadDate: new Date().toISOString(),
      };
      const updated = await db.entities.DisciplinaryAction.update(savedRecord.id, { signed_document, status: 'signed_filed' });
      setSavedRecord(updated);
      onSaved?.(updated);
      setSignedFile(null);
      toast({ title: 'Signed copy filed', description: 'This record is now locked.' });
    } catch (e) {
      toast({ title: 'Unable to file signed copy', description: e?.message || undefined, variant: 'destructive' });
    } finally {
      setFiling(false);
    }
  };

  const viewSignedDoc = async () => {
    if (!savedRecord?.signed_document) return;
    setLoadingSignedDoc(true);
    try {
      const url = await getDisciplinaryDocument(`disciplinary_signed_document_${savedRecord.id}`);
      setSignedDocUrl(url);
      if (url) window.open(url, '_blank', 'noopener');
    } finally {
      setLoadingSignedDoc(false);
    }
  };

  const downloadSignedDoc = async () => {
    if (!savedRecord?.signed_document) return;
    const url = signedDocUrl || (await getDisciplinaryDocument(`disciplinary_signed_document_${savedRecord.id}`));
    if (!url) { toast({ title: 'Signed document not found on this device', variant: 'destructive' }); return; }
    setSignedDocUrl(url);
    downloadFile(url, savedRecord.signed_document.filename || 'signed-disciplinary-action');
  };

  const levelLabel = (value) => ACTION_LEVELS.find((l) => l.value === value)?.label || value;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>Disciplinary Action</span>
            {savedRecord && <Badge className={STATUS_COLORS[savedRecord.status]}>{STATUS_LABELS[savedRecord.status] || savedRecord.status}</Badge>}
            {isLocked && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="w-3 h-3" />Locked</span>}
          </DialogTitle>
        </DialogHeader>

        {/* ---- On-screen fill form (hidden when printing) ---- */}
        <div className="print:hidden space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Employee <span className="text-red-500">*</span></Label>
              <Select value={form.employee_id} onValueChange={selectEmployee} disabled={isLocked || isExistingRecord}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select an employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>#{e.employee_number} — {e.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Action Level <span className="text-red-500">*</span></Label>
              <Select value={form.action_level} onValueChange={(v) => setForm((f) => ({ ...f, action_level: v }))} disabled={isLocked}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{ACTION_LEVELS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Action Date <span className="text-red-500">*</span></Label>
              <Input type="date" value={form.action_date} onChange={(e) => setForm((f) => ({ ...f, action_date: e.target.value }))} disabled={isLocked} className="mt-1" />
            </div>
            <div>
              <Label>Incident Date <span className="text-red-500">*</span></Label>
              <Input type="date" value={form.incident_date} onChange={(e) => setForm((f) => ({ ...f, incident_date: e.target.value }))} disabled={isLocked} className="mt-1" />
            </div>
          </div>

          {priorActions.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />Progressive Discipline History ({priorActions.length} prior action{priorActions.length === 1 ? '' : 's'})
              </p>
              <div className="space-y-1.5">
                {priorActions.map((a) => (
                  <div key={a.id} className="rounded-md border border-border bg-background">
                    <button
                      type="button"
                      onClick={() => setExpandedPriorId(expandedPriorId === a.id ? null : a.id)}
                      className="w-full flex items-center justify-between gap-2 p-2 text-left text-xs hover:bg-muted/50"
                    >
                      <span className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{levelLabel(a.action_level)}</Badge>
                        <span className="text-muted-foreground">{a.action_date}</span>
                      </span>
                      <Badge className={`${STATUS_COLORS[a.status]} text-[10px]`}>{STATUS_LABELS[a.status] || a.status}</Badge>
                    </button>
                    {expandedPriorId === a.id && (
                      <div className="p-2 pt-0 text-xs text-muted-foreground space-y-1 border-t border-border/50">
                        <p><span className="text-foreground font-medium">Incident:</span> {a.incident_description || '—'}</p>
                        {a.policy_violated && <p><span className="text-foreground font-medium">Policy:</span> {a.policy_violated}</p>}
                        {a.corrective_action_required && <p><span className="text-foreground font-medium">Corrective Action:</span> {a.corrective_action_required}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label>Incident Description <span className="text-red-500">*</span></Label>
            <Textarea value={form.incident_description} onChange={(e) => setForm((f) => ({ ...f, incident_description: e.target.value }))} disabled={isLocked} rows={3} className="mt-1" />
          </div>
          <div>
            <Label>Policy Violated</Label>
            <Input value={form.policy_violated} onChange={(e) => setForm((f) => ({ ...f, policy_violated: e.target.value }))} disabled={isLocked} placeholder="e.g. Employee Handbook §4.2 — Attendance Policy" className="mt-1" />
          </div>
          <div>
            <Label>Prior Actions Referenced</Label>
            <Textarea value={form.prior_actions_referenced} onChange={(e) => setForm((f) => ({ ...f, prior_actions_referenced: e.target.value }))} disabled={isLocked} rows={2} placeholder="Reference specific prior write-ups from the history above, if relevant" className="mt-1" />
          </div>
          <div>
            <Label>Corrective Action Required</Label>
            <Textarea value={form.corrective_action_required} onChange={(e) => setForm((f) => ({ ...f, corrective_action_required: e.target.value }))} disabled={isLocked} rows={2} className="mt-1" />
          </div>
          <div>
            <Label>Consequences if Repeated</Label>
            <Textarea value={form.consequences_if_repeated} onChange={(e) => setForm((f) => ({ ...f, consequences_if_repeated: e.target.value }))} disabled={isLocked} rows={2} className="mt-1" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Supervisor Name <span className="text-red-500">*</span></Label>
              <Input value={form.supervisor_name} onChange={(e) => setForm((f) => ({ ...f, supervisor_name: e.target.value }))} disabled={isLocked} className="mt-1" />
            </div>
            <div>
              <Label>Witness Name</Label>
              <Input value={form.witness_name} onChange={(e) => setForm((f) => ({ ...f, witness_name: e.target.value }))} disabled={isLocked} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Employee Statement</Label>
            <Textarea value={form.employee_statement} onChange={(e) => setForm((f) => ({ ...f, employee_statement: e.target.value }))} disabled={isLocked} rows={2} placeholder="Employee's written response, if any" className="mt-1" />
          </div>

          {!isLocked && (
            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={handleSaveDraft} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save Draft
              </Button>
              <Button onClick={handlePrint} disabled={saving} className="gap-1.5 steel-gradient text-white border-0">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}Print for Signatures
              </Button>
            </div>
          )}

          {isExistingRecord && savedRecord.status !== 'draft' && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              <Label className="text-sm flex items-center gap-1.5"><FileCheck2 className="w-3.5 h-3.5" />Signed Copy</Label>
              {savedRecord.signed_document ? (
                <div className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
                  <span className="flex-1 truncate">{savedRecord.signed_document.filename}</span>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={viewSignedDoc} disabled={loadingSignedDoc}>
                    <Eye className="w-3.5 h-3.5" />View
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadSignedDoc} disabled={loadingSignedDoc}>
                    <Download className="w-3.5 h-3.5" />Download
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">Upload the scanned, wet-signed copy to file this record and lock it.</p>
                  <FileDropzone accept="image/*,.pdf" label={signedFile ? signedFile.name : 'Upload signed scan (PDF or photo)'} onFileSelected={setSignedFile} />
                  <div className="flex justify-end">
                    <Button size="sm" onClick={handleFileSignedCopy} disabled={!signedFile || filing} className="gap-1.5 steel-gradient text-white border-0">
                      {filing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {filing ? 'Filing…' : 'File Signed Copy'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {!isExistingRecord && (
            <p className="text-xs text-muted-foreground">Save a draft or print for signatures before a signed copy can be filed.</p>
          )}
        </div>

        {/* ---- Print-only letterhead layout (hidden on screen) ---- */}
        <div className="hidden print:block text-black text-sm">
          <div className="flex items-start justify-between border-b-2 border-black pb-3 mb-4">
            <div>
              <p className="text-lg font-bold">{company?.name || 'Company Name'}</p>
              {(company?.city || company?.state) && <p className="text-xs">{[company?.city, company?.state].filter(Boolean).join(', ')}</p>}
            </div>
            <div className="text-right">
              <p className="text-base font-bold uppercase tracking-wide">Disciplinary Action Form</p>
              <p className="text-xs">Action Date: {form.action_date}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
            <p><span className="font-semibold">Employee:</span> {selectedEmployee?.full_name || '—'} {selectedEmployee?.employee_number ? `(#${selectedEmployee.employee_number})` : ''}</p>
            <p><span className="font-semibold">Action Level:</span> {levelLabel(form.action_level)}</p>
            <p><span className="font-semibold">Incident Date:</span> {form.incident_date || '—'}</p>
            <p><span className="font-semibold">Supervisor:</span> {form.supervisor_name || '—'}</p>
          </div>

          {[
            ['Incident Description', form.incident_description],
            ['Policy Violated', form.policy_violated],
            ['Prior Actions Referenced', form.prior_actions_referenced],
            ['Corrective Action Required', form.corrective_action_required],
            ['Consequences if Repeated', form.consequences_if_repeated],
            ['Employee Statement', form.employee_statement],
          ].map(([label, value]) => (
            <div key={label} className="mb-3">
              <p className="text-xs font-semibold uppercase tracking-wide border-b border-black/40 mb-1">{label}</p>
              <p className="text-xs whitespace-pre-wrap min-h-[1.5em]">{value || '—'}</p>
            </div>
          ))}

          <div className="grid grid-cols-3 gap-6 mt-10 pt-4">
            {[
              { role: 'Employee', name: selectedEmployee?.full_name },
              { role: 'Supervisor', name: form.supervisor_name },
              { role: 'Witness', name: form.witness_name },
            ].map(({ role, name }) => (
              <div key={role} className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wide">{role}</p>
                <p className="text-xs">Printed Name: {name || '_____________________'}</p>
                <div className="border-b border-black h-8" />
                <p className="text-xs">Signature</p>
                <div className="border-b border-black h-8" />
                <p className="text-xs">Date</p>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="print:hidden">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
