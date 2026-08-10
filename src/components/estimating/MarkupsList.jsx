import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/components/ui/use-toast';
import { CheckCircle2, Send, Link2, MousePointerClick, Ruler, Shapes, Loader2 } from 'lucide-react';
import { getShapeClass } from '@/data/steelShapeSelector';
import { SHAPE_CATALOG } from '@/data/steelShapes';

const TOOL_META = {
  count: { label: 'Count', icon: MousePointerClick, unitLabel: 'lbs/ft' },
  length: { label: 'Length', icon: Ruler, unitLabel: 'lbs/ft' },
  area: { label: 'Area', icon: Shapes, unitLabel: 'lbs/sq ft' },
};

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
      const key = `${r.tool}::${r.label || 'Untitled'}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          tool: r.tool,
          label: r.label || 'Untitled',
          color: r.color || '#94a3b8',
          shape_type: r.shape_type || 'Custom',
          size_designation: r.size_designation || '',
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

// Part 1/2 — groups accepted Count/Length/Area rows by (tool, label) into a
// review-and-push summary, and pushes each group to a single consolidated
// MaterialTakeoffLine record (re-pushing updates that same record via
// pushed_material_line_id rather than creating a duplicate every sync).
export default function MarkupsList({ rows, onRowsChange, takeoffId, takeoffName, fileName, companyId, bidId, projectId, onLink }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [settings, setSettings] = useState({});
  const [bids, setBids] = useState([]);
  const [projects, setProjects] = useState([]);
  const [linkPromptOpen, setLinkPromptOpen] = useState(false);
  const [linkDraftValue, setLinkDraftValue] = useState('');
  const [pendingPushTarget, setPendingPushTarget] = useState(null);
  const [linking, setLinking] = useState(false);
  const [pushingKey, setPushingKey] = useState(null);

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

  const groups = useMemo(() => buildGroups(rows), [rows]);

  const getSetting = (group) => settings[group.key] || {
    multiplier: 1,
    unitWeight: group.tool === 'area' ? '' : (lookupCatalogWeightPerFt(group.size_designation) ?? ''),
  };

  const updateSetting = (key, group, field, value) => {
    setSettings((prev) => ({ ...prev, [key]: { ...getSetting(group), [field]: value } }));
  };

  const calcGroup = (group) => {
    const { multiplier, unitWeight } = getSetting(group);
    const finalQuantity = group.totalMetric * (Number(multiplier) || 0);
    const weight = Number(unitWeight) || 0;
    const estTons = (finalQuantity * weight) / 2000;
    return { finalQuantity, weight, estTons };
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
    };

    if (group.tool === 'length') {
      return {
        ...base,
        quantity: 1,
        length_ft: finalQuantity,
        weight_per_ft: weight,
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
        weight_per_ft: weight,
        tons_per_piece: estTons,
        total_tons: estTons,
        notes: `${noteBase} — Area group "${group.label}": ${group.totalAreaSqFt.toFixed(2)} sq ft × ${multiplier} multiplier`,
      };
    }
    return {
      ...base,
      quantity: finalQuantity,
      length_ft: 0,
      weight_per_ft: weight,
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
                const { finalQuantity, estTons } = calcGroup(group);
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

                    <div className="w-24">
                      <label className="text-[10px] text-muted-foreground">Qty multiplier</label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={setting.multiplier}
                        onChange={(e) => updateSetting(group.key, group, 'multiplier', e.target.value === '' ? '' : Number(e.target.value))}
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="w-32">
                      <label className="text-[10px] text-muted-foreground">Unit weight ({TOOL_META[tool].unitLabel})</label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={setting.unitWeight}
                        onChange={(e) => updateSetting(group.key, group, 'unitWeight', e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="manual entry"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="w-28">
                      <label className="text-[10px] text-muted-foreground">Est. weight (tons)</label>
                      <p className="h-8 flex items-center text-sm font-semibold">{estTons.toFixed(3)}</p>
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
    </div>
  );
}
