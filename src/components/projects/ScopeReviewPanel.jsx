import React, { useEffect, useState, useRef, useImperativeHandle, forwardRef } from 'react';
import { Plus, X, Loader2, Download, RefreshCw, AlertTriangle } from 'lucide-react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import ConflictResolutionModal from '@/components/projects/ConflictResolutionModal';

// IMPORTANT — read before touching the save/conflict logic below:
//
// This app has no real-time backend (SPA + localStorage, see
// src/api/localData.js's own "HONESTY NOTE"). What follows is OPTIMISTIC
// CONCURRENCY CONFLICT *PREVENTION*, not collaborative live editing — it
// stops two people from silently clobbering each other's work, it does not
// give them a shared live cursor. Each question saves independently (its own
// create/update call) so two people editing DIFFERENT questions never
// collide at all. For the SAME question: before writing, we re-fetch that
// row's current updated_date and compare it to the value this tab had when
// it last loaded/synced that row (see `updated_date`, generically stamped by
// localData.js's normalizeRecord/update on every write — no separate
// "updated_at" field was added since one already exists). A mismatch means
// someone else wrote to it in between; the write is refused and
// ConflictResolutionModal shows both versions so a person — not code —
// decides which one survives. A periodic freshness poll (see
// FRESHNESS_POLL_MS below) surfaces a "this changed elsewhere" banner even
// before the user tries to save, but it only ever refreshes rows that are
// NOT locally dirty — it can never silently discard an unsaved edit.
const FRESHNESS_POLL_MS = 45000;

