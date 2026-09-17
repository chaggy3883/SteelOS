import React, { useEffect, useState } from 'react';
import { DollarSign } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { getAvailableSections } from '@/lib/meetingModeSections';
import { MEETING_FORMATS, DEFAULT_MEETING_FORMAT } from '@/lib/meetingModeFormats';

const todayStr = () => new Date().toISOString().slice(0, 10);

// Section keys default to the company's configured standard set
// (Company.meeting_mode_sections, set from Admin > Meeting Mode) but are
// freely adjustable for this one meeting — a specific occurrence doesn't
// need every section every time. Both the default set and the offered
// options are filtered through getAvailableSections(company), so a section
// the company's current pack doesn't grant is never even shown here.
export default function AddMeetingModal({ open, onOpenChange, company, onCreate }) {
  const [name, setName] = useState('');
  const [meetingDate, setMeetingDate] = useState(todayStr());
  const [format, setFormat] = useState(DEFAULT_MEETING_FORMAT);
  const [sections, setSections] = useState([]);
  const [saving, setSaving] = useState(false);

  const availableSections = getAvailableSections(company);
  const isProjectNotes = format === 'project_notes';

  useEffect(() => {
    if (!open) return;
    setName('');
    setMeetingDate(todayStr());
    setFormat(DEFAULT_MEETING_FORMAT);
    const defaults = (company?.meeting_mode_sections || []).filter((key) =>
      availableSections.some((s) => s.key === key)
    );
    setSections(defaults);
    // availableSections is recomputed each render from `company`, not a
    // stable dep — only re-derive defaults when the modal opens/company changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, company]);

  const toggleSection = (key) => {
    setSections((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const canCreate = name.trim() && meetingDate && (isProjectNotes || sections.length > 0) && !saving;

  const handleCreate = async () => {
    if (!canCreate) return;
    setSaving(true);
    try {
      await onCreate({ name: name.trim(), meeting_date: meetingDate, format, sections: isProjectNotes ? [] : sections });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Meeting</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="meeting-name">Meeting Name</Label>
            <Input id="meeting-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monday Shop Meeting" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="meeting-date">Date</Label>
            <Input id="meeting-date" type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Meeting Type</Label>
            <div className="mt-2 space-y-2">
              {MEETING_FORMATS.map((f) => (
                <div
                  key={f.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => setFormat(f.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFormat(f.key); } }}
                  className={`flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer ${
                    format === f.key ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <div className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border-2 ${format === f.key ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
                  <div className="flex-1">
                    <span className="font-medium text-sm">{f.label}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">{f.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {isProjectNotes ? (
            <p className="text-sm text-muted-foreground">
              No sections to choose — this meeting will open straight to the project/bid selector and notes panel.
            </p>
          ) : (
            <div>
              <Label>Sections</Label>
              {availableSections.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-1">No sections are available to your company's current pack.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {availableSections.map((s) => (
                    <div key={s.key} className="flex items-start gap-2.5 rounded-lg border border-border p-3">
                      <Checkbox
                        id={`section-${s.key}`}
                        checked={sections.includes(s.key)}
                        onCheckedChange={() => toggleSection(s.key)}
                        className="mt-0.5"
                      />
                      <label htmlFor={`section-${s.key}`} className="flex-1 cursor-pointer">
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
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!canCreate}>{saving ? 'Creating…' : 'Create Meeting'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
