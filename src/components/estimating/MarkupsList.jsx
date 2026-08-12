import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/components/ui/use-toast';
import { CheckCircle2, Send, Link2, MousePointerClick, Ruler, Shapes, Loader2, Clipboard, Scale, FileDown, Printer, ListChecks } from 'lucide-react';
import { getShapeClass } from '@/data/steelShapeSelector';
import { SHAPE_CATALOG } from '@/data/steelShapes';
import { exportRequisitionToPdf } from '@/lib/requisitionPdfExport';
import { exportRowsToCsv } from '@/lib/csvExport';

const TOOL_META = {
  count: { label: 'Count', icon: MousePointerClick, unitLabel: 'lbs/ft' },
  length: { label: 'Length', icon: Ruler, unitLabel: 'lbs/ft' },
  area: { label: 'Area', icon: Shapes, unitLabel: 'lbs/sq ft' },
};

const METRIC_LABELS = {
  count: 'Count (pcs)',
  length: 'Length (ft)',
  area: 'Area (sq ft)',
};

const UNASSIGNED_PHASE = 'Unassigned';

// Shape category used for the tonnage summary's breakdown — maps the
// SHAPE_CLASSES taxonomy IRONSIGHT's own tool presets use (steelShapeSelector.js)
// down to the coarser categories estimators think in.
const CATEGORY_LABELS = {
  'W-Beam': 'W-Beam',
  'HSS Tube': 'HSS',
  'C-Channel': 'Channel',
  'L-Angle': 'Angle',
  'PL-Plate': 'Plate',
};
const categoryFor = (shapeType) => CATEGORY_LABELS[shapeType] || shapeType || 'Custom';

// steelShapes.js's SHAPE_CATALOG is keyed by material category (beams,
// columns, hss, ...), not by the shape_class taxonomy IRONSIGHT's own tool
// presets use — so this scans every category's `sizes` list for a matching
// `value` rather than going through a category lookup first.
function lookupCatalogWeightPerFt(sizeDesignation) {
  if (!sizeDesignation) return null;
  const needle = String(sizeDesignation).toUpperCase();
  for (const category of Object.values(SHAPE_CATALOG)) {
    const match = category.sizes.find((s) => s.value.toUpperCase() === needle);
    if (match) return match.weightPerFt;
  }
  return null;
}

