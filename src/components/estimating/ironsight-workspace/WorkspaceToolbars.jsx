import React from 'react';
import {
  FolderOpen, Save, Printer, Undo2, Redo2, MousePointer2, Hand, ZoomIn, ZoomOut, Maximize, MoveHorizontal, RotateCw,
  PenLine, Highlighter, Minus, MoveUpRight, Waypoints, Pentagon, Square, Circle, Cloud, TextCursorInput, Type,
  MessageSquareText, StickyNote, Stamp, Crosshair, ScanSearch, MousePointerClick, Hexagon, Ruler, Spline, Shapes, Box,
  BrickWall, TriangleRight, Radius, Diameter, CheckCheck,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MEASURE_TOOLS } from '@/lib/takeoffGeometry';
import { STAMPS } from '@/lib/drawingMarkups';

export const MARKUP_ICONS = {
  pen: PenLine, highlight: Highlighter, line: Minus, arrow: MoveUpRight, polyline: Waypoints, polygon: Pentagon,
  rect: Square, ellipse: Circle, cloud: Cloud, textbox: TextCursorInput, typewriter: Type, callout: MessageSquareText,
  note: StickyNote, stamp: Stamp,
};
export const MEASURE_ICONS = {
  length: Ruler, polylength: Spline, perimeter: Pentagon, area: Shapes, volume: Box, wall_area: BrickWall,
  angle: TriangleRight, radius: Radius, diameter: Diameter, count: MousePointerClick, bolt_count: Hexagon,
};

// Keyboard letters shown in tooltips — the same ones workspaceMenus binds.
export const MARKUP_KEYS = {
  pen: 'P', highlight: 'I', line: 'L', arrow: 'A', polyline: 'Shift+Y', polygon: 'Shift+O', rect: 'R', ellipse: 'E', cloud: 'C',
  textbox: 'T', typewriter: 'W', callout: 'Q', note: 'N', stamp: 'K',
};
export const MEASURE_KEYS = {
  length: 'Shift+L', polylength: 'Shift+P', perimeter: 'Shift+R', area: 'Shift+A', volume: 'Shift+V', wall_area: 'Shift+W',
  angle: 'Shift+G', radius: 'Shift+U', diameter: 'Shift+D', count: 'Shift+C', bolt_count: 'Shift+B',
};

