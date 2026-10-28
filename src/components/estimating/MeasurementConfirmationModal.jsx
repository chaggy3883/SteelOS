import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GripVertical, X, ScanSearch, Loader2 } from 'lucide-react';
import { MEASURE_TOOLS, toolLabel, toolKind, applyMeasureExtras, extrasComplete, measurementSummary } from '@/lib/takeoffGeometry';
import { scaleLabelFromPtsPerFt } from '@/lib/takeoffScale';
import { formatFeetInchesFraction } from '@/lib/fractionInches';

// Volume (concrete, fill) and Angle are not steel members — no shape/size
// pick, just a plain description, and never a weight.
const NON_STEEL_KINDS = ['volume', 'angle'];

const toFeet = (ft, inches) => (parseFloat(ft) || 0) + (parseFloat(inches) || 0) / 12;

// Feet + inches entry (inches may be decimal, e.g. 4.5).
function FeetInches({ label, ft, inches, onFt, onInches }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2 mt-1">
        <Input type="number" min={0} value={ft} onChange={(e) => onFt(e.target.value)} placeholder="0" className="w-16 h-8" />
        <span className="text-xs text-muted-foreground">ft</span>
        <Input type="number" min={0} step="any" value={inches} onChange={(e) => onInches(e.target.value)} placeholder="0" className="w-16 h-8" />
        <span className="text-xs text-muted-foreground">in</span>
      </div>
    </div>
  );
}

