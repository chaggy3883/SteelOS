import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Combine, FileDown, FileSpreadsheet, Save, Star, ChevronDown, ChevronRight, AlertTriangle, ArrowLeft } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import MathDrill from '@/components/estimating/MathDrill';
import { DEFAULT_COMBINE_SETTINGS, combineRun, buildOrderExportTables, summarizeForCompare } from '@/lib/stockCombiner';
import { formatFtIn, formatInches, profileKey } from '@/lib/materialEntryMath';
import { exportCombinedOrderToPdf } from '@/lib/requisitionPdfExport';
import { exportCombinedOrderToXlsx } from '@/lib/requisitionXlsxExport';

// "Combine for ordering" review screen, shared by the Full Takeoff (manual
// rows) and IRONSIGHT's Markups List. Each caller turns its own rows into
// the same piece list (see stockCombiner.js for the piece shape) and hands
// it here; this screen runs the Mult (linear) / Nest (plate) engine live as
// settings change, shows every group's order line, cut list and drop, and
// saves runs to combining_runs. Nothing here edits the takeoff itself.

const n = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const money = (v) => (v == null ? '—' : `$${n(v, 2)}`);
const parseList = (text) => String(text || '').split(/[,;\s]+/).map((t) => Number(t)).filter((v) => Number.isFinite(v) && v > 0);
const parseSheets = (text) => String(text || '').split(/[,;]+/).map((t) => {
  const m = t.trim().match(/^(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)$/);
  return m ? { width_in: Number(m[1]), length_in: Number(m[2]) } : null;
}).filter(Boolean);
const sheetText = (s) => `${s.width_in}x${s.length_in}`;

// Drill-down lines for one group's numbers.
function groupMath(g) {
  const t = g.totals;
  if (g.family === 'linear') {
    const wpf = g.weight_per_ft || 0;
    return {
      stock: [`${t.stock_qty} bars × ${formatFtIn(g.stock_length_in || 0)}`, ...g.bars.map((b) => `Bar ${b.index}: ${b.cuts.map((c) => formatFtIn(c.length_in)).join(' + ')}${b.cuts.length > 1 ? ` + ${b.cuts.length - 1} kerf × ${g.settings_used.kerf_in}"` : ''}${g.settings_used.squaring_in ? ` + squaring ${g.settings_used.squaring_in}"` : ''} → drop ${formatFtIn(b.drop_in)}`)],
      drop: [`Ordered ${n(t.ordered_in, 3)} in − pieces ${n(t.piece_in, 3)} in = ${n(t.ordered_in - t.piece_in, 3)} in`, `${n(t.ordered_in - t.piece_in, 3)} ÷ ${n(t.ordered_in, 3)} × 100 = ${n(t.drop_pct, 3)}%`, `= usable drop ${n(t.usable_drop_in, 3)} + scrap drop ${n(t.scrap_drop_in, 3)} + kerf ${n(t.kerf_in, 3)} + squaring ${n(t.squaring_in, 3)} in`],
      ordered: [`${n(t.ordered_in, 3)} in ÷ 12 = ${n(t.ordered_in / 12, 4)} ft × ${n(wpf, 3)} lb/ft = ${n(t.ordered_lbs, 3)} lb`, `${n(t.ordered_lbs, 3)} ÷ 2000 = ${n(t.ordered_tons, 4)} tons`],
      used: [`${n(t.piece_in, 3)} in ÷ 12 × ${n(wpf, 3)} lb/ft = ${n(t.used_lbs, 3)} lb`],
      scrap: [`Scrap drop ${n(t.scrap_drop_in, 3)} + kerf ${n(t.kerf_in, 3)} + squaring ${n(t.squaring_in, 3)} = ${n(t.scrap_drop_in + t.kerf_in + t.squaring_in, 3)} in`, `÷ 12 × ${n(wpf, 3)} lb/ft = ${n(t.scrap_lbs, 3)} lb ÷ 2000 = ${n(t.scrap_tons, 5)} tons`, `Usable drop (≥ ${g.settings_used.usable_drop_in}"): ${n(t.usable_drop_in, 3)} in = ${n(t.usable_drop_lbs, 3)} lb`],
      combined: [`${t.qty_combined} of ${t.qty_total} pieces placed on stock`, `${t.qty_combined} ÷ ${t.qty_total} × 100 = ${n(t.pct_combined, 1)}%`, ...g.flagged.map((f) => `${f.label} ${formatFtIn(f.length_in)} × ${f.quantity}: ${f.reason}`)],
      cost: [t.cost_basis, t.cost != null ? `= ${money(t.cost)}` : ''],
    };
  }
  const lb = g.lb_per_sq_in || 0;
  return {
    stock: [`${t.stock_qty} sheets × ${g.sheet ? `${g.sheet.width_in}" × ${g.sheet.length_in}"` : '—'} (${g.preference === 'upright' ? 'long side along the sheet' : 'short side along the sheet'} first)`, ...g.sheets.map((s) => `Sheet ${s.index}: ${s.placements.length} parts, ${n(s.part_area, 1)} sq in`)],
    drop: [`Ordered ${n(t.ordered_area, 1)} sq in − parts ${n(t.part_area, 1)} sq in = ${n(t.ordered_area - t.part_area, 1)} sq in`, `${n(t.ordered_area - t.part_area, 1)} ÷ ${n(t.ordered_area, 1)} × 100 = ${n(t.drop_pct, 3)}%`, `= usable drop ${n(t.usable_drop_area, 1)} + scrap ${n(t.scrap_area, 1)} sq in`],
    ordered: [`${n(t.ordered_area, 1)} sq in × ${n(lb, 5)} lb/sq in = ${n(t.ordered_lbs, 3)} lb`, `${n(t.ordered_lbs, 3)} ÷ 2000 = ${n(t.ordered_tons, 4)} tons`],
    used: [`${n(t.part_area, 1)} sq in × ${n(lb, 5)} lb/sq in = ${n(t.used_lbs, 3)} lb`],
    scrap: [`${n(t.scrap_area, 1)} sq in × ${n(lb, 5)} = ${n(t.scrap_lbs, 3)} lb ÷ 2000 = ${n(t.scrap_tons, 5)} tons`, `Usable drop (strip ≥ the plate drop minimum both ways): ${n(t.usable_drop_area, 1)} sq in = ${n(t.usable_drop_lbs, 3)} lb`],
    combined: [`${t.qty_combined} of ${t.qty_total} parts nested`, `${n(t.pct_combined, 1)}%`, ...g.flagged.map((f) => `${f.label} ${formatInches(f.width_in)} × ${formatInches(f.length_in)}: ${f.reason}`)],
    cost: [t.cost_basis, t.cost != null ? `= ${money(t.cost)}` : ''],
  };
}

