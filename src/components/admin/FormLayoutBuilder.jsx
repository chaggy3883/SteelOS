import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Trash2, Save, Loader2 } from 'lucide-react';

const TARGET_FORMS = [
  { key: 'add_bid', label: 'Add Bid' },
  { key: 'hr_onboarding', label: 'HR Onboarding' },
  { key: 'new_candidate', label: 'New Candidate' },
  { key: 'new_project', label: 'New Project' },
];

const ELEMENT_TYPES = ['short_text', 'long_text', 'numeric', 'date', 'checkbox', 'dropdown'];

const VALIDATION_PRESETS = {
  none: '',
  email: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
  phone: '^\\(?\\d{3}\\)?[- ]?\\d{3}[- ]?\\d{4}$',
  alphanumeric: '^[a-zA-Z0-9 ]+$',
};

const presetForRegex = (regex) => Object.entries(VALIDATION_PRESETS).find(([, v]) => v === regex)?.[0] || (regex ? 'custom' : 'none');

const emptyField = () => ({ element_type: 'short_text', label: '', is_required: false, validation_regex: '' });

export default function FormLayoutBuilder() {
  const { toast } = useToast();
  const [targetFormKey, setTargetFormKey] = useState(TARGET_FORMS[0].key);
  const [layoutRow, setLayoutRow] = useState(null);
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadLayout(targetFormKey); }, [targetFormKey]);

  const loadLayout = async (key) => {
    setLoading(true);
    try {
      const rows = await db.entities.form_layouts.filter({ target_form_key: key }, '-created_date', 1);
      setLayoutRow(rows[0] || null);
      setFields(rows[0]?.fields_schema_json?.length ? rows[0].fields_schema_json.map((f) => ({ ...f })) : []);
    } finally {
      setLoading(false);
    }
  };

  const updateField = (index, patch) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const addField = () => setFields((prev) => [...prev, emptyField()]);
  const removeField = (index) => setFields((prev) => prev.filter((_, i) => i !== index));

  const handleSave = async () => {
    setSaving(true);
    try {
      if (layoutRow) {
        const updated = await db.entities.form_layouts.update(layoutRow.id, { fields_schema_json: fields });
        setLayoutRow(updated);
      } else {
        const created = await db.entities.form_layouts.create({ target_form_key: targetFormKey, fields_schema_json: fields });
        setLayoutRow(created);
      }
      toast({ title: 'Form layout saved' });
    } catch (e) {
      toast({ title: 'Unable to save form layout', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="steel-card p-5 space-y-4">
        <div>
          <Label className="text-xs">Target Form</Label>
          <Select value={targetFormKey} onValueChange={setTargetFormKey}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TARGET_FORMS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            This configures the field list persisted for this form key. It doesn't yet rewire the app's real {TARGET_FORMS.find((f) => f.key === targetFormKey)?.label} screen to render from it — see the preview alongside for what a consuming form would show.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-3">
            {fields.map((field, i) => (
              <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input value={field.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder="Field label" className="flex-1 h-8 text-sm" />
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => removeField(i)}>
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={field.element_type} onValueChange={(v) => updateField(i, { element_type: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ELEMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={presetForRegex(field.validation_regex)} onValueChange={(v) => updateField(i, { validation_regex: v === 'custom' ? field.validation_regex : (VALIDATION_PRESETS[v] || '') })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No validation</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="phone">Phone</SelectItem>
                      <SelectItem value="alphanumeric">Alphanumeric</SelectItem>
                      <SelectItem value="custom">Custom regex</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {presetForRegex(field.validation_regex) === 'custom' && (
                  <Input value={field.validation_regex} onChange={(e) => updateField(i, { validation_regex: e.target.value })} placeholder="Custom regex" className="h-8 text-xs font-mono" />
                )}
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={!!field.is_required} onChange={(e) => updateField(i, { is_required: e.target.checked })} />
                  Required
                </label>
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1.5 w-full" onClick={addField}>
              <Plus className="w-3.5 h-3.5" />Add Field
            </Button>
          </div>
        )}

        <Button onClick={handleSave} disabled={saving} className="gap-2 w-full steel-gradient text-white border-0">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save Layout
        </Button>
      </div>

      <div className="steel-card p-5">
        <h4 className="font-semibold text-sm mb-3">Live Preview</h4>
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fields configured yet.</p>
        ) : (
          <div className="space-y-3">
            {fields.map((field, i) => (
              <div key={i}>
                <Label className="text-xs">
                  {field.label || 'Untitled field'}{field.is_required && <span className="text-red-500 ml-0.5">*</span>}
                </Label>
                {field.element_type === 'long_text' ? (
                  <textarea disabled className="mt-1 w-full rounded-md border border-input bg-muted/30 px-3 py-1.5 text-sm" rows={2} />
                ) : field.element_type === 'checkbox' ? (
                  <div className="mt-1"><input type="checkbox" disabled /></div>
                ) : field.element_type === 'dropdown' ? (
                  <Select disabled><SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger></Select>
                ) : (
                  <Input disabled type={field.element_type === 'numeric' ? 'number' : field.element_type === 'date' ? 'date' : 'text'} className="mt-1 h-8 text-sm" />
                )}
                {field.validation_regex && <p className="text-[10px] text-muted-foreground font-mono mt-0.5">/{field.validation_regex}/</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
