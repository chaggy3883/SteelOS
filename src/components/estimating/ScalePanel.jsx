import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/ui/use-toast';
import { Ruler, HelpCircle, SquareDashed, CheckCheck, Trash2, Crosshair } from 'lucide-react';
import { FRACTION_OPTIONS, feetInchesFractionToDecimal, formatFeetInchesFraction } from '@/lib/fractionInches';
import {
  SCALE_PRESETS, SCALE_PRESET_GROUPS, findPreset, ptsPerFtFromRatio, scaleLabelFromPtsPerFt,
  normalizeRect, scaleCheckPercent, scaleCheckTier,
} from '@/lib/takeoffScale';

// Banner text for each click of a scale pick, shown on the drawing itself.
export function stepsForScalePick(pick) {
  if (!pick) return null;
  const where = pick.target?.kind === 'viewport' ? ` inside ${pick.target.name || 'the viewport'}` : '';
  if (pick.purpose === 'viewport') {
    return ['Viewport — click one corner of the detail', 'Click the opposite corner', 'Name the viewport and pick its scale in the panel'];
  }
  if (pick.purpose === 'check') {
    return [`Check scale — click one end of a dimension you know${where}`, 'Click the other end', 'Type the dimension shown on the drawing in the panel'];
  }
  return [`Step 1 of 2 — click one end of a known dimension${where}`, 'Step 2 of 2 — click the other end', 'Type the real distance in the panel'];
}

const CHECK_STYLES = {
  good: 'text-green-700 border-green-300 bg-green-50',
  close: 'text-amber-700 border-amber-300 bg-amber-50',
  off: 'text-red-700 border-red-300 bg-red-50',
};

function DistanceInputs({ feet, inches, fraction, setFeet, setInches, setFraction }) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex items-center gap-1">
        <Input type="number" min={0} value={feet} onChange={(e) => setFeet(e.target.value)} placeholder="0" className="w-[60px] h-8" autoFocus />
        <span className="text-xs text-muted-foreground">ft</span>
      </div>
      <div className="flex items-center gap-1">
        <Input type="number" min={0} max={11} value={inches} onChange={(e) => setInches(e.target.value)} placeholder="0" className="w-[60px] h-8" />
        <span className="text-xs text-muted-foreground">in</span>
      </div>
      <div className="flex items-center gap-1">
        <Select value={fraction} onValueChange={setFraction}>
          <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FRACTION_OPTIONS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">&quot;</span>
      </div>
    </div>
  );
}