function buildGroups(rows) {
  const map = new Map();
  rows
    .filter((r) => r.is_accepted && (r.tool === 'count' || r.tool === 'length' || r.tool === 'area'))
    .forEach((r) => {
      // Phase folds into the group key alongside tool+label — a project
      // built in stages needs its takeoff split per stage, so the same
      // label tagged with two different phases becomes two edit cards
      // instead of one card silently blending both stages' quantities.
      const phase = (r.phase || '').trim();
      const key = `${r.tool}::${r.label || 'Untitled'}::${phase}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          tool: r.tool,
          label: r.label || 'Untitled',
          color: r.color || '#94a3b8',
          shape_type: r.shape_type || 'Custom',
          size_designation: r.size_designation || '',
          phase,
          rows: [],
        });
      }
      map.get(key).rows.push(r);
    });

  return Array.from(map.values()).map((group) => {
    const totalCount = group.rows.reduce((sum, r) => sum + (r.quantity || 1), 0);
    const totalLengthFt = group.rows.reduce((sum, r) => sum + (r.length_ft || 0), 0);
    const totalAreaSqFt = group.rows.reduce((sum, r) => sum + (r.area_sq_ft || 0), 0);
    const totalMetric = group.tool === 'count' ? totalCount : group.tool === 'length' ? totalLengthFt : totalAreaSqFt;
    const isPushed = group.rows.length > 0 && group.rows.every((r) => r.pushed_to_estimate);
    const existingLineId = group.rows.find((r) => r.pushed_material_line_id)?.pushed_material_line_id || null;
    return { ...group, totalCount, totalLengthFt, totalAreaSqFt, totalMetric, isPushed, existingLineId };
  });
}

const defaultSettingFor = (group) => {
  const catalogWeight = lookupCatalogWeightPerFt(group.size_designation);
  return {
    multiplier: 1,
    unitWeight: catalogWeight ?? '',
    weightSource: catalogWeight != null ? 'aisc' : 'manual',
    typicalLengthFt: 0,
  };
};

// Restores Phase 4's persisted markup_weights (keyed the same way as
// buildGroups' group.key) into the in-memory settings shape this component
// works with. Groups with no persisted entry fall back to defaultSettingFor
// at read time via getSetting, so this only needs to seed what was saved.
function mapInitialWeights(weights) {
  const result = {};
  Object.entries(weights || {}).forEach(([key, w]) => {
    result[key] = {
      multiplier: 1,
      unitWeight: w.unit_weight_lbs_per_ft ?? '',
      weightSource: w.weight_source || 'manual',
      typicalLengthFt: w.typical_length_ft || 0,
    };
  });
  return result;
}

const WEIGHT_BADGES = {
  aisc: { label: 'AISC', className: 'text-blue-600 border-blue-300' },
  manual: { label: 'Manual', className: 'text-muted-foreground' },
  override: { label: 'Override', className: 'text-amber-600 border-amber-300' },
};

// Part 1/2 — groups accepted Count/Length/Area rows by (tool, label) into a
// review-and-push summary, auto-resolves unit weight from the AISC catalog,
// computes a weight/tonnage rollup, and pushes each group to a single
// consolidated MaterialTakeoffLine record (re-pushing updates that same
// record via pushed_material_line_id rather than creating a duplicate every
// sync). Weight settings persist onto the blueprint_takeoffs session so they
// survive a resume, mirroring tool_chest's own 800ms debounce.
export default function MarkupsList({ rows, onRowsChange, takeoffId, takeoffName, fileName, companyId, bidId, projectId, onLink, initialWeights }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [settings, setSettings] = useState(() => mapInitialWeights(initialWeights));
  const [bids, setBids] = useState([]);
  const [projects, setProjects] = useState([]);
  const [linkedBid, setLinkedBid] = useState(null);
  const [linkPromptOpen, setLinkPromptOpen] = useState(false);
  const [linkDraftValue, setLinkDraftValue] = useState('');
  const [pendingPushTarget, setPendingPushTarget] = useState(null);
  const [linking, setLinking] = useState(false);
  const [pushingKey, setPushingKey] = useState(null);
  const weightsSaveTimerRef = useRef(null);

  useEffect(() => {
    if (!companyId) return;
    Promise.all([
      db.entities.Bid.filter({ company_id: companyId }, '-created_date', 500),
      db.entities.Project.filter({ company_id: companyId }, '-created_date', 500),
    ]).then(([bidList, projectList]) => {
      setBids(bidList.filter((b) => !b.is_archived));
      setProjects(projectList.filter((p) => !p.is_archived));
    }).catch(() => { setBids([]); setProjects([]); });
  }, [companyId]);

  useEffect(() => {
    if (!bidId) { setLinkedBid(null); return; }
    db.entities.Bid.get(bidId).then(setLinkedBid).catch(() => setLinkedBid(null));
  }, [bidId]);

  // Part 4 — debounced persistence of weight settings onto the session, same
  // 800ms-after-last-edit pattern BlueprintTakeoff.jsx already uses for
  // tool_chest. Writes the whole settings map each time (small — one entry
  // per markup group), keyed identically to buildGroups' group.key.
  useEffect(() => {
    if (!takeoffId) return;
    if (weightsSaveTimerRef.current) clearTimeout(weightsSaveTimerRef.current);
    weightsSaveTimerRef.current = setTimeout(() => {
      const markup_weights = {};
      Object.entries(settings).forEach(([key, s]) => {
        markup_weights[key] = {
          unit_weight_lbs_per_ft: Number(s.unitWeight) || 0,
          typical_length_ft: Number(s.typicalLengthFt) || 0,
          weight_source: s.weightSource || 'manual',
        };
      });
      db.entities.blueprint_takeoffs.update(takeoffId, { markup_weights }).catch((e) => {
        console.error('Failed to persist markup weights', e);
      });
    }, 800);
    return () => clearTimeout(weightsSaveTimerRef.current);
  }, [settings, takeoffId]);

  const groups = useMemo(() => buildGroups(rows), [rows]);

  const getSetting = (group) => settings[group.key] || defaultSettingFor(group);

  const updateSetting = (group, field, value) => {
    setSettings((prev) => ({ ...prev, [group.key]: { ...getSetting(group), [field]: value } }));
  };

  // Phase lives on the rows themselves (like label/shape_type), not in the
  // ephemeral weight-settings map — it's a takeoff-stage tag, not a pricing
  // input, so it persists straight through onRowsChange the same way
  // applyPushedFlag mutates every row in a group by its _key.
  const updateGroupPhase = (group, phase) => {
    const keys = new Set(group.rows.map((r) => r._key));
    const newRows = rows.map((r) => (keys.has(r._key) ? { ...r, phase } : r));
    onRowsChange(newRows);
  };

  // Unit weight edits flip the badge to "Override" when they replace an
  // AISC-sourced value — a value the estimator typed with no catalog match
  // to begin with is still just "Manual", not an override of anything.
  const updateUnitWeight = (group, value) => {
    const current = getSetting(group);
    const nextSource = current.weightSource === 'aisc' || current.weightSource === 'override' ? 'override' : 'manual';
    setSettings((prev) => ({ ...prev, [group.key]: { ...current, unitWeight: value, weightSource: nextSource } }));
  };

  // Part 2 — weight calculation engine. Count needs an assumed per-piece
  // length (the tool itself never measures one); Length/Area already have a
  // real physical total, so their est_lbs comes straight from that total ×
  // unit weight. finalQuantity (count/length/area total × qty multiplier)
  // still drives the pushed quantity/length_ft — see buildPayload — the
  // multiplier is a piece-count concept that Phase 4's weight formulas don't
  // apply to Length/Area totals.
  const calcGroup = (group) => {
    const { multiplier, unitWeight, typicalLengthFt } = getSetting(group);
    const finalQuantity = group.totalMetric * (Number(multiplier) || 0);
    const weight = Number(unitWeight) || 0;

    let estLbs = 0;
    let weightUnknown = false;
    if (group.tool === 'count') {
      const typicalLength = Number(typicalLengthFt) || 0;
      if (typicalLength > 0) {
        estLbs = finalQuantity * weight * typicalLength;
      } else {
        weightUnknown = true;
      }
    } else if (group.tool === 'length') {
      estLbs = group.totalLengthFt * weight;
    } else {
      estLbs = group.totalAreaSqFt * weight;
    }

    return { finalQuantity, weight, estLbs, estTons: estLbs / 2000, weightUnknown };
  };

  const buildPayload = (group, linkOverride) => {
    const effectiveBidId = linkOverride ? linkOverride.bidId : bidId;
    const effectiveProjectId = linkOverride ? linkOverride.projectId : projectId;
    const { multiplier } = getSetting(group);
    const { finalQuantity, weight, estTons } = calcGroup(group);
    const shapeClass = group.shape_type || 'Custom';
    const materialType = getShapeClass(shapeClass).label || shapeClass;
    const noteBase = `From IRONSIGHT takeoff: ${takeoffName || fileName || 'Untitled takeoff'}`;

    const base = {
      bid_id: effectiveBidId || undefined,
      project_id: effectiveBidId ? undefined : (effectiveProjectId || undefined),
      material_type: materialType,
      shape_class: shapeClass,
      material_size: group.size_designation || '',
      coating_type: 'No Coating',
      source: 'ironsight',
      pushed_from_takeoff_id: takeoffId,
      weight_per_ft: weight,
    };

    if (group.tool === 'length') {
      return {
        ...base,
        quantity: 1,
        length_ft: finalQuantity,
        tons_per_piece: estTons,
        total_tons: estTons,
        notes: `${noteBase} — Length group "${group.label}": ${group.totalLengthFt.toFixed(2)} ft × ${multiplier} multiplier`,
      };
    }
    if (group.tool === 'area') {
      return {
        ...base,
        quantity: 1,
        length_ft: 0,
        tons_per_piece: estTons,
        total_tons: estTons,
        notes: `${noteBase} — Area group "${group.label}": ${group.totalAreaSqFt.toFixed(2)} sq ft × ${multiplier} multiplier`,
      };
    }
    return {
      ...base,
      quantity: finalQuantity,
      length_ft: 0,
      tons_per_piece: finalQuantity ? estTons / finalQuantity : 0,
      total_tons: estTons,
      notes: `${noteBase} — Count group "${group.label}": ${group.totalCount} pieces × ${multiplier} multiplier`,
    };
  };

  const applyPushedFlag = (group, lineId) => {
    const pushedKeys = new Set(group.rows.map((r) => r._key));
    const newRows = rows.map((r) => (pushedKeys.has(r._key) ? { ...r, pushed_to_estimate: true, pushed_material_line_id: lineId } : r));
    onRowsChange(newRows);
  };

  const pushGroup = async (group, linkOverride) => {
    setPushingKey(group.key);
    try {
      const payload = buildPayload(group, linkOverride);
      let lineId = group.existingLineId;
      if (lineId) {
        await db.entities.MaterialTakeoffLine.update(lineId, payload);
      } else {
        const created = await db.entities.MaterialTakeoffLine.create(payload);
        lineId = created.id;
      }
      applyPushedFlag(group, lineId);
      return true;
    } catch (e) {
      console.error('Failed to push markup group to estimate', group.key, e);
      return false;
    } finally {
      setPushingKey(null);
    }
  };

  const notifyPushed = (count, linkOverride) => {
    const effectiveBidId = linkOverride ? linkOverride.bidId : bidId;
    const effectiveProjectId = linkOverride ? linkOverride.projectId : projectId;
    const linkPath = effectiveBidId ? `/estimating/${effectiveBidId}` : effectiveProjectId ? `/projects/${effectiveProjectId}` : null;
    const linkLabel = effectiveBidId ? 'Bid Detail' : 'Project Detail';
    toast({
      title: `${count} item${count === 1 ? '' : 's'} pushed to estimate`,
      description: linkPath ? `View in ${linkLabel}` : undefined,
      action: linkPath ? (
        <ToastAction altText={`View in ${linkLabel}`} onClick={() => navigate(linkPath, { state: { tab: 'fulltakeoff' } })}>
          View
        </ToastAction>
      ) : undefined,
    });
  };

  const handlePushClick = async (group) => {
    if (!bidId && !projectId) {
      setPendingPushTarget(group.key);
      setLinkPromptOpen(true);
      return;
    }
    const ok = await pushGroup(group);
    if (ok) notifyPushed(1);
    else toast({ title: 'Push failed', description: 'Could not push this markup group — see console for details.', variant: 'destructive' });
  };

  const handlePushAll = async () => {
    if (groups.length === 0) return;
    if (!bidId && !projectId) {
      setPendingPushTarget('ALL');
      setLinkPromptOpen(true);
      return;
    }
    setPushingKey('ALL');
    let succeeded = 0;
    for (const group of groups) {
      const ok = await pushGroup(group);
      if (ok) succeeded += 1;
    }
    setPushingKey(null);
    if (succeeded > 0) notifyPushed(succeeded);
    if (succeeded < groups.length) {
      toast({ title: `${groups.length - succeeded} group(s) failed to push`, description: 'See console for details.', variant: 'destructive' });
    }
  };

  const handleConfirmLink = async () => {
    if (!linkDraftValue) return;
    const [kind, id] = linkDraftValue.split(':');
    const newBidId = kind === 'bid' ? id : null;
    const newProjectId = kind === 'project' ? id : null;
    setLinking(true);
    try {
      await onLink(newBidId, newProjectId);
      setLinkPromptOpen(false);

      // Push using the just-confirmed link directly, rather than waiting on
      // the bidId/projectId props to flow back down through the parent.
      const linkOverride = { bidId: newBidId, projectId: newProjectId };
      if (pendingPushTarget === 'ALL') {
        let succeeded = 0;
        for (const group of groups) {
          if (await pushGroup(group, linkOverride)) succeeded += 1;
        }
        if (succeeded > 0) notifyPushed(succeeded, linkOverride);
      } else if (pendingPushTarget) {
        const group = groups.find((g) => g.key === pendingPushTarget);
        if (group && (await pushGroup(group, linkOverride))) notifyPushed(1, linkOverride);
      }
      setPendingPushTarget(null);
      setLinkDraftValue('');
    } catch (e) {
      console.error('Failed to link takeoff', e);
      toast({ title: 'Failed to link takeoff', variant: 'destructive' });
    } finally {
      setLinking(false);
    }
  };

  // Part 3 — tonnage summary. Recomputed straight from groups/settings on
  // every render rather than memoized — a handful of markup groups is cheap,
  // and it avoids a stale-dependency footgun tying it to calcGroup's closure.
  const categoryTotals = {};
  groups.forEach((group) => {
    const cat = categoryFor(group.shape_type);
    const { estTons } = calcGroup(group);
    categoryTotals[cat] = (categoryTotals[cat] || 0) + estTons;
  });
  const totalTons = Object.values(categoryTotals).reduce((sum, t) => sum + t, 0);

  // Spreadsheet view — merges groups sharing (tool, shape, size, phase) so
  // the same shape/size split across multiple labels within one stage
  // collapses into a single summed quantity row, per stage. Weight/tons
  // still come straight from each source group's own calcGroup() (which
  // already applied that group's own multiplier/typical-length/unit-weight
  // settings) — only the outputs are summed, not re-derived.
  const spreadsheetRows = groups.reduce((acc, group) => {
    const phase = group.phase || UNASSIGNED_PHASE;
    const key = `${group.tool}::${group.shape_type}::${group.size_designation}::${phase}`;
    const { finalQuantity, estLbs, estTons } = calcGroup(group);
    const existing = acc.find((r) => r.key === key);
    if (existing) {
      existing.qty += finalQuantity;
      existing.estLbs += estLbs;
      existing.estTons += estTons;
    } else {
      acc.push({ key, phase, tool: group.tool, shape_type: group.shape_type, size_designation: group.size_designation, qty: finalQuantity, estLbs, estTons });
    }
    return acc;
  }, []);

  const phaseKeys = Array.from(new Set(spreadsheetRows.map((r) => r.phase))).sort((a, b) => {
    if (a === UNASSIGNED_PHASE) return 1;
    if (b === UNASSIGNED_PHASE) return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
  const phaseTonsOf = (phase) => spreadsheetRows.filter((r) => r.phase === phase).reduce((s, r) => s + r.estTons, 0);
  const phasePctOfProject = (phase) => (totalTons > 0 ? (phaseTonsOf(phase) / totalTons) * 100 : 0);

  const linkedJobLabel = linkedBid
    ? (linkedBid.job_name || (linkedBid.bid_number ? `Bid ${linkedBid.bid_number}` : 'Linked bid'))
    : projectId
      ? (projects.find((p) => p.id === projectId)?.name || 'Linked project')
      : null;
  const linkedJobPath = bidId ? `/estimating/${bidId}` : projectId ? `/projects/${projectId}` : null;

  const spreadsheetExportRows = () => spreadsheetRows.map((r) => [
    r.phase,
    `${phasePctOfProject(r.phase).toFixed(1)}%`,
    categoryFor(r.shape_type),
    r.size_designation || '—',
    r.qty.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    METRIC_LABELS[r.tool] || r.tool,
    r.estLbs.toFixed(0),
    r.estTons.toFixed(2),
  ]);

  const handleExportSpreadsheetCsv = () => {
    exportRowsToCsv({
      filename: `${takeoffName || fileName || 'takeoff'}_spreadsheet`,
      columns: ['Phase', '% of Project', 'Shape', 'Size', 'Qty', 'Metric', 'Est. Weight (lbs)', 'Est. Tons'],
      rows: spreadsheetExportRows(),
    });
  };

  const handlePrintSpreadsheet = () => {
    exportRequisitionToPdf({
      title: 'IRONSIGHT Takeoff Spreadsheet',
      subtitle: `${takeoffName || fileName || 'Untitled takeoff'}${linkedJobLabel ? ` — ${linkedJobLabel}` : ''}`,
      columns: ['Phase', '% of Project', 'Shape', 'Size', 'Qty', 'Metric', 'Est. Weight (lbs)', 'Est. Tons'],
      rows: spreadsheetExportRows(),
    });
  };

  const bidTons = linkedBid?.total_weight_tons;
  const variance = (bidTons != null && bidTons > 0)
    ? (() => {
      const deltaPct = ((totalTons - bidTons) / bidTons) * 100;
      const absPct = Math.abs(deltaPct);
      const tier = absPct <= 10 ? 'green' : absPct <= 20 ? 'yellow' : 'red';
      return { deltaPct, tier };
    })()
    : null;

  const VARIANCE_STYLES = {
    green: 'text-green-700 border-green-300 bg-green-50',
    yellow: 'text-amber-700 border-amber-300 bg-amber-50',
    red: 'text-red-700 border-red-300 bg-red-50',
  };

  const handleCopySummary = async () => {
    const dateStr = new Date().toLocaleDateString();
    const parts = Object.entries(categoryTotals).map(([cat, tons]) => `${cat}: ${tons.toFixed(1)} tons`);
    const text = `IRONSIGHT Takeoff Summary — ${takeoffName || fileName || 'Untitled takeoff'} — ${dateStr}: ${parts.join(', ')}, TOTAL: ${totalTons.toFixed(1)} tons`;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Summary copied to clipboard' });
    } catch (e) {
      console.error('Failed to copy takeoff summary', e);
      toast({ title: 'Could not copy to clipboard', description: 'See console for details.', variant: 'destructive' });
    }
  };

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No Count, Length, or Area markups yet — place a measurement with the tools above to see it here.</p>;
  }

  const groupsByTool = { count: groups.filter((g) => g.tool === 'count'), length: groups.filter((g) => g.tool === 'length'), area: groups.filter((g) => g.tool === 'area') };

  return (
    <div className="space-y-4">
      {linkPromptOpen && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5" />Link this takeoff to a bid or project before pushing to the estimate.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={linkDraftValue} onValueChange={setLinkDraftValue}>
              <SelectTrigger className="h-8 text-xs w-64"><SelectValue placeholder="Select a bid or project…" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Bids</SelectLabel>
                  {bids.map((b) => <SelectItem key={`bid:${b.id}`} value={`bid:${b.id}`}>{b.job_name} ({b.bid_number})</SelectItem>)}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Projects</SelectLabel>
                  {projects.map((p) => <SelectItem key={`project:${p.id}`} value={`project:${p.id}`}>{p.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleConfirmLink} disabled={!linkDraftValue || linking}>
              {linking ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}Link &amp; Push
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setLinkPromptOpen(false); setPendingPushTarget(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button size="sm" onClick={handlePushAll} disabled={pushingKey != null}>
          {pushingKey === 'ALL' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}Push All
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h4 className="font-semibold text-sm flex items-center gap-2"><ListChecks className="w-4 h-4 text-primary" />Takeoff Spreadsheet</h4>
              {linkedJobLabel ? (
                <button onClick={() => navigate(linkedJobPath)} className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5">
                  <Link2 className="w-3 h-3" />Linked to {linkedJobLabel}
                </button>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5">Not linked to a bid or project yet.</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleExportSpreadsheetCsv}><FileDown className="w-3.5 h-3.5 mr-1.5" />Export CSV</Button>
              <Button size="sm" variant="outline" onClick={handlePrintSpreadsheet}><Printer className="w-3.5 h-3.5 mr-1.5" />Print</Button>
            </div>
          </div>

          <div className="space-y-3">
            {phaseKeys.map((phase) => {
              const rowsForPhase = spreadsheetRows.filter((r) => r.phase === phase);
              return (
                <div key={phase} className="border rounded-lg overflow-hidden">
                  <div className="bg-muted/40 px-3 py-2 text-sm font-semibold flex items-center justify-between">
                    <span>{phase}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {phaseTonsOf(phase).toFixed(1)} tons · {phasePctOfProject(phase).toFixed(0)}% of project
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/20 text-muted-foreground uppercase tracking-wide">
                        <tr>
                          <th className="text-left p-2">Shape</th>
                          <th className="text-left p-2">Size</th>
                          <th className="text-right p-2">Qty</th>
                          <th className="text-left p-2">Metric</th>
                          <th className="text-right p-2">Est. Weight (lbs)</th>
                          <th className="text-right p-2">Est. Tons</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowsForPhase.map((r) => (
                          <tr key={r.key} className="border-t">
                            <td className="p-2">{categoryFor(r.shape_type)}</td>
                            <td className="p-2">{r.size_designation || '—'}</td>
                            <td className="p-2 text-right font-mono">{r.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                            <td className="p-2 text-muted-foreground">{METRIC_LABELS[r.tool] || r.tool}</td>
                            <td className="p-2 text-right font-mono">{r.estLbs.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                            <td className="p-2 text-right font-mono">{r.estTons.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {['count', 'length', 'area'].map((tool) => {
        if (groupsByTool[tool].length === 0) return null;
        const Icon = TOOL_META[tool].icon;
        return (
          <div key={tool} className="border rounded-lg overflow-hidden">
            <div className="bg-muted/40 px-3 py-2 text-sm font-semibold flex items-center gap-2">
              <Icon className="w-4 h-4" />{TOOL_META[tool].label}
            </div>
            <div className="divide-y">
              {groupsByTool[tool].map((group) => {
                const setting = getSetting(group);
                const { finalQuantity, estLbs, estTons, weightUnknown } = calcGroup(group);
                const badge = WEIGHT_BADGES[setting.weightSource] || WEIGHT_BADGES.manual;
                return (
                  <div key={group.key} className="p-3 flex flex-wrap items-end gap-3">
                    <div className="min-w-40">
                      <span className="w-2.5 h-2.5 rounded-full inline-block mr-1.5" style={{ backgroundColor: group.color }} />
                      <span className="font-medium text-sm">{group.label}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {group.shape_type}{group.size_designation ? ` — ${group.size_designation}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tool === 'count' && `${group.totalCount} count`}
                        {tool === 'length' && `${group.totalLengthFt.toFixed(2)} ft total`}
                        {tool === 'area' && `${group.totalAreaSqFt.toFixed(2)} sq ft total`}
                      </p>
                    </div>

                    <div className="w-32">
                      <label className="text-[10px] text-muted-foreground">Phase / Stage</label>
                      <Input
                        value={group.phase}
                        onChange={(e) => updateGroupPhase(group, e.target.value)}
                        placeholder="e.g. Phase 1"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="w-24">
                      <label className="text-[10px] text-muted-foreground">Qty multiplier</label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={setting.multiplier}
                        onChange={(e) => updateSetting(group, 'multiplier', e.target.value === '' ? '' : Number(e.target.value))}
                        className="h-8 text-xs"
                      />
                    </div>

                    {tool === 'count' && (
                      <div className="w-28">
                        <label className="text-[10px] text-muted-foreground">Typical length (ft)</label>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={setting.typicalLengthFt}
                          onChange={(e) => updateSetting(group, 'typicalLengthFt', e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="e.g. 20"
                          className="h-8 text-xs"
                        />
                      </div>
                    )}

                    <div className="w-36">
                      <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        Unit weight ({TOOL_META[tool].unitLabel})
                        <Badge variant="outline" className={`text-[9px] px-1 py-0 leading-4 ${badge.className}`}>{badge.label}</Badge>
                      </label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={setting.unitWeight}
                        onChange={(e) => updateUnitWeight(group, e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="manual entry"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="w-32">
                      <label className="text-[10px] text-muted-foreground">Est. weight</label>
                      {weightUnknown ? (
                        <p className="h-8 flex items-center text-xs text-muted-foreground italic">weight unknown</p>
                      ) : (
                        <div className="h-8 flex flex-col justify-center leading-tight">
                          <span className="text-sm font-semibold">{estLbs.toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs</span>
                          <span className="text-[10px] text-muted-foreground">{estTons.toFixed(2)} tons</span>
                        </div>
                      )}
                    </div>

                    <div className="ml-auto flex items-center gap-2">
                      {group.isPushed && <Badge variant="outline" className="text-green-700 border-green-300"><CheckCircle2 className="w-3 h-3 mr-1" />Pushed</Badge>}
                      <Button
                        size="sm"
                        variant={group.isPushed ? 'outline' : 'default'}
                        onClick={() => handlePushClick(group)}
                        disabled={pushingKey != null || finalQuantity <= 0}
                      >
                        {pushingKey === group.key ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                        {group.isPushed ? 'Re-push' : 'Push to Estimate'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="font-semibold text-sm flex items-center gap-2"><Scale className="w-4 h-4 text-primary" />Tonnage Summary</h4>
            <Button size="sm" variant="outline" onClick={handleCopySummary}>
              <Clipboard className="w-3.5 h-3.5 mr-1.5" />Copy Summary
            </Button>
          </div>

          <div className="flex flex-wrap gap-4">
            {Object.entries(categoryTotals).map(([cat, tons]) => (
              <div key={cat} className="min-w-24">
                <p className="text-xs text-muted-foreground">{cat}</p>
                <p className="text-lg font-bold">{tons.toFixed(1)} <span className="text-xs font-normal text-muted-foreground">tons</span></p>
              </div>
            ))}
            <div className="min-w-24 border-l pl-4">
              <p className="text-xs text-muted-foreground">TOTAL</p>
              <p className="text-lg font-bold text-primary">{totalTons.toFixed(1)} <span className="text-xs font-normal text-muted-foreground">tons</span></p>
            </div>
          </div>

          {variance && (
            <div className={`rounded-md border px-3 py-2 text-xs font-medium ${VARIANCE_STYLES[variance.tier]}`}>
              Variance vs. bid estimate ({bidTons.toFixed(1)} tons): {variance.deltaPct > 0 ? '+' : ''}{variance.deltaPct.toFixed(1)}%
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
