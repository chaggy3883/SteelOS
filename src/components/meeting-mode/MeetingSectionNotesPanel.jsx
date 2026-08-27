import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { History, Save, Check } from 'lucide-react';
import { db } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import MeetingNoteHistoryModal from '@/components/meeting-mode/MeetingNoteHistoryModal';

// Docked alongside whichever section is active. The visible text is simply
// the most recent MeetingNoteLog row for this meeting+section — so it stays
// on screen, unedited, until someone actually types over it (per spec) —
// and Save always INSERTS a new row rather than updating one in place, same
// append-only discipline as StatusHistoryEntry. isDirty()/save() are exposed
// imperatively (mirrors BidDetail.jsx's takeoffRef.current?.isDirty?.()) so
// the parent's navigation guard can check/trigger a save without this panel
// re-rendering on every parent keystroke.
const MeetingSectionNotesPanel = forwardRef(function MeetingSectionNotesPanel(
  { meetingId, meetingName, section, currentUser, employees = [] },
  ref
) {
  const { toast } = useToast();
  const [entries, setEntries] = useState([]);
  const [savedText, setSavedText] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadEntries = async () => {
    setLoading(true);
    try {
      const rows = await db.entities.MeetingNoteLog.filter({ meeting_id: meetingId, section: section.key }, '-saved_at', 200);
      setEntries(rows);
      const latest = rows[0]?.note_text || '';
      setSavedText(latest);
      setText(latest);
    } catch (e) {
      setEntries([]);
      setSavedText('');
      setText('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEntries();
    setJustSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, section.key]);

  const isDirty = () => text !== savedText;

  const save = async () => {
    if (!isDirty()) return true;
    setSaving(true);
    try {
      await db.entities.MeetingNoteLog.create({
        meeting_id: meetingId,
        meeting_type: meetingName,
        section: section.key,
        note_text: text,
        saved_by: currentUser?.id || '',
        saved_at: new Date().toISOString(),
      });
      await loadEntries();
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      return true;
    } catch (e) {
      toast({ title: 'Unable to save note', variant: 'destructive' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({ isDirty, save }));

  const employeeName = (id) => employees.find((e) => e.id === id)?.full_name || 'Unknown';

  return (
    <div className="w-96 flex-shrink-0 border-l border-slate-800 flex flex-col text-white">
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400 uppercase tracking-wide">{section.label} Notes</p>
          <button type="button" onClick={() => setHistoryOpen(true)} className="text-slate-400 hover:text-white" aria-label="Note history">
            <History className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-1">Stays visible until edited — click Save to log a new entry.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={loading ? 'Loading…' : "Notes from today's meeting…"}
          disabled={loading}
          rows={14}
          className="w-full h-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-base placeholder:text-slate-500 focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>

      <div className="px-5 py-4 border-t border-slate-800">
        <button
          type="button"
          onClick={save}
          disabled={saving || !isDirty()}
          className="w-full h-11 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-base font-semibold flex items-center justify-center gap-2"
        >
          {justSaved ? <><Check className="w-5 h-5" /> Saved</> : <><Save className="w-5 h-5" /> {saving ? 'Saving…' : 'Save'}</>}
        </button>
      </div>

      <MeetingNoteHistoryModal
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        sectionLabel={section.label}
        entries={entries}
        employeeName={employeeName}
      />
    </div>
  );
});

export default MeetingSectionNotesPanel;
