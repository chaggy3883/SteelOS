import React, { useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Loader2, CheckCircle2, Printer } from 'lucide-react';
import { db } from '@/api/apiClient';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SIMPLE_CHECKLIST_ITEMS, FREE_TEXT_FIELDS, blankTurnoverRecord as blankRecord } from '@/components/projects/turnoverReviewShared';

// Free-text name (Detailing Company, Erector) linked to its Vendor record
// when one matches by name — standing rule: every data point links back to
// its source record where applicable. Vendor is looked up by name, not FK,
// since these fields are plain text on the reference form, not a picker.
function VendorLinkedField({ label, value, onChange, disabled, vendorsByName }) {
  const navigate = useNavigate();
  const matched = vendorsByName.get((value || '').trim().toLowerCase());
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="mt-1 h-9" />
      {matched && (
        <button
          type="button"
          className="text-xs text-primary hover:underline mt-1"
          onClick={() => navigate(`/crm/directory?vendor=${matched.id}`)}
        >
          View Vendor record →
        </button>
      )}
    </div>
  );
}

function StringListEditor({ items, onChange, disabled, placeholder }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...(items || []), trimmed]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      {(items || []).map((name, index) => (
        <div key={`${name}-${index}`} className="flex items-center gap-2 rounded-lg border border-border p-2 pl-3">
          <span className="flex-1 text-sm">{name}</span>
          {!disabled && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onChange(items.filter((_, i) => i !== index))}>
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            className="h-9"
          />
          <Button variant="outline" onClick={add} disabled={!draft.trim()}><Plus className="w-4 h-4 mr-1" />Add</Button>
        </div>
      )}
    </div>
  );
}

