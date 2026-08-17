import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { saveDocumentRecords } from '@/lib/inspectionDocumentStore';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import { EQUIPMENT_TYPES, SERVICE_LEVELS, composeCumulativeChecklist } from '@/lib/serviceScheduleEngine';
import { cn } from '@/lib/utils';
import { ArrowLeft, Gauge, ChevronDown, Loader2, Info } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import ModuleLocked from '@/components/shared/ModuleLocked';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import InspectionDocumentUpload from '@/components/shared/InspectionDocumentUpload';
import { useToast } from '@/components/ui/use-toast';

const SERVICE_ACTIONS = [
  { value: 'Pass', label: 'Pass' },
  { value: 'Requires_Repair', label: 'Requires Repair' },
  { value: 'Schedule_Followup', label: 'Schedule Followup' },
];

const toDocumentRef = ({ id, filename, mimetype, size, uploadDate }) => ({ id, filename, mimetype, size, uploadDate });

const buildChecklistSections = (composedSections) => composedSections.map(({ section, items }) => ({
  section,
  section_notes: '',
  findings: items.map(({ item, notes_required }) => ({ item, checked: false, notes: '', notes_required })),
}));

const emptyForm = () => ({
  service_date: new Date().toISOString().slice(0, 10),
  inspector_name: '',
  equipment_type: EQUIPMENT_TYPES[0].value,
  service_level: 'A',
  equipment_id: '',
  equipment_description: '',
  asset_id: '',
  current_odometer_miles: '',
  current_runtime_hours: '',
  checklist_sections: [],
  deficiencies: '',
  service_action: 'Pass',
  service_action_notes: '',
});

