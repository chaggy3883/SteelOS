import React from 'react';
import { Switch } from '@/components/ui/switch';
import { TableProperties } from 'lucide-react';

export const LEGEND_ANCHORS = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'custom', label: 'Where I dragged it' },
];

const selectClass = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs';

// Side-panel card for the current page's legend: on/off, which corner, and
// whether it lists each tool or rolls tools up by group (subject). The
// legend is drawn on the sheet by BlueprintCanvas and can be dragged there
// in Select mode; the same settings place it in the exported PDF.
// `setting` = blueprint_takeoffs.legend_settings[page].
export default function LegendControls({ pageNum, setting = {}, rowCount = 0, onChange }) {
  const on = Boolean(setting.on);
  return (
    <div className="border rounded-lg">
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm font-semibold">
        <span className="flex items-center gap-2"><TableProperties className="w-4 h-4" />Legend — page {pageNum}</span>
        <Switch checked={on} onCheckedChange={(v) => onChange({ on: v })} aria-label="Show a legend on this page" />
      </div>
      {on && (
        <div className="border-t p-3 space-y-2 text-xs">
          {rowCount === 0 && <p className="text-muted-foreground">Nothing measured on this page yet — the legend appears once there is.</p>}
          <label className="block space-y-1">
            <span className="font-medium">Where on the sheet</span>
            <select className={selectClass} value={setting.anchor || 'bottom-right'} onChange={(e) => onChange({ anchor: e.target.value })}>
              {LEGEND_ANCHORS.filter((a) => a.value !== 'custom' || setting.pdfX != null).map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-medium">One line per</span>
            <select className={selectClass} value={setting.group_by || 'tool'} onChange={(e) => onChange({ group_by: e.target.value })}>
              <option value="tool">Tool / item (W18X35, Base plates…)</option>
              <option value="subject">Group (Framing, Stairs…)</option>
            </select>
          </label>
          <p className="text-muted-foreground">Tip: with Select on, drag the legend on the drawing to move it.</p>
        </div>
      )}
    </div>
  );
}
