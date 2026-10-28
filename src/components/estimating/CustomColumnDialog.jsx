import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { COLUMN_TYPES, BUILT_IN_FIELDS, createColumn, aliasFromName, validateColumns } from '@/lib/takeoffColumns';
import { FORMULA_FUNCTIONS, validateFormula, evaluateFormula } from '@/lib/takeoffFormula';

const selectClass = 'h-8 w-full rounded-md border border-input bg-background px-2 text-sm';

// Add or edit one of this takeoff's own columns (blueprint_takeoffs
// .custom_columns). Editing a company column (one that came with the tool
// set) saves a job-only copy with the same id, which replaces the company
// one for this takeoff only — the company tool set itself is never touched.
// Formula text is checked as it's typed, against the names that exist.
export default function CustomColumnDialog({ open, onOpenChange, column, allColumns = [], isCompanyColumn = false, sampleBuiltIns, onSave, onDelete }) {
  const [draft, setDraft] = useState(null);
  const [aliasTouched, setAliasTouched] = useState(false);
  const [choicesText, setChoicesText] = useState('');

  useEffect(() => {
    if (!open) return;
    const base = column ? { ...column } : createColumn({ name: 'New column', type: 'number' }, allColumns);
    setDraft(base);
    setAliasTouched(Boolean(column));
    setChoicesText((base.choices || []).join(', '));
  }, [open, column]);

  const others = useMemo(() => allColumns.filter((c) => c.id !== draft?.id), [allColumns, draft?.id]);
  const availableNames = useMemo(() => [...BUILT_IN_FIELDS.map((f) => f.alias), ...others.map((c) => c.alias)], [others]);

  if (!draft) return null;

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const handleName = (name) => {
    if (aliasTouched) set({ name });
    else set({ name, alias: aliasFromName(name, others.map((c) => c.alias)) });
  };
  const finalColumn = createColumn({
    ...draft,
    choices: draft.type === 'choice' ? choicesText.split(',').map((x) => x.trim()).filter(Boolean) : [],
  }, others);
  const listCheck = validateColumns([...others, finalColumn]);
  const myErrors = listCheck.errors.filter((e) => e.columnId === finalColumn.id);
  const formulaCheck = draft.type === 'formula' ? validateFormula(draft.formula, availableNames) : null;
  // Try the formula on a sample markup so the estimator sees a number, not
  // just "valid" — other custom columns count as 0 / blank here.
  const sampleResult = formulaCheck?.ok && sampleBuiltIns
    ? evaluateFormula(draft.formula, { ...Object.fromEntries(others.map((c) => [c.alias, c.type === 'text' || c.type === 'choice' || c.type === 'date' ? '' : 0])), ...sampleBuiltIns })
    : null;

  const insertName = (name) => set({ formula: `${draft.formula || ''}${draft.formula && !/[\s(]$/.test(draft.formula) ? ' ' : ''}${name}` });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{column ? `Edit column "${column.name}"` : 'Add a column'}</DialogTitle>
          <DialogDescription>
            {isCompanyColumn
              ? 'This column came with the company tool set. Changes here apply to this takeoff only.'
              : 'A column only this takeoff has. Typed values are saved on each markup; formulas recalculate every time.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Column name</span>
            <Input className="h-8" value={draft.name} onChange={(e) => handleName(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Name used in formulas</span>
            <Input className="h-8 font-mono" value={draft.alias} onChange={(e) => { setAliasTouched(true); set({ alias: e.target.value.replace(/\s+/g, '') }); }} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Kind of value</span>
            <select className={selectClass} value={draft.type} onChange={(e) => set({ type: e.target.value })}>
              {COLUMN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <span className="block text-[11px] text-muted-foreground">{COLUMN_TYPES.find((t) => t.value === draft.type)?.help}</span>
          </label>
          {(draft.type === 'number' || draft.type === 'formula') && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium">Decimals</span>
                <Input className="h-8" type="number" min={0} max={6} value={draft.decimals} onChange={(e) => set({ decimals: Math.max(0, Math.min(6, parseInt(e.target.value, 10) || 0)) })} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">Unit (optional)</span>
                <Input className="h-8" value={draft.unit || ''} onChange={(e) => set({ unit: e.target.value })} placeholder="tn, lb, ea…" />
              </label>
            </div>
          )}
          {draft.type === 'choice' && (
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-medium">Choices (separate with commas)</span>
              <Input className="h-8" value={choicesText} onChange={(e) => setChoicesText(e.target.value)} placeholder="Bare, Shop primed, Galvanized" />
            </label>
          )}
        </div>

        {draft.type === 'formula' && (
          <div className="space-y-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium">Formula</span>
              <Input className="h-9 font-mono" value={draft.formula || ''} onChange={(e) => set({ formula: e.target.value })} placeholder="[Weight] * 1.05 / 2000" />
            </label>
            {draft.formula && (
              formulaCheck?.ok ? (
                <p className="text-xs text-green-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />Formula looks good
                  {sampleResult && !sampleResult.error && sampleBuiltIns && (
                    <span className="text-muted-foreground">— on a sample 20&apos; W18X35 beam it gives <span className="font-mono text-foreground">{String(sampleResult.value)}</span></span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-red-600 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />{formulaCheck?.error}</p>
              )
            )}
            <div className="text-[11px] text-muted-foreground space-y-1">
              <p>Click a name to add it. Names with spaces go in square brackets, e.g. <span className="font-mono">[Wt Per Ft]</span>.</p>
              <div className="flex flex-wrap gap-1">
                {availableNames.map((n) => (
                  <button key={n} type="button" onClick={() => insertName(n)} className="px-1.5 py-0.5 rounded border font-mono hover:bg-muted" title={BUILT_IN_FIELDS.find((f) => f.alias === n)?.help || 'Another column'}>{n}</button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {FORMULA_FUNCTIONS.map((f) => (
                  <button key={f.name} type="button" onClick={() => insertName(`${f.name}(`)} className="px-1.5 py-0.5 rounded border font-mono hover:bg-muted" title={f.help}>{f.name}()</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {myErrors.length > 0 && (
          <ul className="text-xs text-red-600 space-y-0.5">
            {myErrors.map((e, i) => <li key={i} className="flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{e.message}</li>)}
          </ul>
        )}

        <DialogFooter className="gap-2">
          {column && onDelete && (
            <Button variant="outline" className="mr-auto text-destructive" onClick={() => onDelete(column)}>
              {isCompanyColumn ? 'Go back to the company version' : 'Remove column'}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave(finalColumn)} disabled={myErrors.length > 0 || (draft.type === 'formula' && !formulaCheck?.ok)}>Save column</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