function ToolButton({ icon: Icon, label, active, disabled, onClick, keys, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={keys ? `${label} (${keys})` : label}
      className={`h-7 min-w-7 px-1.5 inline-flex items-center justify-center gap-1 rounded text-xs transition-colors disabled:opacity-40 disabled:pointer-events-none ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground'}`}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
}

const Sep = () => <div className="w-px h-5 bg-border mx-1 flex-shrink-0" />;

// Main toolbar — file actions, undo/redo, navigation tools and zoom.
export function MainToolbar({ a }) {
  return (
    <div className="flex items-center gap-0.5 px-2 h-9 border-b bg-background overflow-x-auto">
      <ToolButton icon={FolderOpen} label="Open a drawing for this project" keys="Ctrl+O" onClick={a.openDrawing} />
      <ToolButton icon={Save} label="Save" keys="Ctrl+S" onClick={a.save} disabled={!a.hasSession} />
      <ToolButton icon={Printer} label="Print this page" keys="Ctrl+P" onClick={a.print} disabled={!a.hasFile} />
      <Sep />
      <ToolButton icon={Undo2} label="Undo" keys="Ctrl+Z" onClick={a.undo} disabled={!a.canUndo} />
      <ToolButton icon={Redo2} label="Redo" keys="Ctrl+Y" onClick={a.redo} disabled={!a.canRedo} />
      <Sep />
      <ToolButton icon={MousePointer2} label="Select" keys="V" active={a.isSelect} onClick={a.selectTool} />
      <ToolButton icon={Hand} label="Pan" keys="H" active={a.navTool === 'pan' && !a.anyToolLive} onClick={a.panTool} />
      <ToolButton icon={ZoomIn} label="Zoom tool (click to zoom in, Alt-click out, drag a box)" keys="Z" active={a.navTool === 'zoom' && !a.anyToolLive} onClick={a.zoomTool} />
      <Sep />
      <ToolButton icon={ZoomOut} label="Zoom out" keys="Ctrl+-" onClick={a.zoomOut} disabled={!a.hasFile} />
      <ToolButton icon={ZoomIn} label="Zoom in" keys="Ctrl+=" onClick={a.zoomIn} disabled={!a.hasFile} />
      <ToolButton icon={Maximize} label="Fit page" keys="Ctrl+0" onClick={a.fitPage} disabled={!a.hasFile} />
      <ToolButton icon={MoveHorizontal} label="Fit width" keys="Ctrl+2" onClick={a.fitWidth} disabled={!a.hasFile} />
      <ToolButton icon={RotateCw} label="Rotate view clockwise" keys="Ctrl+]" onClick={a.rotateView} disabled={!a.hasFile} />
    </div>
  );
}

// Markup + measure toolbar.
export function MarkupToolbar({ a }) {
  const markupIds = ['pen', 'highlight', 'line', 'arrow', 'polyline', 'polygon', 'rect', 'ellipse', 'cloud', 'textbox', 'typewriter', 'callout', 'note'];
  const stamp = STAMPS.find((s) => s.id === a.stampKind) || STAMPS[0];
  return (
    <div className="flex items-center gap-0.5 px-2 h-9 border-b bg-muted/20 overflow-x-auto">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1 flex-shrink-0">Markup</span>
      {markupIds.map((id) => (
        <ToolButton key={id} icon={MARKUP_ICONS[id]} label={a.markupLabel(id)} keys={MARKUP_KEYS[id]} active={a.markupTool === id} disabled={!a.hasFile} onClick={() => a.startMarkup(id)} />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={!a.hasFile}
            title={`Stamp — ${stamp.label} (K)`}
            className={`h-7 px-1.5 inline-flex items-center gap-1 rounded text-xs disabled:opacity-40 ${a.markupTool === 'stamp' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
          >
            <Stamp className="w-4 h-4" /><span className="text-[10px] font-semibold">{stamp.label}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {STAMPS.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => { a.setStampKind(s.id); a.startMarkup('stamp'); }} className="text-xs">
              <span className="inline-block border-2 px-1.5 py-0.5 font-bold text-[10px] mr-2" style={{ color: s.color, borderColor: s.color }}>{s.label}</span>
              IRONSIGHT stamp
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Sep />
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1 flex-shrink-0">Measure</span>
      <ToolButton icon={MEASURE_ICONS.count} label="Count" keys={MEASURE_KEYS.count} active={a.activeTool === 'count'} disabled={!a.hasFile} onClick={() => a.startCount('beam')} />
      <ToolButton icon={MEASURE_ICONS.bolt_count} label="Bolt Count" keys={MEASURE_KEYS.bolt_count} active={a.activeTool === 'bolt_count'} disabled={!a.hasFile} onClick={() => a.startCount('bolt')} />
      {Object.entries(MEASURE_TOOLS).map(([id, def]) => (
        <ToolButton key={id} icon={MEASURE_ICONS[id]} label={def.label} keys={MEASURE_KEYS[id]} active={a.activeTool === id} disabled={!a.hasFile} onClick={() => a.startMeasure(id)} />
      ))}
      {MEASURE_TOOLS[a.activeTool]?.input === 'circle' && (
        <div className="flex items-center gap-0.5 rounded-md border px-1 py-0.5 text-[11px] ml-1">
          <button type="button" className={`px-1.5 py-0.5 rounded ${a.circleMode !== 'three' ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => a.setCircleMode('center')}>Center + edge</button>
          <button type="button" className={`px-1.5 py-0.5 rounded ${a.circleMode === 'three' ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => a.setCircleMode('three')}>3 points</button>
        </div>
      )}
      <Sep />
      <ToolButton icon={Crosshair} label="Calibrate" keys="Shift+K" active={a.calibrationMode && a.pickPurpose === 'calibrate'} disabled={!a.hasFile} onClick={a.calibrate}>
        <span className="hidden xl:inline">Calibrate</span>
      </ToolButton>
      <ToolButton icon={CheckCheck} label="Check scale" active={a.calibrationMode && a.pickPurpose === 'check'} disabled={!a.hasFile || !a.pageCalibrated} onClick={a.checkScale} />
      <ToolButton icon={ScanSearch} label="Find symbols" keys="Shift+F" active={a.symbolPicking} disabled={!a.hasFile} onClick={a.findSymbols} />
    </div>
  );
}
