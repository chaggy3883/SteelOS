import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { AlertTriangle, Loader2, Plus } from 'lucide-react';
import { materialCatalogPermissions } from '@/lib/materialCatalogAccess';
import { calcCatalogRow, entryFamily, WEIGHT_SOURCE_LABELS } from '@/lib/materialEntryMath';
import { estimateWeightPerFt } from '@/data/steelShapeSelector';
import {
  checkMasterSizeParses, checkDesignationParses, findDuplicateSize, findDuplicateDesignation, mirrorForMasterSize, mirrorForDesignation,
  resolveSteelWeight, WEIGHT_FIELD_BY_FAMILY, WEIGHT_UNIT_BY_FAMILY,
} from '@/lib/catalogSizeRules';
import { addMasterSize, addSteelSize, currentActor } from '@/lib/materialCatalogWrites';
import MathDrill from '@/components/estimating/MathDrill';

// "+ Add size" from a takeoff's Size picker. Two targets:
//   - { kind: 'master', shapeType } — a MaterialSizeOption under that
//     MaterialShapeType (Full Takeoff's Size picker, IRONSIGHT Count setup);
//   - { kind: 'steel', shapeClass } — a steel_catalog row, is_custom
//     (IRONSIGHT's measurement Size picker).
// A standard AISC W / HSS / C / L size is also added to the other table
// (materialCatalogWrites.js). The optional weight is in the family's unit
// and becomes the size's own saved weight. Duplicates (any spelling) offer
// the existing size instead; a size that doesn't parse warns but can still
// be added. Estimators, admins and super admins (impersonating) can add;
// changing what's stored is admin-only, on the Material Catalog page.
export default function AddCatalogSizeDialog({ open, onOpenChange, target, existingValues = [], initialText = '', catalogRows = [], onAdded, onUseExisting }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const perms = materialCatalogPermissions(user?.roles || user?.user?.roles || []);
  const [text, setText] = useState('');
  const [weight, setWeight] = useState('');
  const [dim1, setDim1] = useState('');
  const [dim2, setDim2] = useState('');
  const [wall, setWall] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText(initialText || '');
    setWeight('');
    setDim1('');
    setDim2('');
    setWall('');
  }, [open, initialText]);

  const isMaster = target?.kind === 'master';
  const shapeType = target?.shapeType;
  const shapeClass = target?.shapeClass;
  const family = isMaster ? entryFamily(shapeType?.shape_code, shapeType?.category) : 'linear';
  const unit = WEIGHT_UNIT_BY_FAMILY[family];
  const value = text.trim();
  const w = Number(weight);

  const duplicate = useMemo(() => {
    if (!value) return null;
    return isMaster ? findDuplicateSize(shapeType?.shape_code, value, existingValues) : findDuplicateDesignation(value, existingValues);
  }, [value, isMaster, shapeType, existingValues]);

  const parse = useMemo(() => {
    if (!value) return null;
    return isMaster ? checkMasterSizeParses(shapeType?.shape_code, shapeType?.category, value) : checkDesignationParses(shapeClass, value);
  }, [value, isMaster, shapeType, shapeClass]);

  // How the size will read and which weight it will get, live.
  const preview = useMemo(() => {
    if (!value) return null;
    if (isMaster) {
      const fakeSaved = w > 0 ? { size_value: value, [WEIGHT_FIELD_BY_FAMILY[family]]: w, weight_source: 'typed', weight_set_by: currentActor(), weight_set_date: new Date().toISOString() } : null;
      const calc = calcCatalogRow({ shape_code: shapeType?.shape_code, size_value: value, quantity: 1, length_in: 12, width_in: 12 }, { shapeType, catalogRows, sizeOption: fakeSaved });
      const mirror = mirrorForMasterSize(shapeType?.shape_code, value);
      return {
        reads: `${shapeType?.shape_code} ${value}`,
        profile: calc.profile,
        source: calc.needsWeight ? 'Weight needed' : (WEIGHT_SOURCE_LABELS[calc.weightSource] || calc.weightSource),
        weight: calc.needsWeight ? null : `${Number(calc.unitWeight.toFixed(3))} ${calc.weightUnit}`,
        lines: [calc.weightFormula],
        needsWeight: calc.needsWeight,
        mirror: mirror ? `Also adds ${mirror.size_designation} to IRONSIGHT's ${mirror.shape_class} sizes.` : null,
      };
    }
    const designation = value.toUpperCase();
    let source = 'Weight needed';
    let weightText = null;
    let lines = ['No steel catalog, AISC or estimator weight for this size — type one above or on the Markups List later.'];
    if (w > 0) {
      source = 'Saved weight';
      weightText = `${w} lb/ft`;
      lines = [`Typed here: ${w} lb/ft — saved by ${currentActor()}`];
    } else {
      const found = resolveSteelWeight(designation, catalogRows);
      const est = found ? 0 : estimateWeightPerFt(shapeClass, designation);
      if (found) { source = found.source === 'aisc' ? 'AISC v16.0' : found.source === 'saved' ? 'Saved weight' : 'Steel catalog'; weightText = `${found.perFt} lb/ft`; lines = [found.text]; }
      else if (est > 0) { source = 'AISC estimate'; weightText = `${Number(est.toFixed(3))} lb/ft`; lines = [`Estimated from the size (steelShapeSelector.js): ${Number(est.toFixed(3))} lb/ft`]; }
    }
    const mirror = mirrorForDesignation(shapeClass, designation);
    return {
      reads: designation,
      profile: designation,
      source,
      weight: weightText,
      lines,
      needsWeight: !weightText,
      mirror: mirror ? `Also adds "${mirror.sizeValue}" under ${mirror.shapeCode} in the master catalog.` : null,
    };
  }, [value, w, isMaster, family, shapeType, shapeClass, catalogRows]);

  const canSave = perms.canAdd && !!value && !duplicate && !saving && (isMaster ? !!shapeType?.id : !!shapeClass);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const result = isMaster
        ? await addMasterSize({ shapeType, sizeValue: value, weight: w > 0 ? w : null, from: 'takeoff' })
        : await addSteelSize({ shapeClass, designation: value, weightPerFt: w > 0 ? w : null, dims: { dimension1: dim1, dimension2: dim2, wall_thickness_in: wall }, from: 'ironsight' });
      if (result.duplicate) {
        const existing = isMaster ? result.duplicate.size_value : result.duplicate.size_designation;
        const inactive = result.duplicate.is_active === false;
        toast({ title: `Already in the catalog as "${existing}"`, description: inactive ? 'It is turned off — an admin can turn it back on in Material Catalog.' : 'Selected the existing size instead.' });
        if (!inactive) onUseExisting?.(existing);
        onOpenChange(false);
        return;
      }
      const added = isMaster ? result.record.size_value : result.record.size_designation;
      const mirrorNote = result.mirror?.created ? ' Also added to the other takeoff\'s catalog.' : '';
      toast({ title: `Added ${isMaster ? `${shapeType.shape_code} ${added}` : added}`, description: `Every takeoff can pick it now.${mirrorNote}` });
      onAdded?.({ value: added, record: result.record, mirror: result.mirror });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Could not add the size', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const heading = isMaster ? `${shapeType?.shape_code || ''} — ${shapeType?.description || ''}` : shapeClass;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md z-[80]">
        <DialogHeader>
          <DialogTitle>Add a size — {heading}</DialogTitle>
        </DialogHeader>

        {perms.needsCompany && (
          <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 text-xs flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            You&apos;re signed in as the platform operator. The catalog belongs to one company — pick a company to work as (Impersonate) before adding sizes.
          </div>
        )}
        {!perms.canAdd && !perms.needsCompany && (
          <p className="text-xs text-muted-foreground">Only estimators, admins and super admins can add catalog sizes.</p>
        )}

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Size</Label>
            <Input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              className="mt-1 font-mono"
              placeholder={isMaster ? (family === 'plate' ? 'e.g. 5/8 x' : family === 'each' ? 'e.g. 3/4 x 0\'-2 1/2' : 'e.g. 1/2 x 6') : 'e.g. W12X40'}
            />
            {!value && <p className="text-[11px] text-destructive mt-0.5">Type the size.</p>}
            {duplicate && (
              <div className="mt-1 flex items-center gap-2 text-[11px] text-amber-700">
                <span>Already listed as &quot;{duplicate}&quot;.</span>
                <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => { onUseExisting?.(duplicate); onOpenChange(false); }}>Use {duplicate}</Button>
              </div>
            )}
            {!duplicate && parse && !parse.ok && (
              <p className="text-[11px] text-amber-700 mt-0.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{parse.message} You can still add it.</p>
            )}
            {!duplicate && parse?.ok && parse.message && <p className="text-[11px] text-muted-foreground mt-0.5">{parse.message}</p>}
          </div>

          {!isMaster && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Dim 1 (in)</Label>
                <Input type="number" min={0} step="any" value={dim1} onChange={(e) => setDim1(e.target.value)} className="mt-1 h-8" placeholder="depth" />
              </div>
              <div>
                <Label className="text-xs">Dim 2 (in)</Label>
                <Input type="number" min={0} step="any" value={dim2} onChange={(e) => setDim2(e.target.value)} className="mt-1 h-8" placeholder="width" />
              </div>
              <div>
                <Label className="text-xs">Wall (in)</Label>
                <Input type="number" min={0} step="any" value={wall} onChange={(e) => setWall(e.target.value)} className="mt-1 h-8" placeholder="optional" />
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs">Weight ({unit}, optional)</Label>
            <Input type="number" min={0} step="any" value={weight} onChange={(e) => setWeight(e.target.value)} className="mt-1 h-8 w-40" placeholder={unit} />
            <p className="text-[11px] text-muted-foreground mt-0.5">Saved as this size&apos;s own weight — every takeoff uses it before AISC or a computed weight.</p>
          </div>

          {preview && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-1">
              <p>Reads as <span className="font-mono font-semibold">{preview.reads}</span>{preview.profile && preview.profile !== preview.reads ? <span className="text-muted-foreground"> ({preview.profile})</span> : null}</p>
              <p className="flex items-center gap-1.5">
                Weight source: <span className={preview.needsWeight ? 'text-amber-700 font-medium' : 'font-medium'}>{preview.source}</span>
                {preview.weight && <MathDrill value={preview.weight} title="Weight for this size" lines={preview.lines} align="start" />}
              </p>
              {preview.mirror && <p className="text-muted-foreground">{preview.mirror}</p>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}Add size
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
