import React, { useEffect, useState } from 'react';
import { Plus, X, Loader2 } from 'lucide-react';
import { db } from '@/api/apiClient';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';

// Company-wide standard attendee list for the Turnover / Contract Review
// meeting (Project Handoff tab on a project). Unlike Meeting Mode's section
// checklist (a fixed option list you toggle), attendees are open-ended names/
// roles specific to each company, so this is a free-text add/remove editor
// rather than a checkbox grid.
export default function TurnoverMeetingSettingsPanel() {
  const { toast } = useToast();
  const [company, setCompany] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [newAttendee, setNewAttendee] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getEffectiveCompany()
      .then((c) => {
        setCompany(c);
        setAttendees(c?.turnover_meeting_standard_attendees || []);
      })
      .catch(() => setCompany(null))
      .finally(() => setLoading(false));
  }, []);

  const addAttendee = () => {
    const trimmed = newAttendee.trim();
    if (!trimmed) return;
    setAttendees((prev) => [...prev, trimmed]);
    setNewAttendee('');
  };

  const removeAttendee = (index) => {
    setAttendees((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!company?.id) {
      toast({ title: 'No active tenant to save settings for', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const updated = await db.entities.Company.update(company.id, { turnover_meeting_standard_attendees: attendees });
      setCompany(updated);
      toast({ title: 'Turnover Meeting settings saved' });
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
        <h3 className="text-lg font-semibold">Turnover Meeting — Required Attendees</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Standard list of required attendee names/roles for the Turnover / Contract Review meeting. Pre-fills a new
          project's attendee list — each project can still add, remove, or edit its own copy after that.
        </p>
      </div>

      <div className="space-y-2">
        {attendees.length === 0 && (
          <p className="text-sm text-muted-foreground">No standard attendees configured yet.</p>
        )}
        {attendees.map((name, index) => (
          <div key={`${name}-${index}`} className="flex items-center gap-2 rounded-lg border border-border p-2 pl-3">
            <span className="flex-1 text-sm">{name}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeAttendee(index)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={newAttendee}
          placeholder="e.g. Project Manager, Estimator, Shop Foreman"
          onChange={(e) => setNewAttendee(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAttendee(); } }}
          className="h-9"
        />
        <Button variant="outline" onClick={addAttendee} disabled={!newAttendee.trim()}>
          <Plus className="w-4 h-4 mr-1" />Add
        </Button>
      </div>

      <Button onClick={handleSave} disabled={saving || !company?.id}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}
