import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { History, Save, Check, Search, X } from 'lucide-react';
import { db } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { getLiveProjects } from '@/lib/meetingModeData';
import MeetingNoteHistoryModal from '@/components/meeting-mode/MeetingNoteHistoryModal';
import UnsavedChangesModal from '@/components/meeting-mode/UnsavedChangesModal';

// A bid stops being a live thing to take notes on once it's won (it becomes
// a Project and should be selected as one going forward) or otherwise dead.
const ACTIVE_BID_STATUSES = ['draft', 'in_progress', 'submitted'];

// The 'project_notes' meeting format's entire body: a Project/Bid search
// picker on the left, a single free-text notes panel on the right — no
// sections, no data-display body. Deliberately fetches only Project.name/
// project_number and Bid.job_name/customer_name for the picker — never a
// cost/pricing field — so there is nothing to leak here by construction,
// same discipline as ProjectStatusSection.jsx's Shop-Meeting-style section.
//
// Notes are keyed by project_id/bid_id (not meeting_id) in MeetingNoteLog,
// reusing the exact same append-only "most recent row stays visible until
// edited" discipline as MeetingSectionNotesPanel.jsx, so a note struck for a
// given project/bid carries forward into every future project_notes meeting
// that selects it again, regardless of which Meeting instance saved it.
const ProjectBidNotesSession = forwardRef(function ProjectBidNotesSession(
  { meetingId, meetingName, currentUser, employees = [], onExit },
  ref
) {
  const { toast } = useToast();
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [projects, setProjects] = useState([]);
  const [bids, setBids] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null); // { type: 'project'|'bid', id, label, sublabel }
  const [pendingSelection, setPendingSelection] = useState(null);

  const [entries, setEntries] = useState([]);
  const [savedText, setSavedText] = useState('');
  const [text, setText] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [savingUnsaved, setSavingUnsaved] = useState(false);

  useEffect(() => {
    (async () => {
      setLoadingOptions(true);
      try {
        const [liveProjects, allBids] = await Promise.all([
          getLiveProjects(),
          db.entities.Bid.list('-created_date', 500),
        ]);
        setProjects(liveProjects);
        setBids(allBids.filter((b) => ACTIVE_BID_STATUSES.includes(b.status)));
      } catch (e) {
        setProjects([]);
        setBids([]);
      } finally {
        setLoadingOptions(false);
      }
    })();
  }, []);

  const options = useMemo(() => {
    const projectOptions = projects.map((p) => ({
      type: 'project',
      id: p.id,
      label: p.name,
      sublabel: p.project_number || '',
    }));
    const bidOptions = bids.map((b) => ({
      type: 'bid',
      id: b.id,
      label: b.job_name,
      sublabel: b.customer_name || '',
    }));
    const q = query.trim().toLowerCase();
    const all = [...projectOptions, ...bidOptions];
    if (!q) return all;
    return all.filter((o) => o.label?.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q));
  }, [projects, bids, query]);

  const isDirty = () => !!selected && text !== savedText;

  // Guards against an out-of-order async response: if the user selects a
  // new project/bid before an older loadEntriesFor call resolves, that
  // older call's result must never be applied once it finally comes back.
  const loadRequestIdRef = useRef(0);

  const loadEntriesFor = async (item) => {
    const requestId = ++loadRequestIdRef.current;
    setLoadingNotes(true);
    try {
      const filterKey = item.type === 'project' ? { project_id: item.id } : { bid_id: item.id };
      const rows = await db.entities.MeetingNoteLog.filter(filterKey, '-saved_at', 200);
      if (loadRequestIdRef.current !== requestId) return; // a newer selection has since started
      setEntries(rows);
      const latest = rows[0]?.note_text || '';
      setSavedText(latest);
      setText(latest);
    } catch (e) {
      if (loadRequestIdRef.current !== requestId) return;
      setEntries([]);
      setSavedText('');
      setText('');
    } finally {
      if (loadRequestIdRef.current === requestId) setLoadingNotes(false);
    }
  };

  const applySelection = (item) => {
    setSelected(item);
    setJustSaved(false);
    loadEntriesFor(item);
  };

  const selectItem = (item) => {
    if (selected?.type === item.type && selected?.id === item.id) return;
    if (isDirty()) {
      setPendingSelection(item);
      setShowUnsavedModal(true);
    } else {
      applySelection(item);
    }
  };

  const save = async () => {
    if (!selected || !isDirty()) return true;
    setSaving(true);
    try {
      await db.entities.MeetingNoteLog.create({
        meeting_id: meetingId,
        meeting_type: meetingName,
        section: 'project_notes',
        ...(selected.type === 'project' ? { project_id: selected.id } : { bid_id: selected.id }),
        note_text: text,
        saved_by: currentUser?.id || '',
        saved_at: new Date().toISOString(),
      });
      await loadEntriesFor(selected);
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

  const handleUnsavedSave = async () => {
    setSavingUnsaved(true);
    try {
      const ok = await save();
      if (ok) {
        setShowUnsavedModal(false);
        if (pendingSelection) applySelection(pendingSelection);
        setPendingSelection(null);
      }
    } finally {
      setSavingUnsaved(false);
    }
  };

  const handleUnsavedDiscard = () => {
    setShowUnsavedModal(false);
    if (pendingSelection) applySelection(pendingSelection);
    setPendingSelection(null);
  };

  const employeeName = (id) => employees.find((e) => e.id === id)?.full_name || 'Unknown';

  return (
    <>
      <div className="w-80 flex-shrink-0 border-r border-slate-800 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <p className="text-lg font-semibold truncate">{meetingName}</p>
          <p className="text-xs text-slate-500">Project / Bid Notes</p>
        </div>
        <div className="px-4 pt-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects or bids…"
              className="w-full h-9 pl-8 pr-8 rounded bg-slate-900 border border-slate-700 text-sm placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-2 text-slate-500 hover:text-white" aria-label="Clear search">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {loadingOptions ? (
            <p className="px-5 py-3 text-sm text-slate-500">Loading projects and bids…</p>
          ) : options.length === 0 ? (
            <p className="px-5 py-3 text-sm text-slate-500">No matching projects or bids.</p>
          ) : (
            options.map((o) => (
              <button
                key={`${o.type}:${o.id}`}
                type="button"
                onClick={() => selectItem(o)}
                aria-current={selected?.type === o.type && selected?.id === o.id ? 'true' : undefined}
                className={`w-full text-left px-5 py-3 border-l-4 transition-colors ${
                  selected?.type === o.type && selected?.id === o.id
                    ? 'border-blue-500 bg-slate-900 text-white'
                    : 'border-transparent text-slate-400 hover:text-white hover:bg-slate-900/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide bg-slate-800 text-slate-300 rounded px-1.5 py-0.5 flex-shrink-0">
                    {o.type === 'project' ? 'Project' : 'Bid'}
                  </span>
                  <span className="text-sm font-medium truncate">{o.label}</span>
                </div>
                {o.sublabel && <p className="text-xs text-slate-500 truncate mt-0.5 pl-1">{o.sublabel}</p>}
              </button>
            ))
          )}
        </div>
        <div className="px-5 py-4 border-t border-slate-800 flex items-center justify-end">
          <button type="button" onClick={onExit} className="text-slate-400 hover:text-white flex items-center gap-1.5 text-sm">
            <X className="w-4 h-4" /> Exit
          </button>
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col text-white">
        {!selected ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-2xl text-slate-400">Select a project or bid to begin.</p>
          </div>
        ) : (
          <>
            <div className="px-8 py-5 border-b border-slate-800 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xl font-semibold truncate">{selected.label}</p>
                {selected.sublabel && <p className="text-sm text-slate-500 truncate">{selected.sublabel}</p>}
              </div>
              <button type="button" onClick={() => setHistoryOpen(true)} className="text-slate-400 hover:text-white flex-shrink-0" aria-label="Note history">
                <History className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-8 py-6">
              <p className="text-xs text-slate-500 mb-2">Stays visible until edited — click Save to log a new entry. No pricing or cost data belongs in this panel.</p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={loadingNotes ? 'Loading…' : `Notes for ${selected.label}…`}
                disabled={loadingNotes}
                className="w-full h-full min-h-[16rem] px-4 py-3 rounded bg-slate-900 border border-slate-700 text-base placeholder:text-slate-500 focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>
            <div className="px-8 py-4 border-t border-slate-800">
              <button
                type="button"
                onClick={save}
                disabled={saving || !isDirty()}
                className="h-11 px-6 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-base font-semibold flex items-center justify-center gap-2"
              >
                {justSaved ? <><Check className="w-5 h-5" /> Saved</> : <><Save className="w-5 h-5" /> {saving ? 'Saving…' : 'Save'}</>}
              </button>
            </div>
          </>
        )}
      </div>

      <MeetingNoteHistoryModal
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        sectionLabel={selected?.label || ''}
        entries={entries}
        employeeName={employeeName}
      />

      <UnsavedChangesModal open={showUnsavedModal} onSave={handleUnsavedSave} onDiscard={handleUnsavedDiscard} saving={savingUnsaved} />
    </>
  );
});

export default ProjectBidNotesSession;