const toLocalRow = (row) => ({ ...row, _localKey: row.id });
const newLocalRow = (identity) => ({
  _localKey: `new-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  id: null,
  question_text: '',
  answer_text: '',
  raised_by: identity,
  raised_date: new Date().toISOString().slice(0, 10),
  answered_date: '',
  sort_order: 0,
  updated_date: null,
});

// Clearing an answer back to blank un-answers the question — don't leave a
// stale answered_date behind pointing at text that's gone.
const answeredDateFor = (row) => (String(row.answer_text || '').trim() ? (row.answered_date || new Date().toISOString().slice(0, 10)) : '');

const ScopeReviewPanel = forwardRef(function ScopeReviewPanel({ project, onExportPdf }, ref) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [questions, setQuestions] = useState([]);
  // Last-confirmed-synced snapshot per row, keyed by the row's stable
  // _localKey (never re-keyed, even once a brand-new row gets a real id —
  // see saveRow). This is both the dirty-check baseline and the
  // optimistic-concurrency baseline.
  const syncedRef = useRef(new Map());
  const [generalNotes, setGeneralNotes] = useState('');
  const [savedGeneralNotes, setSavedGeneralNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingKeys, setSavingKeys] = useState(new Set());
  const [savingNotes, setSavingNotes] = useState(false);
  const [staleInfo, setStaleInfo] = useState({ changedKeys: new Set(), deletedKeys: new Set(), newCount: 0 });
  const [conflict, setConflict] = useState(null); // { localKey, intent: 'save'|'save-deleted'|'delete', mine, theirs }
  const [resolvingConflict, setResolvingConflict] = useState(false);

  const isRowDirty = (row) => {
    const synced = syncedRef.current.get(row._localKey);
    if (!synced) return !!(row.question_text || '').trim() || !!(row.answer_text || '').trim();
    return row.question_text !== synced.question_text || row.answer_text !== synced.answer_text;
  };

  const isDirty = () => questions.some(isRowDirty) || generalNotes !== savedGeneralNotes;

  const applySynced = (localKey, dbRow) => {
    syncedRef.current.set(localKey, dbRow);
    setQuestions((prev) => prev.map((q) => (q._localKey === localKey ? { ...dbRow, _localKey: localKey } : q)));
  };

  const load = async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const rows = await db.entities.ScopeReviewQuestion.filter({ project_id: project.id }, 'sort_order', 500);
      syncedRef.current = new Map(rows.map((r) => [r.id, r]));
      setQuestions(rows.map(toLocalRow));
      setStaleInfo({ changedKeys: new Set(), deletedKeys: new Set(), newCount: 0 });
      setGeneralNotes(project.scope_review_general_notes || '');
      setSavedGeneralNotes(project.scope_review_general_notes || '');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [project?.id]);

  // Lightweight freshness poll — see the file-top note. Never touches local
  // state's actual field values, only flags what's stale; Refresh (below) is
  // the only thing that pulls new content in, and even that skips dirty rows.
  useEffect(() => {
    if (!project?.id) return;
    const interval = setInterval(async () => {
      try {
        const rows = await db.entities.ScopeReviewQuestion.filter({ project_id: project.id }, 'sort_order', 500);
        const liveById = new Map(rows.map((r) => [r.id, r]));
        const changedKeys = new Set();
        const deletedKeys = new Set();
        syncedRef.current.forEach((synced, key) => {
          if (!synced.id) return; // never-saved local row — nothing to compare
          const live = liveById.get(synced.id);
          if (!live) { deletedKeys.add(key); return; }
          if (live.updated_date !== synced.updated_date) changedKeys.add(key);
        });
        const knownIds = new Set(Array.from(syncedRef.current.values()).map((s) => s.id).filter(Boolean));
        const newCount = rows.filter((r) => !knownIds.has(r.id)).length;
        setStaleInfo({ changedKeys, deletedKeys, newCount });
      } catch (e) {
        // best-effort — a failed poll just skips this cycle
      }
    }, FRESHNESS_POLL_MS);
    return () => clearInterval(interval);
  }, [project?.id]);

  const refresh = async () => {
    if (!project?.id) return;
    const rows = await db.entities.ScopeReviewQuestion.filter({ project_id: project.id }, 'sort_order', 500);
    const nextSynced = new Map();
    setQuestions((prevLocal) => {
      const dirty = prevLocal.filter(isRowDirty);
      dirty.forEach((q) => {
        const s = syncedRef.current.get(q._localKey);
        if (s) nextSynced.set(q._localKey, s);
      });
      const keptIds = new Set(dirty.map((q) => q.id).filter(Boolean));
      const freshOthers = rows.filter((r) => !keptIds.has(r.id)).map(toLocalRow);
      freshOthers.forEach((q) => nextSynced.set(q._localKey, rows.find((r) => r.id === q.id)));
      return [...dirty, ...freshOthers].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    });
    syncedRef.current = nextSynced;
    if (generalNotes === savedGeneralNotes) {
      const freshProject = await db.entities.Project.get(project.id).catch(() => null);
      if (freshProject) {
        setGeneralNotes(freshProject.scope_review_general_notes || '');
        setSavedGeneralNotes(freshProject.scope_review_general_notes || '');
      }
    }
    setStaleInfo({ changedKeys: new Set(), deletedKeys: new Set(), newCount: 0 });
    toast({ title: 'Refreshed' });
  };

  const addQuestion = () => {
    const identity = user?.full_name || user?.email || 'Unknown';
    setQuestions((prev) => [...prev, { ...newLocalRow(identity), sort_order: prev.length }]);
  };

  // Same precaution as TurnoverReviewPanel.jsx's assertPlainValue — every
  // field handler here funnels through updateQuestion/updateGeneralNotes, so
  // this one guard covers all of them. No leak has surfaced in this panel,
  // but this closes off the same class of bug (a raw event/DOM node landing
  // in state and only failing much later, cryptically, inside
  // db.entities...create/update's JSON.stringify).
  const assertPlainValue = (field, value) => {
    try {
      JSON.stringify(value);
      return true;
    } catch (e) {
      console.error(`ScopeReviewPanel: refusing to store a non-serializable value into "${field}" (likely a raw event/DOM node/component instance from an onChange handler, not a plain value).`, value);
      return false;
    }
  };
  const updateQuestion = (localKey, field, value) => {
    if (!assertPlainValue(field, value)) return;
    setQuestions((prev) => prev.map((q) => (q._localKey === localKey ? { ...q, [field]: value } : q)));
  };
  const updateGeneralNotes = (value) => {
    if (!assertPlainValue('generalNotes', value)) return;
    setGeneralNotes(value);
  };

  const saveRow = async (localKey) => {
    const row = questions.find((q) => q._localKey === localKey);
    if (!row || !project?.id) return false;
    setSavingKeys((prev) => new Set(prev).add(localKey));
    try {
      const answered = answeredDateFor(row);
      if (!row.id) {
        const created = await db.entities.ScopeReviewQuestion.create({
          project_id: project.id,
          question_text: row.question_text,
          answer_text: row.answer_text,
          raised_by: row.raised_by,
          raised_date: row.raised_date,
          answered_date: answered,
          sort_order: row.sort_order,
        });
        applySynced(localKey, created);
        toast({ title: 'Question saved' });
        return true;
      }
      const synced = syncedRef.current.get(localKey);
      const current = await db.entities.ScopeReviewQuestion.get(row.id);
      if (!current) {
        setConflict({ localKey, intent: 'save-deleted', mine: { ...row, answered_date: answered }, theirs: null });
        return false;
      }
      if (current.updated_date !== synced?.updated_date) {
        setConflict({ localKey, intent: 'save', mine: { ...row, answered_date: answered }, theirs: current });
        return false;
      }
      const updated = await db.entities.ScopeReviewQuestion.update(row.id, {
        question_text: row.question_text,
        answer_text: row.answer_text,
        answered_date: answered,
      });
      applySynced(localKey, updated);
      toast({ title: 'Question saved' });
      return true;
    } catch (e) {
      toast({ title: 'Unable to save', description: e?.message || 'Please retry.', variant: 'destructive' });
      return false;
    } finally {
      setSavingKeys((prev) => { const next = new Set(prev); next.delete(localKey); return next; });
    }
  };

  const removeQuestion = async (localKey) => {
    const row = questions.find((q) => q._localKey === localKey);
    if (!row) return;
    if (!row.id) {
      setQuestions((prev) => prev.filter((q) => q._localKey !== localKey));
      return;
    }
    const synced = syncedRef.current.get(localKey);
    const current = await db.entities.ScopeReviewQuestion.get(row.id);
    if (!current) {
      // Already gone — nothing to conflict over.
      setQuestions((prev) => prev.filter((q) => q._localKey !== localKey));
      syncedRef.current.delete(localKey);
      toast({ title: 'Already removed elsewhere' });
      return;
    }
    if (current.updated_date !== synced?.updated_date) {
      setConflict({ localKey, intent: 'delete', mine: row, theirs: current });
      return;
    }
    await db.entities.ScopeReviewQuestion.delete(row.id);
    setQuestions((prev) => prev.filter((q) => q._localKey !== localKey));
    syncedRef.current.delete(localKey);
  };

  const saveGeneralNotes = async () => {
    if (!project?.id) return false;
    setSavingNotes(true);
    try {
      await db.entities.Project.update(project.id, { scope_review_general_notes: generalNotes });
      setSavedGeneralNotes(generalNotes);
      toast({ title: 'General Notes saved' });
      return true;
    } catch (e) {
      toast({ title: 'Unable to save', description: e?.message || 'Please retry.', variant: 'destructive' });
      return false;
    } finally {
      setSavingNotes(false);
    }
  };

  const handleConflictKeepMine = async () => {
    if (!conflict) return;
    const { localKey, intent, mine } = conflict;
    setResolvingConflict(true);
    try {
      if (intent === 'delete') {
        await db.entities.ScopeReviewQuestion.delete(mine.id);
        setQuestions((prev) => prev.filter((q) => q._localKey !== localKey));
        syncedRef.current.delete(localKey);
        toast({ title: 'Question deleted' });
      } else if (intent === 'save-deleted') {
        const created = await db.entities.ScopeReviewQuestion.create({
          project_id: project.id,
          question_text: mine.question_text,
          answer_text: mine.answer_text,
          raised_by: mine.raised_by,
          raised_date: mine.raised_date,
          answered_date: mine.answered_date,
          sort_order: mine.sort_order,
        });
        applySynced(localKey, created);
        toast({ title: 'Question saved' });
      } else {
        const updated = await db.entities.ScopeReviewQuestion.update(mine.id, {
          question_text: mine.question_text,
          answer_text: mine.answer_text,
          answered_date: mine.answered_date,
        });
        applySynced(localKey, updated);
        toast({ title: 'Your version saved' });
      }
    } catch (e) {
      toast({ title: 'Unable to save', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setResolvingConflict(false);
      setConflict(null);
    }
  };

  const handleConflictTakeTheirs = () => {
    if (!conflict) return;
    const { localKey, theirs } = conflict;
    if (theirs) {
      applySynced(localKey, theirs);
    } else {
      // Their side has no row at all (it was deleted) — drop ours too.
      setQuestions((prev) => prev.filter((q) => q._localKey !== localKey));
      syncedRef.current.delete(localKey);
    }
    setConflict(null);
  };

  // Exposed to ProjectHandoffPanel/ProjectDetail for the page-leave guard —
  // saves every currently-dirty row. If any one hits a conflict, that row's
  // ConflictResolutionModal opens and this returns false so the caller
  // doesn't navigate away with an unresolved conflict sitting on screen.
  const saveAllDirty = async () => {
    const dirtyKeys = questions.filter(isRowDirty).map((q) => q._localKey);
    let allOk = true;
    for (const key of dirtyKeys) {
      const ok = await saveRow(key);
      if (!ok) allOk = false;
    }
    if (generalNotes !== savedGeneralNotes) {
      const ok = await saveGeneralNotes();
      if (!ok) allOk = false;
    }
    return allOk;
  };

  // getPrintData exposes this panel's current in-memory state for
  // scopeReviewPdf.js's generateScopeReviewPdf(), so the export always
  // reflects what's actually on screen rather than a stale fetch-on-open.
  useImperativeHandle(ref, () => ({ isDirty, save: saveAllDirty, getPrintData: () => ({ questions, generalNotes }) }));

  const unansweredCount = questions.filter((q) => !String(q.answer_text || '').trim()).length;
  const hasStaleData = staleInfo.changedKeys.size > 0 || staleInfo.deletedKeys.size > 0 || staleInfo.newCount > 0;

  if (loading) {
    return <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            Scope Review
            {questions.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${unansweredCount > 0 ? 'bg-amber-500/10 text-amber-600' : 'bg-green-500/10 text-green-600'}`}>
                {unansweredCount > 0 ? `${unansweredCount} unanswered` : 'All answered'}
              </span>
            )}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">Questions raised during spec review or bidding — add as they come up, answer once the customer responds. Each question saves independently.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={refresh} title="Refresh"><RefreshCw className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={onExportPdf}><Download className="w-4 h-4 mr-1" />Export PDF</Button>
          <Button onClick={addQuestion}><Plus className="w-4 h-4 mr-1" />Add Question</Button>
        </div>
      </div>

      {hasStaleData && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              This list changed elsewhere
              {staleInfo.changedKeys.size > 0 && ` — ${staleInfo.changedKeys.size} question(s) updated`}
              {staleInfo.deletedKeys.size > 0 && `, ${staleInfo.deletedKeys.size} removed`}
              {staleInfo.newCount > 0 && `, ${staleInfo.newCount} new`}
              . Your unsaved edits are safe — Refresh only pulls in changes to rows you haven't touched.
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={refresh}>Refresh</Button>
        </div>
      )}

      {questions.length === 0 && (
        <p className="text-sm text-muted-foreground steel-card p-5 text-center">No questions yet — click Add Question when one comes up.</p>
      )}

      <div className="space-y-3">
        {questions.map((q) => {
          const dirty = isRowDirty(q);
          const saving = savingKeys.has(q._localKey);
          const stale = staleInfo.changedKeys.has(q._localKey) || staleInfo.deletedKeys.has(q._localKey);
          return (
            <div key={q._localKey} className={`steel-card p-4 space-y-2 ${dirty ? 'ring-1 ring-yellow-500/40 bg-yellow-500/5' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Question</Label>
                  <Textarea value={q.question_text} onChange={(e) => updateQuestion(q._localKey, 'question_text', e.target.value)} className="mt-1 min-h-[48px]" />
                </div>
                <Button variant="ghost" size="icon" className="mt-5" onClick={() => removeQuestion(q._localKey)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Raised by {q.raised_by || 'Unknown'} on {q.raised_date || '—'}</p>
              <div>
                <Label className="text-xs">Answer {q.answered_date && <span className="text-muted-foreground font-normal">(answered {q.answered_date})</span>}</Label>
                <Textarea
                  value={q.answer_text}
                  placeholder="Pending customer response…"
                  onChange={(e) => updateQuestion(q._localKey, 'answer_text', e.target.value)}
                  className="mt-1 min-h-[48px]"
                />
              </div>
              <div className="flex items-center justify-between">
                {stale && !dirty ? (
                  <span className="text-xs text-amber-600">Changed elsewhere — Refresh to see the latest.</span>
                ) : <span />}
                {dirty && (
                  <Button size="sm" onClick={() => saveRow(q._localKey)} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="steel-card p-5">
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">General Notes</Label>
          {generalNotes !== savedGeneralNotes && (
            <Button size="sm" onClick={saveGeneralNotes} disabled={savingNotes}>{savingNotes ? 'Saving…' : 'Save'}</Button>
          )}
        </div>
        <Textarea value={generalNotes} onChange={(e) => updateGeneralNotes(e.target.value)} placeholder="Anything not tied to a specific question above." className="mt-1 min-h-[96px]" />
      </div>

      <ConflictResolutionModal
        open={!!conflict}
        resolving={resolvingConflict}
        title={conflict?.intent === 'delete' ? 'This question changed before you deleted it' : 'Someone else changed this question first'}
        description={conflict?.intent === 'save-deleted' ? 'Someone else already deleted this question. Recreate it with your edits, or let it stay deleted.' : undefined}
        keepLabel={conflict?.intent === 'delete' ? 'Delete Anyway' : conflict?.intent === 'save-deleted' ? 'Recreate With My Edits' : 'Keep My Version'}
        takeLabel={conflict?.intent === 'delete' ? 'Keep Their Update (Cancel Delete)' : conflict?.intent === 'save-deleted' ? 'Leave It Deleted' : 'Take Their Version'}
        rows={conflict ? [
          { label: 'Question', mine: conflict.mine?.question_text, theirs: conflict.theirs?.question_text },
          { label: 'Answer', mine: conflict.mine?.answer_text, theirs: conflict.theirs?.answer_text },
        ] : []}
        onKeepMine={handleConflictKeepMine}
        onTakeTheirs={handleConflictTakeTheirs}
      />
    </div>
  );
});

export default ScopeReviewPanel;
