import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Crosshair } from 'lucide-react';
import { FRACTION_OPTIONS, feetInchesFractionToDecimal, formatFeetInchesFraction } from '@/lib/fractionInches';
import {
  SCALE_PRESETS, SCALE_PRESET_GROUPS, findPreset, ptsPerFtFromRatio, ptsPerFtFromPaper, scaleLabelFromPtsPerFt, pointInRect,
} from '@/lib/takeoffScale';
import { parsePageList } from '@/lib/drawingMarkups';

const sel = 'h-8 rounded-md border border-input bg-background px-2 text-xs';
const METRIC_TO_FT = { m: 3.280839895, cm: 0.03280839895, mm: 0.003280839895 };

// Real distance between the two calibration points, in feet.
export function knownLengthFt({ unitSystem, feet, inches, fraction, metricValue, metricUnit }) {
  if (unitSystem === 'metric') return (Number(metricValue) || 0) * (METRIC_TO_FT[metricUnit] || 0);
  return feetInchesFractionToDecimal(feet, inches, fraction);
}

function ApplyTo({ value, onChange, pageText, onPageText, pageNum, numPages, viewports }) {
  const radio = (v, label, extra = null) => (
    <label className="flex items-center gap-2 text-xs cursor-pointer">
      <input type="radio" name="scale-apply" checked={value === v} onChange={() => onChange(v)} />
      {label}{extra}
    </label>
  );
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Applies to</p>
      {radio('page', `This page (${pageNum})`)}
      {radio('all', `All ${numPages} pages`)}
      {radio('list', 'These pages:', (
        <Input className="h-7 w-32 text-xs ml-1" value={pageText} onChange={(e) => { onPageText(e.target.value); onChange('list'); }} placeholder="1-3, 5" />
      ))}
      {viewports.map((v) => radio(`vp:${v.id}`, `Viewport "${v.name}" on this page`))}
    </div>
  );
}

