import React, { useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import { Plus, X, Loader2, Printer } from 'lucide-react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// Organic, project-specific running list of questions that came up during
// spec review or bidding — NOT drawn from any fixed template or company-wide
// question bank. Fully variable length (could be 1, could be 30+), matching
// the same explicit-save/dirty-tracking convention as TurnoverReviewPanel and
// TakeoffEngine.jsx rather than autosave-per-keystroke.
const ScopeReviewPanel = forwardRef(function ScopeReviewPanel({ project, onExportPdf }, ref) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [questions, setQuestions] = useState([]);
  const [savedQuestions, setSavedQuestions] = useState([]);
  const [deletedIds, setDeletedIds] = useState([]);
  const [generalNotes, setGeneralNotes] = useState('');
  const [savedGeneralNotes, setSavedGeneralNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isDirty = () => JSON.stringify(questions) !== JSON.stringify(savedQuestions) || generalNotes !== savedGeneralNotes || deletedIds.length > 0;

  const load = async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const rows = await db.entities.ScopeReviewQuestion.filter({ project_id: project.id }, 'sort_order', 500);
      setQuestions(rows);
      setSavedQuestions(rows);
      setDeletedIds([]);
      setGeneralNotes(project.scope_review_general_notes || '');
      setSavedGeneralNotes(project.scope_review_general_notes || '');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [project?.id]);

  const addQuestion = () => {
    const identity = user?.full_name || user?.email || 'Unknown';
    setQuestions((prev) => [...prev, {
      id: null,
      question_text: '',
      answer_text: '',
      raised_by: identity,
      raised_date: new Date().toISOString().slice(0, 10),
      answered_date: '',
      sort_order: prev.length,
    }]);
  };

  const updateQuestion = (index, field, value) => {
    setQuestions((prev) => prev.map((q, i) => i === index ? { ...q, [field]: value } : q));
  };

  const removeQuestion = (index) => {
    setQuestions((prev) => {
      const target = prev[index];
      if (target.id) setDeletedIds((ids) => [...ids, target.id]);
      return prev.filter((_, i) => i !== index);
    });
  };

  const save = async () => {
    if (!project?.id) return false;
    setSaving(true);
    try {
      await Promise.all(deletedIds.map((id) => db.entities.ScopeReviewQuestion.delete(id)));
      await Promise.all(questions.map((q, index) => {
        // Clearing an answer back to blank un-answers the question — don't
        // leave a stale answered_date behind pointing at text that's gone.
        const answeredDate = String(q.answer_text || '').trim() ? (q.answered_date || new Date().toISOString().slice(0, 10)) : '';
        const payload = { project_id: project.id, question_text: q.question_text, answer_text: q.answer_text, raised_by: q.raised_by, raised_date: q.raised_date, answered_date: answeredDate, sort_order: index };
        return q.id ? db.entities.ScopeReviewQuestion.update(q.id, payload) : db.entities.ScopeReviewQuestion.create(payload);
      }));
      if (generalNotes !== savedGeneralNotes) {
        await db.entities.Project.update(project.id, { scope_review_general_notes: generalNotes });
      }
      const rows = await db.entities.ScopeReviewQuestion.filter({ project_id: project.id }, 'sort_order', 500);
      setQuestions(rows);
      setSavedQuestions(rows);
      setSavedGeneralNotes(generalNotes);
      setDeletedIds([]);
      toast({ title: 'Scope Review saved' });
      return true;
    } catch (e) {
      toast({ title: 'Unable to save', description: e?.message || 'Please retry.', variant: 'destructive' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({ isDirty, save }));

  const unansweredCount = questions.filter((q) => !String(q.answer_text || '').trim()).length;

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
          <p className="text-xs text-muted-foreground mt-1">Questions raised during spec review or bidding — add as they come up, answer once the customer responds.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onExportPdf}><Printer className="w-4 h-4 mr-1" />Export PDF</Button>
          <Button onClick={addQuestion}><Plus className="w-4 h-4 mr-1" />Add Question</Button>
        </div>
      </div>

      {questions.length === 0 && (
        <p className="text-sm text-muted-foreground steel-card p-5 text-center">No questions yet — click Add Question when one comes up.</p>
      )}

      <div className="space-y-3">
        {questions.map((q, index) => (
          <div key={q.id || `new-${index}`} className="steel-card p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <Label className="text-xs">Question</Label>
                <Textarea value={q.question_text} onChange={(e) => updateQuestion(index, 'question_text', e.target.value)} className="mt-1 min-h-[48px]" />
              </div>
              <Button variant="ghost" size="icon" className="mt-5" onClick={() => removeQuestion(index)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Raised by {q.raised_by || 'Unknown'} on {q.raised_date || '—'}</p>
            <div>
              <Label className="text-xs">Answer {q.answered_date && <span className="text-muted-foreground font-normal">(answered {q.answered_date})</span>}</Label>
              <Textarea
                value={q.answer_text}
                placeholder="Pending customer response…"
                onChange={(e) => updateQuestion(index, 'answer_text', e.target.value)}
                className="mt-1 min-h-[48px]"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="steel-card p-5">
        <Label className="text-xs">General Notes</Label>
        <Textarea value={generalNotes} onChange={(e) => setGeneralNotes(e.target.value)} placeholder="Anything not tied to a specific question above." className="mt-1 min-h-[96px]" />
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !isDirty()}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  );
});

export default ScopeReviewPanel;
