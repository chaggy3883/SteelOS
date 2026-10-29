import React, { forwardRef, useRef } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import WorkspaceMenuBar from './WorkspaceMenuBar';
import { MainToolbar, MarkupToolbar } from './WorkspaceToolbars';
import MarkupPropertiesStrip from './MarkupPropertiesStrip';
import LeftSidebar from './LeftSidebar';
import RightSidebar from './RightSidebar';
import WorkspaceStatusBar from './WorkspaceStatusBar';
import CanvasContextMenu from './CanvasContextMenu';

// Drag handle between panels. `axis` 'x' resizes a width, 'y' a height;
// `sign` flips the direction for panels anchored on the right / bottom.
function Splitter({ axis, value, sign = 1, onChange }) {
  const startRef = useRef(null);
  const down = (e) => {
    e.preventDefault();
    startRef.current = { pos: axis === 'x' ? e.clientX : e.clientY, value };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!startRef.current) return;
    const d = (axis === 'x' ? e.clientX : e.clientY) - startRef.current.pos;
    onChange(startRef.current.value + d * sign);
  };
  const up = (e) => {
    startRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return (
    <div
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      className={`${axis === 'x' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'} flex-shrink-0 bg-border hover:bg-primary/50 transition-colors`}
      title="Drag to resize"
    />
  );
}

// The Revu-style IRONSIGHT workspace shell: title bar (project/bid →
// drawing → revision), menu bar, main + markup toolbars, properties strip,
// open-drawing tabs, left side bar, the drawing, right side bar, the bottom
// panel (Markups List and the takeoff tabs) and the status bar. Pure
// layout — every piece of state and every action comes from
// BlueprintTakeoff, and panel sizes come from useWorkspaceLayout.
const IronsightWorkspace = forwardRef(function IronsightWorkspace({
  titleBar, menus, toolbar, strip, drawingTabs = [], left, rightContent, banners, canvas, bottomTabs, statusBar,
  layout, setLayout, contextMenu, onCloseContextMenu,
}, ref) {
  return (
    <div ref={ref} className="fixed inset-0 z-40 flex flex-col bg-background text-foreground">
      {titleBar}
      <WorkspaceMenuBar menus={menus} />
      <MainToolbar a={toolbar} />
      <MarkupToolbar a={toolbar} />
      {strip ? <MarkupPropertiesStrip {...strip} /> : (
        <div className="h-9 flex items-center px-3 border-b bg-background text-xs text-muted-foreground flex-shrink-0">
          Select a markup, or pick a markup tool, to change its color, fill, line and font here.
        </div>
      )}
      {drawingTabs.length > 1 && (
        <div className="flex items-end gap-0.5 px-2 pt-1 border-b bg-muted/30 overflow-x-auto flex-shrink-0">
          {drawingTabs.map((t) => (
            <div key={t.id} className={`flex items-center gap-1 rounded-t border border-b-0 px-2 py-1 text-xs ${t.active ? 'bg-background font-semibold' : 'bg-muted/50 text-muted-foreground'}`}>
              <button type="button" onClick={t.onSelect} className="max-w-[220px] truncate" title={t.label}>{t.label}</button>
              {!t.active && <button type="button" onClick={t.onClose} title="Close tab" className="hover:text-foreground"><X className="w-3 h-3" /></button>}
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <div className="flex-shrink-0 h-full" style={{ width: layout.leftOpen ? layout.leftWidth : 36 }}>
          <LeftSidebar
            {...left}
            tab={layout.leftTab}
            onTabChange={(id) => setLayout({ leftTab: id })}
            collapsed={!layout.leftOpen}
            onToggleCollapsed={() => setLayout((l) => ({ leftOpen: !l.leftOpen }))}
          />
        </div>
        {layout.leftOpen && <Splitter axis="x" value={layout.leftWidth} onChange={(v) => setLayout({ leftWidth: v })} />}

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {banners}
          <div className="flex-1 min-h-0 relative">{canvas}</div>
          {layout.bottomOpen && <Splitter axis="y" value={layout.bottomHeight} sign={-1} onChange={(v) => setLayout({ bottomHeight: v })} />}
          <div className="flex-shrink-0 flex flex-col min-h-0 border-t" style={{ height: layout.bottomOpen ? layout.bottomHeight : 28 }}>
            <div className="h-7 flex items-center gap-0.5 px-1 bg-muted/40 border-b flex-shrink-0 overflow-x-auto">
              {bottomTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setLayout({ bottomTab: t.id, bottomOpen: true })}
                  className={`h-6 px-2 rounded text-xs whitespace-nowrap ${layout.bottomTab === t.id && layout.bottomOpen ? 'bg-background shadow-sm font-semibold' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {t.label}{t.badge ? <span className="ml-1 text-[10px] text-muted-foreground">({t.badge})</span> : null}
                </button>
              ))}
              <button
                type="button"
                className="ml-auto h-6 w-6 inline-flex items-center justify-center rounded hover:bg-muted"
                title={layout.bottomOpen ? 'Collapse the bottom panel' : 'Show the bottom panel'}
                onClick={() => setLayout((l) => ({ bottomOpen: !l.bottomOpen }))}
              >
                {layout.bottomOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
            </div>
            {layout.bottomOpen && (
              <div className="flex-1 min-h-0 overflow-hidden">
                {/* All tabs stay mounted (hidden) so local edit state in the
                    Estimate tab survives switching, as before. */}
                {bottomTabs.map((t) => (
                  <div key={t.id} className={`h-full ${t.scroll === false ? '' : 'overflow-auto p-2'} ${layout.bottomTab === t.id ? '' : 'hidden'}`}>{t.content}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        {layout.rightOpen && <Splitter axis="x" value={layout.rightWidth} sign={-1} onChange={(v) => setLayout({ rightWidth: v })} />}
        <div className="flex-shrink-0 h-full" style={{ width: layout.rightOpen ? layout.rightWidth : 36 }}>
          <RightSidebar
            tab={layout.rightTab}
            onTabChange={(id) => setLayout({ rightTab: id })}
            collapsed={!layout.rightOpen}
            onToggleCollapsed={() => setLayout((l) => ({ rightOpen: !l.rightOpen }))}
            content={rightContent}
          />
        </div>
      </div>

      <WorkspaceStatusBar {...statusBar} />
      {contextMenu && <CanvasContextMenu menu={contextMenu} onClose={onCloseContextMenu} />}
    </div>
  );
});

export default IronsightWorkspace;