function Section({ title, open, onToggle, children }) {
  return (
    <Collapsible open={open} onOpenChange={onToggle} className="steel-card overflow-hidden">
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-muted/30 transition-colors">
          <span className="flex items-center gap-2 font-semibold text-sm">{title}</span>
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
        <Label className="font-normal text-sm cursor-pointer">
          {finding.item}
          {finding.notes_required && <span className="text-red-500 ml-1">*</span>}
        </Label>
      </div>
      <Input
        value={finding.notes}
        onChange={(e) => onChange({ notes: e.target.value })}
        placeholder={finding.notes_required ? 'Notes required for this item' : 'Details / location (optional)'}
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
  const [schedules, setSchedules] = useState([]);
  const [fleetAssets, setFleetAssets] = useState([]);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [pendingFiles, setPendingFiles] = useState([]);
  const [savedDocuments, setSavedDocuments] = useState([]);
  const [lastSavedId, setLastSavedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState({ admin: true, action: true, attachments: true });

  useEffect(() => {
    Promise.all([db.auth.me().catch(() => null), getEffectiveCompany().catch(() => null)])
      .then(([user, company]) => { setCurrentUser(user); setEffectiveCompany(company); })
      .finally(() => setCheckingAccess(false));
  }, []);

  useEffect(() => {
    setLoadingSchedules(true);
    Promise.all([
      db.entities.ServiceSchedule.list('-created_date', 500).catch(() => []),
      db.entities.erection_fleet_assets.list('-created_date', 200).catch(() => []),
    ])
      .then(([scheduleList, assetList]) => { setSchedules(scheduleList); setFleetAssets(assetList); })
      .finally(() => setLoadingSchedules(false));
  }, []);

  const composedSections = useMemo(
    () => composeCumulativeChecklist(schedules, form.equipment_type, form.service_level),
    [schedules, form.equipment_type, form.service_level]
  );

  // Rebuild the checklist (and its collapsible-open state) whenever the
  // equipment type or service level changes — the composed set of sections
  // is different every time, so there's nothing meaningful to carry over.
  useEffect(() => {
    setForm((f) => ({ ...f, checklist_sections: buildChecklistSections(composedSections) }));
    setOpenSections((prev) => ({
      admin: true, action: true, attachments: true,
      ...Object.fromEntries(composedSections.map(({ section }) => [section, true])),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composedSections]);

  const selectedAsset = useMemo(() => fleetAssets.find((a) => a.id === form.asset_id) || null, [fleetAssets, form.asset_id]);
  const assetLocksType = !!selectedAsset?.equipment_type;

  // Which readings matter for this equipment type — a pure calendar type
  // like SEMI_TRAILER never needs an odometer/hours input at all.
  const relevantUnits = useMemo(() => {
    const units = new Set();
    schedules.filter((s) => s.equipment_type === form.equipment_type).forEach((s) => {
      if (s.interval_unit) units.add(s.interval_unit);
      if (s.secondary_interval_unit) units.add(s.secondary_interval_unit);
    });
    return units;
  }, [schedules, form.equipment_type]);

  const toggleSection = (key) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const selectAsset = (assetId) => {
    const asset = fleetAssets.find((a) => a.id === assetId);
    setForm((f) => ({
      ...f,
      asset_id: assetId,
      equipment_type: asset?.equipment_type || f.equipment_type,
      equipment_description: f.equipment_description || asset?.asset_name || '',
      current_odometer_miles: asset?.odometer_miles !== undefined ? String(asset.odometer_miles) : '',
      current_runtime_hours: asset?.runtime_hours !== undefined ? String(asset.runtime_hours) : '',
    }));
  };

  const updateSectionNotes = (sectionIndex, section_notes) => {
    setForm((f) => ({ ...f, checklist_sections: f.checklist_sections.map((s, i) => (i === sectionIndex ? { ...s, section_notes } : s)) }));
  };

  const updateFinding = (sectionIndex, findingIndex, patch) => {
    setForm((f) => ({
      ...f,
      checklist_sections: f.checklist_sections.map((s, i) => (i !== sectionIndex ? s : {
        ...s,
        findings: s.findings.map((finding, fi) => (fi === findingIndex ? { ...finding, ...patch } : finding)),
      })),
    }));
  };

  const requiresActionNotes = form.service_action === 'Requires_Repair' || form.service_action === 'Schedule_Followup';

  const missingRequiredNotes = form.checklist_sections
    .flatMap((s) => s.findings)
    .some((f) => f.notes_required && !f.notes.trim());

  const handleDeleteSavedDocument = async (docId) => {
    if (!lastSavedId) return;
    const nextDocs = savedDocuments.filter((d) => d.id !== docId);
    await saveDocumentRecords(`service_documents_${lastSavedId}`, nextDocs);
    await db.entities.EquipmentService.update(lastSavedId, { documents: nextDocs.map(toDocumentRef) });
    setSavedDocuments(nextDocs);
  };

  const handleSave = async () => {
    if (!form.asset_id && !form.equipment_id.trim()) {
      toast({ title: 'Select an equipment record or enter an equipment ID', variant: 'destructive' });
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
    if (missingRequiredNotes) {
      toast({ title: 'Some checklist items require notes', description: 'Add notes to every item marked with *.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const created = await db.entities.EquipmentService.create({
        service_date: form.service_date,
        inspector_name: form.inspector_name.trim(),
        equipment_type: form.equipment_type,
        service_level: form.service_level,
        equipment_id: form.equipment_id.trim(),
        equipment_description: form.equipment_description.trim(),
        asset_id: form.asset_id || '',
        checklist_sections: form.checklist_sections,
        deficiencies: form.deficiencies.trim(),
        service_action: form.service_action,
        service_action_notes: requiresActionNotes ? form.service_action_notes.trim() : '',
        documents: [],
      });

      if (selectedAsset) {
        const level = form.service_level;
        const checkpoint = {
          date: form.service_date,
          ...(relevantUnits.has('miles') ? { odometer_miles: Number(form.current_odometer_miles) || 0 } : {}),
          ...(relevantUnits.has('engine_hours') ? { runtime_hours: Number(form.current_runtime_hours) || 0 } : {}),
        };
        await db.entities.erection_fleet_assets.update(selectedAsset.id, {
          ...(relevantUnits.has('miles') ? { odometer_miles: Number(form.current_odometer_miles) || 0 } : {}),
          ...(relevantUnits.has('engine_hours') ? { runtime_hours: Number(form.current_runtime_hours) || 0 } : {}),
          // Write the type back once if this asset didn't have one yet, so
          // it only has to be picked here a single time per asset.
          ...(selectedAsset.equipment_type ? {} : { equipment_type: form.equipment_type }),
          last_service_by_level: { ...(selectedAsset.last_service_by_level || {}), [level]: checkpoint },
        });
        setFleetAssets((prev) => prev.map((a) => (a.id === selectedAsset.id ? { ...a, equipment_type: form.equipment_type } : a)));
      }

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
      setForm((f) => ({ ...emptyForm(), equipment_type: f.equipment_type, service_level: f.service_level }));
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
  const allowed = isPlatformOperatorView || hasModule(effectiveCompany, '/field-operations/equipment-service');

  if (!allowed) {
    return <ModuleLocked modulePath="/field-operations/equipment-service" title="Equipment Service Not Included" />;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in max-w-3xl mx-auto">
      <PageHeader
        title="Equipment Service"
        subtitle="Escalating A/B/C/D service-level checklist, composed per equipment type"
        actions={<Link to="/field-operations"><Button variant="outline" size="sm" className="gap-1.5"><ArrowLeft className="w-3.5 h-3.5" />Field Operations</Button></Link>}
      />

      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
        <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <p>Intervals shown here are baselines — the manufacturer service manual for this specific asset always governs.</p>
      </div>

      <Section title="Administrative Header" open={openSections.admin} onToggle={() => toggleSection('admin')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Fleet Equipment (optional)</Label>
            <Select value={form.asset_id || '__none__'} onValueChange={(v) => selectAsset(v === '__none__' ? '' : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Not linked — free text below" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not linked — free text below</SelectItem>
                {fleetAssets.map((a) => <SelectItem key={a.id} value={a.id}>{a.asset_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Equipment ID / Tag {!form.asset_id && <span className="text-red-500">*</span>}</Label>
            <Input value={form.equipment_id} onChange={(e) => setForm((f) => ({ ...f, equipment_id: e.target.value }))} placeholder="e.g. TRK-014" className="mt-1" disabled={!!form.asset_id} />
          </div>
          <div>
            <Label>Equipment Type <span className="text-red-500">*</span></Label>
            <Select value={form.equipment_type} onValueChange={(v) => setForm((f) => ({ ...f, equipment_type: v }))} disabled={assetLocksType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{EQUIPMENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
            {assetLocksType && <p className="text-xs text-muted-foreground mt-1">Set on the linked fleet asset — edit it there to change.</p>}
          </div>
          <div>
            <Label>Service Level <span className="text-red-500">*</span></Label>
            <Select value={form.service_level} onValueChange={(v) => setForm((f) => ({ ...f, service_level: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{SERVICE_LEVELS.map((l) => <SelectItem key={l} value={l}>Level {l}</SelectItem>)}</SelectContent>
            </Select>
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
          {form.asset_id && relevantUnits.has('miles') && (
            <div>
              <Label className="flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" />Current Odometer (mi)</Label>
              <Input type="number" value={form.current_odometer_miles} onChange={(e) => setForm((f) => ({ ...f, current_odometer_miles: e.target.value }))} className="mt-1" />
            </div>
          )}
          {form.asset_id && relevantUnits.has('engine_hours') && (
            <div>
              <Label className="flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" />Current Engine Hours</Label>
              <Input type="number" value={form.current_runtime_hours} onChange={(e) => setForm((f) => ({ ...f, current_runtime_hours: e.target.value }))} className="mt-1" />
            </div>
          )}
        </div>
      </Section>

      {loadingSchedules ? (
        <div className="steel-card p-8 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : form.checklist_sections.length === 0 ? (
        <div className="steel-card p-6 text-center text-sm text-muted-foreground">
          No active service schedule found for this equipment type / level combination. Add one under Admin → Equipment Service Schedules.
        </div>
      ) : (
        form.checklist_sections.map((section, sectionIndex) => (
          <Section
            key={section.section}
            title={section.section}
            open={openSections[section.section]}
            onToggle={() => toggleSection(section.section)}
          >
            <p className="text-xs text-muted-foreground">Check any condition observed, and note its location. Items marked * require notes.</p>
            <div className="space-y-2">
              {section.findings.map((finding, findingIndex) => (
                <FindingRow key={finding.item} finding={finding} onChange={(patch) => updateFinding(sectionIndex, findingIndex, patch)} />
              ))}
            </div>
            <div>
              <Label className="text-xs">Section Notes</Label>
              <Textarea
                value={section.section_notes}
                onChange={(e) => updateSectionNotes(sectionIndex, e.target.value)}
                placeholder="Overall notes for this section (optional)"
                rows={2}
                className="mt-1"
              />
            </div>
          </Section>
        ))
      )}

      <Section title="Deficiencies & Action" open={openSections.action} onToggle={() => toggleSection('action')}>
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

      <Section title="Attach Documents" open={openSections.attachments} onToggle={() => toggleSection('attachments')}>
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
