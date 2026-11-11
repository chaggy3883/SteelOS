import React, { useEffect, useState, useRef, useImperativeHandle, forwardRef } from 'react';
import { Plus, X, Loader2, CheckCircle2, Download, RefreshCw, AlertTriangle, Pencil, ArrowUp, ArrowDown, RotateCcw } from 'lucide-react';
import { db } from '@/api/apiClient';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  FREE_TEXT_FIELDS, SCOPE_VENDOR_ROLES, DEFAULT_CHECKLIST, blankTurnoverRecord as blankRecord,
  normalizeTurnoverRecord, checklistFor, checklistItemText, scopeVendorFor, quoteName,
} from '@/components/projects/turnoverReviewShared';
import ConflictResolutionModal from '@/components/projects/ConflictResolutionModal';
import ScopeVendorsCard from '@/components/projects/ScopeVendorsCard';

// Optimistic-concurrency conflict PREVENTION, not real-time collaboration —
// see ScopeReviewPanel.jsx's file-top note for the full rationale (same
// mechanism, applied here at the whole-record level rather than per-row).
// This form is treated as one unit rather than field-by-field: unlike Scope
// Review's open-ended list of independent rows, this is a single ~20-field
// form filled out together for one meeting — field-level locking would mean
// dozens of tiny save buttons for marginal benefit, since the realistic
// collision case is two people filling out the SAME meeting record, not two
// people each owning disjoint fields of it.
const FRESHNESS_POLL_MS = 45000;

// Builds only the rows that actually differ between two record versions —
// showing all ~20 fields in a conflict modal regardless of whether they
// changed would bury the one or two that matter.
function buildConflictRows(mine, theirs) {
  if (!mine || !theirs) return [];
  const rows = [];
  const checklistLabel = (rec) => checklistFor(rec)
    .filter(({ key }) => !!(rec.checklist_items || {})[key]).map((item) => checklistItemText(item, rec)).join(', ') || '(none checked)';
  if (JSON.stringify(mine.checklist_items || {}) !== JSON.stringify(theirs.checklist_items || {})
    || JSON.stringify(checklistFor(mine)) !== JSON.stringify(checklistFor(theirs))
    || String(mine.galvanizing_tons ?? '') !== String(theirs.galvanizing_tons ?? '')) {
    rows.push({ label: 'Checklist', mine: checklistLabel(mine), theirs: checklistLabel(theirs) });
  }
  SCOPE_VENDOR_ROLES.forEach(({ key, label }) => {
    const text = (rec) => {
      const v = scopeVendorFor(rec, key);
      const quotes = v.quotes.map(quoteName).join(', ');
      return [v.vendor_name || '—', quotes ? `(${quotes})` : ''].filter(Boolean).join(' ');
    };
    if (text(mine) !== text(theirs)) rows.push({ label, mine: text(mine), theirs: text(theirs) });
  });
  const subQuoteText = (rows_) => (rows_ || []).map((r) => `${r.company || '—'} (${r.type || '—'})`).join('; ') || '(none)';
  if (JSON.stringify(mine.sub_quotes || []) !== JSON.stringify(theirs.sub_quotes || [])) {
    rows.push({ label: 'Sub Quotes', mine: subQuoteText(mine.sub_quotes), theirs: subQuoteText(theirs.sub_quotes) });
  }
  FREE_TEXT_FIELDS.forEach(({ key, label }) => {
    if ((mine[key] || '') !== (theirs[key] || '')) rows.push({ label, mine: mine[key], theirs: theirs[key] });
  });
  const listText = (list) => (list || []).join(', ') || '(none)';
  if (JSON.stringify(mine.required_attendees || []) !== JSON.stringify(theirs.required_attendees || [])) {
    rows.push({ label: 'Required Attendees', mine: listText(mine.required_attendees), theirs: listText(theirs.required_attendees) });
  }
  if (JSON.stringify(mine.actual_attendees || []) !== JSON.stringify(theirs.actual_attendees || [])) {
    rows.push({ label: 'Actual Attendees', mine: listText(mine.actual_attendees), theirs: listText(theirs.actual_attendees) });
  }
  return rows;
}

function StringListEditor({ items, onChange, disabled, placeholder }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...(items || []), trimmed]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      {(items || []).map((name, index) => (
        <div key={`${name}-${index}`} className="flex items-center gap-2 rounded-lg border border-border p-2 pl-3">
          <span className="flex-1 text-sm">{name}</span>
          {!disabled && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onChange(items.filter((_, i) => i !== index))}>
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            className="h-9"
          />
          <Button variant="outline" onClick={add} disabled={!draft.trim()}><Plus className="w-4 h-4 mr-1" />Add</Button>
        </div>
      )}
    </div>
  );
}

