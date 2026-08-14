import React, { useEffect, useState } from 'react';
import { Plus, X, Save, Check } from 'lucide-react';
import { db } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { noteDraftKey } from '@/lib/meetingNotes';
import EmployeePicker from '@/components/meeting-mode/EmployeePicker';
import EmployeeDetailModal from '@/components/meeting-mode/EmployeeDetailModal';

const todayStr = () => new Date().toISOString().slice(0, 10);
const emptyDraft = () => ({ noteBody: '', actionItems: [] });

// Docked alongside whatever project-bearing slide is on screen during a
// Project Review meeting — rebinds to a new project's draft the moment the
// PM navigates to a different job, without losing what was typed for the
// job they just left (that's in its own localStorage-keyed draft already).
export default function ProjectReviewNotesPanel({ project, currentUser, meetingType, employees, certifications }) {
  const { toast } = useToast();
  const [noteBody, setNoteBody] = useState('');
  const [actionItems, setActionItems] = useState([]);
  const [addingItem, setAddingItem] = useState(false);
  const [newDescription, setNewDescription] = useState('');
  const [newOwner, setNewOwner] = useState(null);
  const [newDueDate, setNewDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [employeeModal, setEmployeeModal] = useState(null);

  // Load this project's draft (if any) whenever the bound project changes.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(noteDraftKey(project.id));
      const draft = raw ? JSON.parse(raw) : emptyDraft();
      setNoteBody(draft.noteBody || '');
      setActionItems(draft.actionItems || []);
    } catch (e) {
      setNoteBody('');
      setActionItems([]);
    }
    setAddingItem(false);
    setJustSaved(false);
  }, [project.id]);

  // Autosave — plain localStorage write on every change, no debounce needed
  // since this is a synchronous local write, not a network call.
  useEffect(() => {
    localStorage.setItem(noteDraftKey(project.id), JSON.stringify({ noteBody, actionItems }));
  }, [project.id, noteBody, actionItems]);

  const employeeById = (id) => employees.find((e) => e.id === id);

  const handleAddItem = () => {
    if (!newDescription.trim()) return;
    setActionItems((prev) => [...prev, {
      description: newDescription.trim(),
      owner_id: newOwner?.id || '',
      due_date: newDueDate,
      status: 'Open',
    }]);
    setNewDescription('');
    setNewOwner(null);
    setNewDueDate('');
    setAddingItem(false);
  };

  const handleRemoveItem = (idx) => setActionItems((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!noteBody.trim() && actionItems.length === 0) {
      toast({ title: 'Nothing to save yet', description: 'Type a note or add an action item first.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await db.entities.ProjectMeetingNote.create({
        project_id: project.id,
        meeting_date: todayStr(),
        meeting_type: meetingType,
        author_id: currentUser?.id || '',
        note_body: noteBody.trim(),
        action_items: actionItems,
      });
      localStorage.removeItem(noteDraftKey(project.id));
      setNoteBody('');
      setActionItems([]);
      setJustSaved(true);
      toast({ title: 'Note saved to project record' });
      setTimeout(() => setJustSaved(false), 2500);
    } catch (e) {
      toast({ title: 'Unable to save note', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-96 flex-shrink-0 border-l border-slate-800 flex flex-col text-white">
      <div className="px-5 py-5 border-b border-slate-800">
        <p className="text-sm text-slate-400 uppercase tracking-wide">Project Review Notes</p>
        <p className="text-lg font-semibold mt-1">{project.name}</p>
        <p className="text-xs text-slate-500">Autosaves locally as you type — click Save to commit to the project.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <textarea
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          placeholder="Notes from today's review…"
          rows={8}
          className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-base placeholder:text-slate-500 focus:outline-none focus:border-blue-500 resize-none"
        />

        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Action Items</p>
          {actionItems.length > 0 && (
            <div className="space-y-2 mb-2">
              {actionItems.map((item, idx) => {
                const owner = employeeById(item.owner_id);
                return (
                  <div key={idx} className="flex items-start gap-2 border border-slate-800 rounded-lg px-3 py-2">
                    <div className="flex-1">
                      <p className="text-sm">{item.description}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                        {owner ? (
                          <button type="button" onClick={() => setEmployeeModal(owner)} className="underline hover:text-white">{owner.full_name}</button>
                        ) : (
                          <span>Unassigned</span>
                        )}
                        <span>{item.due_date || 'No due date'}</span>
                      </div>
                    </div>
                    <button type="button" onClick={() => handleRemoveItem(idx)} aria-label="Remove action item" className="text-slate-600 hover:text-red-400 flex-shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {addingItem ? (
            <div className="border border-slate-700 rounded-lg p-3 space-y-2">
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What needs to happen?"
                className="w-full h-9 px-2 rounded bg-slate-900 border border-slate-700 text-sm"
              />
              {newOwner ? (
                <div className="flex items-center justify-between text-sm">
                  <span>{newOwner.full_name}</span>
                  <button type="button" onClick={() => setNewOwner(null)} className="text-xs text-slate-400 hover:text-white">Change</button>
                </div>
              ) : (
                <EmployeePicker employees={employees} onPick={setNewOwner} placeholder="Owner…" />
              )}
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="w-full h-9 px-2 rounded bg-slate-900 border border-slate-700 text-sm"
              />
              <div className="flex gap-2">
                <button type="button" onClick={handleAddItem} className="h-8 px-3 rounded bg-blue-600 hover:bg-blue-500 text-sm font-medium">Add</button>
                <button type="button" onClick={() => { setAddingItem(false); setNewOwner(null); setNewDescription(''); setNewDueDate(''); }} className="h-8 px-3 text-sm text-slate-400 hover:text-white">Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setAddingItem(true)} className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-white">
              <Plus className="w-4 h-4" /> Add Action Item
            </button>
          )}
        </div>
      </div>

      <div className="px-5 py-4 border-t border-slate-800">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full h-11 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-base font-semibold flex items-center justify-center gap-2"
        >
          {justSaved ? <><Check className="w-5 h-5" /> Saved</> : <><Save className="w-5 h-5" /> {saving ? 'Saving…' : 'Save to Project'}</>}
        </button>
      </div>

      <EmployeeDetailModal open={!!employeeModal} onOpenChange={(o) => !o && setEmployeeModal(null)} employee={employeeModal} certifications={certifications} />
    </div>
  );
}
