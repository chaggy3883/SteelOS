import React from 'react';
import { Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Lock } from 'lucide-react';
import { FONT_FAMILIES } from '@/lib/drawingMarkups';

const sel = 'h-7 rounded border border-input bg-background px-1 text-xs';
const LINE_WIDTHS = [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
const FONT_SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

function Toggle({ on, onClick, title, children }) {
  return (
    <button type="button" title={title} onClick={onClick} className={`h-7 w-7 inline-flex items-center justify-center rounded ${on ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
      {children}
    </button>
  );
}

// Properties strip under the toolbars: color, fill, opacity, line width,
// line style and — for text markups — font, size, bold/italic/underline and
// alignment. Edits the selected markup(s), or, with a markup tool live and
// nothing selected, the style the next markup will be drawn with.
export default function MarkupPropertiesStrip({ title, style, showText, showFill = true, showLine = true, locked, onChange }) {
  if (!style) return null;
  const set = (patch) => { if (!locked) onChange(patch); };
  return (
    <div className="flex items-center gap-2 px-2 h-9 border-b bg-background overflow-x-auto text-xs">
      <span className="font-semibold text-muted-foreground whitespace-nowrap">{title}</span>
      {locked && <span className="flex items-center gap-1 text-slate-500"><Lock className="w-3 h-3" />Locked</span>}
      <label className="flex items-center gap-1" title="Line / border color">
        Color
        <input type="color" value={style.color || '#dc2626'} disabled={locked} onChange={(e) => set({ color: e.target.value })} className="h-6 w-7 p-0 border rounded" />
      </label>
      {showFill && (
        <label className="flex items-center gap-1" title="Fill color">
          Fill
          <input type="checkbox" checked={Boolean(style.fill_color)} disabled={locked} onChange={(e) => set({ fill_color: e.target.checked ? (style.fill_color || '#ffffff') : '' })} />
          <input type="color" value={style.fill_color || '#ffffff'} disabled={locked || !style.fill_color} onChange={(e) => set({ fill_color: e.target.value })} className="h-6 w-7 p-0 border rounded disabled:opacity-40" />
        </label>
      )}
      <label className="flex items-center gap-1" title="Opacity">
        Opacity
        <select className={sel} value={Math.round((style.opacity ?? 1) * 100)} disabled={locked} onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}>
          {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => <option key={v} value={v}>{v}%</option>)}
        </select>
      </label>
      {showLine && (
        <>
          <label className="flex items-center gap-1" title="Line width (points)">
            Width
            <select className={sel} value={Number(style.line_width) || 0} disabled={locked} onChange={(e) => set({ line_width: Number(e.target.value) })}>
              {Array.from(new Set([...LINE_WIDTHS, Number(style.line_width) || 0])).sort((x, y) => x - y).map((v) => <option key={v} value={v}>{v} pt</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1" title="Line style">
            Style
            <select className={sel} value={style.line_style || 'solid'} disabled={locked} onChange={(e) => set({ line_style: e.target.value })}>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </label>
        </>
      )}
      {showText && (
        <>
          <div className="w-px h-5 bg-border" />
          <select className={sel} value={style.font_family || 'Helvetica'} disabled={locked} onChange={(e) => set({ font_family: e.target.value })} title="Font">
            {FONT_FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <select className={sel} value={Number(style.font_size) || 12} disabled={locked} onChange={(e) => set({ font_size: Number(e.target.value) })} title="Font size (points)">
            {Array.from(new Set([...FONT_SIZES, Number(style.font_size) || 12])).sort((x, y) => x - y).map((v) => <option key={v} value={v}>{v} pt</option>)}
          </select>
          <label className="flex items-center gap-1" title="Text color">
            Text
            <input type="color" value={style.text_color || '#111827'} disabled={locked} onChange={(e) => set({ text_color: e.target.value })} className="h-6 w-7 p-0 border rounded" />
          </label>
          <Toggle on={style.bold} title="Bold" onClick={() => set({ bold: !style.bold })}><Bold className="w-3.5 h-3.5" /></Toggle>
          <Toggle on={style.italic} title="Italic" onClick={() => set({ italic: !style.italic })}><Italic className="w-3.5 h-3.5" /></Toggle>
          <Toggle on={style.underline} title="Underline" onClick={() => set({ underline: !style.underline })}><Underline className="w-3.5 h-3.5" /></Toggle>
          <Toggle on={(style.align || 'left') === 'left'} title="Align left" onClick={() => set({ align: 'left' })}><AlignLeft className="w-3.5 h-3.5" /></Toggle>
          <Toggle on={style.align === 'center'} title="Center" onClick={() => set({ align: 'center' })}><AlignCenter className="w-3.5 h-3.5" /></Toggle>
          <Toggle on={style.align === 'right'} title="Align right" onClick={() => set({ align: 'right' })}><AlignRight className="w-3.5 h-3.5" /></Toggle>
          <label className="flex items-center gap-1" title="Draw a border around the text">
            <input type="checkbox" checked={style.border !== false} disabled={locked} onChange={(e) => set({ border: e.target.checked })} />Border
          </label>
        </>
      )}
    </div>
  );
}
