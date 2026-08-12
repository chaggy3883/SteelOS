import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { saveDocumentRecords } from '@/lib/inspectionDocumentStore';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { canAccessEquipmentService } from '@/lib/planGating';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, ClipboardCheck, Wrench, Disc, CircleDot, Truck, Droplets, AlertTriangle, Paperclip,
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

const SERVICE_TYPES = [
  { value: 'Daily', label: 'Daily / Shift' },
  { value: 'Monthly', label: 'Monthly' },
  { value: 'Annual', label: 'Annual' },
  { value: 'DOT_Inspection', label: 'DOT Inspection' },
];

const SERVICE_ACTIONS = [
  { value: 'Pass', label: 'Pass' },
  { value: 'Requires_Repair', label: 'Requires Repair' },
  { value: 'Schedule_Followup', label: 'Schedule Followup' },
];

const CHECKLIST_SECTIONS = [
  {
    key: 'cab_engine_findings',
    title: 'Cab & Engine Inspection',
    icon: Wrench,
    items: [
      'Fluid levels (oil, coolant, windshield washer, power steering)',
      'Horn, wipers, interior warning lights',
      'Seat belts and mirrors',
      'Battery terminals (corrosion, mounting)',
      'Belt wear, fluid leaks, hose damage',
    ],
  },
  {
    key: 'brakes_steering_findings',
    title: 'Brakes & Steering',
    icon: Disc,
    items: [
      'Brake pads/shoes/rotors/drums wear',
      'Air/hydraulic brake lines (leaks, cracks)',
      'Parking brake holding power',
      'Steering linkage, ball joints, tie rods (play)',
    ],
  },
  {
    key: 'tires_suspension_findings',
    title: 'Tires & Suspension',
    icon: CircleDot,
    items: [
      'Tire tread depth',
      'Tire pressure',
      'Wheel lug nuts (torque, rust)',
      'Leaf springs, air bags, shock absorbers (cracks, leaks)',
    ],
  },
  {
    key: 'trailer_findings',
    title: 'Trailer Inspection',
    icon: Truck,
    items: [
      'Kingpin and fifth wheel (wear, damage)',
      'Emergency breakaway system and cable',
      'Landing gear (legs, crank, feet)',
      'Trailer lights, turn signals, 7-way plug',
    ],
  },
  {
    key: 'hydraulics_findings',
    title: 'Equipment & Hydraulics',
    icon: Droplets,
    items: [
      'Hydraulic fluid levels and hose leaks',
      'Lift cylinders, pins, bushings (play, grease)',
      'Safety guards, shields, emergency shut-offs',
      'Zerk fittings greased',
    ],
  },
];

const toDocumentRef = ({ id, filename, mimetype, size, uploadDate }) => ({ id, filename, mimetype, size, uploadDate });

const buildFindings = (items) => items.map((item) => ({ item, checked: false, notes: '' }));

