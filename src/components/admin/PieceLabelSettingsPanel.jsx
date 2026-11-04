import React, { useEffect, useState } from 'react';
import { Loader2, Tag } from 'lucide-react';
import { db } from '@/api/apiClient';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import {
  LABEL_SIZE_PRESETS, LABEL_FIELDS, MIN_LABEL_IN, MAX_LABEL_IN, normalizePieceLabelSettings,
} from '@/lib/pieceLabelSettings';

// Admin → Piece Labels: the label stock this company prints piece stickers
// on (Project → Pieces → Print labels) and which fields go on them. Saved to
// Company.piece_label_settings; pieceLabelPdf.js fits the layout to the size.
export default function PieceLabelSettingsPanel() {
  const { toast } = useToast();
  const [company, setCompany] = useState(null);
  const [form, setForm] = useState(() => normalizePieceLabelSettings(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getEffectiveCompany()
      .then((c) => {
        setCompany(c);
        setForm(normalizePieceLabelSettings(c?.piece_label_settings));
      })
      .catch(() => setCompany(null))
      .finally(() => setLoading(false));
  }, []);

  const pickSize = (key) => {
    const preset = LABEL_SIZE_PRESETS.find((p) => p.key === key);
    setForm((f) => (preset
      ? { ...f, size_key: key, width_in: preset.widthIn, height_in: preset.heightIn }
      : { ...f, size_key: 'custom' }));
  };

  const toggleField = (key) => {
    setForm((f) => ({ ...f, fields: f.fields.includes(key) ? f.fields.filter((k) => k !== key) : [...f.fields, key] }));
  };

  const handleSave = async () => {
    if (!company?.id) {
      toast({ title: 'No active company to save settings for', variant: 'destructive' });
      return;
    }
    const settings = normalizePieceLabelSettings(form);
    setSaving(true);
    try {
      const updated = await db.entities.Company.update(company.id, { piece_label_settings: settings });
      setCompany(updated);
      setForm(settings);
      toast({ title: `Piece labels saved — ${settings.width_in}" x ${settings.height_in}"` });
    } catch (e) {
      toast({ title: 'Unable to save label settings', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;
  }

  const isCustom = form.size_key === 'custom';

  return (
    <div className="steel-card p-5 space-y-6 max-w-2xl">
      <div>
        <h3 className="font-semibold flex items-center gap-2"><Tag className="w-4 h-4 text-primary" />Piece Labels</h3>
        <p className="text-xs text-muted-foreground mt-1">
          The sticker size your label printer uses and what prints on each piece label. Used by Project → Pieces → Print labels:
          one label per page, cut to this size.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Label size</Label>
        <div className="flex flex-wrap gap-2">
          {LABEL_SIZE_PRESETS.map((p) => (
            <Button key={p.key} type="button" size="sm" variant={form.size_key === p.key ? 'default' : 'outline'} onClick={() => pickSize(p.key)}>
              {p.label}
            </Button>
          ))}
          <Button type="button" size="sm" variant={isCustom ? 'default' : 'outline'} onClick={() => pickSize('custom')}>Custom</Button>
        </div>
        {isCustom && (
          <div className="flex items-end gap-3 pt-2">
            <div>
              <Label className="text-xs">Width (in)</Label>
              <Input type="number" step="0.25" min={MIN_LABEL_IN} max={MAX_LABEL_IN} value={form.width_in}
                onChange={(e) => setForm((f) => ({ ...f, width_in: e.target.value }))} className="h-8 w-24 mt-1" />
            </div>
            <span className="pb-2 text-muted-foreground">x</span>
            <div>
              <Label className="text-xs">Height (in)</Label>
              <Input type="number" step="0.25" min={MIN_LABEL_IN} max={MAX_LABEL_IN} value={form.height_in}
                onChange={(e) => setForm((f) => ({ ...f, height_in: e.target.value }))} className="h-8 w-24 mt-1" />
            </div>
            <span className="pb-2 text-xs text-muted-foreground">{MIN_LABEL_IN}" to {MAX_LABEL_IN}" each side</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Print on each label</Label>
        <p className="text-xs text-muted-foreground">The QR code always prints. Turned-off boxes leave more room for the rest.</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {LABEL_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={form.fields.includes(f.key)} onCheckedChange={() => toggleField(f.key)} />
              {f.label}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
          <Checkbox checked={form.uppercase} onCheckedChange={(v) => setForm((f) => ({ ...f, uppercase: v === true }))} />
          Print in capital letters
        </label>
      </div>

      <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save label settings'}</Button>
    </div>
  );
}
