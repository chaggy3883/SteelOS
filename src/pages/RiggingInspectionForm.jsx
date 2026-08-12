import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { saveDocumentRecords } from '@/lib/inspectionDocumentStore';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { canAccessRiggingInspection } from '@/lib/planGating';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, ClipboardCheck, Link2, Wrench, AlertTriangle, Paperclip,
  ChevronDown, ShieldAlert, Loader2,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import InspectionDocumentUpload from '@/components/shared/InspectionDocumentUpload';
import { useToast } from '@/components/ui/use-toast';

const INSPECTION_TYPES = [
  { value: 'Daily', label: 'Daily' },
  { value: 'Monthly', label: 'Monthly' },
  { value: 'Annual', label: 'Annual' },
  { value: 'Initial', label: 'Initial' },
  { value: 'Idle_Equipment', label: 'Idle Equipment' },
];

const SLING_TYPES = [
  { value: 'Wire_Rope', label: 'Wire Rope' },
  { value: 'Synthetic_Web', label: 'Synthetic Web' },
  { value: 'Chain', label: 'Chain' },
];

const SLING_CHECKLIST_BY_TYPE = {
  Wire_Rope: ['Broken wires per lay', 'Kinking', 'Birdcaging', 'Core protrusion', 'Corrosion', 'End termination damage'],
  Synthetic_Web: ['Cuts', 'Punctures', 'Severe abrasion', 'UV degradation', 'Chemical/heat damage', 'Broken/worn stitching'],
  Chain: ['Link wear', 'Elongation/stretch', 'Nicks/gouges', 'Weld/crown damage'],
};

const HARDWARE_SECTIONS = [
  { key: 'Shackles_Pins', label: 'Shackles / Pins', items: ['Bow distortion', 'Pin bending', 'Thread stripping', 'Wear inside bow'] },
  { key: 'Hooks', label: 'Hooks', items: ['Throat opening stretch', 'Twisting', 'Cracks', 'Safety latch condition'] },
  { key: 'Spreader_Bars', label: 'Spreader Bars', items: ['Structural deformation', 'Weld integrity', 'Proof-load test current'] },
];

const DISPOSAL_ACTIONS = [
  { value: 'Pass', label: 'Pass' },
  { value: 'Requires_Repair', label: 'Requires Repair' },
  { value: 'Removed_From_Service', label: 'Immediately Removed From Service' },
];

const toDocumentRef = ({ id, filename, mimetype, size, uploadDate }) => ({ id, filename, mimetype, size, uploadDate });

const buildSlingFindings = (slingType) =>
  (SLING_CHECKLIST_BY_TYPE[slingType] || []).map((item) => ({ item, checked: false, notes: '' }));

const buildHardwareFindings = () =>
  HARDWARE_SECTIONS.flatMap((section) => section.items.map((item) => ({ subsection: section.key, item, checked: false, notes: '' })));

const emptyForm = () => ({
  inspection_date: new Date().toISOString().slice(0, 10),
  inspector_name: '',
  inspection_type: 'Daily',
  equipment_id: '',
  equipment_description: '',
  tag_legible: false,
  wll_readable: false,
  sling_type: 'Wire_Rope',
  sling_findings: buildSlingFindings('Wire_Rope'),
  hardware_findings: buildHardwareFindings(),
  deficiencies: '',
  disposal_action: 'Pass',
  disposal_notes: '',
});

function Section({ title, icon: Icon, open, onToggle, children }) {
  return (
    <Collapsible open={open} onOpenChange={onToggle} className="steel-card overflow-hidden">
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-muted/30 transition-colors">
          <span className="flex items-center gap-2 font-semibold text-sm">
            {Icon && <Icon className="w-4 h-4 text-primary flex-shrink-0" />}
            {title}
          </span>
          <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform flex-shrink-0', open && 'rotate-180')} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border p-4 space-y-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FindingRow({ finding, onChange }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-2.5 sm:flex-row sm:items-start">
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <Checkbox checked={finding.checked} onCheckedChange={(v) => onChange({ checked: !!v })} className="mt-0.5" />
        <Label className="font-normal text-sm cursor-pointer">{finding.item}</Label>
      </div>
      <Input
        value={finding.notes}
        onChange={(e) => onChange({ notes: e.target.value })}
        placeholder="Details / location (optional)"
        className="text-xs h-8 sm:w-60 flex-shrink-0"
      />
    </div>
  );
}