const emptyForm = () => ({
  service_date: new Date().toISOString().slice(0, 10),
  inspector_name: '',
  service_type: 'Daily',
  equipment_id: '',
  equipment_description: '',
  cab_engine_findings: buildFindings(CHECKLIST_SECTIONS[0].items),
  brakes_steering_findings: buildFindings(CHECKLIST_SECTIONS[1].items),
  tires_suspension_findings: buildFindings(CHECKLIST_SECTIONS[2].items),
  trailer_findings: buildFindings(CHECKLIST_SECTIONS[3].items),
  hydraulics_findings: buildFindings(CHECKLIST_SECTIONS[4].items),
  deficiencies: '',
  service_action: 'Pass',
  service_action_notes: '',
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

export default function EquipmentServiceForm() {
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState(null);
  const [effectiveCompany, setEffectiveCompany] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [pendingFiles, setPendingFiles] = useState([]);
  const [savedDocuments, setSavedDocuments] = useState([]);
  const [lastSavedId, setLastSavedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState({
    admin: true,
    cab_engine_findings: true,
    brakes_steering_findings: true,
    tires_suspension_findings: true,
    trailer_findings: true,
    hydraulics_findings: true,
    action: true,
    attachments: true,
  });

  useEffect(() => {
    Promise.all([db.auth.me().catch(() => null), getEffectiveCompany().catch(() => null)])
      .then(([user, company]) => { setCurrentUser(user); setEffectiveCompany(company); })
      .finally(() => setCheckingAccess(false));
  }, []);

  const toggleSection = (key) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const updateFinding = (sectionKey, index, patch) => {
    setForm((f) => ({ ...f, [sectionKey]: f[sectionKey].map((it, i) => (i === index ? { ...it, ...patch } : it)) }));
  };

  const requiresActionNotes = form.service_action === 'Requires_Repair' || form.service_action === 'Schedule_Followup';

  const handleDeleteSavedDocument = async (docId) => {
    if (!lastSavedId) return;
    const nextDocs = savedDocuments.filter((d) => d.id !== docId);
    await saveDocumentRecords(`service_documents_${lastSavedId}`, nextDocs);
    await db.entities.EquipmentService.update(lastSavedId, { documents: nextDocs.map(toDocumentRef) });
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
    if (!form.service_date) {
      toast({ title: 'Service date is required', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const cleanSection = (sectionKey) => ({ findings: form[sectionKey].map((f) => ({ ...f, notes: f.notes.trim() })) });

      const created = await db.entities.EquipmentService.create({
        service_date: form.service_date,
        inspector_name: form.inspector_name.trim(),
        service_type: form.service_type,
        equipment_id: form.equipment_id.trim(),
        equipment_description: form.equipment_description.trim(),
        cab_engine_section: cleanSection('cab_engine_findings'),
        brakes_steering_section: cleanSection('brakes_steering_findings'),
        tires_suspension_section: cleanSection('tires_suspension_findings'),
        trailer_section: cleanSection('trailer_findings'),
        hydraulics_section: cleanSection('hydraulics_findings'),
        deficiencies: form.deficiencies.trim(),
        service_action: form.service_action,
        service_action_notes: requiresActionNotes ? form.service_action_notes.trim() : '',
        documents: [],
      });

      if (pendingFiles.length > 0) {
        const storageKey = `service_documents_${created.id}`;
        const documents = pendingFiles.map((f) => ({ ...f, uploadDate: new Date().toISOString() }));
        await saveDocumentRecords(storageKey, documents);
        await db.entities.EquipmentService.update(created.id, { documents: documents.map(toDocumentRef) });
        setSavedDocuments(documents);
      } else {
        setSavedDocuments([]);
      }
      setLastSavedId(created.id);

      toast({ title: 'Equipment service record saved' });
      setForm(emptyForm());
      setPendingFiles([]);
    } catch (e) {
      toast({ title: 'Unable to save equipment service record', description: e?.message || undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (checkingAccess) {
    return <div className="p-4 md:p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;
  }

  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  const allowed = isPlatformOperatorView || canAccessEquipmentService(effectiveCompany);

  if (!allowed) {
    return (
      <div className="p-4 md:p-6">
        <div className="steel-card p-8 text-center max-w-md mx-auto mt-12">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">Access Restricted</h2>
          <p className="text-sm text-muted-foreground">Equipment Service is only available on the Erector or Enterprise plan.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in max-w-3xl mx-auto">
      <PageHeader
        title="Equipment Service"
        subtitle="DOT pre-trip style equipment inspection and service checklist"
        actions={<Link to="/field-operations"><Button variant="outline" size="sm" className="gap-1.5"><ArrowLeft className="w-3.5 h-3.5" />Field Operations</Button></Link>}
      />

      <Section title="Administrative Header" icon={ClipboardCheck} open={openSections.admin} onToggle={() => toggleSection('admin')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Equipment ID <span className="text-red-500">*</span></Label>
            <Input value={form.equipment_id} onChange={(e) => setForm((f) => ({ ...f, equipment_id: e.target.value }))} placeholder="e.g. TRK-014" className="mt-1" />
          </div>
          <div>
            <Label>Equipment Description</Label>
            <Input value={form.equipment_description} onChange={(e) => setForm((f) => ({ ...f, equipment_description: e.target.value }))} placeholder="e.g. Flatbed delivery truck" className="mt-1" />
          </div>
          <div>
            <Label>Service Date <span className="text-red-500">*</span></Label>
            <Input type="date" value={form.service_date} onChange={(e) => setForm((f) => ({ ...f, service_date: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>Inspector Name <span className="text-red-500">*</span></Label>
            <Input value={form.inspector_name} onChange={(e) => setForm((f) => ({ ...f, inspector_name: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>Service Type</Label>
            <Select value={form.service_type} onValueChange={(v) => setForm((f) => ({ ...f, service_type: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{SERVICE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </Section>

      {CHECKLIST_SECTIONS.map((section) => (
        <Section
          key={section.key}
          title={section.title}
          icon={section.icon}
          open={openSections[section.key]}
          onToggle={() => toggleSection(section.key)}
        >
          <p className="text-xs text-muted-foreground">Check any condition observed, and note its location.</p>
          <div className="space-y-2">
            {form[section.key].map((finding, i) => (
              <FindingRow key={finding.item} finding={finding} onChange={(patch) => updateFinding(section.key, i, patch)} />
            ))}
          </div>
        </Section>
      ))}

      <Section title="Deficiencies & Action" icon={AlertTriangle} open={openSections.action} onToggle={() => toggleSection('action')}>
        <div>
          <Label>Issues Found</Label>
          <Textarea
            value={form.deficiencies}
            onChange={(e) => setForm((f) => ({ ...f, deficiencies: e.target.value }))}
            placeholder="Describe any issues found and their location"
            rows={3}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Service Action</Label>
          <Select value={form.service_action} onValueChange={(v) => setForm((f) => ({ ...f, service_action: v }))}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{SERVICE_ACTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {requiresActionNotes && (
          <div>
            <Label>Notes</Label>
            <Textarea
              value={form.service_action_notes}
              onChange={(e) => setForm((f) => ({ ...f, service_action_notes: e.target.value }))}
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
          {saving ? 'Saving…' : 'Save Service Record'}
        </Button>
      </div>
    </div>
  );
}
