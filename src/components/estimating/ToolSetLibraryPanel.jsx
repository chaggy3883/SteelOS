import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { isSuperAdmin, getImpersonatingCompanyId } from '@/lib/tenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Copy, Trash2, Download, Upload, Save, Lock, ArrowUp, ArrowDown, Wrench, Columns3, Info, Play, AlertTriangle } from 'lucide-react';
import { SHAPE_CLASSES, estimateWeightPerFt } from '@/data/steelShapeSelector';
import CountMarkerSwatch from '@/components/estimating/CountMarkerSwatch';
import {
  MEASUREMENT_TYPES, COUNT_SYMBOLS, LINE_STYLES, SCALE_PRESETS, STRUCTURAL_STEEL_STARTER_ID,
  buildStructuralSteelStarter, createTool, createToolSet, duplicateToolSet, validateToolSet,
  exportToolSetJson, parseToolSetImport, toolSetFileName, toToolChestPreset, makeToolWeightLookup,
} from '@/lib/takeoffToolSets';
import {
  COLUMN_TYPES, BUILT_IN_FIELDS, BUILT_IN_ALIASES, createColumn, aliasFromName, validateColumns,
  computeColumnValues, formatColumnValue,
} from '@/lib/takeoffColumns';
import { FORMULA_FUNCTIONS } from '@/lib/takeoffFormula';

// Company tool set library for IRONSIGHT (entity: takeoff_tool_sets).
// Standalone: BlueprintTakeoff wires it in through onApplyTool (one tool →
// a tool_chest preset) and onApplyToolSet (a whole set → presets + columns).
// Every edit happens on a local draft; nothing is written until Save.

const selectClass = 'h-8 w-full rounded-md border border-input bg-background px-2 text-sm';
const weightLookup = makeToolWeightLookup(estimateWeightPerFt);

const SAMPLE_ROWS = {
  length: { tool: 'length', length_ft: 20, quantity: 1 },
  polylength: { tool: 'length', measurement_type: 'polylength', length_ft: 32, quantity: 1 },
  count: { tool: 'count', points: [{}, {}, {}, {}] },
  bolt_count: { tool: 'bolt_count', points: [{}, {}, {}, {}, {}, {}, {}, {}] },
  area: { tool: 'area', area_sq_ft: 100 },
  perimeter: { tool: 'area', area_sq_ft: 100, perimeter_ft: 40 },
  volume: { tool: 'area', area_sq_ft: 100 },
};

const typeLabel = (value) => MEASUREMENT_TYPES.find((m) => m.value === value)?.label || value;

function ToolSwatch({ tool, size = 16 }) {
  if (tool.tool === 'count' || tool.tool === 'bolt_count') {
    return <CountMarkerSwatch color={tool.symbol === 'circle' ? tool.color : undefined} symbol={tool.symbol === 'circle' ? undefined : tool.symbol} size={size} />;
  }
  if (['area', 'wall_area', 'volume'].includes(tool.tool)) {
    return <span className="inline-block rounded-sm border-2" style={{ width: size, height: size, borderColor: tool.color, background: tool.fill_color ? `${tool.fill_color}55` : 'transparent' }} />;
  }
  return <span className="inline-block" style={{ width: size, height: 0, borderTop: `${Math.max(2, Math.min(tool.line_width, 5))}px ${tool.line_style === 'solid' ? 'solid' : tool.line_style} ${tool.color}` }} />;
}

function Field({ label, help, children, className = '' }) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {help && <span className="block text-[11px] text-muted-foreground leading-snug">{help}</span>}
    </label>
  );
}

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

