import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wrench, ChevronDown, ChevronUp, Trash2, Plus, Library, Download, MousePointerClick, Hexagon, Ruler, Shapes } from 'lucide-react';
import { SHAPE_CLASSES } from '@/data/steelShapeSelector';
import {
  MEASUREMENT_TYPES, STRUCTURAL_STEEL_STARTER_ID, buildStructuralSteelStarter, createToolSet, toToolChestPreset,
} from '@/lib/takeoffToolSets';
import CountMarkerSwatch from '@/components/estimating/CountMarkerSwatch';

const typeLabel = (value) => MEASUREMENT_TYPES.find((m) => m.value === value)?.label || value;

function PresetIcon({ preset }) {
  const type = preset.measurement_type || preset.tool;
  if (type === 'count' || type === 'bolt_count') {
    if (preset.symbol && preset.symbol !== 'circle') return <CountMarkerSwatch symbol={preset.symbol} size={14} />;
    return type === 'bolt_count' ? <Hexagon className="w-3.5 h-3.5 flex-shrink-0" /> : <MousePointerClick className="w-3.5 h-3.5 flex-shrink-0" />;
  }
  if (['area', 'wall_area', 'volume'].includes(type)) return <Shapes className="w-3.5 h-3.5 flex-shrink-0" />;
  return <Ruler className="w-3.5 h-3.5 flex-shrink-0" />;
}

// IRONSIGHT's Tool Chest side panel: this takeoff's saved presets (click one
// to measure with it), a hand-made preset form, and the company-wide picker
// — load a whole company tool set (or the built-in starter) in one step, or
// open the full library to manage sets. Loading a set only changes this
// takeoff; it never writes to the company's tool sets, so it works for a
// super_admin who isn't working as a company yet (the library's own write
// buttons are what that blocks).
export default function ToolChestPanel({
  toolChest, selectedPresetId, onSelectPreset, onRemovePreset, onAddPreset,
  activeToolSet, onLoadToolSet, onOpenLibrary,
}) {
  const { user } = useAuth();
  const me = user?.email || user?.full_name || '';
  const [open, setOpen] = useState(false);
  const [companySets, setCompanySets] = useState([]);
  const [pickedSetId, setPickedSetId] = useState('');
  const [label, setLabel] = useState('');
  const [shapeClass, setShapeClass] = useState(SHAPE_CLASSES[0].value);
  const [size, setSize] = useState('');
  const [tool, setTool] = useState('count');
  const [color, setColor] = useState('#ef4444');
  const starter = useMemo(() => buildStructuralSteelStarter(), []);

  // Re-read when the panel opens so a set just saved in the library shows up.
  useEffect(() => {
    if (!open) return;
    db.entities.takeoff_tool_sets.list('-created_date', 500)
      .then((rows) => setCompanySets(rows.filter((r) => r.is_shared !== false || !r.created_by || r.created_by === me)))
      .catch(() => setCompanySets([]));
  }, [open, me]);

  const allSets = [starter, ...companySets];

  const handleLoadPicked = () => {
    const set = allSets.find((s) => s.id === pickedSetId);
    if (!set) return;
    const clean = createToolSet(set);
    const presets = clean.tools.map((t) => toToolChestPreset(t, { toolSetId: set.id }));
    onLoadToolSet?.(clean, presets);
    setPickedSetId('');
  };

  const handleAdd = () => {
    if (!label.trim()) return;
    onAddPreset?.({
      id: crypto.randomUUID(),
      tool,
      label: label.trim(),
      shapeClass,
      sizeDesignation: size.trim(),
      color,
    });
    setLabel('');
    setSize('');
  };

  return (
    <div className="border rounded-lg">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold"
      >
        <span className="flex items-center gap-2"><Wrench className="w-4 h-4" />Tool Chest</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="border-t p-3 space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Company tool sets</p>
            {activeToolSet && (
              <p className="text-[11px] text-muted-foreground">
                Using <span className="font-medium text-foreground">{activeToolSet.name}</span> — {activeToolSet.tools?.length || 0} tools, {activeToolSet.columns?.length || 0} columns
              </p>
            )}
            <div className="flex items-center gap-1.5">
              <Select value={pickedSetId} onValueChange={setPickedSetId}>
                <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Pick a tool set…" /></SelectTrigger>
                <SelectContent>
                  {allSets.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}{s.id === STRUCTURAL_STEEL_STARTER_ID ? ' (built-in)' : ''} · {s.tools?.length || 0} tools
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="secondary" className="h-8" onClick={handleLoadPicked} disabled={!pickedSetId} title="Replace this takeoff's Tool Chest with the set's tools and columns">
                <Download className="w-3.5 h-3.5 mr-1" />Load
              </Button>
            </div>
            <Button size="sm" variant="outline" className="w-full h-8" onClick={onOpenLibrary}>
              <Library className="w-3.5 h-3.5 mr-1.5" />Open tool set library
            </Button>
          </div>

          <div className="border-t pt-3">
            {toolChest.length === 0 ? (
              <p className="text-xs text-muted-foreground">No tools in this takeoff yet — load a tool set above or add one below.</p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
                {toolChest.map((preset) => (
                  <div
                    key={preset.id}
                    onClick={() => onSelectPreset?.(preset)}
                    title={preset.subject ? `${preset.subject} · ${typeLabel(preset.measurement_type || preset.tool)}` : typeLabel(preset.measurement_type || preset.tool)}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 cursor-pointer text-xs ${selectedPresetId === preset.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}
                  >
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: preset.color }} />
                    <PresetIcon preset={preset} />
                    <span className="font-medium truncate">{preset.label}</span>
                    <span className="text-muted-foreground truncate flex-1">
                      {typeLabel(preset.measurement_type || preset.tool)}{preset.sizeDesignation ? ` — ${preset.sizeDesignation}` : ''}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 flex-shrink-0"
                      onClick={(e) => { e.stopPropagation(); onRemovePreset?.(preset.id); }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">New tool (this takeoff only)</p>
            <Input placeholder="Label — e.g. W14x90 Columns" value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <Select value={shapeClass} onValueChange={setShapeClass}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHAPE_CLASSES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="Size (e.g. W14X90)" value={size} onChange={(e) => setSize(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="flex items-center gap-2">
              <Select value={tool} onValueChange={setTool}>
                <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEASUREMENT_TYPES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 rounded border cursor-pointer" />
              <Button size="sm" onClick={handleAdd} disabled={!label.trim()} className="ml-auto">
                <Plus className="w-3.5 h-3.5 mr-1" />Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