// Scale dialog. Three ways in:
//   mode 'calibrate' — after two clicks on a known dimension: type the
//                      length (ft-in-fraction or metric), pick the pages.
//   mode 'scale'     — pick a preset (architectural / engineering / metric)
//                      or type a custom ratio.
//   mode 'required'  — a measuring tool was picked on a page with no scale:
//                      calibrate or pick a scale before going on.
// The result goes through onApply({ pages | viewportId, scale, readable }).
export default function ScaleDialog({
  open, mode, onOpenChange, pageNum, numPages, points = [], viewports = [], canvasScale = 1, defaultUnits = 'ft-in',
  currentLabel, onApply, onStartCalibrate,
}) {
  const [tab, setTab] = useState('calibrate');
  const [unitSystem, setUnitSystem] = useState('imperial');
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');
  const [fraction, setFraction] = useState('0');
  const [metricValue, setMetricValue] = useState('');
  const [metricUnit, setMetricUnit] = useState('m');
  const [applyTo, setApplyTo] = useState('page');
  const [pageText, setPageText] = useState('');
  const [presetId, setPresetId] = useState('');
  const [customKind, setCustomKind] = useState('preset');
  const [paperIn, setPaperIn] = useState('1');
  const [realFt, setRealFt] = useState('');
  const [ratioN, setRatioN] = useState('');

  const [p1, p2] = points;
  const pdfDist = p1 && p2 ? Math.hypot(p2.pdfX - p1.pdfX, p2.pdfY - p1.pdfY) : 0;
  // A viewport holding both clicks is the natural target.
  const containing = useMemo(() => (p1 && p2 ? viewports.find((v) => pointInRect(p1, v) && pointInRect(p2, v)) : null), [p1, p2, viewports]);

  useEffect(() => {
    if (!open) return;
    setTab(mode === 'calibrate' ? 'calibrate' : 'scale');
    setUnitSystem(defaultUnits === 'metric' ? 'metric' : 'imperial');
    setFeet(''); setInches(''); setFraction('0'); setMetricValue('');
    setApplyTo(containing ? `vp:${containing.id}` : 'page');
    setPageText(String(pageNum));
    setPresetId(''); setCustomKind('preset'); setPaperIn('1'); setRealFt(''); setRatioN('');
    // Fresh inputs each time the dialog opens.
  }, [open]);

  const knownFt = knownLengthFt({ unitSystem, feet, inches, fraction, metricValue, metricUnit });
  const calibratedPts = knownFt > 0 && pdfDist > 0 ? pdfDist / knownFt : 0;

  const pickedScale = (() => {
    if (customKind === 'preset') {
      const p = findPreset(presetId);
      return p ? { pts_per_ft: p.ptsPerFt, label: p.label, source: 'preset', preset_id: p.id } : null;
    }
    if (customKind === 'ratio') {
      const n = Number(ratioN);
      return n > 0 ? { pts_per_ft: ptsPerFtFromRatio(n), label: `1:${n}`, source: 'preset', preset_id: `metric-${n}` } : null;
    }
    const pin = Number(paperIn); const rf = Number(realFt);
    if (!(pin > 0 && rf > 0)) return null;
    const pts = ptsPerFtFromPaper(pin, rf);
    return { pts_per_ft: pts, label: `${pin}" = ${formatFeetInchesFraction(rf)}`, source: 'preset', preset_id: null };
  })();

  const target = () => {
    if (applyTo.startsWith('vp:')) return { viewportId: applyTo.slice(3) };
    if (applyTo === 'all') return { pages: Array.from({ length: numPages }, (_, i) => i + 1) };
    if (applyTo === 'list') return { pages: parsePageList(pageText, numPages) };
    return { pages: [pageNum] };
  };
  const t = target();
  const targetOk = t.viewportId || (t.pages && t.pages.length);
  const tooClose = tab === 'calibrate' && pdfDist > 0 && pdfDist * (canvasScale || 1) <= 10;

  const applyCalibration = () => {
    if (!(calibratedPts > 0) || tooClose || !targetOk) return;
    onApply({ ...t, scale: { pts_per_ft: calibratedPts, label: scaleLabelFromPtsPerFt(calibratedPts), source: 'calibrated', preset_id: null }, readable: formatFeetInchesFraction(knownFt) });
  };
  const applyPicked = () => {
    if (!pickedScale || !targetOk) return;
    onApply({ ...t, scale: pickedScale, readable: pickedScale.label });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tab === 'calibrate' ? 'Calibrate' : 'Drawing scale'}</DialogTitle>
          <DialogDescription>
            {mode === 'required'
              ? 'This page has no scale yet. Calibrate from a dimension you know, or pick the scale printed on the sheet.'
              : `Page ${pageNum} is ${currentLabel || 'not calibrated'}.`}
          </DialogDescription>
        </DialogHeader>

        {mode === 'required' && (
          <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 text-xs px-3 py-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />Measuring needs a scale — nothing was measured yet.
          </div>
        )}

        <div className="flex gap-1 border-b">
          {[['calibrate', 'Calibrate from two points'], ['scale', 'Pick a scale']].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`px-3 py-1.5 text-xs border-b-2 -mb-px ${tab === id ? 'border-primary font-semibold' : 'border-transparent text-muted-foreground'}`}>{label}</button>
          ))}
        </div>

        {tab === 'calibrate' && (
          pdfDist > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1"><input type="radio" checked={unitSystem === 'imperial'} onChange={() => setUnitSystem('imperial')} />Feet-inches</label>
                <label className="flex items-center gap-1"><input type="radio" checked={unitSystem === 'metric'} onChange={() => setUnitSystem('metric')} />Metric</label>
              </div>
              {unitSystem === 'imperial' ? (
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-1 text-xs"><Input autoFocus type="number" min={0} value={feet} onChange={(e) => setFeet(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyCalibration(); }} className="w-20 h-8" placeholder="0" />ft</label>
                  <label className="flex items-center gap-1 text-xs"><Input type="number" min={0} max={11} value={inches} onChange={(e) => setInches(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyCalibration(); }} className="w-16 h-8" placeholder="0" />in</label>
                  <label className="flex items-center gap-1 text-xs">
                    <select className={sel} value={fraction} onChange={(e) => setFraction(e.target.value)}>
                      {FRACTION_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>&quot;
                  </label>
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <Input autoFocus type="number" min={0} step="any" value={metricValue} onChange={(e) => setMetricValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyCalibration(); }} className="w-28 h-8" placeholder="0" />
                  <select className={sel} value={metricUnit} onChange={(e) => setMetricUnit(e.target.value)}>
                    <option value="m">m</option><option value="cm">cm</option><option value="mm">mm</option>
                  </select>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Points are {pdfDist.toFixed(1)} pt apart on the sheet
                {knownFt > 0 ? <> → {formatFeetInchesFraction(knownFt)} = <span className="font-semibold text-foreground">{scaleLabelFromPtsPerFt(calibratedPts)}</span> ({calibratedPts.toFixed(3)} pt per ft)</> : ''}
              </p>
              {tooClose && <p className="text-xs text-red-600">Those points are too close together — pick two clearly separated points.</p>}
              <ApplyTo value={applyTo} onChange={setApplyTo} pageText={pageText} onPageText={setPageText} pageNum={pageNum} numPages={numPages} viewports={viewports} />
            </div>
          ) : (
            <div className="space-y-2 text-xs">
              <p>Click both ends of a dimension you know on the drawing (a grid spacing or a dimensioned run). Snapping to line work is on; hold Shift to keep it straight, Alt to place freely.</p>
              <Button size="sm" onClick={onStartCalibrate}><Crosshair className="w-3.5 h-3.5 mr-1.5" />Pick two points</Button>
            </div>
          )
        )}

        {tab === 'scale' && (
          <div className="space-y-3 text-xs">
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input type="radio" checked={customKind === 'preset'} onChange={() => setCustomKind('preset')} />Standard scale
                <select className={`${sel} w-48`} value={presetId} onChange={(e) => { setPresetId(e.target.value); setCustomKind('preset'); }}>
                  <option value="">Pick…</option>
                  {SCALE_PRESET_GROUPS.map((g) => (
                    <optgroup key={g} label={g}>
                      {SCALE_PRESETS.filter((p) => p.group === g).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 flex-wrap">
                <input type="radio" checked={customKind === 'paper'} onChange={() => setCustomKind('paper')} />Custom
                <Input type="number" min={0} step="any" value={paperIn} onChange={(e) => { setPaperIn(e.target.value); setCustomKind('paper'); }} className="w-16 h-7 text-xs" />
                in on paper =
                <Input type="number" min={0} step="any" value={realFt} onChange={(e) => { setRealFt(e.target.value); setCustomKind('paper'); }} className="w-20 h-7 text-xs" placeholder="ft" />
                ft real
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={customKind === 'ratio'} onChange={() => setCustomKind('ratio')} />Ratio 1 :
                <Input type="number" min={1} value={ratioN} onChange={(e) => { setRatioN(e.target.value); setCustomKind('ratio'); }} className="w-20 h-7 text-xs" placeholder="100" />
              </label>
            </div>
            {pickedScale && <p className="text-muted-foreground">{pickedScale.label} = {pickedScale.pts_per_ft.toFixed(3)} pt per ft. Run Check Scale on a known dimension to be sure the PDF is full size.</p>}
            <ApplyTo value={applyTo} onChange={setApplyTo} pageText={pageText} onPageText={setPageText} pageNum={pageNum} numPages={numPages} viewports={viewports} />
            <Button size="sm" variant="outline" onClick={onStartCalibrate}><Crosshair className="w-3.5 h-3.5 mr-1.5" />Calibrate from two points instead</Button>
          </div>
        )}

        {applyTo === 'list' && !targetOk && <p className="text-xs text-red-600">Use page numbers like 1-3, 5.</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {tab === 'calibrate'
            ? <Button onClick={applyCalibration} disabled={!(calibratedPts > 0) || tooClose || !targetOk}>Set scale</Button>
            : <Button onClick={applyPicked} disabled={!pickedScale || !targetOk}>Set scale</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