function ToolEditor({ tool, columns, onChange }) {
  const set = (patch) => onChange(createTool({ ...tool, ...patch }));
  const isCount = tool.tool === 'count' || tool.tool === 'bolt_count';
  const isArea = ['area', 'wall_area', 'volume'].includes(tool.tool);
  const isLength = ['length', 'polylength', 'perimeter'].includes(tool.tool);
  const weighable = isCount || ['length', 'polylength', 'perimeter', 'radius', 'diameter'].includes(tool.tool);
  const scaleValue = tool.scale_override ? (SCALE_PRESETS.find((s) => Math.abs(s.px_per_ft - tool.scale_override.px_per_ft) < 1e-6)?.label || 'custom') : '';
  const wtPerFt = weightLookup({}, tool);
  const editableColumns = columns.filter((c) => c.type !== 'formula');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="What are you measuring?" help={MEASUREMENT_TYPES.find((m) => m.value === tool.tool)?.help}>
          <select className={selectClass} value={tool.tool} onChange={(e) => set({ tool: e.target.value })}>
            {MEASUREMENT_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Name on the drawing" help="Shows in the Markups List, legend and exported PDF.">
          <Input className="h-8" value={tool.label} onChange={(e) => set({ label: e.target.value })} />
        </Field>
        <Field label="Group (subject)" help="Optional heading to total similar tools together, e.g. Framing or Stairs.">
          <Input className="h-8" value={tool.subject} onChange={(e) => set({ subject: e.target.value })} />
        </Field>
        <Field label="Color">
          <div className="flex items-center gap-2">
            <input type="color" className="h-8 w-12 rounded border" value={tool.color} onChange={(e) => set({ color: e.target.value })} />
            <ToolSwatch tool={tool} size={20} />
          </div>
        </Field>
      </div>

      {isCount ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Marker shape">
            <select className={selectClass} value={tool.symbol} onChange={(e) => set({ symbol: e.target.value })}>
              {COUNT_SYMBOLS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Marker size (pt)">
            <Input className="h-8" type="number" min={2} max={48} value={tool.symbol_size} onChange={(e) => set({ symbol_size: Number(e.target.value) })} />
          </Field>
          <Field label="Number each mark" help="Labels marks 1, 2, 3 ... on the sheet.">
            <div className="h-8 flex items-center"><Switch checked={tool.show_numbers} onCheckedChange={(v) => set({ show_numbers: v })} /></div>
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Line width (pt)">
            <Input className="h-8" type="number" min={0.25} max={24} step={0.25} value={tool.line_width} onChange={(e) => set({ line_width: Number(e.target.value) })} />
          </Field>
          <Field label="Line style">
            <select className={selectClass} value={tool.line_style} onChange={(e) => set({ line_style: e.target.value })}>
              {LINE_STYLES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </Field>
          {isArea && (
            <Field label="Fill" help="Leave off for an outline only.">
              <div className="flex items-center gap-2">
                <Switch checked={Boolean(tool.fill_color)} onCheckedChange={(v) => set({ fill_color: v ? tool.color : '' })} />
                {tool.fill_color && <input type="color" className="h-8 w-10 rounded border" value={tool.fill_color} onChange={(e) => set({ fill_color: e.target.value })} />}
                {tool.fill_color && <Input className="h-8 w-20" type="number" min={0} max={1} step={0.05} value={tool.fill_opacity} onChange={(e) => set({ fill_opacity: Number(e.target.value) })} title="Opacity 0–1" />}
              </div>
            </Field>
          )}
        </div>
      )}

      {tool.tool !== 'bolt_count' && tool.tool !== 'angle' && (
        <div className="rounded-md border p-3 space-y-3">
          <div className="text-xs font-semibold">{weighable ? 'Steel (for weight)' : 'Material'}</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {weighable && (
              <Field label="Shape type">
                <select className={selectClass} value={tool.shapeClass} onChange={(e) => set({ shapeClass: e.target.value })}>
                  <option value="">— none —</option>
                  {SHAPE_CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
            )}
            <Field label="Size" help={tool.shapeClass ? 'e.g. W18X35, HSS6X6X3/8, L4X4X1/4' : (isArea ? 'e.g. PL3/8, 1.5B 20GA deck' : undefined)}>
              <Input className="h-8" value={tool.sizeDesignation} onChange={(e) => set({ sizeDesignation: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Grade">
              <Input className="h-8" value={tool.grade} onChange={(e) => set({ grade: e.target.value })} />
            </Field>
            {weighable && (
              <Field label="Weight per foot override" help={wtPerFt ? `Using ${wtPerFt.toFixed(2)} lb/ft${tool.unit_weight_lbs_per_ft ? ' (typed)' : ' (catalog)'}.` : 'Type one when the shape isn\'t in the catalog (e.g. pipe rail).'}>
                <Input className="h-8" type="number" min={0} step={0.01} value={tool.unit_weight_lbs_per_ft ?? ''} onChange={(e) => set({ unit_weight_lbs_per_ft: numOrNull(e.target.value) })} />
              </Field>
            )}
            {isCount && (
              <Field label="Length per piece (ft)" help="Turns a count into weight, e.g. a column's height.">
                <Input className="h-8" type="number" min={0} step={0.0625} value={tool.typical_length_ft ?? ''} onChange={(e) => set({ typical_length_ft: numOrNull(e.target.value) })} />
              </Field>
            )}
            {isLength && (
              <Field label="Slope (degrees)" help="For stair stringers/ramps: plan length ÷ cos(slope) = true length.">
                <Input className="h-8" type="number" min={0} max={89} step={0.5} value={tool.slope_deg ?? ''} onChange={(e) => set({ slope_deg: numOrNull(e.target.value) })} />
              </Field>
            )}
            {tool.tool === 'volume' && (
              <Field label="Depth (ft)" help="Used for Volume = Area × Depth.">
                <Input className="h-8" type="number" min={0} step={0.0625} value={tool.depth_ft ?? ''} onChange={(e) => set({ depth_ft: numOrNull(e.target.value) })} />
              </Field>
            )}
          </div>
        </div>
      )}

      {!isCount && (
        <Field label="Drawing scale for this tool" help="Optional. Leave on 'Use the sheet's calibration' unless this tool is always used on details drawn at a different scale.">
          <div className="flex gap-2">
            <select
              className={selectClass}
              value={scaleValue}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) set({ scale_override: null });
                else if (v === 'custom') set({ scale_override: { scale_reference: 'Custom', px_per_ft: tool.scale_override?.px_per_ft || 18 } });
                else { const p = SCALE_PRESETS.find((s) => s.label === v); set({ scale_override: { scale_reference: p.label, px_per_ft: p.px_per_ft } }); }
              }}
            >
              <option value="">Use the sheet's calibration</option>
              {SCALE_PRESETS.map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
              <option value="custom">Custom…</option>
            </select>
            {scaleValue === 'custom' && (
              <Input className="h-8 w-40" type="number" min={0.01} step={0.01} value={tool.scale_override?.px_per_ft ?? ''} title="PDF points per real foot" onChange={(e) => set({ scale_override: { scale_reference: 'Custom', px_per_ft: Number(e.target.value) } })} />
            )}
          </div>
        </Field>
      )}

      {editableColumns.length > 0 && (
        <div className="rounded-md border p-3 space-y-2">
          <div className="text-xs font-semibold">Starting values for this tool&apos;s markups</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {editableColumns.map((c) => {
              const v = tool.default_values[c.id] ?? '';
              const setV = (val) => set({ default_values: { ...tool.default_values, [c.id]: val === '' ? undefined : val } });
              return (
                <Field key={c.id} label={c.name}>
                  {c.type === 'choice' ? (
                    <select className={selectClass} value={v} onChange={(e) => setV(e.target.value)}>
                      <option value="">(column default)</option>
                      {c.choices.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                    </select>
                  ) : c.type === 'checkbox' ? (
                    <div className="h-8 flex items-center"><Switch checked={Boolean(v)} onCheckedChange={(val) => setV(val)} /></div>
                  ) : (
                    <Input className="h-8" type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'} value={v} onChange={(e) => setV(c.type === 'number' ? numOrNull(e.target.value) ?? '' : e.target.value)} />
                  )}
                </Field>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ColumnEditor({ column, columns, errors, onChange }) {
  const set = (patch) => onChange({ ...column, ...patch });
  const others = columns.filter((c) => c.id !== column.id);
  const names = [...BUILT_IN_ALIASES, ...others.map((c) => c.alias)];
  const preview = useMemo(() => {
    if (column.type !== 'formula') return null;
    const sample = { tool: 'length', length_ft: 20, quantity: 1, unit_weight_lbs_per_ft: 35 };
    const r = computeColumnValues(sample, columns.map((c) => (c.id === column.id ? column : c)));
    return { value: r.values[column.alias], error: r.errors[column.alias] };
  }, [column, columns]);
  const myErrors = errors.filter((e) => e.columnId === column.id);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Column name">
          <Input
            className="h-8"
            value={column.name}
            onChange={(e) => {
              const name = e.target.value;
              const autoAlias = column.alias === aliasFromName(column.name, others.map((c) => c.alias));
              set({ name, ...(autoAlias ? { alias: aliasFromName(name, others.map((c) => c.alias)) } : {}) });
            }}
          />
        </Field>
        <Field label="Name used in formulas" help="Letters, numbers and _ only. Must be different from every other column.">
          <Input className="h-8 font-mono" value={column.alias} onChange={(e) => set({ alias: e.target.value.replace(/\s+/g, '') })} />
        </Field>
        <Field label="Kind of value" help={COLUMN_TYPES.find((t) => t.value === column.type)?.help}>
          <select className={selectClass} value={column.type} onChange={(e) => onChange(createColumn({ ...column, type: e.target.value, decimals: undefined }, others))}>
            {COLUMN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
      </div>

      {column.type === 'choice' && (
        <Field label="Choices" help="One per line.">
          <Textarea rows={3} value={column.choices.join('\n')} onChange={(e) => set({ choices: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
        </Field>
      )}

      {column.type === 'formula' && (
        <div className="space-y-2">
          <Field label="Formula" help="Use + − × ÷ ( ) and column names. Example: Length * WtPerFt * Qty / 2000">
            <Input className="h-8 font-mono" value={column.formula} onChange={(e) => set({ formula: e.target.value })} />
          </Field>
          <div className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">You can use:</span>{' '}
            {names.map((n) => (
              <button key={n} type="button" className="font-mono underline decoration-dotted mr-1.5 hover:text-foreground" onClick={() => set({ formula: `${column.formula}${column.formula && !/\s$/.test(column.formula) ? ' ' : ''}${n}` })}>{n}</button>
            ))}
            <br />
            <span className="font-medium text-foreground">Functions:</span>{' '}
            {FORMULA_FUNCTIONS.map((f) => <span key={f.name} className="font-mono mr-1.5" title={f.help}>{f.name}</span>)}
          </div>
          {preview && (
            <div className={`text-xs rounded px-2 py-1 ${preview.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
              Example — a 20&apos; W18X35 beam: {preview.error ? preview.error : formatColumnValue(column, preview.value)}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(column.type === 'number' || column.type === 'formula') && (
          <>
            <Field label="Decimal places">
              <Input className="h-8" type="number" min={0} max={6} value={column.decimals} onChange={(e) => set({ decimals: Math.max(0, Math.min(6, parseInt(e.target.value, 10) || 0)) })} />
            </Field>
            <Field label="Unit label" help="Optional, e.g. lb, tn, ea.">
              <Input className="h-8" value={column.unit} onChange={(e) => set({ unit: e.target.value })} />
            </Field>
          </>
        )}
        {column.type !== 'formula' && (
          <Field label="Default value">
            {column.type === 'choice' ? (
              <select className={selectClass} value={column.default ?? ''} onChange={(e) => set({ default: e.target.value || null })}>
                <option value="">(blank)</option>
                {column.choices.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
              </select>
            ) : column.type === 'checkbox' ? (
              <div className="h-8 flex items-center"><Switch checked={Boolean(column.default)} onCheckedChange={(v) => set({ default: v })} /></div>
            ) : (
              <Input className="h-8" type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'} value={column.default ?? ''} onChange={(e) => set({ default: column.type === 'number' ? numOrNull(e.target.value) : e.target.value })} />
            )}
          </Field>
        )}
      </div>

      {myErrors.length > 0 && (
        <ul className="text-xs text-red-700 space-y-0.5">
          {myErrors.map((e, i) => <li key={i} className="flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{e.message}</li>)}
        </ul>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {(preset: object, toolSet: object) => void} [props.onApplyTool] "Use" on one tool — receives a tool_chest preset (toToolChestPreset)
 * @param {(toolSet: object, presets: object[]) => void} [props.onApplyToolSet] "Load into this takeoff" — the whole set
 * @param {string} [props.initialToolSetId]
 */
export default function ToolSetLibraryPanel({ onApplyTool, onApplyToolSet, initialToolSetId }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const me = user?.email || user?.full_name || '';
  const starter = useMemo(() => buildStructuralSteelStarter(), []);
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(initialToolSetId || STRUCTURAL_STEEL_STARTER_ID);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('tools');
  const [openToolId, setOpenToolId] = useState(null);
  const [openColumnId, setOpenColumnId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState(null);
  const [importState, setImportState] = useState(null); // { fileName, result }
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.entities.takeoff_tool_sets.list('-created_date', 500);
      setSets(rows.filter((r) => r.is_shared !== false || !r.created_by || r.created_by === me));
    } catch (e) {
      console.error('Failed to load tool sets', e);
      toast({ title: 'Couldn\'t load tool sets', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [me, toast]);

  useEffect(() => { load(); }, [load]);

  const allSets = useMemo(() => [starter, ...sets], [starter, sets]);
  const selected = allSets.find((s) => s.id === selectedId) || null;
  const readOnly = Boolean(selected?.is_builtin);
  // Tool sets belong to one company. A platform super_admin who hasn't
  // picked a company to work as has no company to save them under (the data
  // layer refuses the write), so say that up front instead of failing on Save.
  const writesBlocked = isSuperAdmin(user) && !getImpersonatingCompanyId();

  useEffect(() => {
    setDraft(selected ? createToolSet(selected) : null);
    setDirty(false);
    setOpenToolId(null);
    setOpenColumnId(null);
    // Only re-seed the draft when the selection (or its saved version) changes.
  }, [selectedId, selected?.version, selected?.id]);

  const update = (patch) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };
  const validation = useMemo(() => (draft ? validateToolSet(draft) : { ok: true, errors: [], warnings: [], columnErrors: [] }), [draft]);
  const columnErrors = useMemo(() => (draft ? validateColumns(draft.columns).errors : []), [draft]);

  const selectSet = (id) => {
    if (id === selectedId) return;
    if (dirty) { setPendingSwitch(id); return; }
    setSelectedId(id);
  };

  const persistNew = async (setData, successTitle) => {
    const check = validateToolSet(setData);
    if (!check.ok) { toast({ title: 'Fix these first', description: check.errors.slice(0, 3).join(' '), variant: 'destructive' }); return null; }
    const { id: _id, is_builtin: _b, company_id: _c, ...rest } = createToolSet(setData);
    const row = await db.entities.takeoff_tool_sets.create({ ...rest, created_by: me, version: 1 });
    await load();
    setSelectedId(row.id);
    toast({ title: successTitle });
    return row;
  };

  const handleNew = async () => {
    try {
      await persistNew(createToolSet({ name: 'New tool set', tools: [createTool({ tool: 'length', label: 'Beams', shapeClass: 'W-Beam' })], columns: [] }), 'Tool set created');
    } catch (e) { toast({ title: 'Couldn\'t create tool set', description: e?.message, variant: 'destructive' }); }
  };

  const handleDuplicate = async () => {
    if (!selected) return;
    try {
      await persistNew(duplicateToolSet(dirty && draft ? draft : selected, { createdBy: me }), 'Copy created — you can edit it now');
    } catch (e) { toast({ title: 'Couldn\'t duplicate', description: e?.message, variant: 'destructive' }); }
  };

  const handleSave = async () => {
    if (!draft || readOnly) return;
    if (!validation.ok) { toast({ title: 'Fix these first', description: validation.errors.slice(0, 3).join(' '), variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const { id, is_builtin: _b, company_id: _c, created_by: _cb, ...fields } = draft;
      await db.entities.takeoff_tool_sets.update(id, { ...fields, version: (selected?.version || 1) + 1 });
      await load();
      setDirty(false);
      toast({ title: 'Tool set saved' });
    } catch (e) {
      toast({ title: 'Couldn\'t save', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || readOnly) return;
    try {
      await db.entities.takeoff_tool_sets.delete(selected.id);
      setConfirmDelete(false);
      setSelectedId(STRUCTURAL_STEEL_STARTER_ID);
      await load();
      toast({ title: `Deleted "${selected.name}"` });
    } catch (e) { toast({ title: 'Couldn\'t delete', description: e?.message, variant: 'destructive' }); }
  };

  const handleExport = () => {
    const source = draft || selected;
    if (!source) return;
    const blob = new Blob([exportToolSetJson(source)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = toolSetFileName(source);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    setImportState({ fileName: file.name, result: parseToolSetImport(text) });
  };

  const handleConfirmImport = async () => {
    const r = importState?.result;
    if (!r?.ok) return;
    const nameTaken = sets.some((s) => s.name.toLowerCase() === r.toolSet.name.toLowerCase());
    try {
      await persistNew({ ...r.toolSet, name: nameTaken ? `${r.toolSet.name} (imported)` : r.toolSet.name }, 'Tool set imported');
      setImportState(null);
    } catch (e) { toast({ title: 'Couldn\'t import', description: e?.message, variant: 'destructive' }); }
  };

  const updateTool = (tool) => update({ tools: draft.tools.map((t) => (t.id === tool.id ? tool : t)) });
  const moveTool = (idx, dir) => {
    const tools = [...draft.tools];
    const j = idx + dir;
    if (j < 0 || j >= tools.length) return;
    [tools[idx], tools[j]] = [tools[j], tools[idx]];
    update({ tools });
  };
  const addTool = () => {
    const t = createTool({ tool: 'length', label: `Tool ${draft.tools.length + 1}` });
    update({ tools: [...draft.tools, t] });
    setOpenToolId(t.id);
  };
  const addColumn = () => {
    const c = createColumn({ name: `Column ${draft.columns.length + 1}`, type: 'number' }, draft.columns);
    update({ columns: [...draft.columns, c] });
    setOpenColumnId(c.id);
  };
  const removeColumn = (id) => update({
    columns: draft.columns.filter((c) => c.id !== id),
    tools: draft.tools.map((t) => { const { [id]: _drop, ...rest } = t.default_values || {}; return { ...t, default_values: rest }; }),
  });

  const applyWholeSet = () => {
    if (!draft) return;
    const presets = draft.tools.map((t) => toToolChestPreset(t, { toolSetId: draft.id }));
    onApplyToolSet?.(draft, presets);
    toast({ title: `Loaded ${presets.length} tool${presets.length === 1 ? '' : 's'} from "${draft.name}"` });
  };

  return (
    <div className="flex flex-col h-full min-h-[420px] gap-2">
    {writesBlocked && (
      <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 text-xs flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
        You&apos;re signed in as the platform operator. Tool sets belong to one company — pick a company to work as (Impersonate) before creating, importing or changing them. You can still load a set into this takeoff.
      </div>
    )}
    <div className="flex flex-1 min-h-0 border rounded-md overflow-hidden bg-background">
      {/* Library list */}
      <div className="w-64 shrink-0 border-r flex flex-col">
        <div className="p-2 border-b flex gap-1">
          <Button size="sm" className="flex-1" onClick={handleNew} disabled={writesBlocked}><Plus className="w-3.5 h-3.5 mr-1" />New</Button>
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={writesBlocked} title="Import a tool set file"><Upload className="w-3.5 h-3.5" /></Button>
          <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-3 text-xs text-muted-foreground">Loading…</div>}
          {allSets.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => selectSet(s.id)}
              className={`w-full text-left px-3 py-2 border-b hover:bg-muted/60 ${s.id === selectedId ? 'bg-muted' : ''}`}
            >
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {s.is_builtin && <Lock className="w-3 h-3 text-muted-foreground" />}
                <span className="truncate">{s.name}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {s.tools?.length || 0} tools · {s.columns?.length || 0} columns{s.is_builtin ? ' · built-in' : ` · v${s.version || 1}`}{s.is_shared === false ? ' · private' : ''}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-w-0 flex flex-col">
        {!draft ? (
          <div className="p-6 text-sm text-muted-foreground">Pick a tool set on the left, or create a new one.</div>
        ) : (
          <>
            <div className="p-3 border-b flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                {readOnly ? (
                  <div className="font-semibold truncate flex items-center gap-2">{draft.name}<Badge variant="outline">Built-in · read only</Badge></div>
                ) : (
                  <Input className="h-8 font-semibold" value={draft.name} onChange={(e) => update({ name: e.target.value })} aria-label="Tool set name" />
                )}
              </div>
              {onApplyToolSet && <Button size="sm" variant="secondary" onClick={applyWholeSet}><Play className="w-3.5 h-3.5 mr-1" />Load into this takeoff</Button>}
              <Button size="sm" variant="outline" onClick={handleDuplicate} disabled={writesBlocked}><Copy className="w-3.5 h-3.5 mr-1" />{readOnly ? 'Duplicate to edit' : 'Duplicate'}</Button>
              <Button size="sm" variant="outline" onClick={handleExport} title="Download as a file you can share or import elsewhere"><Download className="w-3.5 h-3.5 mr-1" />Export</Button>
              {!readOnly && <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)} disabled={writesBlocked}><Trash2 className="w-3.5 h-3.5" /></Button>}
              {!readOnly && <Button size="sm" onClick={handleSave} disabled={!dirty || saving || writesBlocked}><Save className="w-3.5 h-3.5 mr-1" />{saving ? 'Saving…' : 'Save'}</Button>}
            </div>

            {!validation.ok && !readOnly && (
              <div className="mx-3 mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {validation.errors.slice(0, 4).map((e, i) => <div key={i}>• {e}</div>)}
              </div>
            )}

            <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col">
              <TabsList className="mx-3 mt-2 self-start">
                <TabsTrigger value="tools"><Wrench className="w-3.5 h-3.5 mr-1" />Tools ({draft.tools.length})</TabsTrigger>
                <TabsTrigger value="columns"><Columns3 className="w-3.5 h-3.5 mr-1" />Columns ({draft.columns.length})</TabsTrigger>
                <TabsTrigger value="details"><Info className="w-3.5 h-3.5 mr-1" />Details</TabsTrigger>
              </TabsList>

              <TabsContent value="tools" className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                <div className="space-y-2">
                  {draft.tools.map((t, idx) => (
                    <div key={t.id} className="rounded-md border">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <button type="button" className="flex-1 min-w-0 flex items-center gap-2 text-left" onClick={() => setOpenToolId(openToolId === t.id ? null : t.id)}>
                          <ToolSwatch tool={t} />
                          <span className="font-medium text-sm truncate">{t.label}</span>
                          <Badge variant="outline" className="text-[10px]">{typeLabel(t.tool)}</Badge>
                          {t.sizeDesignation && <span className="text-xs text-muted-foreground truncate">{t.sizeDesignation}</span>}
                          {t.subject && <span className="text-xs text-muted-foreground truncate">· {t.subject}</span>}
                        </button>
                        {onApplyTool && (
                          <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => onApplyTool(toToolChestPreset(t, { toolSetId: draft.id }), draft)}>Use</Button>
                        )}
                        {!readOnly && (
                          <>
                            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveTool(idx, -1)} disabled={idx === 0}><ArrowUp className="w-3.5 h-3.5" /></Button>
                            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveTool(idx, 1)} disabled={idx === draft.tools.length - 1}><ArrowDown className="w-3.5 h-3.5" /></Button>
                            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => update({ tools: draft.tools.filter((x) => x.id !== t.id) })}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </>
                        )}
                      </div>
                      {openToolId === t.id && (
                        <fieldset disabled={readOnly} className="border-t p-3">
                          <ToolEditor tool={t} columns={draft.columns} onChange={updateTool} />
                        </fieldset>
                      )}
                    </div>
                  ))}
                  {!readOnly && <Button type="button" size="sm" variant="outline" onClick={addTool}><Plus className="w-3.5 h-3.5 mr-1" />Add a tool</Button>}
                  {readOnly && <p className="text-xs text-muted-foreground">This starter set can&apos;t be changed. Click <strong>Duplicate to edit</strong> to make your company&apos;s own copy.</p>}
                </div>
              </TabsContent>

              <TabsContent value="columns" className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                <p className="text-xs text-muted-foreground mb-2">
                  Extra columns every markup made with these tools gets. Built-in values you can always use in formulas:{' '}
                  {BUILT_IN_FIELDS.map((f) => <span key={f.alias} className="font-mono mr-1" title={f.help}>{f.alias}</span>)}
                </p>
                <div className="space-y-2">
                  {draft.columns.map((c) => {
                    const hasError = columnErrors.some((e) => e.columnId === c.id);
                    return (
                      <div key={c.id} className={`rounded-md border ${hasError ? 'border-red-300' : ''}`}>
                        <div className="flex items-center gap-2 px-3 py-2">
                          <button type="button" className="flex-1 min-w-0 flex items-center gap-2 text-left" onClick={() => setOpenColumnId(openColumnId === c.id ? null : c.id)}>
                            <span className="font-medium text-sm truncate">{c.name}</span>
                            <Badge variant="outline" className="text-[10px]">{COLUMN_TYPES.find((t) => t.value === c.type)?.label}</Badge>
                            <span className="font-mono text-xs text-muted-foreground truncate">{c.type === 'formula' ? `${c.alias} = ${c.formula}` : c.alias}</span>
                            {hasError && <AlertTriangle className="w-3.5 h-3.5 text-red-600" />}
                          </button>
                          {!readOnly && <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeColumn(c.id)}><Trash2 className="w-3.5 h-3.5" /></Button>}
                        </div>
                        {openColumnId === c.id && (
                          <fieldset disabled={readOnly} className="border-t p-3">
                            <ColumnEditor
                              column={c}
                              columns={draft.columns}
                              errors={columnErrors}
                              onChange={(next) => update({ columns: draft.columns.map((x) => (x.id === c.id ? next : x)) })}
                            />
                          </fieldset>
                        )}
                      </div>
                    );
                  })}
                  {!readOnly && <Button type="button" size="sm" variant="outline" onClick={addColumn}><Plus className="w-3.5 h-3.5 mr-1" />Add a column</Button>}
                </div>
              </TabsContent>

              <TabsContent value="details" className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-3">
                <fieldset disabled={readOnly} className="space-y-3">
                  <Field label="Description" help="What this set is for, so other estimators pick the right one.">
                    <Textarea rows={3} value={draft.description} onChange={(e) => update({ description: e.target.value })} />
                  </Field>
                  <Field label="Share with everyone in the company" help="Off = only you see it in the library.">
                    <div className="h-8 flex items-center"><Switch checked={draft.is_shared} onCheckedChange={(v) => update({ is_shared: v })} disabled={readOnly} /></div>
                  </Field>
                </fieldset>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div>Created by: {selected?.created_by || '—'}</div>
                  <div>Revision: v{selected?.version || 1}</div>
                  {validation.warnings.map((w, i) => <div key={i} className="text-amber-700">⚠ {w}</div>)}
                </div>
                {/* Live sample so the estimator can sanity-check columns against a known row. */}
                {draft.columns.length > 0 && (
                  <div className="rounded-md border p-3">
                    <div className="text-xs font-semibold mb-1">Sample row per tool</div>
                    <div className="overflow-x-auto">
                      <table className="text-xs w-full">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="pr-3 py-1">Tool</th>
                            <th className="pr-3 py-1">Sample</th>
                            {draft.columns.map((c) => <th key={c.id} className="pr-3 py-1">{c.name}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {draft.tools.map((t) => {
                            const sample = SAMPLE_ROWS[t.tool] || SAMPLE_ROWS.length;
                            const r = computeColumnValues(sample, draft.columns, { tool: t, weightLookup });
                            return (
                              <tr key={t.id} className="border-t cursor-pointer hover:bg-muted/50" onClick={() => { setTab('tools'); setOpenToolId(t.id); }}>
                                <td className="pr-3 py-1 whitespace-nowrap">{t.label}</td>
                                <td className="pr-3 py-1 whitespace-nowrap text-muted-foreground">
                                  {sample.length_ft ? `${sample.length_ft} ft` : sample.area_sq_ft ? `${sample.area_sq_ft} sf` : `${sample.points?.length} ea`}
                                </td>
                                {draft.columns.map((c) => (
                                  <td key={c.id} className={`pr-3 py-1 whitespace-nowrap ${r.errors[c.alias] ? 'text-red-600' : ''}`} title={r.errors[c.alias] || ''}>
                                    {r.errors[c.alias] ? 'error' : formatColumnValue(c, r.values[c.alias])}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{selected?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone in the company loses this tool set. Takeoffs that already loaded its tools keep their own copies. Export it first if you might want it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(pendingSwitch)} onOpenChange={(o) => { if (!o) setPendingSwitch(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>You changed &quot;{draft?.name}&quot; without saving.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setDirty(false); setSelectedId(pendingSwitch); setPendingSwitch(null); }}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(importState)} onOpenChange={(o) => { if (!o) setImportState(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import tool set</DialogTitle>
            <DialogDescription>{importState?.fileName} — check it over before it&apos;s added to the library.</DialogDescription>
          </DialogHeader>
          {importState?.result && (
            <div className="space-y-3 text-sm">
              {importState.result.errors.length > 0 && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 space-y-0.5">
                  {importState.result.errors.map((e, i) => <div key={i}>• {e}</div>)}
                </div>
              )}
              {importState.result.warnings.length > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-0.5">
                  {importState.result.warnings.map((e, i) => <div key={i}>• {e}</div>)}
                </div>
              )}
              {importState.result.preview && (
                <div className="space-y-2">
                  <div><span className="font-semibold">{importState.result.preview.name}</span> <span className="text-muted-foreground">v{importState.result.preview.version}</span></div>
                  {importState.result.preview.description && <p className="text-xs text-muted-foreground">{importState.result.preview.description}</p>}
                  <div className="max-h-56 overflow-y-auto rounded border text-xs">
                    {importState.result.toolSet.tools.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 px-2 py-1 border-b last:border-b-0">
                        <ToolSwatch tool={t} size={14} />
                        <span className="font-medium">{t.label}</span>
                        <span className="text-muted-foreground">{typeLabel(t.tool)}{t.sizeDesignation ? ` · ${t.sizeDesignation}` : ''}</span>
                      </div>
                    ))}
                    {importState.result.preview.columns.map((c) => (
                      <div key={c.alias} className="px-2 py-1 border-b last:border-b-0 font-mono text-muted-foreground">
                        {c.name} ({c.type}){c.formula ? ` = ${c.formula}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportState(null)}>Cancel</Button>
            <Button onClick={handleConfirmImport} disabled={!importState?.result?.ok || writesBlocked}>Add to library</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
}
