import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { isAdminUser } from '@/lib/tenantContext';
import { EQUIPMENT_TYPES, SERVICE_LEVELS, INTERVAL_UNITS } from '@/lib/serviceScheduleEngine';
import { ShieldCheck, Loader2, Trash2, ArrowLeft, Plus, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';

const emptyForm = () => ({
  equipment_type: EQUIPMENT_TYPES[0].value,
  service_level: 'A',
  interval_value: '',
  interval_unit: 'engine_hours',
  interval_label: '',
  hasSecondary: false,
  secondary_interval_value: '',
  secondary_interval_unit: 'months',
  checklist_items: [],
  is_active: true,
});

const emptyItem = () => ({ section: '', item: '', notes_required: false });

export default function ServiceScheduleDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { toast } = useToast();

  const [currentUser, setCurrentUser] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [schedule, setSchedule] = useState(null);
  const [form, setForm] = useState(emptyForm());

  useEffect(() => {
    db.auth.me().then((u) => { setCurrentUser(u); setCheckingAccess(false); }).catch(() => setCheckingAccess(false));
  }, []);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      setLoading(true);
      try {
        const record = await db.entities.ServiceSchedule.get(id);
        setSchedule(record);
        setForm({
          equipment_type: record.equipment_type || EQUIPMENT_TYPES[0].value,
          service_level: record.service_level || 'A',
          interval_value: String(record.interval_value ?? ''),
          interval_unit: record.interval_unit || 'engine_hours',
          interval_label: record.interval_label || '',
          hasSecondary: !!record.secondary_interval_unit,
          secondary_interval_value: String(record.secondary_interval_value ?? ''),
          secondary_interval_unit: record.secondary_interval_unit || 'months',
          checklist_items: (record.checklist_items || []).map((i) => ({ ...i })),
          is_active: record.is_active !== false,
        });
      } catch (e) {
        toast({ title: 'Schedule not found', variant: 'destructive' });
        navigate('/admin/service-schedules');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  const updateItem = (index, patch) => {
    setForm((f) => ({ ...f, checklist_items: f.checklist_items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));
  };

  const addItem = () => setForm((f) => ({ ...f, checklist_items: [...f.checklist_items, emptyItem()] }));
  const removeItem = (index) => setForm((f) => ({ ...f, checklist_items: f.checklist_items.filter((_, i) => i !== index) }));

  const isValid = form.interval_value !== '' && !Number.isNaN(Number(form.interval_value))
    && form.checklist_items.every((it) => it.section.trim() && it.item.trim());

  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      const payload = {
        equipment_type: form.equipment_type,
        service_level: form.service_level,
        interval_value: Number(form.interval_value),
        interval_unit: form.interval_unit,
        interval_label: form.interval_label.trim(),
        secondary_interval_value: form.hasSecondary ? Number(form.secondary_interval_value) || 0 : null,
        secondary_interval_unit: form.hasSecondary ? form.secondary_interval_unit : null,
        checklist_items: form.checklist_items.map((it) => ({ section: it.section.trim(), item: it.item.trim(), notes_required: !!it.notes_required })),
        is_active: form.is_active,
      };

      if (isNew) {
        const created = await db.entities.ServiceSchedule.create(payload);
        toast({ title: 'Schedule created' });
        navigate(`/admin/service-schedules/${created.id}`);
      } else {
        const updated = await db.entities.ServiceSchedule.update(id, payload);
        setSchedule(updated);
        toast({ title: 'Schedule updated' });
      }
    } catch (e) {
      toast({ title: 'Failed to save schedule', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this service schedule? This cannot be undone.')) return;
    try {
      await db.entities.ServiceSchedule.delete(id);
      toast({ title: 'Schedule deleted' });
      navigate('/admin/service-schedules');
    } catch (e) {
      toast({ title: 'Failed to delete schedule', variant: 'destructive' });
    }
  };

  if (checkingAccess) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!isAdminUser(currentUser)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Admin Access Required</h2>
        <p className="text-sm text-muted-foreground">You need administrator privileges to manage service schedules.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  const typeLabel = EQUIPMENT_TYPES.find((t) => t.value === form.equipment_type)?.label || form.equipment_type;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <button onClick={() => navigate('/admin/service-schedules')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" />Back to Service Schedules
      </button>

      <PageHeader
        title={isNew ? 'New Service Schedule' : `${typeLabel} — Level ${form.service_level}`}
        subtitle="Defines the baseline interval and checklist for one equipment type + service level."
      />

      <div className="mb-6 flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
        <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <p>This is a baseline interval — the manufacturer service manual for a specific asset always governs. Only store this level's OWN checklist items here; the form composes A→B→C→D cumulatively at render time.</p>
      </div>

      <div className="steel-card p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Equipment Type</Label>
            <Select value={form.equipment_type} onValueChange={(v) => setForm((f) => ({ ...f, equipment_type: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{EQUIPMENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Service Level</Label>
            <Select value={form.service_level} onValueChange={(v) => setForm((f) => ({ ...f, service_level: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{SERVICE_LEVELS.map((l) => <SelectItem key={l} value={l}>Level {l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-muted/40 border border-border space-y-3">
          <Label className="block">Primary Interval</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input type="number" min={0} value={form.interval_value} onChange={(e) => setForm((f) => ({ ...f, interval_value: e.target.value }))} placeholder="Value" />
            <Select value={form.interval_unit} onValueChange={(v) => setForm((f) => ({ ...f, interval_unit: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{INTERVAL_UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Display Label (optional — e.g. "10,000–15,000 mi")</Label>
            <Input value={form.interval_label} onChange={(e) => setForm((f) => ({ ...f, interval_label: e.target.value }))} className="mt-1" />
          </div>

          <label className="flex items-center gap-2 text-sm pt-1">
            <Checkbox checked={form.hasSecondary} onCheckedChange={(v) => setForm((f) => ({ ...f, hasSecondary: !!v }))} />
            Add an "OR — whichever comes first" second trigger (e.g. "1,000 hours or 12 months")
          </label>

          {form.hasSecondary && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-6">
              <Input type="number" min={0} value={form.secondary_interval_value} onChange={(e) => setForm((f) => ({ ...f, secondary_interval_value: e.target.value }))} placeholder="Value" />
              <Select value={form.secondary_interval_unit} onValueChange={(v) => setForm((f) => ({ ...f, secondary_interval_unit: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{INTERVAL_UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Checklist Items (this level's own — composed cumulatively with lower levels)</Label>
            <Button size="sm" variant="outline" onClick={addItem}><Plus className="w-3.5 h-3.5" />Add Item</Button>
          </div>
          {form.checklist_items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-border rounded-lg">No items yet.</p>
          ) : (
            <div className="space-y-2">
              {form.checklist_items.map((it, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-2.5 sm:flex-row sm:items-start">
                  <Input value={it.section} onChange={(e) => updateItem(i, { section: e.target.value })} placeholder="Section (e.g. Engine)" className="sm:w-40 flex-shrink-0" />
                  <Input value={it.item} onChange={(e) => updateItem(i, { item: e.target.value })} placeholder="Checklist item text" className="flex-1" />
                  <label className="flex items-center gap-1.5 text-xs flex-shrink-0 whitespace-nowrap">
                    <Checkbox checked={it.notes_required} onCheckedChange={(v) => updateItem(i, { notes_required: !!v })} />
                    Notes required
                  </label>
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => removeItem(i)}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg border border-border">
          <div>
            <p className="text-sm font-medium">Active</p>
            <p className="text-xs text-muted-foreground">Only active schedules are offered on the Equipment Service form and evaluated for due/overdue tracking.</p>
          </div>
          <Switch checked={form.is_active} onCheckedChange={(is_active) => setForm((f) => ({ ...f, is_active }))} />
        </div>
      </div>

      <div className="flex items-center justify-between mt-6">
        {!isNew ? (
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={handleDelete}>
            <Trash2 className="w-4 h-4" />Delete
          </Button>
        ) : <span />}
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/admin/service-schedules')}>Cancel</Button>
          <Button onClick={handleSave} disabled={!isValid || saving} className="steel-gradient text-white border-0">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{isNew ? 'Create Schedule' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