const TurnoverReviewPanel = forwardRef(function TurnoverReviewPanel({ project, onExportPdf }, ref) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [record, setRecord] = useState(blankRecord());
  const [savedRecord, setSavedRecord] = useState(blankRecord());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState([]);

  const isDirty = () => JSON.stringify(record) !== JSON.stringify(savedRecord);

  const loadRecord = async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const [existing, company, vendorRows] = await Promise.all([
        db.entities.TurnoverMeetingRecord.filter({ project_id: project.id }, '-created_date', 1),
        getEffectiveCompany().catch(() => null),
        db.entities.Vendor.filter({ is_active: true }, 'name', 500).catch(() => []),
      ]);
      setVendors(vendorRows);
      const found = existing[0];
      const next = found
        ? { ...blankRecord(), ...found }
        : { ...blankRecord(), required_attendees: company?.turnover_meeting_standard_attendees || [] };
      setRecord(next);
      setSavedRecord(next);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRecord(); }, [project?.id]);

  const update = (field, value) => setRecord((prev) => ({ ...prev, [field]: value }));
  const updateChecklist = (key, value) => setRecord((prev) => ({ ...prev, checklist_items: { ...prev.checklist_items, [key]: value } }));

  // Accepts an explicit record to save (used by markCompleted, which needs to
  // save the just-computed completed state immediately rather than racing
  // setRecord's async update — a plain closure over `record` here would still
  // see the pre-completion values).
  const save = async (overrideRecord) => {
    if (!project?.id) return false;
    const source = overrideRecord || record;
    setSaving(true);
    try {
      const payload = { ...source, project_id: project.id };
      delete payload.id;
      const saved = source.id
        ? await db.entities.TurnoverMeetingRecord.update(source.id, payload)
        : await db.entities.TurnoverMeetingRecord.create(payload);
      const next = { ...blankRecord(), ...saved };
      setRecord(next);
      setSavedRecord(next);
      toast({ title: 'Turnover / Contract Review saved' });
      return true;
    } catch (e) {
      toast({ title: 'Unable to save', description: e?.message || 'Please retry.', variant: 'destructive' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const markCompleted = async () => {
    const identity = user?.full_name || user?.email || 'Unknown';
    const updated = { ...record, status: 'completed', completed_by: identity, completed_date: new Date().toISOString().slice(0, 10) };
    setRecord(updated);
    // Completion is a deliberate save-and-lock action — flush it immediately
    // against the just-computed object rather than leaving it sitting dirty.
    await save(updated);
  };

  useImperativeHandle(ref, () => ({ isDirty, save }));

  const vendorsByName = new Map(vendors.map((v) => [String(v.name || '').trim().toLowerCase(), v]));
  const readOnly = record.status === 'completed';

  if (loading) {
    return <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            Turnover / Contract Review
            {readOnly && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 font-medium uppercase tracking-wide">Completed — Read Only</span>}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Operational/logistics handoff only — no pricing or cost data from the Bid Worksheet appears here.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onExportPdf}><Printer className="w-4 h-4 mr-1" />Export PDF</Button>
          {!readOnly && (
            <Button variant="outline" onClick={markCompleted} disabled={saving}>
              <CheckCircle2 className="w-4 h-4 mr-1" />Mark Completed
            </Button>
          )}
        </div>
      </div>

      {readOnly && (
        <p className="text-xs text-muted-foreground">
          Completed by {record.completed_by || 'Unknown'} on {record.completed_date || '—'}.
        </p>
      )}

      <div className="steel-card p-5 space-y-2">
        <h4 className="font-semibold mb-1">Checklist</h4>
        {SIMPLE_CHECKLIST_ITEMS.map(({ key, label }) => (
          <div key={key} className="flex items-start gap-2.5 py-1">
            <Checkbox id={`turnover-${key}`} checked={!!record.checklist_items[key]} onCheckedChange={(v) => updateChecklist(key, !!v)} disabled={readOnly} className="mt-0.5" />
            <label htmlFor={`turnover-${key}`} className="flex-1 text-sm cursor-pointer">{label}</label>
          </div>
        ))}
      </div>

      <div className="steel-card p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="flex items-start gap-2.5 py-1 mb-2">
            <Checkbox id="turnover-detailing" checked={!!record.checklist_items.detailing_required} onCheckedChange={(v) => updateChecklist('detailing_required', !!v)} disabled={readOnly} className="mt-0.5" />
            <label htmlFor="turnover-detailing" className="flex-1 text-sm cursor-pointer font-medium">Detailing</label>
          </div>
          {record.checklist_items.detailing_required && (
            <VendorLinkedField label="Detailing Company" value={record.detailing_company} onChange={(v) => update('detailing_company', v)} disabled={readOnly} vendorsByName={vendorsByName} />
          )}
        </div>
        <div>
          <div className="flex items-start gap-2.5 py-1 mb-2">
            <Checkbox id="turnover-galv" checked={!!record.checklist_items.galvanizing_required} onCheckedChange={(v) => updateChecklist('galvanizing_required', !!v)} disabled={readOnly} className="mt-0.5" />
            <label htmlFor="turnover-galv" className="flex-1 text-sm cursor-pointer font-medium">Galvanizing</label>
          </div>
          {record.checklist_items.galvanizing_required && (
            <div>
              <Label className="text-xs">Tons</Label>
              <Input type="number" value={record.galvanizing_tons ?? ''} onChange={(e) => update('galvanizing_tons', e.target.value)} disabled={readOnly} className="mt-1 h-9" />
            </div>
          )}
        </div>
        <div>
          <Label className="text-xs">Pricing Basis</Label>
          <Select value={record.pricing_basis || ''} onValueChange={(v) => update('pricing_basis', v)} disabled={readOnly}>
            <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select pricing basis" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="erected">Erected</SelectItem>
              <SelectItem value="fob">FOB</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {record.pricing_basis === 'erected' && (
          <VendorLinkedField label="Who's the Erector?" value={record.erector_name} onChange={(v) => update('erector_name', v)} disabled={readOnly} vendorsByName={vendorsByName} />
        )}
      </div>

      <div className="steel-card p-5">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold">Sub Quotes</h4>
          {!readOnly && (
            <Button variant="outline" size="sm" onClick={() => update('sub_quotes', [...record.sub_quotes, { company: '', type: '' }])}>
              <Plus className="w-3.5 h-3.5 mr-1" />Add Sub Quote
            </Button>
          )}
        </div>
        {record.sub_quotes.length === 0 && <p className="text-sm text-muted-foreground">No sub quotes listed.</p>}
        <div className="space-y-2">
          {record.sub_quotes.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input placeholder="Company" value={row.company} disabled={readOnly}
                onChange={(e) => update('sub_quotes', record.sub_quotes.map((r, i) => i === index ? { ...r, company: e.target.value } : r))}
                className="h-9" />
              <Input placeholder="Type (e.g. Erection, Hauling)" value={row.type} disabled={readOnly}
                onChange={(e) => update('sub_quotes', record.sub_quotes.map((r, i) => i === index ? { ...r, type: e.target.value } : r))}
                className="h-9" />
              {!readOnly && (
                <Button variant="ghost" size="icon" onClick={() => update('sub_quotes', record.sub_quotes.filter((_, i) => i !== index))}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="steel-card p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        {FREE_TEXT_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <Label className="text-xs">{label}</Label>
            <Textarea value={record[key] || ''} onChange={(e) => update(key, e.target.value)} disabled={readOnly} className="mt-1 min-h-[72px]" />
          </div>
        ))}
      </div>

      <div className="steel-card p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 className="font-semibold mb-2">Required Attendees</h4>
          <StringListEditor items={record.required_attendees} onChange={(v) => update('required_attendees', v)} disabled={readOnly} placeholder="e.g. Project Manager" />
        </div>
        <div>
          <h4 className="font-semibold mb-2">Actual Attendees</h4>
          <StringListEditor items={record.actual_attendees} onChange={(v) => update('actual_attendees', v)} disabled={readOnly} placeholder="Who actually attended" />
        </div>
      </div>

      {!readOnly && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving || !isDirty()}>{saving ? 'Saving…' : 'Save Draft'}</Button>
        </div>
      )}
    </div>
  );
});

export default TurnoverReviewPanel;
