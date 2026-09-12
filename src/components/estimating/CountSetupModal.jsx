import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GripVertical, X } from 'lucide-react';

// Step 1 of the Count/Bolt Count engine — asks for whichever fields this
// `kind` needs (Shape/Size/Length for a beam count, Type/Size/Grade for a
// bolt count) before the color/symbol picker (CountColorPickerModal) and the
// click-to-mark session itself. Both kinds share this exact component and
// the master material catalog (MaterialShapeType/MaterialSizeOption/
// MaterialGradeOption) as their data source — only which fields render (and
// which catalog category `shapeTypes` was pre-filtered to) differs, so this
// stays one engine parameterized by `kind` rather than two separate forms.
export default function CountSetupModal({
  open,
  kind, // 'beam' | 'bolt'
  shapeTypes = [],
  sizesByShapeId = {},
  gradesByShapeId = {},
  initialValues = null,
  onConfirm,
  onCancel,
}) {
  const [pos, setPos] = useState({ x: 320, y: 140 });
  const [shapeTypeId, setShapeTypeId] = useState('');
  const [size, setSize] = useState('');
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');
  const [grade, setGrade] = useState('');

  // Reset the form whenever the setup modal (re)opens — defaults to the
  // catalog's first shape/size, or the passed-in initial values when a
  // Tool Chest preset seeded this step.
  useEffect(() => {
    if (!open) return;
    const firstId = initialValues?.shape_type_id || shapeTypes[0]?.id || '';
    setShapeTypeId(firstId);
    setSize(initialValues?.size_designation || (sizesByShapeId[firstId] || [])[0] || '');
    setFeet(initialValues?.length_ft ? String(Math.floor(initialValues.length_ft)) : '');
    setInches(initialValues?.length_ft ? String(Math.round((initialValues.length_ft % 1) * 12)) : '');
    setGrade(initialValues?.grade || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  // The material catalog loads asynchronously in the parent — if this modal
  // is opened before it resolves, `shapeTypes` is still empty when the reset
  // effect above runs, leaving shapeTypeId permanently blank even after the
  // catalog arrives a moment later. Backfill once it does, but only while
  // nothing has been selected yet (never override an in-progress choice).
  useEffect(() => {
    if (!open || shapeTypeId) return;
    const firstId = initialValues?.shape_type_id || shapeTypes[0]?.id || '';
    if (firstId) setShapeTypeId(firstId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shapeTypes]);

  useEffect(() => {
    const sizes = sizesByShapeId[shapeTypeId] || [];
    if (!sizes.includes(size)) setSize(sizes[0] || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeTypeId, sizesByShapeId]);

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

  if (!open) return null;

  const sizeOptions = sizesByShapeId[shapeTypeId] || [];
  const gradeOptions = gradesByShapeId[shapeTypeId] || [];
  const shapeLabel = kind === 'bolt' ? 'Type' : 'Shape';
  const selectedShape = shapeTypes.find((s) => s.id === shapeTypeId);
  const canConfirm = !!shapeTypeId && !!size;

  const handleConfirmClick = () => {
    if (!canConfirm) return;
    const base = {
      shape_type_id: shapeTypeId,
      shape_type: selectedShape?.description || selectedShape?.shape_code || '',
      size_designation: size,
    };
    if (kind === 'bolt') {
      onConfirm?.({ ...base, grade });
    } else {
      const lengthFt = (parseFloat(feet) || 0) + (parseFloat(inches) || 0) / 12;
      onConfirm?.({ ...base, length_ft: lengthFt });
    }
  };

  return (
    <div style={{ position: 'fixed', left: pos.x, top: pos.y }} className="z-[70] w-80 rounded-lg border bg-card shadow-2xl">
      <div
        onMouseDown={handleDragStart}
        className="flex items-center gap-2 px-3 py-2 border-b text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-move select-none"
      >
        <GripVertical className="w-4 h-4" />
        {kind === 'bolt' ? 'Set Up Bolt Count' : 'Set Up Count'}
        <Button size="icon" variant="ghost" className="h-5 w-5 ml-auto" onClick={onCancel}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="p-3 space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">{shapeLabel}</label>
          <select
            value={shapeTypeId}
            onChange={(e) => setShapeTypeId(e.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {shapeTypes.length === 0 && <option value="">No catalog loaded</option>}
            {shapeTypes.map((s) => <option key={s.id} value={s.id}>{s.description || s.shape_code}</option>)}
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

        {kind === 'bolt' ? (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Grade</label>
            {gradeOptions.length > 0 ? (
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">—</option>
                {gradeOptions.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            ) : (
              <Input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="e.g. A325" className="mt-1 h-8" />
            )}
          </div>
        ) : (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Length</label>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1">
                <Input type="number" min={0} value={feet} onChange={(e) => setFeet(e.target.value)} placeholder="0" className="w-16 h-8" />
                <span className="text-xs text-muted-foreground">ft</span>
              </div>
              <div className="flex items-center gap-1">
                <Input type="number" min={0} max={11} value={inches} onChange={(e) => setInches(e.target.value)} placeholder="0" className="w-16 h-8" />
                <span className="text-xs text-muted-foreground">in</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={handleConfirmClick} disabled={!canConfirm}>Next: Pick Color</Button>
      </div>
    </div>
  );
}