export default function RiggingInspectionForm() {
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState(null);
  const [effectiveCompany, setEffectiveCompany] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [pendingFiles, setPendingFiles] = useState([]);
  const [savedDocuments, setSavedDocuments] = useState([]);
  const [lastSavedId, setLastSavedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState({ admin: true, slings: true, hardware: true, disposal: true, attachments: true });

  useEffect(() => {
    Promise.all([db.auth.me().catch(() => null), getEffectiveCompany().catch(() => null)])
      .then(([user, company]) => { setCurrentUser(user); setEffectiveCompany(company); })
      .finally(() => setCheckingAccess(false));
  }, []);

  const toggleSection = (key) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const applySlingType = (type) => setForm((f) => ({ ...f, sling_type: type, sling_findings: buildSlingFindings(type) }));

  const updateSlingFinding = (index, patch) => {
    setForm((f) => ({ ...f, sling_findings: f.sling_findings.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));
  };

  const updateHardwareFinding = (index, patch) => {
    setForm((f) => ({ ...f, hardware_findings: f.hardware_findings.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));
  };

  const requiresDisposalNotes = form.disposal_action === 'Requires_Repair' || form.disposal_action === 'Removed_From_Service';

  const handleDeleteSavedDocument = async (docId) => {
    if (!lastSavedId) return;
    const nextDocs = savedDocuments.filter((d) => d.id !== docId);
    await saveDocumentRecords(`inspection_documents_${lastSavedId}`, nextDocs);
    await db.entities.RiggingInspection.update(lastSavedId, { documents: nextDocs.map(toDocumentRef) });
    setSavedDocuments(nextDocs);
  };

  const handleSave = async () => {
    if (!form.equipment_id.trim()) {
      toast({ title: 'Equipment ID is required', variant: 'destructive' });
      return;
    }
    if (!form.inspector_name.trim()) {
      toast({ title: 'Inspector name is required', variant: 'destructive' });
      return;
    }
    if (!form.inspection_date) {
      toast({ title: 'Inspection date is required', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const created = await db.entities.RiggingInspection.create({
        inspection_date: form.inspection_date,
        inspector_name: form.inspector_name.trim(),
        inspection_type: form.inspection_type,
        equipment_id: form.equipment_id.trim(),
        equipment_description: form.equipment_description.trim(),
        tag_legible: form.tag_legible,
        wll_readable: form.wll_readable,
        sling_type: form.sling_type,
        sling_findings: form.sling_findings.map((f) => ({ ...f, notes: f.notes.trim() })),
        hardware_findings: form.hardware_findings.map((f) => ({ ...f, notes: f.notes.trim() })),
        deficiencies: form.deficiencies.trim(),
        disposal_action: form.disposal_action,
        disposal_notes: requiresDisposalNotes ? form.disposal_notes.trim() : '',
        documents: [],
      });

      if (pendingFiles.length > 0) {
        const storageKey = `inspection_documents_${created.id}`;
        const documents = pendingFiles.map((f) => ({ ...f, uploadDate: new Date().toISOString() }));
        await saveDocumentRecords(storageKey, documents);
        await db.entities.RiggingInspection.update(created.id, { documents: documents.map(toDocumentRef) });
        setSavedDocuments(documents);
      } else {
        setSavedDocuments([]);
      }
      setLastSavedId(created.id);

      toast({ title: 'Rigging inspection saved' });
      setForm(emptyForm());
      setPendingFiles([]);
    } catch (e) {
      toast({ title: 'Unable to save rigging inspection', description: e?.message || undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (checkingAccess) {
    return <div className="p-4 md:p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;
  }

  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  const allowed = isPlatformOperatorView || canAccessRiggingInspection(effectiveCompany);

  if (!allowed) {
    return (
      <div className="p-4 md:p-6">
        <div className="steel-card p-8 text-center max-w-md mx-auto mt-12">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">Access Restricted</h2>
          <p className="text-sm text-muted-foreground">Rigging Inspection is only available on the Erector or Enterprise plan.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in max-w-3xl mx-auto">
      <PageHeader
        title="Rigging Inspection"
        subtitle="Sling and hardware inspection checklist per OSHA 29 CFR 1926.251 and ASME B30.9"
        actions={<Link to="/field-operations"><Button variant="outline" size="sm" className="gap-1.5"><ArrowLeft className="w-3.5 h-3.5" />Field Operations</Button></Link>}
      />

      <Section title="Administrative & General" icon={ClipboardCheck} open={openSections.admin} onToggle={() => toggleSection('admin')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Equipment ID <span className="text-red-500">*</span></Label>
            <Input value={form.equipment_id} onChange={(e) => setForm((f) => ({ ...f, equipment_id: e.target.value }))} placeholder="e.g. SLG-0042" className="mt-1" />
          </div>
          <div>
            <Label>Equipment Description</Label>
            <Input value={form.equipment_description} onChange={(e) => setForm((f) => ({ ...f, equipment_description: e.target.value }))} placeholder="e.g. 2in x 20ft nylon web sling" className="mt-1" />
          </div>
          <div>
            <Label>Inspection Date <span className="text-red-500">*</span></Label>
            <Input type="date" value={form.inspection_date} onChange={(e) => setForm((f) => ({ ...f, inspection_date: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>Inspector Name <span className="text-red-500">*</span></Label>
            <Input value={form.inspector_name} onChange={(e) => setForm((f) => ({ ...f, inspector_name: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>Inspection Type</Label>
            <Select value={form.inspection_type} onValueChange={(v) => setForm((f) => ({ ...f, inspection_type: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{INSPECTION_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox id="tag_legible" checked={form.tag_legible} onCheckedChange={(v) => setForm((f) => ({ ...f, tag_legible: !!v }))} />
            <Label htmlFor="tag_legible" className="font-normal cursor-pointer">Manufacturer tags present and readable</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="wll_readable" checked={form.wll_readable} onCheckedChange={(v) => setForm((f) => ({ ...f, wll_readable: !!v }))} />
            <Label htmlFor="wll_readable" className="font-normal cursor-pointer">Working Load Limit clearly marked</Label>
          </div>
        </div>
      </Section>

      <Section title="Slings" icon={Link2} open={openSections.slings} onToggle={() => toggleSection('slings')}>
        <div>
          <Label>Sling Type</Label>
          <Select value={form.sling_type} onValueChange={applySlingType}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{SLING_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">Check any condition observed on this sling, and note its location.</p>
        <div className="space-y-2">
          {form.sling_findings.map((finding, i) => (
            <FindingRow key={finding.item} finding={finding} onChange={(patch) => updateSlingFinding(i, patch)} />
          ))}
        </div>
      </Section>

      <Section title="Hardware & Components" icon={Wrench} open={openSections.hardware} onToggle={() => toggleSection('hardware')}>
        <p className="text-xs text-muted-foreground">Check any condition observed, and note its location.</p>
        {HARDWARE_SECTIONS.map((section) => (
          <div key={section.key} className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">{section.label}</Label>
            {section.items.map((item) => {
              const index = form.hardware_findings.findIndex((f) => f.subsection === section.key && f.item === item);
              const finding = form.hardware_findings[index];
              return <FindingRow key={item} finding={finding} onChange={(patch) => updateHardwareFinding(index, patch)} />;
            })}
          </div>
        ))}
      </Section>

      <Section title="Deficiencies & Disposal" icon={AlertTriangle} open={openSections.disposal} onToggle={() => toggleSection('disposal')}>
        <div>
          <Label>Deficiencies Found</Label>
          <Textarea
            value={form.deficiencies}
            onChange={(e) => setForm((f) => ({ ...f, deficiencies: e.target.value }))}
            placeholder="Describe any issues found and their location"
            rows={3}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Disposal Action</Label>
          <Select value={form.disposal_action} onValueChange={(v) => setForm((f) => ({ ...f, disposal_action: v }))}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{DISPOSAL_ACTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {requiresDisposalNotes && (
          <div>
            <Label>Repair / Removal Notes</Label>
            <Textarea
              value={form.disposal_notes}
              onChange={(e) => setForm((f) => ({ ...f, disposal_notes: e.target.value }))}
              rows={2}
              className="mt-1"
            />
          </div>
        )}
      </Section>

      <Section title="Attach Documents" icon={Paperclip} open={openSections.attachments} onToggle={() => toggleSection('attachments')}>
        <InspectionDocumentUpload
          pendingFiles={pendingFiles}
          onPendingFilesChange={setPendingFiles}
          savedDocuments={savedDocuments}
          onDeleteSaved={lastSavedId ? handleDeleteSavedDocument : undefined}
          disabled={saving}
        />
      </Section>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto steel-gradient text-white border-0 gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save Inspection'}
        </Button>
      </div>
    </div>
  );
}