const TurnoverReviewPanel = forwardRef(function TurnoverReviewPanel({ project, onExportPdf }, ref) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [record, setRecord] = useState(blankRecord());
  const [savedRecord, setSavedRecord] = useState(blankRecord());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [pricingLinks, setPricingLinks] = useState([]);
  const [estimateDocs, setEstimateDocs] = useState([]);
  const [editingChecklist, setEditingChecklist] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [stale, setStale] = useState(false);
  const [conflict, setConflict] = useState(null); // { mine, theirs }
  const [resolvingConflict, setResolvingConflict] = useState(false);
  // Read by the freshness-poll interval below so it never has to re-register
  // itself on every keystroke (which would perpetually reset its own clock).
  const latestRef = useRef({ record, savedRecord });
  useEffect(() => { latestRef.current = { record, savedRecord }; }, [record, savedRecord]);

  const isDirty = () => JSON.stringify(record) !== JSON.stringify(savedRecord);

  const loadRecord = async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const [existing, company, vendorRows, wonBids, linkedBids] = await Promise.all([
        db.entities.TurnoverMeetingRecord.filter({ project_id: project.id }, '-created_date', 1),
        getEffectiveCompany().catch(() => null),
        db.entities.Vendor.filter({ is_active: true }, 'name', 500).catch(() => []),
        db.entities.Bid.filter({ won_project_id: project.id }, '-created_date', 1).catch(() => []),
        db.entities.Bid.filter({ project_id: project.id }, '-created_date', 1).catch(() => []),
      ]);
      setVendors(vendorRows);
      // The won estimate this job came from: its Vendor Pricing and files are
      // where the scope vendors' quotes are attached from.
      const bid = wonBids[0] || linkedBids[0] || null;
      setEstimate(bid);
      if (bid) {
        const [links, docs] = await Promise.all([
          db.entities.VendorPricingLink.filter({ bid_id: bid.id }, '-created_date', 500).catch(() => []),
          db.entities.Document.filter({ bid_id: bid.id }, '-created_date', 1000).catch(() => []),
        ]);
        setPricingLinks(links);
        setEstimateDocs(docs.filter((d) => !d.is_archived));
      } else {
        setPricingLinks([]);
        setEstimateDocs([]);
      }
      const found = existing[0];
      const next = found
        ? normalizeTurnoverRecord(found)
        : { ...blankRecord(), required_attendees: company?.turnover_meeting_standard_attendees || [] };
      setRecord(next);
      setSavedRecord(next);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRecord(); }, [project?.id]);

  // Lightweight freshness poll — no live push mechanism exists (see file-top
  // note). If nothing local is dirty, it's safe to silently pull in the
  // fresher copy (nothing of the user's would be lost). If something IS
  // dirty, this only raises the "stale" banner — the actual conflict, if
  // any, surfaces the moment the user hits Save, via the same check.
  useEffect(() => {
    if (!project?.id) return;
    const interval = setInterval(async () => {
      const { record: curRecord, savedRecord: curSaved } = latestRef.current;
      if (!curSaved.id) return;
      try {
        const current = await db.entities.TurnoverMeetingRecord.get(curSaved.id);
        if (!current || current.updated_date === curSaved.updated_date) return;
        const dirtyNow = JSON.stringify(curRecord) !== JSON.stringify(curSaved);
        if (dirtyNow) {
          setStale(true);
        } else {
          const next = normalizeTurnoverRecord(current);
          setRecord(next);
          setSavedRecord(next);
          setStale(false);
        }
      } catch (e) {
        // best-effort — a failed poll just skips this cycle
      }
    }, FRESHNESS_POLL_MS);
    return () => clearInterval(interval);
  }, [project?.id]);

  const refresh = async () => {
    if (!savedRecord.id) return;
    const current = await db.entities.TurnoverMeetingRecord.get(savedRecord.id);
    if (!current) return;
    if (isDirty()) {
      // Don't discard local edits silently — surface it as a conflict the
      // same way Save would, so the user explicitly picks a side.
      setConflict({ mine: record, theirs: current });
      return;
    }
    const next = normalizeTurnoverRecord(current);
    setRecord(next);
    setSavedRecord(next);
    setStale(false);
    toast({ title: 'Refreshed' });
  };

  // Every field handler in this panel funnels through update()/updateChecklist
  // rather than calling setRecord directly, so this one guard covers all of
  // them: if a handler ever passes a raw event, DOM node, or component
  // instance instead of a plain value (the classic mistake with a Select/
  // Checkbox onChange), record would pick up something JSON.stringify can't
  // serialize, and the failure wouldn't surface until save() calls
  // db.entities...create/update far downstream — a "Converting circular
  // structure to JSON" error with a stack trace pointing into localData.js,
  // giving no indication of which field or handler was actually at fault.
  // Catching it right here, at the moment of the state update, rejects the
  // bad value immediately with a message naming the exact field.
  const assertPlainValue = (field, value) => {
    try {
      JSON.stringify(value);
      return true;
    } catch (e) {
      console.error(`TurnoverReviewPanel: refusing to store a non-serializable value into "${field}" (likely a raw event/DOM node/component instance from an onChange handler, not a plain value).`, value);
      return false;
    }
  };
  const update = (field, value) => {
    if (!assertPlainValue(field, value)) return;
    setRecord((prev) => ({ ...prev, [field]: value }));
  };
  const updateChecklist = (key, value) => {
    if (!assertPlainValue(`checklist_items.${key}`, value)) return;
    setRecord((prev) => ({ ...prev, checklist_items: { ...prev.checklist_items, [key]: value } }));
  };
  const updateScopeVendor = (roleKey, value) => {
    if (!assertPlainValue(`scope_vendors.${roleKey}`, value)) return;
    setRecord((prev) => ({ ...prev, scope_vendors: { ...(prev.scope_vendors || {}), [roleKey]: value } }));
  };

  // Editing the checklist itself (this project's copy — the first edit copies
  // the standard list onto the record). Removing an item drops its answer too.
  const setChecklistList = (fn) => setRecord((prev) => ({ ...prev, checklist_list: fn(checklistFor(prev).map((i) => ({ ...i }))) }));
  const renameItem = (index, label) => setChecklistList((list) => list.map((item, i) => (i === index ? { ...item, label } : item)));
  const moveItem = (index, delta) => setChecklistList((list) => {
    const to = index + delta;
    if (to < 0 || to >= list.length) return list;
    const next = [...list];
    [next[index], next[to]] = [next[to], next[index]];
    return next;
  });
  const removeItem = (index) => setRecord((prev) => {
    const list = checklistFor(prev);
    const gone = list[index];
    const items = { ...(prev.checklist_items || {}) };
    if (gone) delete items[gone.key];
    return { ...prev, checklist_list: list.filter((_, i) => i !== index), checklist_items: items };
  });
  const addItem = () => {
    const label = newItem.trim();
    if (!label) return;
    const key = `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setChecklistList((list) => [...list, { key, label }]);
    setNewItem('');
  };
  const resetChecklist = () => {
    if (!window.confirm('Put the checklist back to the standard items? Answers to items you added will be cleared.')) return;
    setRecord((prev) => {
      const keep = new Set(DEFAULT_CHECKLIST.map((i) => i.key));
      const items = Object.fromEntries(Object.entries(prev.checklist_items || {}).filter(([k]) => keep.has(k)));
      return { ...prev, checklist_list: null, checklist_items: items };
    });
  };
  const finishEditing = () => {
    // Blank names aren't kept.
    setRecord((prev) => (Array.isArray(prev.checklist_list)
      ? { ...prev, checklist_list: prev.checklist_list.map((i) => ({ ...i, label: String(i.label || '').trim() })).filter((i) => i.label) }
      : prev));
    setEditingChecklist(false);
  };

  // Accepts an explicit record to save (used by markCompleted, which needs to
  // save the just-computed completed state immediately rather than racing
  // setRecord's async update — a plain closure over `record` here would still
  // see the pre-completion values). Before writing an existing record, this
  // re-fetches it and compares updated_date to what this tab last synced —
  // see the file-top note. A mismatch opens ConflictResolutionModal instead
  // of writing.
  const save = async (overrideRecord) => {
    if (!project?.id) return false;
    const source = overrideRecord || record;
    setSaving(true);
    try {
      if (source.id) {
        const current = await db.entities.TurnoverMeetingRecord.get(source.id);
        if (current && current.updated_date !== savedRecord.updated_date) {
          setConflict({ mine: source, theirs: current });
          return false;
        }
      }
      const payload = { ...source, project_id: project.id };
      delete payload.id;
      const saved = source.id
        ? await db.entities.TurnoverMeetingRecord.update(source.id, payload)
        : await db.entities.TurnoverMeetingRecord.create(payload);
      const next = normalizeTurnoverRecord(saved);
      setRecord(next);
      setSavedRecord(next);
      setStale(false);
      toast({ title: 'Turnover / Contract Review saved' });
      return true;
    } catch (e) {
      toast({ title: 'Unable to save', description: e?.message || 'Please retry.', variant: 'destructive' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleConflictKeepMine = async () => {
    if (!conflict) return;
    setResolvingConflict(true);
    try {
      // Write directly rather than calling save() — the user has explicitly
      // seen both versions and chosen theirs to lose, so this intentionally
      // bypasses the optimistic-concurrency check for this one write.
      const payload = { ...conflict.mine, project_id: project.id };
      delete payload.id;
      const saved = await db.entities.TurnoverMeetingRecord.update(conflict.theirs.id, payload);
      const next = normalizeTurnoverRecord(saved);
      setRecord(next);
      setSavedRecord(next);
      setStale(false);
      toast({ title: 'Your version saved' });
    } catch (e) {
      toast({ title: 'Unable to save', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setResolvingConflict(false);
      setConflict(null);
    }
  };

  const handleConflictTakeTheirs = () => {
    if (!conflict) return;
    const next = normalizeTurnoverRecord(conflict.theirs);
    setRecord(next);
    setSavedRecord(next);
    setStale(false);
    setConflict(null);
  };

  const markCompleted = async () => {
    const identity = user?.full_name || user?.email || 'Unknown';
    const updated = { ...record, status: 'completed', completed_by: identity, completed_date: new Date().toISOString().slice(0, 10) };
    // Don't optimistically setRecord(updated) here — if save() finds a
    // conflict it returns without writing, and record must stay in its prior
    // (draft, editable) state until completion actually succeeds. save()
    // itself applies `updated` to `record` on success.
    await save(updated);
  };

  // getPrintData exposes this panel's current in-memory state for
  // turnoverReviewPdf.js's generateTurnoverReviewPdf(), so the export always
  // reflects what's actually on screen rather than a stale fetch-on-open.
  useImperativeHandle(ref, () => ({ isDirty, save, getPrintData: () => ({ record }) }));

  const vendorsByName = new Map(vendors.map((v) => [String(v.name || '').trim().toLowerCase(), v]));
  const readOnly = record.status === 'completed';

  if (loading) {
    return <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            Turnover / Contract Review
            {readOnly && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 font-medium uppercase tracking-wide">Completed — Read Only</span>}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Operational/logistics handoff only — no pricing or cost data from the Bid Worksheet appears here.
          </p>
        </div>
        <div className="flex gap-2">
          {!readOnly && <Button variant="outline" size="icon" onClick={refresh} title="Refresh"><RefreshCw className="w-4 h-4" /></Button>}
          <Button variant="outline" onClick={onExportPdf}><Download className="w-4 h-4 mr-1" />Export PDF</Button>
          {!readOnly && (
            <Button variant="outline" onClick={markCompleted} disabled={saving}>
              <CheckCircle2 className="w-4 h-4 mr-1" />Mark Completed
            </Button>
          )}
        </div>
      </div>

      {readOnly && (
        <p className="text-xs text-muted-foreground">
          Completed by {record.completed_by || 'Unknown'} on {record.completed_date || '—'}.
        </p>
      )}

      {stale && !readOnly && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>Someone else updated this record since you loaded it. Your unsaved edits are safe — Save will show you both versions if they conflict.</span>
          </div>
          <Button size="sm" variant="outline" onClick={refresh}>Refresh</Button>
        </div>
      )}

      <div className="steel-card p-5 space-y-2" data-turnover-checklist>
        <div className="flex items-center justify-between mb-1 gap-2">
          <h4 className="font-semibold">Checklist</h4>
          {!readOnly && (
            editingChecklist ? (
              <div className="flex gap-2">
                {Array.isArray(record.checklist_list) && (
                  <Button variant="ghost" size="sm" onClick={resetChecklist}><RotateCcw className="w-3.5 h-3.5 mr-1" />Standard list</Button>
                )}
                <Button size="sm" onClick={finishEditing}>Done</Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setEditingChecklist(true)}><Pencil className="w-3.5 h-3.5 mr-1" />Edit checklist</Button>
            )
          )}
        </div>
        {editingChecklist && !readOnly ? (
          <div className="space-y-2">
            {checklistFor(record).map((item, index, list) => (
              <div key={item.key} className="flex items-center gap-1.5">
                <Input value={item.label} onChange={(e) => renameItem(index, e.target.value)} className="h-9" aria-label="Checklist item" />
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={index === 0} onClick={() => moveItem(index, -1)} title="Move up"><ArrowUp className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={index === list.length - 1} onClick={() => moveItem(index, 1)} title="Move down"><ArrowDown className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeItem(index)} title="Remove item"><X className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <Input
                value={newItem}
                placeholder="New checklist item"
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
                className="h-9"
              />
              <Button variant="outline" onClick={addItem} disabled={!newItem.trim()}><Plus className="w-4 h-4 mr-1" />Add item</Button>
            </div>
          </div>
        ) : (
          <>
            {checklistFor(record).length === 0 && <p className="text-sm text-muted-foreground">No checklist items.</p>}
            {checklistFor(record).map(({ key, label, detail }) => (
              <div key={key} className="flex items-start gap-2.5 py-1">
                <Checkbox id={`turnover-${key}`} checked={!!record.checklist_items[key]} onCheckedChange={(v) => updateChecklist(key, !!v)} disabled={readOnly} className="mt-0.5" />
                <label htmlFor={`turnover-${key}`} className="flex-1 text-sm cursor-pointer">{label}</label>
                {detail === 'tons' && record.checklist_items[key] && (
                  <div className="flex items-center gap-1.5 -mt-1">
                    <Label htmlFor={`turnover-${key}-tons`} className="text-xs text-muted-foreground">Tons</Label>
                    <Input id={`turnover-${key}-tons`} type="number" min="0" step="any" value={record.galvanizing_tons ?? ''} onChange={(e) => update('galvanizing_tons', e.target.value)} disabled={readOnly} className="h-8 w-24" />
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      <ScopeVendorsCard
        record={record}
        readOnly={readOnly}
        onChange={updateScopeVendor}
        vendorsByName={vendorsByName}
        estimate={estimate}
        pricingLinks={pricingLinks}
        estimateDocs={estimateDocs}
      />

      <div className="steel-card p-5">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold">Sub Quotes</h4>
          {!readOnly && (
            <Button variant="outline" size="sm" onClick={() => update('sub_quotes', [...record.sub_quotes, { company: '', type: '' }])}>
              <Plus className="w-3.5 h-3.5 mr-1" />Add Sub Quote
            </Button>
          )}
        </div>
        {record.sub_quotes.length === 0 && <p className="text-sm text-muted-foreground">No sub quotes listed.</p>}
        <div className="space-y-2">
          {record.sub_quotes.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input placeholder="Company" value={row.company} disabled={readOnly}
                onChange={(e) => update('sub_quotes', record.sub_quotes.map((r, i) => i === index ? { ...r, company: e.target.value } : r))}
                className="h-9" />
              <Input placeholder="Type (e.g. Erection, Hauling)" value={row.type} disabled={readOnly}
                onChange={(e) => update('sub_quotes', record.sub_quotes.map((r, i) => i === index ? { ...r, type: e.target.value } : r))}
                className="h-9" />
              {!readOnly && (
                <Button variant="ghost" size="icon" onClick={() => update('sub_quotes', record.sub_quotes.filter((_, i) => i !== index))}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="steel-card p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        {FREE_TEXT_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <Label className="text-xs">{label}</Label>
            <Textarea value={record[key] || ''} onChange={(e) => update(key, e.target.value)} disabled={readOnly} className="mt-1 min-h-[72px]" />
          </div>
        ))}
      </div>

      <div className="steel-card p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 className="font-semibold mb-2">Required Attendees</h4>
          <StringListEditor items={record.required_attendees} onChange={(v) => update('required_attendees', v)} disabled={readOnly} placeholder="e.g. Project Manager" />
        </div>
        <div>
          <h4 className="font-semibold mb-2">Actual Attendees</h4>
          <StringListEditor items={record.actual_attendees} onChange={(v) => update('actual_attendees', v)} disabled={readOnly} placeholder="Who actually attended" />
        </div>
      </div>

      {!readOnly && (
        <div className="flex justify-end">
          <Button onClick={() => save()} disabled={saving || !isDirty()}>{saving ? 'Saving…' : 'Save Draft'}</Button>
        </div>
      )}

      <ConflictResolutionModal
        open={!!conflict}
        resolving={resolvingConflict}
        title="Someone else updated this record first"
        rows={conflict ? buildConflictRows(conflict.mine, conflict.theirs) : []}
        onKeepMine={handleConflictKeepMine}
        onTakeTheirs={handleConflictTakeTheirs}
      />
    </div>
  );
});

export default TurnoverReviewPanel;
