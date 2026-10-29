import React from 'react';
import { SlidersHorizontal, Wrench, Ruler, ScanSearch, X } from 'lucide-react';

export const RIGHT_TABS = [
  { id: 'properties', label: 'Properties', icon: SlidersHorizontal },
  { id: 'toolchest', label: 'Tool Chest', icon: Wrench },
  { id: 'measurements', label: 'Measurements', icon: Ruler },
  { id: 'symbols', label: 'Find symbols', icon: ScanSearch },
];

// Right side bar shell: icon strip + the active tab's content. The content
// itself (Properties, the existing ToolChestPanel, ScalePanel/legend, and
// VisualSearchPanel) is handed in by the workspace.
export default function RightSidebar({ tab, onTabChange, collapsed, onToggleCollapsed, content }) {
  return (
    <div className="h-full flex min-h-0 bg-background">
      {!collapsed && (
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="h-7 px-2 flex items-center justify-between border-b text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex-shrink-0">
            {RIGHT_TABS.find((t) => t.id === tab)?.label}
            <button type="button" onClick={onToggleCollapsed} title="Hide panel" className="hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-3">
            {content[tab] || null}
          </div>
        </div>
      )}
      <div className="w-9 flex-shrink-0 border-l flex flex-col items-center py-1 gap-1 bg-muted/30">
        {RIGHT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.label}
            onClick={() => { if (collapsed) onToggleCollapsed(); onTabChange(t.id); }}
            className={`h-8 w-8 inline-flex items-center justify-center rounded ${tab === t.id && !collapsed ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
          >
            <t.icon className="w-4 h-4" />
          </button>
        ))}
      </div>
    </div>
  );
}
