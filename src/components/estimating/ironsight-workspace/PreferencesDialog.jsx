import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FONT_FAMILIES } from '@/lib/drawingMarkups';

const sel = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs';

// Edit > Preferences. Saved per user on this device (useWorkspaceLayout);
// every change applies straight away.
export default function PreferencesDialog({ open, onOpenChange, prefs, onChange, onResetLayout }) {
  const check = (key, label, help) => (
    <label className="flex items-start gap-2 text-xs cursor-pointer">
      <input type="checkbox" className="mt-0.5" checked={Boolean(prefs[key])} onChange={(e) => onChange({ [key]: e.target.checked })} />
      <span><span className="font-medium">{label}</span><span className="block text-muted-foreground">{help}</span></span>
    </label>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Preferences</DialogTitle>
          <DialogDescription>IRONSIGHT settings for you on this device.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            {check('snap', 'Snap to the drawing', 'Points jump to line ends, midpoints and lines. Hold Alt while clicking to place freely.')}
            {check('ortho', 'Ortho', 'Every line stays horizontal or vertical. Shift does this for a single click.')}
            {check('grid', 'Show grid', 'A light ½ inch paper grid over the sheet.')}
          </div>
          <label className="block space-y-1 text-xs">
            <span className="font-medium">Units for coordinates and calibration</span>
            <select className={sel} value={prefs.units} onChange={(e) => onChange({ units: e.target.value })}>
              <option value="ft-in">Feet-inches-fractions (12&apos;-6 1/2&quot;)</option>
              <option value="decimal-ft">Decimal feet (12.54&apos;)</option>
              <option value="metric">Metric (meters)</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1 text-xs">
              <span className="font-medium">Default text font</span>
              <select className={sel} value={prefs.font_family} onChange={(e) => onChange({ font_family: e.target.value })}>
                {FONT_FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium">Default text size</span>
              <select className={sel} value={prefs.font_size} onChange={(e) => onChange({ font_size: Number(e.target.value) })}>
                {[8, 9, 10, 11, 12, 14, 16, 18, 24].map((s) => <option key={s} value={s}>{s} pt</option>)}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">New text boxes, typewriter text and callouts start with this font. Change any one of them later from the properties strip.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onChange({ toolStyles: {} }); onResetLayout(); }}>Reset panels &amp; tool styles</Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