// Fires after every Count/Length/Area click (see BlueprintTakeoff's
// handleMeasurementClick/handleSaveAreaName) so a shape/size/phase/quantity
// gets attached to the takeoff row before it's committed, instead of
// stamping a bare, unlabeled row straight from the click. Not a Dialog —
// Dialog's full-screen backdrop would sit on top of the drawing the
// estimator is actively looking at, so this is a plain floating, draggable
// panel (same drag pattern as BlueprintTakeoff's own fullscreen tools panel)
// positioned wherever it was last dragged to.
export default function MeasurementConfirmationModal({
  open,
  pendingMeasurement,
  steelCatalog = {},
  areas = {},
  onCountSimilar,
  onConfirm,
  onMergeDuplicate,
  onKeepSeparate,
  onCancel,
  // Starting values from the Tool Chest tool being measured with (shape,
  // size, slope, depth, description) — see BlueprintTakeoff's activePreset.
  // The estimator can still change any of them before adding the row.
  defaults = null,
}) {
  const [pos, setPos] = useState({ x: 320, y: 140 });
  const [shape, setShape] = useState('');
  const [size, setSize] = useState('');
  const [phaseArea, setPhaseArea] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarCount, setSimilarCount] = useState(null);
  // Set only when onConfirm reports an existing row already covers this
  // same spot/shape/size/phase — swaps the footer for a merge-or-keep-
  // separate prompt instead of adding the row right away.
  const [duplicateRow, setDuplicateRow] = useState(null);
  // Tool extras — slope (Length/Polylength/Perimeter/Area), depth (Volume),
  // wall height (Wall Area), and a plain description for non-steel kinds.
  const [slopeMode, setSlopeMode] = useState('none');
  const [rise, setRise] = useState('');
  const [run, setRun] = useState('12');
  const [degrees, setDegrees] = useState('');
  const [depthFt, setDepthFt] = useState('');
  const [depthIn, setDepthIn] = useState('');
  const [heightFt, setHeightFt] = useState('');
  const [heightIn, setHeightIn] = useState('');
  const [description, setDescription] = useState('');

  const shapeKeys = Object.keys(steelCatalog || {});
  const sizeOptions = steelCatalog?.[shape] || [];
  const areaKeys = Object.keys(areas || {});

  // Reset the form for each new measurement, defaulting to the catalog's
  // first shape/size and (for an Area-tool measurement) the zone name that
  // was just saved via the Name This Area modal, since that's the phase/area
  // this exact shape almost always belongs to.
  useEffect(() => {
    if (!open) return;
    const keys = Object.keys(steelCatalog || {});
    let firstShape = keys[0] || '';
    let firstSize = (steelCatalog?.[firstShape] || [])[0] || '';
    const norm = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');
    const wantSize = norm(defaults?.size);
    const sizeHit = wantSize ? keys.map((k) => [k, (steelCatalog[k] || []).find((s) => norm(s) === wantSize)]).find(([, s]) => s) : null;
    if (sizeHit) {
      [firstShape, firstSize] = sizeHit;
    } else if (defaults?.shape && steelCatalog?.[defaults.shape]) {
      firstShape = defaults.shape;
      firstSize = steelCatalog[defaults.shape][0] || '';
    }
    setShape(firstShape);
    setSize(firstSize);
    setPhaseArea(pendingMeasurement?.zoneName || '');
    setQuantity(1);
    setSimilarCount(null);
    setSimilarLoading(false);
    setDuplicateRow(null);
    setSlopeMode('none');
    setRise('');
    setRun('12');
    setDegrees('');
    setDepthFt('');
    setDepthIn('');
    setHeightFt('');
    setHeightIn('');
    setDescription(defaults?.description || '');
    if (defaults?.slope?.mode === 'degrees') {
      setSlopeMode('degrees');
      setDegrees(String(defaults.slope.degrees));
    } else if (defaults?.slope?.mode === 'pitch') {
      setSlopeMode('pitch');
      setRise(String(defaults.slope.rise));
      setRun(String(defaults.slope.run));
    }
    if (Number(defaults?.depth_ft) > 0) setDepthFt(String(defaults.depth_ft));
    // defaults only matter when a new measurement opens.
  }, [open, pendingMeasurement]);

  useEffect(() => {
    const sizes = steelCatalog?.[shape] || [];
    if (!sizes.includes(size)) setSize(sizes[0] || '');
  }, [shape, steelCatalog]);

  const handleDragStart = (e) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = pos;
    const handleMove = (moveEvent) => {
      setPos({ x: startPos.x + (moveEvent.clientX - startX), y: startPos.y + (moveEvent.clientY - startY) });
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const handleCountSimilarClick = async () => {
    setSimilarLoading(true);
    setSimilarCount(null);
    try {
      const count = await onCountSimilar?.();
      if (count != null) setSimilarCount(count);
    } finally {
      setSimilarLoading(false);
    }
  };

  const tool = pendingMeasurement?.tool;
  const def = MEASURE_TOOLS[tool];
  const isNonSteel = NON_STEEL_KINDS.includes(toolKind(tool));
  const extras = {
    slope: slopeMode === 'pitch' ? { mode: 'pitch', rise: Number(rise) || 0, run: Number(run) || 0 }
      : slopeMode === 'degrees' ? { mode: 'degrees', degrees: Number(degrees) || 0 }
      : null,
    depth_ft: toFeet(depthFt, depthIn),
    height_ft: toFeet(heightFt, heightIn),
  };
  // What will actually be saved, recomputed live as slope/depth/height change.
  const preview = def && pendingMeasurement ? applyMeasureExtras(pendingMeasurement, extras) : null;
  const extrasOk = extrasComplete(tool, extras);
  // Steel kinds keep the shape/size pick; non-steel carries a description.
  const payload = () => ({
    shape: isNonSteel ? (description.trim() || toolLabel(tool)) : shape,
    size: isNonSteel ? '' : size,
    quantity,
    phaseArea: phaseArea || null,
    extras,
  });

  const handleAddToTakeoffClick = () => {
    const result = onConfirm?.(payload());
    if (result?.duplicate) setDuplicateRow(result.duplicate);
  };

  if (!open || !pendingMeasurement) return null;

  const headerLabel = toolLabel(tool);
  // Only require a phase/area pick when the bid actually has one or more
  // areas defined — a project that was never phased shouldn't block every
  // takeoff row on picking from an empty/meaningless dropdown.
  const phaseRequired = areaKeys.length > 0;

  return (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y }}
      className="z-[70] w-80 rounded-lg border bg-card shadow-2xl"
    >
      <div
        onMouseDown={handleDragStart}
        className="flex items-center gap-2 px-3 py-2 border-b text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-move select-none"
      >
        <GripVertical className="w-4 h-4" />Confirm {headerLabel}
        <Button size="icon" variant="ghost" className="h-5 w-5 ml-auto" onClick={onCancel}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="p-3 space-y-3">
        {preview && (
          <div className="rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
            <p className="font-semibold text-sm">{measurementSummary(preview, formatFeetInchesFraction)}</p>
            {pendingMeasurement.scale_pts_per_ft > 0 && (
              <p className="text-muted-foreground">Measured at {scaleLabelFromPtsPerFt(pendingMeasurement.scale_pts_per_ft)}</p>
            )}
          </div>
        )}

        {def?.slope && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Slope (roofs, ramps, stair stringers)</label>
            <div className="flex items-center gap-2 mt-1">
              <select
                value={slopeMode}
                onChange={(e) => setSlopeMode(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="none">Flat</option>
                <option value="pitch">Pitch (rise:run)</option>
                <option value="degrees">Angle (degrees)</option>
              </select>
              {slopeMode === 'pitch' && (
                <>
                  <Input type="number" min={0} step="any" value={rise} onChange={(e) => setRise(e.target.value)} placeholder="6" className="w-14 h-8" />
                  <span className="text-xs">:</span>
                  <Input type="number" min={0} step="any" value={run} onChange={(e) => setRun(e.target.value)} placeholder="12" className="w-14 h-8" />
                </>
              )}
              {slopeMode === 'degrees' && (
                <>
                  <Input type="number" min={0} max={88} step="any" value={degrees} onChange={(e) => setDegrees(e.target.value)} placeholder="30" className="w-16 h-8" />
                  <span className="text-xs">°</span>
                </>
              )}
            </div>
          </div>
        )}

        {def?.needsDepth && (
          <FeetInches label="Depth / thickness *" ft={depthFt} inches={depthIn} onFt={setDepthFt} onInches={setDepthIn} />
        )}
        {def?.needsHeight && (
          <FeetInches label="Wall height *" ft={heightFt} inches={heightIn} onFt={setHeightFt} onInches={setHeightIn} />
        )}

        {isNonSteel ? (
          <div>
            <label className="text-xs font-medium text-muted-foreground">What is it?</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={tool === 'volume' ? 'e.g. Footing concrete' : 'e.g. Brace angle at grid C'}
              className="mt-1 h-8"
            />
          </div>
        ) : (
        <>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Shape</label>
          <select
            value={shape}
            onChange={(e) => setShape(e.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {shapeKeys.length === 0 && <option value="">No catalog loaded</option>}
            {shapeKeys.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Size</label>
          <select
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {sizeOptions.length === 0 && <option value="">—</option>}
            {sizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        </>
        )}

        {phaseRequired && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Phase / Area <span className="text-destructive">*</span></label>
            <select
              value={phaseArea}
              onChange={(e) => setPhaseArea(e.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Select a phase/area…</option>
              {areaKeys.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-muted-foreground">Quantity</label>
          <Input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            className="mt-1 h-8"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={handleCountSimilarClick}
          disabled={similarLoading}
        >
          {similarLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5" />}
          Count Similar
        </Button>

        {similarCount != null && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs space-y-1.5">
            <p>Found {similarCount} similar shape{similarCount === 1 ? '' : 's'}. Use this count?</p>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 flex-1" onClick={() => { setQuantity(similarCount); setSimilarCount(null); }}>Use</Button>
              <Button size="sm" variant="outline" className="h-7 flex-1" onClick={() => setSimilarCount(null)}>Ignore</Button>
            </div>
          </div>
        )}
      </div>

      {duplicateRow ? (
        <div className="px-3 py-2 border-t bg-amber-500/5 space-y-2">
          <p className="text-xs text-amber-700">
            Looks like a duplicate of an existing row here — {duplicateRow.shape_type} {duplicateRow.size_designation} (qty {duplicateRow.quantity}) already logged at this spot. Merge into that row, or keep this as a separate row?
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => onKeepSeparate?.({ ...payload(), existingRowKey: duplicateRow._key })}
            >
              Keep Separate
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onMergeDuplicate?.(duplicateRow._key, quantity)}
            >
              Merge (+{quantity})
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={handleAddToTakeoffClick} disabled={(!isNonSteel && !shape) || (phaseRequired && !phaseArea) || !extrasOk}>
            Add to Takeoff
          </Button>
        </div>
      )}
    </div>
  );
}