function PresetSelect({ value, onChange, placeholder = 'Pick a drawing scale…', className = 'h-8 w-48 text-xs' }) {
  return (
    <Select value={value || ''} onValueChange={onChange}>
      <SelectTrigger className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {SCALE_PRESET_GROUPS.map((g) => (
          <SelectGroup key={g}>
            <SelectLabel>{g}</SelectLabel>
            {SCALE_PRESETS.filter((p) => p.group === g).map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

// IRONSIGHT drawing scale controls for the current page: preset scales
// (read off the title block), two-click calibration, Check Scale, and
// rectangular viewports with their own scale for details drawn at a
// different scale than the rest of the sheet. All the scale math lives in
// takeoffScale.js; the saved state in useTakeoffScales.
export default function ScalePanel({
  pageNum,
  numPages,
  scales,
  disabled,
  canvasScale,
  calibrationMode,
  calibrationPoints,
  pick,
  onStartPick,
  onCancelPick,
  onScaleReference,
}) {
  const { toast } = useToast();
  const [applyAllPages, setApplyAllPages] = useState(false);
  const [metricN, setMetricN] = useState('');
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');
  const [fraction, setFraction] = useState('0');
  const [viewportName, setViewportName] = useState('');
  const [viewportPreset, setViewportPreset] = useState('');

  const entry = scales.pageEntry(pageNum);
  const viewports = entry?.viewports || [];
  const pageScale = scales.resolveAt(pageNum, null);
  const pointsReady = calibrationMode && calibrationPoints.length === 2;

  // Fresh inputs for every new pick.
  useEffect(() => {
    setFeet('');
    setInches('');
    setFraction('0');
    setViewportName(`Viewport ${viewports.length + 1}`);
    setViewportPreset('');
  }, [pick?.purpose, pick?.target?.id, calibrationMode]);

  const realFt = feetInchesFractionToDecimal(feet, inches, fraction);
  const [p1, p2] = calibrationPoints;
  const pdfDist = p1 && p2 ? Math.hypot(p2.pdfX - p1.pdfX, p2.pdfY - p1.pdfY) : 0;

  const pagesFor = (all) => (all ? Array.from({ length: Math.max(1, numPages || 1) }, (_, i) => i + 1) : [pageNum]);

  const applyPagePreset = (presetId) => {
    const preset = findPreset(presetId);
    if (!preset) return;
    scales.setPageScale(pagesFor(applyAllPages), { pts_per_ft: preset.ptsPerFt, label: preset.label, source: 'preset', preset_id: preset.id });
    toast({ title: `Scale set to ${preset.label}`, description: `${applyAllPages ? 'Every page' : `Page ${pageNum}`} — use Check Scale on a known dimension to be sure the PDF is full size.` });
  };

  const applyMetric = () => {
    const n = Number(metricN);
    if (!(n > 0)) return;
    const pts = ptsPerFtFromRatio(n);
    scales.setPageScale(pagesFor(applyAllPages), { pts_per_ft: pts, label: `1:${n}`, source: 'preset', preset_id: `metric-${n}` });
    setMetricN('');
  };

  // Writes a two-click calibration onto the page(s) or the target viewport.
  const saveCalibration = (ptsPerFt, readable, target) => {
    const scale = { pts_per_ft: ptsPerFt, label: scaleLabelFromPtsPerFt(ptsPerFt), source: 'calibrated', preset_id: null };
    if (target?.kind === 'viewport') {
      scales.updateViewport(pageNum, target.id, scale);
    } else {
      scales.setPageScale(pagesFor(applyAllPages), scale);
    }
    onScaleReference?.(readable);
    toast({ title: 'Scale set', description: `${target?.kind === 'viewport' ? target.name || 'Viewport' : applyAllPages ? 'Every page' : `Page ${pageNum}`}: ${scale.label}` });
  };

  const handleConfirmCalibration = () => {
    if (!(realFt > 0)) {
      toast({ title: 'Enter the dimension between your two points.', variant: 'destructive' });
      return;
    }
    // On-screen separation at the zoom the points were picked at — guards
    // against two accidental clicks on the same spot.
    if (!(pdfDist * (canvasScale || 1) > 10)) {
      toast({ title: 'Points are too close together', description: 'Click two clearly separated points on the drawing.', variant: 'destructive' });
      onStartPick(pick.purpose, pick.target);
      return;
    }
    const ptsPerFt = pdfDist / realFt;
    if (!(ptsPerFt > 0 && ptsPerFt < 100000)) {
      toast({ title: 'Implausible scale', description: 'That scale looks wrong — check your points and distance and try again.', variant: 'destructive' });
      onStartPick(pick.purpose, pick.target);
      return;
    }
    saveCalibration(ptsPerFt, formatFeetInchesFraction(realFt), pick.target);
    onCancelPick();
  };

  // Check Scale: measure a known dimension under whatever scale applies at
  // the first click and show how far off it reads.
  const checkScale = p1 ? scales.resolveAt(pageNum, p1) : null;
  const measuredFt = checkScale?.ptsPerFt ? pdfDist / checkScale.ptsPerFt : null;
  const checkPct = measuredFt != null && realFt > 0 ? scaleCheckPercent(measuredFt, realFt) : null;

  const fixFromCheck = () => {
    if (!(realFt > 0) || !(pdfDist > 0)) return;
    const target = checkScale?.source === 'viewport' ? { kind: 'viewport', id: checkScale.viewportId, name: checkScale.name } : { kind: 'page' };
    saveCalibration(pdfDist / realFt, formatFeetInchesFraction(realFt), target);
    onCancelPick();
  };

  const saveViewport = (thenCalibrate) => {
    const rect = normalizeRect(p1, p2);
    if (!((rect.x2 - rect.x1) * (canvasScale || 1) > 10 && (rect.y2 - rect.y1) * (canvasScale || 1) > 10)) {
      toast({ title: 'That box is too small', description: 'Click two opposite corners around the detail.', variant: 'destructive' });
      onStartPick('viewport');
      return;
    }
    const preset = findPreset(viewportPreset);
    const viewport = {
      id: crypto.randomUUID(),
      name: viewportName.trim() || `Viewport ${viewports.length + 1}`,
      ...rect,
      pts_per_ft: preset ? preset.ptsPerFt : null,
      label: preset ? preset.label : null,
      source: preset ? 'preset' : null,
      preset_id: preset ? preset.id : null,
    };
    scales.addViewport(pageNum, viewport);
    if (thenCalibrate) onStartPick('calibrate', { kind: 'viewport', id: viewport.id, name: viewport.name });
    else onCancelPick();
  };

  const statusBadge = pageScale
    ? (
      <Badge variant="outline" className="text-green-700 border-green-300">
        Page {pageNum}: {pageScale.label}{pageScale.source === 'legacy' ? ' (whole set, from older session)' : entry?.source === 'calibrated' ? ' (calibrated)' : ''}
      </Badge>
    )
    : viewports.some((v) => v.pts_per_ft > 0)
      ? <Badge variant="outline" className="text-cyan-700 border-cyan-300">Page {pageNum}: measure inside a viewport only</Badge>
      : <Badge variant="outline" className="text-amber-600 border-amber-300">Page {pageNum} isn&apos;t calibrated</Badge>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {statusBadge}
        <PresetSelect value={entry?.source === 'preset' ? entry.preset_id : ''} onChange={applyPagePreset} />
        <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={applyAllPages} onChange={(e) => setApplyAllPages(e.target.checked)} />
          All pages
        </label>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">1 :</span>
          <Input type="number" min={1} value={metricN} onChange={(e) => setMetricN(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyMetric(); }} placeholder="N" className="w-16 h-8 text-xs" />
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={applyMetric} disabled={!(Number(metricN) > 0)}>Set</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {calibrationMode ? (
          <Button size="sm" variant="outline" onClick={onCancelPick}>Cancel</Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => onStartPick('calibrate', { kind: 'page' })} disabled={disabled}>
              <Ruler className="w-3.5 h-3.5 mr-1.5" />{pageScale ? 'Recalibrate' : 'Calibrate (2 clicks)'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onStartPick('check', null)} disabled={disabled || !scales.pageHasScale(pageNum)}>
              <CheckCheck className="w-3.5 h-3.5 mr-1.5" />Check Scale
            </Button>
            <Button size="sm" variant="outline" onClick={() => onStartPick('viewport', null)} disabled={disabled}>
              <SquareDashed className="w-3.5 h-3.5 mr-1.5" />Add Viewport
            </Button>
          </>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7" title="How scale works">
              <HelpCircle className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="text-sm space-y-2">
            <p className="font-semibold">Setting the scale</p>
            <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
              <li>Fastest: pick the scale printed in the title block from the list. Works when the PDF is full size (not a half-size or &quot;fit to page&quot; print).</li>
              <li>Or Calibrate: click both ends of a dimension you know (a grid line spacing), then type that dimension.</li>
              <li>Always run Check Scale on a second known dimension — within 1% is good.</li>
              <li>A detail at a different scale? Add Viewport, box the detail, and give it its own scale. Measurements starting inside the box use it.</li>
            </ol>
            <p className="text-xs text-amber-600 pt-1 border-t border-border">Each page keeps its own scale. Measuring is blocked on a page with no scale.</p>
          </PopoverContent>
        </Popover>
      </div>

      {viewports.length > 0 && (
        <div className="rounded-md border divide-y">
          {viewports.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-xs">
              <SquareDashed className="w-3.5 h-3.5 text-cyan-600" />
              <span className="font-medium">{v.name}</span>
              <span className={v.pts_per_ft > 0 ? 'text-muted-foreground' : 'text-amber-600'}>{v.pts_per_ft > 0 ? v.label : 'scale not set'}</span>
              <div className="ml-auto flex items-center gap-1">
                <PresetSelect
                  value={v.source === 'preset' ? v.preset_id : ''}
                  onChange={(id) => {
                    const preset = findPreset(id);
                    if (preset) scales.updateViewport(pageNum, v.id, { pts_per_ft: preset.ptsPerFt, label: preset.label, source: 'preset', preset_id: preset.id });
                  }}
                  placeholder="Scale…"
                  className="h-7 w-32 text-xs"
                />
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onStartPick('calibrate', { kind: 'viewport', id: v.id, name: v.name })} disabled={disabled || calibrationMode}>
                  <Crosshair className="w-3 h-3 mr-1" />Calibrate
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Remove viewport" onClick={() => scales.removeViewport(pageNum, v.id)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pointsReady && pick?.purpose === 'calibrate' && (
        <Card>
          <CardContent className="p-3 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Real distance between the two points{pick.target?.kind === 'viewport' ? ` (${pick.target.name || 'viewport'})` : ''}
              </label>
              <DistanceInputs feet={feet} inches={inches} fraction={fraction} setFeet={setFeet} setInches={setInches} setFraction={setFraction} />
              {realFt > 0 && <p className="text-xs text-muted-foreground">= {formatFeetInchesFraction(realFt)} → {scaleLabelFromPtsPerFt(pdfDist / realFt)}</p>}
            </div>
            <Button size="sm" onClick={handleConfirmCalibration} disabled={!(realFt > 0)}>Confirm</Button>
            <Button size="sm" variant="outline" onClick={onCancelPick}>Cancel</Button>
          </CardContent>
        </Card>
      )}

      {pointsReady && pick?.purpose === 'check' && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              {measuredFt != null
                ? <>Measures <span className="font-semibold text-foreground">{formatFeetInchesFraction(measuredFt)}</span> at {checkScale.label}. What does the drawing say it is?</>
                : 'No scale applies where you clicked — set this page or viewport scale first.'}
            </p>
            {measuredFt != null && (
              <DistanceInputs feet={feet} inches={inches} fraction={fraction} setFeet={setFeet} setInches={setInches} setFraction={setFraction} />
            )}
            {checkPct != null && (
              <div className={`rounded-md border px-2 py-1.5 text-xs font-medium ${CHECK_STYLES[scaleCheckTier(checkPct)]}`}>
                {Math.abs(checkPct) < 0.05 ? 'Spot on' : `Off by ${checkPct > 0 ? '+' : ''}${checkPct.toFixed(1)}%`}
                {' — '}{scaleCheckTier(checkPct) === 'good' ? 'good to measure.' : scaleCheckTier(checkPct) === 'close' ? 'close; recalibrate if this is a long run.' : 'the scale is wrong for this spot.'}
              </div>
            )}
            <div className="flex gap-2">
              {checkPct != null && scaleCheckTier(checkPct) !== 'good' && (
                <Button size="sm" onClick={fixFromCheck}>Fix scale from this dimension</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onStartPick('check', null)}>Check another</Button>
              <Button size="sm" variant="outline" onClick={onCancelPick}>Done</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {pointsReady && pick?.purpose === 'viewport' && (
        <Card>
          <CardContent className="p-3 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Viewport name</label>
              <Input value={viewportName} onChange={(e) => setViewportName(e.target.value)} className="h-8 w-40 text-xs" autoFocus />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Its scale (from the detail title)</label>
              <PresetSelect value={viewportPreset} onChange={setViewportPreset} placeholder="Pick a scale…" />
            </div>
            <Button size="sm" onClick={() => saveViewport(false)} disabled={!viewportPreset}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => saveViewport(true)}>Save, then calibrate inside it</Button>
            <Button size="sm" variant="ghost" onClick={onCancelPick}>Cancel</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
