import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GripVertical, X, ScanSearch, Loader2 } from 'lucide-react';

const TOOL_LABELS = { count: 'Count', length: 'Length', area: 'Area' };

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

  const shapeKeys = Object.keys(steelCatalog || {});
  const sizeOptions = steelCatalog?.[shape] || [];
  const areaKeys = Object.keys(areas || {});

  // Reset the form for each new measurement, defaulting to the catalog's
  // first shape/size and (for an Area-tool measurement) the zone name that
  // was just saved via the Name This Area modal, since that's the phase/area
  // this exact shape almost always belongs to.
  useEffect(() => {
    if (!open) return;
    const firstShape = Object.keys(steelCatalog || {})[0] || '';
    setShape(firstShape);
    setSize((steelCatalog?.[firstShape] || [])[0] || '');
    setPhaseArea(pendingMeasurement?.zoneName || '');
    setQuantity(1);
    setSimilarCount(null);
    setSimilarLoading(false);
    setDuplicateRow(null);
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

  const handleAddToTakeoffClick = () => {
    const result = onConfirm?.({ shape, size, quantity, phaseArea: phaseArea || null });
    if (result?.duplicate) setDuplicateRow(result.duplicate);
  };

  if (!open || !pendingMeasurement) return null;

  const toolLabel = TOOL_LABELS[pendingMeasurement.tool] || 'Measurement';
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
        <GripVertical className="w-4 h-4" />Confirm {toolLabel}
        <Button size="icon" variant="ghost" className="h-5 w-5 ml-auto" onClick={onCancel}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="p-3 space-y-3">
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
              onClick={() => onKeepSeparate?.({ shape, size, quantity, phaseArea: phaseArea || null, existingRowKey: duplicateRow._key })}
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
          <Button size="sm" onClick={handleAddToTakeoffClick} disabled={!shape || (phaseRequired && !phaseArea)}>
            Add to Takeoff
          </Button>
        </div>
      )}
    </div>
  );
}
