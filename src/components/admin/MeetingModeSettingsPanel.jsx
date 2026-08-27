import React, { useEffect, useState } from 'react';
import { DollarSign, Loader2 } from 'lucide-react';
import { db } from '@/api/apiClient';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { getAvailableSections } from '@/lib/meetingModeSections';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';

// Company-wide defaults for the Meeting Mode "Add Meeting" section
// checklist. Only ever offers sections getAvailableSections(company) returns
// — a section the company's current pack doesn't grant is never shown here,
// let alone toggleable, per the standing "every offered section must trace
// back to a real module gate" rule.
export default function MeetingModeSettingsPanel() {
  const { toast } = useToast();
  const [company, setCompany] = useState(null);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getEffectiveCompany()
      .then((c) => {
        setCompany(c);
        setSelected(c?.meeting_mode_sections || []);
      })
      .catch(() => setCompany(null))
      .finally(() => setLoading(false));
  }, []);

  const availableSections = getAvailableSections(company);

  const toggleSection = (key) => {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const handleSave = async () => {
    if (!company?.id) {
      toast({ title: 'No active tenant to save settings for', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const updated = await db.entities.Company.update(company.id, { meeting_mode_sections: selected });
      setCompany(updated);
      toast({ title: 'Meeting Mode settings saved' });
    } catch (e) {
      toast({ title: 'Unable to save settings', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Meeting Mode — Default Sections</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Choose which sections are offered by default when someone creates a new meeting. Each meeting can still
          adjust its own sections at creation time — this only sets the starting point.
        </p>
      </div>

      {availableSections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Meeting Mode sections are available to your company's current pack.</p>
      ) : (
        <div className="space-y-2">
          {availableSections.map((s) => (
            <div key={s.key} className="flex items-start gap-2.5 rounded-lg border border-border p-3">
              <Checkbox
                id={`admin-section-${s.key}`}
                checked={selected.includes(s.key)}
                onCheckedChange={() => toggleSection(s.key)}
                className="mt-0.5"
              />
              <label htmlFor={`admin-section-${s.key}`} className="flex-1 cursor-pointer">
                <span className="flex items-center gap-1.5 font-medium text-sm">
                  {s.label}
                  {s.includesPricing && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-600 rounded px-1.5 py-0.5">
                      <DollarSign className="w-3 h-3" />Pricing
                    </span>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5">{s.description}</span>
              </label>
            </div>
          ))}
        </div>
      )}

      <Button onClick={handleSave} disabled={saving || !company?.id}>
        {saving ? 'Saving…' : 'Save Defaults'}
      </Button>
    </div>
  );
}