function runMath(run, field, label, fmt) {
  return [...run.groups.map((g) => `${g.label}${g.sequence_label ? ` [${g.sequence_label}]` : ''}: ${fmt(g.totals[field])}`), `Total ${label}: ${fmt(run.totals[field])}`];
}

function BarDiagram({ group }) {
  const maxLen = Math.max(1, ...group.bars.map((b) => b.stock_length_in));
  const W = 640;
  const scale = W / maxLen;
  const rowH = 22;
  return (
    <svg viewBox={`0 0 ${W + 70} ${group.bars.length * rowH + 4}`} className="w-full" role="img" aria-label={`Cut diagram for ${group.label}`}>
      {group.bars.map((b, i) => {
        const y = i * rowH + 2;
        return (
          <g key={b.index}>
            <rect x={0} y={y} width={b.stock_length_in * scale} height={rowH - 6} fill="none" stroke="currentColor" strokeOpacity="0.4" />
            {b.squaring_in > 0 && <rect x={0} y={y} width={b.squaring_in * scale} height={rowH - 6} fill="#94a3b8" />}
            {b.cuts.map((c, ci) => (
              <g key={ci}>
                <rect x={c.start_in * scale} y={y} width={c.length_in * scale} height={rowH - 6} fill="#3b82f6" fillOpacity="0.75" stroke="#1d4ed8" strokeWidth="0.5" />
                {c.length_in * scale > 46 && <text x={(c.start_in + c.length_in / 2) * scale} y={y + 11} fontSize="9" textAnchor="middle" fill="white">{formatFtIn(c.length_in)}</text>}
              </g>
            ))}
            {b.drop_in > 0 && (
              <rect x={(b.stock_length_in - b.drop_in) * scale} y={y} width={b.drop_in * scale} height={rowH - 6} fill={b.drop_kind === 'usable' ? '#22c55e' : '#ef4444'} fillOpacity="0.45" />
            )}
            <text x={W + 4} y={y + 11} fontSize="9" fill="currentColor">Bar {b.index}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Sheet drawn lying down: the sheet's length runs left to right.
function SheetDiagram({ sheet }) {
  const W = 560;
  const scale = W / sheet.length_in;
  const H = sheet.width_in * scale;
  return (
    <svg viewBox={`0 0 ${W + 2} ${H + 2}`} className="w-full max-w-xl" role="img" aria-label={`Sheet ${sheet.index} layout`}>
      <rect x={1} y={1} width={W} height={H} fill="#ef4444" fillOpacity="0.12" stroke="currentColor" strokeOpacity="0.5" />
      {sheet.usable_drop_area > 0 && sheet.remnant && (
        <rect x={1 + sheet.remnant.y * scale} y={1 + sheet.remnant.x * scale} width={sheet.remnant.h * scale} height={sheet.remnant.w * scale} fill="#22c55e" fillOpacity="0.3" />
      )}
      {sheet.placements.map((p, i) => (
        <g key={i}>
          <rect x={1 + p.y * scale} y={1 + p.x * scale} width={p.h * scale} height={p.w * scale} fill="#3b82f6" fillOpacity="0.7" stroke="#1d4ed8" strokeWidth="0.5" />
          {p.h * scale > 34 && <text x={1 + (p.y + p.h / 2) * scale} y={1 + (p.x + p.w / 2) * scale + 3} fontSize="8" textAnchor="middle" fill="white">{`${formatInches(p.w)}×${formatInches(p.h)}`}</text>}
        </g>
      ))}
    </svg>
  );
}

function GroupDetail({ group, onUseStock, onUseSheet, onClearOverride, overridden }) {
  return (
    <div className="space-y-3 p-3 bg-muted/20 border-t">
      <div>
        <p className="text-xs font-semibold mb-1">View nest</p>
        {group.family === 'linear'
          ? (group.bars.length ? <BarDiagram group={group} /> : <p className="text-xs text-muted-foreground">Nothing placed.</p>)
          : <div className="space-y-2">{group.sheets.map((s) => <div key={s.index}><p className="text-[11px] text-muted-foreground">Sheet {s.index} — {s.width_in}" × {s.length_in}"</p><SheetDiagram sheet={s} /></div>)}</div>}
        <p className="text-[10px] text-muted-foreground mt-1">Blue = pieces · green = usable drop · red = scrap · gray = squaring.</p>
      </div>

      <div className="overflow-x-auto">
        <p className="text-xs font-semibold mb-1">Cut list</p>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr><th className="text-left p-1">{group.family === 'linear' ? 'Bar' : 'Sheet'}</th><th className="text-left p-1">Piece</th><th className="text-left p-1">Size</th><th className="text-left p-1">Position</th><th className="text-left p-1">Drop</th></tr></thead>
          <tbody>
            {group.family === 'linear' ? group.bars.map((b) => b.cuts.map((c, i) => (
              <tr key={`${b.index}-${i}`} className="border-t">
                <td className="p-1">{i === 0 ? `Bar ${b.index} (${formatFtIn(b.stock_length_in)})` : ''}</td>
                <td className="p-1">{c.label}</td>
                <td className="p-1 font-mono">{formatFtIn(c.length_in)}</td>
                <td className="p-1 font-mono">{formatFtIn(c.start_in)} to {formatFtIn(c.end_in)}</td>
                <td className="p-1">{i === b.cuts.length - 1 ? (
                  <MathDrill value={`${formatFtIn(b.drop_in)} ${b.drop_kind === 'usable' ? 'usable' : 'scrap'}`} title={`Bar ${b.index} drop`} lines={[`${formatFtIn(b.stock_length_in)} − squaring ${b.squaring_in}" − pieces ${n(b.piece_in, 3)}" − kerf ${n(b.kerf_in, 3)}" = ${n(b.drop_in, 3)}"`, `${b.drop_kind === 'usable' ? 'At or above' : 'Below'} the usable-drop threshold → ${b.drop_kind}`]} align="start" />
                ) : ''}</td>
              </tr>
            ))) : group.sheets.map((s) => s.placements.map((p, i) => (
              <tr key={`${s.index}-${i}`} className="border-t">
                <td className="p-1">{i === 0 ? `Sheet ${s.index}` : ''}</td>
                <td className="p-1">{p.label}</td>
                <td className="p-1 font-mono">{formatInches(p.w)} × {formatInches(p.h)}{p.rotated ? ' (turned)' : ''}</td>
                <td className="p-1 font-mono">x {formatInches(p.x)}, y {formatInches(p.y)}</td>
                <td className="p-1">{i === s.placements.length - 1 ? (
                  <MathDrill value={`${n(s.drop_area, 0)} sq in`} title={`Sheet ${s.index} drop`} lines={[`${s.width_in} × ${s.length_in} = ${n(s.width_in * s.length_in, 1)} sq in − parts ${n(s.part_area, 1)} = ${n(s.drop_area, 1)} sq in`, s.remnant ? `End strip ${formatInches(s.remnant.w)} × ${formatInches(s.remnant.h)} = ${n(s.remnant.area, 1)} sq in → ${s.usable_drop_area > 0 ? 'usable drop' : 'too small, scrap'}` : 'No end strip left', `Scrap ${n(s.scrap_area, 1)} sq in`]} align="start" />
                ) : ''}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <p className="text-xs font-semibold mb-1">Stock options compared {overridden && <Button size="sm" variant="link" className="h-auto p-0 ml-2 text-xs" onClick={onClearOverride}>Back to best pick</Button>}</p>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr><th className="text-left p-1">Stock</th><th className="text-right p-1">Qty</th><th className="text-right p-1">Ordered</th><th className="text-right p-1">% drop</th><th className="p-1" /></tr></thead>
          <tbody>
            {group.alternatives.map((a, i) => {
              const isLinear = group.family === 'linear';
              const label = isLinear ? formatFtIn(a.stock_length_in) : `${a.sheet.width_in}" × ${a.sheet.length_in}" (${a.preference === 'upright' ? 'long side along' : 'short side along'})`;
              const current = isLinear ? a.stock_length_in === group.stock_length_in : (group.sheet && a.sheet.width_in === group.sheet.width_in && a.sheet.length_in === group.sheet.length_in && a.preference === group.preference);
              return (
                <tr key={i} className={`border-t ${current ? 'bg-primary/5 font-medium' : ''}`}>
                  <td className="p-1">{label}{current ? ' ← used' : ''}</td>
                  <td className="p-1 text-right font-mono">{a.feasible ? (isLinear ? a.bars : a.sheet_qty) : '—'}</td>
                  <td className="p-1 text-right font-mono">{a.feasible ? (isLinear ? formatFtIn(a.ordered_in) : `${n(a.ordered_area, 0)} sq in`) : 'piece too long'}</td>
                  <td className="p-1 text-right font-mono">{a.feasible ? `${n(a.drop_pct, 2)}%` : '—'}</td>
                  <td className="p-1 text-right">{a.feasible && !current && (
                    <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={() => (isLinear ? onUseStock(a.stock_length_in / 12) : onUseSheet(a.sheet))}>Use this</Button>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CombineForOrderingDialog({ open, onOpenChange, source, bidId, takeoffSessionId, title, subtitle, pieces = [], excluded = [] }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState(DEFAULT_COMBINE_SETTINGS);
  const [stockText, setStockText] = useState(DEFAULT_COMBINE_SETTINGS.stock_lengths_ft.join(', '));
  const [sheetsText, setSheetsText] = useState(DEFAULT_COMBINE_SETTINGS.sheets.map(sheetText).join(', '));
  const [expanded, setExpanded] = useState(null);
  const [runs, setRuns] = useState([]);
  const [runName, setRunName] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [compareIds, setCompareIds] = useState([]);
  const [includeCost, setIncludeCost] = useState(false);
  const [stockCosts, setStockCosts] = useState(new Map());
  const [familyFilter, setFamilyFilter] = useState('all');

  const runFilter = useMemo(() => (bidId ? { bid_id: bidId } : takeoffSessionId ? { takeoff_session_id: takeoffSessionId } : null), [bidId, takeoffSessionId]);

  const loadRuns = async () => {
    if (!runFilter) { setRuns([]); return; }
    try {
      const list = await db.entities.combining_runs.filter(runFilter, '-created_date', 50);
      setRuns(list);
    } catch (e) {
      setRuns([]);
    }
  };

  useEffect(() => { if (open) loadRuns(); }, [open, runFilter]);

  // Stock length costs on file (StockLengthOption.cost_per_length, keyed to
  // a steel_catalog size) — used before any $/cwt rate when present.
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [catalog, options] = await Promise.all([
          db.entities.steel_catalog.list('size_designation', 2000),
          db.entities.StockLengthOption.list('-created_date', 5000),
        ]);
        const keyById = new Map(catalog.map((c) => [c.id, profileKey(c.size_designation)]));
        const map = new Map();
        options.forEach((o) => {
          if (o.is_active === false || !(Number(o.cost_per_length) > 0)) return;
          const key = keyById.get(o.steel_catalog_item_id);
          if (!key) return;
          if (!map.has(key)) map.set(key, {});
          map.get(key)[Number(o.stock_length_in)] = Number(o.cost_per_length);
        });
        setStockCosts(map);
      } catch (e) {
        setStockCosts(new Map());
      }
    })();
  }, [open]);

  const piecesWithCosts = useMemo(() => pieces.map((p) => (p.family === 'linear' && stockCosts.has(profileKey(p.profile)) ? { ...p, stock_costs: stockCosts.get(profileKey(p.profile)) } : p)), [pieces, stockCosts]);
  const liveRun = useMemo(() => combineRun(piecesWithCosts, settings), [piecesWithCosts, settings]);
  const run = viewing ? { groups: viewing.groups || [], totals: viewing.totals || {} } : liveRun;
  const shownGroups = run.groups.filter((g) => familyFilter === 'all' || g.family === familyFilter);
  const shownExcluded = viewing ? (viewing.excluded || []) : excluded;

  const set = (patch) => setSettings((prev) => ({ ...prev, ...patch }));
  const setOverride = (key, value) => setSettings((prev) => {
    const next = { ...(prev.group_overrides || {}) };
    if (value) next[key] = value; else delete next[key];
    return { ...prev, group_overrides: next };
  });

  const settingsText = (s) => [
    `Stock ${(s.forced_stock_length_ft ? [s.forced_stock_length_ft] : s.stock_lengths_ft).join("', ")}'`,
    `kerf ${s.kerf_in}"`, `squaring ${s.squaring_in}"`, `clamp ${s.clamp_in}"`, `usable drop ≥ ${s.usable_drop_in}"`,
    `sheets ${(s.forced_sheet ? [s.forced_sheet] : s.sheets).map(sheetText).join(', ')}`,
    `plate kerf ${s.plate_kerf_in}"`, `edge trim ${s.edge_trim_in}"`, s.allow_rotate ? 'rotate on' : 'rotate off',
    s.within_sequence ? 'within sequence only' : 'across sequences',
  ].join(' · ');

  const handleSave = async () => {
    setSaving(true);
    try {
      let createdBy = '';
      try { const me = await db.auth.me(); createdBy = me?.email || me?.full_name || ''; } catch (e) { createdBy = ''; }
      await db.entities.combining_runs.create({
        bid_id: bidId || undefined,
        takeoff_session_id: takeoffSessionId || undefined,
        source,
        name: runName.trim() || `Run ${new Date().toLocaleString()}`,
        created_by: createdBy,
        used_for_pricing: false,
        settings,
        input_pieces: pieces,
        excluded,
        groups: liveRun.groups,
        totals: liveRun.totals,
      });
      setRunName('');
      toast({ title: 'Combining run saved', description: 'The takeoff lines were not changed.' });
      loadRuns();
    } catch (e) {
      toast({ title: 'Could not save the run', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const markForPricing = async (target) => {
    try {
      await Promise.all(runs.filter((r) => r.used_for_pricing && r.id !== target.id).map((r) => db.entities.combining_runs.update(r.id, { used_for_pricing: false })));
      await db.entities.combining_runs.update(target.id, { used_for_pricing: !target.used_for_pricing });
      loadRuns();
    } catch (e) {
      toast({ title: 'Could not update the run', description: e?.message || 'Please retry.', variant: 'destructive' });
    }
  };

  const openSaved = (r) => {
    setViewing(r);
    setExpanded(null);
  };

  const exportArgs = () => ({
    title: `Combined Order List — ${title || 'Takeoff'}`,
    subtitle: `${subtitle || ''}${viewing ? ` — saved run "${viewing.name}"` : ' — live run (not saved)'}`,
    tables: buildOrderExportTables(run, { includeCost }),
    settingsText: settingsText(viewing?.settings || settings),
    includeCost,
  });

  const compareRuns = runs.filter((r) => compareIds.includes(r.id));
  const toggleCompare = (id) => setCompareIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev.slice(-1), id]));

  const t = run.totals || {};
  const linearCount = run.groups.filter((g) => g.family === 'linear').length;
  const plateCount = run.groups.filter((g) => g.family === 'plate').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[96vw] max-h-[92vh] overflow-y-auto" dialogId="combine-for-ordering">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Combine className="w-4 h-4 text-primary" />Combine for ordering</DialogTitle>
          <DialogDescription>
            {title}{subtitle ? ` — ${subtitle}` : ''}. Same-size pieces are packed into stock lengths (linear) and sheets (plate) so you can see what to buy and the drop. This is a review — the takeoff lines are not changed.
          </DialogDescription>
        </DialogHeader>

        {viewing && (
          <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
            <span>Viewing saved run <strong>{viewing.name}</strong> ({new Date(viewing.created_date).toLocaleString()}) — settings: {settingsText(viewing.settings || {})}</span>
            <Button size="sm" variant="outline" className="h-7" onClick={() => setViewing(null)}><ArrowLeft className="w-3.5 h-3.5 mr-1" />Back to live</Button>
          </div>
        )}

        {!viewing && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linear (Mult)</p>
              <div>
                <Label className="text-xs">Stock lengths offered (ft)</Label>
                <Input className="h-8 text-sm mt-1" value={stockText} onChange={(e) => { setStockText(e.target.value); set({ stock_lengths_ft: parseList(e.target.value) }); }} />
              </div>
              <div>
                <Label className="text-xs">Stock length to use</Label>
                <Select value={settings.forced_stock_length_ft ? String(settings.forced_stock_length_ft) : 'best'} onValueChange={(v) => set({ forced_stock_length_ft: v === 'best' ? null : Number(v) })}>
                  <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="best">Best per group (least drop, then fewest bars)</SelectItem>
                    {settings.stock_lengths_ft.map((f) => <SelectItem key={f} value={String(f)}>Force {f}'-0"</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Kerf (in)</Label><Input type="number" step="0.0625" min={0} className="h-8 text-sm mt-1" value={settings.kerf_in} onChange={(e) => set({ kerf_in: Number(e.target.value) || 0 })} /></div>
                <div><Label className="text-xs">Squaring (in per bar)</Label><Input type="number" step="0.125" min={0} className="h-8 text-sm mt-1" value={settings.squaring_in} onChange={(e) => set({ squaring_in: Number(e.target.value) || 0 })} /></div>
                <div><Label className="text-xs">Clamp allowance (in)</Label><Input type="number" step="0.5" min={0} className="h-8 text-sm mt-1" value={settings.clamp_in} onChange={(e) => set({ clamp_in: Number(e.target.value) || 0 })} /></div>
                <div><Label className="text-xs">Usable drop at least (in)</Label><Input type="number" step="1" min={0} className="h-8 text-sm mt-1" value={settings.usable_drop_in} onChange={(e) => set({ usable_drop_in: Number(e.target.value) || 0 })} /></div>
              </div>
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plate (Nest)</p>
              <div>
                <Label className="text-xs">Sheet sizes (width x length, in)</Label>
                <Input className="h-8 text-sm mt-1" value={sheetsText} onChange={(e) => { setSheetsText(e.target.value); set({ sheets: parseSheets(e.target.value) }); }} />
              </div>
              <div>
                <Label className="text-xs">Sheet to use</Label>
                <Select value={settings.forced_sheet ? sheetText(settings.forced_sheet) : 'best'} onValueChange={(v) => set({ forced_sheet: v === 'best' ? null : settings.sheets.find((s) => sheetText(s) === v) || null })}>
                  <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="best">Best per group (least drop, then fewest sheets)</SelectItem>
                    {settings.sheets.map((s) => <SelectItem key={sheetText(s)} value={sheetText(s)}>Force {s.width_in}" × {s.length_in}"</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Kerf (in)</Label><Input type="number" step="0.0625" min={0} className="h-8 text-sm mt-1" value={settings.plate_kerf_in} onChange={(e) => set({ plate_kerf_in: Number(e.target.value) || 0 })} /></div>
                <div><Label className="text-xs">Edge trim (in per side)</Label><Input type="number" step="0.125" min={0} className="h-8 text-sm mt-1" value={settings.edge_trim_in} onChange={(e) => set({ edge_trim_in: Number(e.target.value) || 0 })} /></div>
                <div><Label className="text-xs">Usable drop at least (in, both ways)</Label><Input type="number" step="1" min={0} className="h-8 text-sm mt-1" value={settings.usable_plate_drop_in} onChange={(e) => set({ usable_plate_drop_in: Number(e.target.value) || 0 })} /></div>
                <label className="flex items-center gap-2 text-xs mt-6"><Checkbox checked={settings.allow_rotate !== false} onCheckedChange={(v) => set({ allow_rotate: !!v })} />Turn parts for best fit</label>
              </div>
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Run</p>
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={!!settings.within_sequence} onCheckedChange={(v) => set({ within_sequence: !!v })} />Combine only within sequence / area</label>
              <div>
                <Label className="text-xs">Material price ($/cwt, optional)</Label>
                <Input type="number" min={0} step="0.01" className="h-8 text-sm mt-1" value={settings.price_per_cwt ?? ''} placeholder="e.g. 52.50" onChange={(e) => set({ price_per_cwt: e.target.value === '' ? null : Number(e.target.value) })} />
                <p className="text-[10px] text-muted-foreground mt-0.5">A stock length cost on file (Steel Catalog → stock lengths) is used first for that size.</p>
              </div>
              <div className="flex gap-2">
                <Input className="h-8 text-sm" placeholder="Run name" value={runName} onChange={(e) => setRunName(e.target.value)} />
                <Button size="sm" onClick={handleSave} disabled={saving || !runFilter || pieces.length === 0} title={runFilter ? 'Save this run' : 'Link to a bid or save the IRONSIGHT session first'}><Save className="w-3.5 h-3.5 mr-1" />Save run</Button>
              </div>
            </div>
          </div>
        )}

        {/* Run totals */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {[
            ['Stock to order', <MathDrill key="s" value={`${t.bars || 0} bars · ${t.sheets || 0} sheets`} title="Stock to order" lines={runMath(run, 'stock_qty', 'pieces of stock', (v) => `${v || 0}`)} />],
            ['Ordered tons', <MathDrill key="o" value={n(t.ordered_tons, 3)} title="Ordered tons" lines={[...runMath(run, 'ordered_lbs', 'lb', (v) => `${n(v, 1)} lb`), `${n(t.ordered_lbs, 1)} lb ÷ 2000 = ${n(t.ordered_tons, 4)} tons`]} />],
            ['Used tons', <MathDrill key="u" value={n((t.used_lbs || 0) / 2000, 3)} title="Weight in pieces" lines={[...runMath(run, 'used_lbs', 'lb', (v) => `${n(v, 1)} lb`), `÷ 2000 = ${n((t.used_lbs || 0) / 2000, 4)} tons`]} />],
            ['% drop', <MathDrill key="d" value={`${n(t.drop_pct, 2)}%`} title="% drop (by weight)" lines={[`(ordered ${n(t.ordered_lbs, 1)} − used ${n(t.used_lbs, 1)}) ÷ ${n(t.ordered_lbs, 1)} × 100 = ${n(t.drop_pct, 3)}%`, `Usable drop ${n(t.usable_drop_lbs, 1)} lb + scrap ${n(t.scrap_lbs, 1)} lb`]} />],
            ['Scrap tons', <MathDrill key="x" value={n(t.scrap_tons, 3)} title="Scrap tons" lines={[...runMath(run, 'scrap_lbs', 'scrap lb', (v) => `${n(v, 1)} lb`), `÷ 2000 = ${n(t.scrap_tons, 4)} tons`]} />],
            ['% combined', <MathDrill key="c" value={`${n(t.pct_combined, 1)}%`} title="Pieces combined" lines={[`${t.qty_combined || 0} of ${t.qty_total || 0} pieces placed on stock`, `${t.flagged_count || 0} flagged for splice / special order`]} />],
            ['Cost', <MathDrill key="$" value={money(t.cost)} title="Material cost" lines={[...run.groups.map((g) => `${g.label}: ${g.totals.cost_basis}${g.totals.cost != null ? ` = ${money(g.totals.cost)}` : ''}`), t.cost != null ? `Total of ${t.cost_groups} priced groups = ${money(t.cost)}` : 'No group has a price yet']} />],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border p-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
              <div className="text-sm font-semibold mt-0.5">{value}</div>
            </div>
          ))}
        </div>

        {(t.needs_weight_groups > 0) && (
          <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{t.needs_weight_groups} group{t.needs_weight_groups === 1 ? ' has' : 's have'} no weight — lengths and drop are right, weights and tons show 0 until a weight is entered on the takeoff.</p>
        )}

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Select value={familyFilter} onValueChange={setFamilyFilter}>
              <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups ({run.groups.length})</SelectItem>
                <SelectItem value="linear">Linear only ({linearCount})</SelectItem>
                <SelectItem value="plate">Plate only ({plateCount})</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-xs"><Checkbox checked={includeCost} onCheckedChange={(v) => setIncludeCost(!!v)} />Include cost in export</label>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={run.groups.length === 0} onClick={() => exportCombinedOrderToPdf(exportArgs())}><FileDown className="w-3.5 h-3.5 mr-1" />Order list PDF</Button>
            <Button size="sm" variant="outline" disabled={run.groups.length === 0} onClick={() => exportCombinedOrderToXlsx(exportArgs())}><FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Order list Excel</Button>
          </div>
        </div>

        {/* Groups */}
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="p-2 w-6" />
                <th className="text-left p-2">Group</th>
                <th className="text-left p-2">Order</th>
                <th className="text-right p-2">% drop</th>
                <th className="text-right p-2">Ordered tons</th>
                <th className="text-right p-2">Used lb</th>
                <th className="text-right p-2">Scrap tons</th>
                <th className="text-right p-2">Combined</th>
                <th className="text-right p-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {shownGroups.length === 0 && (
                <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">Nothing to combine — add lengths (linear) or width and length (plate) on the takeoff.</td></tr>
              )}
              {shownGroups.map((g) => {
                const m = groupMath(g);
                const isOpen = expanded === g.key;
                return (
                  <React.Fragment key={g.key}>
                    <tr className="border-t align-top">
                      <td className="p-2"><button type="button" onClick={() => setExpanded(isOpen ? null : g.key)} aria-label={isOpen ? 'Hide detail' : 'View nest and cut list'}>{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button></td>
                      <td className="p-2">
                        <button type="button" className="font-medium text-left hover:underline" onClick={() => setExpanded(isOpen ? null : g.key)}>{g.label}</button>
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">{g.family === 'linear' ? 'Mult' : 'Nest'}</Badge>
                          {g.sequence_label && <Badge variant="outline" className="text-[10px]">{g.sequence_label}</Badge>}
                          {g.forced && <Badge variant="outline" className="text-[10px]">forced</Badge>}
                          {g.needs_weight && <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">weight needed</Badge>}
                          {g.flagged.length > 0 && <Badge variant="outline" className="text-[10px] text-red-700 border-red-300">{g.flagged.length} needs splice / special order</Badge>}
                        </div>
                      </td>
                      <td className="p-2"><MathDrill value={g.order_line || '—'} title="Stock to order" lines={m.stock} align="start" className="font-sans" /></td>
                      <td className="p-2 text-right"><MathDrill value={`${n(g.totals.drop_pct, 2)}%`} title="% drop" lines={m.drop} /></td>
                      <td className="p-2 text-right"><MathDrill value={n(g.totals.ordered_tons, 3)} title="Ordered weight" lines={m.ordered} /></td>
                      <td className="p-2 text-right"><MathDrill value={n(g.totals.used_lbs, 1)} title="Weight in pieces" lines={m.used} /></td>
                      <td className="p-2 text-right"><MathDrill value={n(g.totals.scrap_tons, 4)} title="Scrap" lines={m.scrap} /></td>
                      <td className="p-2 text-right"><MathDrill value={`${g.totals.qty_combined}/${g.totals.qty_total}`} title="Pieces combined" lines={m.combined} /></td>
                      <td className="p-2 text-right"><MathDrill value={money(g.totals.cost)} title="Cost" lines={m.cost} /></td>
                    </tr>
                    {isOpen && (
                      <tr><td colSpan={9} className="p-0">
                        <GroupDetail
                          group={g}
                          overridden={!!settings.group_overrides?.[g.key]}
                          onUseStock={(ft) => { if (!viewing) setOverride(g.key, { stock_length_ft: ft }); }}
                          onUseSheet={(sheet) => { if (!viewing) setOverride(g.key, { sheet }); }}
                          onClearOverride={() => setOverride(g.key, null)}
                        />
                        {g.flagged.length > 0 && (
                          <div className="px-3 pb-3 bg-muted/20">
                            <p className="text-xs font-semibold text-red-700 mb-1">Needs splice / special order — kept, not dropped</p>
                            <ul className="text-xs space-y-0.5">
                              {g.flagged.map((f, i) => <li key={i}>{f.label}: {g.family === 'linear' ? formatFtIn(f.length_in) : `${formatInches(f.width_in)} × ${formatInches(f.length_in)}`} × {f.quantity} — {f.reason}</li>)}
                            </ul>
                          </div>
                        )}
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {shownExcluded.length > 0 && (
          <div className="rounded-lg border p-3">
            <p className="text-xs font-semibold mb-1">Not combined ({shownExcluded.length})</p>
            <ul className="text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
              {shownExcluded.map((x, i) => <li key={i}><span className="text-foreground">{x.label}</span> — {x.reason}</li>)}
            </ul>
          </div>
        )}

        {/* Saved runs */}
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saved runs</p>
            <p className="text-[10px] text-muted-foreground">Tick two to compare.</p>
          </div>
          {!runFilter && <p className="text-xs text-muted-foreground">Link this takeoff to a bid (or save the session) to save runs.</p>}
          {runFilter && runs.length === 0 && <p className="text-xs text-muted-foreground">No saved runs yet.</p>}
          {runs.length > 0 && (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr><th className="p-1" /><th className="text-left p-1">Run</th><th className="text-left p-1">Saved</th><th className="text-right p-1">Stock</th><th className="text-right p-1">% drop</th><th className="text-right p-1">Scrap tons</th><th className="text-right p-1">Cost</th><th className="p-1" /></tr></thead>
              <tbody>
                {runs.map((r) => {
                  const s = summarizeForCompare(r);
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="p-1"><Checkbox checked={compareIds.includes(r.id)} onCheckedChange={() => toggleCompare(r.id)} /></td>
                      <td className="p-1"><button type="button" className="hover:underline text-left" onClick={() => openSaved(r)}>{r.name}</button>{r.used_for_pricing && <Badge className="ml-1 text-[10px]">Used for pricing</Badge>}<span className="text-muted-foreground"> · {r.source === 'ironsight' ? 'IRONSIGHT' : 'Full Takeoff'}</span></td>
                      <td className="p-1 text-muted-foreground">{r.created_date ? new Date(r.created_date).toLocaleString() : ''}{r.created_by ? ` · ${r.created_by}` : ''}</td>
                      <td className="p-1 text-right font-mono"><button type="button" className="hover:underline" onClick={() => openSaved(r)}>{s.bars} bars · {s.sheets} sheets</button></td>
                      <td className="p-1 text-right font-mono"><button type="button" className="hover:underline" onClick={() => openSaved(r)}>{n(s.drop_pct, 2)}%</button></td>
                      <td className="p-1 text-right font-mono"><button type="button" className="hover:underline" onClick={() => openSaved(r)}>{n(s.scrap_tons, 3)}</button></td>
                      <td className="p-1 text-right font-mono"><button type="button" className="hover:underline" onClick={() => openSaved(r)}>{money(s.cost)}</button></td>
                      <td className="p-1 text-right"><Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={() => markForPricing(r)}><Star className="w-3 h-3 mr-1" />{r.used_for_pricing ? 'Unmark' : 'Use for pricing'}</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {compareRuns.length === 2 && (
            <div className="overflow-x-auto">
              <p className="text-xs font-semibold mt-2 mb-1">Compare</p>
              <table className="w-full text-xs border">
                <thead className="bg-muted/40"><tr><th className="text-left p-1.5" />{compareRuns.map((r) => <th key={r.id} className="text-right p-1.5">{r.name}</th>)}<th className="text-right p-1.5">Difference</th></tr></thead>
                <tbody>
                  {[
                    ['Stock qty', (r) => summarizeForCompare(r).stock_qty, (v) => `${v}`],
                    ['Bars', (r) => summarizeForCompare(r).bars, (v) => `${v}`],
                    ['Sheets', (r) => summarizeForCompare(r).sheets, (v) => `${v}`],
                    ['% drop', (r) => summarizeForCompare(r).drop_pct, (v) => `${n(v, 2)}%`],
                    ['Ordered tons', (r) => summarizeForCompare(r).ordered_tons, (v) => n(v, 3)],
                    ['Scrap tons', (r) => summarizeForCompare(r).scrap_tons, (v) => n(v, 4)],
                    ['Cost', (r) => summarizeForCompare(r).cost, (v) => money(v)],
                  ].map(([label, get, fmt]) => {
                    const [a, b] = compareRuns.map(get);
                    const diff = a == null || b == null ? null : b - a;
                    return (
                      <tr key={label} className="border-t">
                        <td className="p-1.5">{label}</td>
                        {compareRuns.map((r) => <td key={r.id} className="p-1.5 text-right font-mono"><button type="button" className="hover:underline" onClick={() => openSaved(r)}>{fmt(get(r))}</button></td>)}
                        <td className="p-1.5 text-right font-mono">{diff == null ? '—' : `${diff > 0 ? '+' : ''}${fmt(diff)}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
