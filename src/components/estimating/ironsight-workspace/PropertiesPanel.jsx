import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Lock, LockOpen, Trash2, Crosshair, Type, StickyNote } from 'lucide-react';
import { markupTypeLabel, isTextMarkup, STAMPS } from '@/lib/drawingMarkups';
import { toolLabel, measurementSummary } from '@/lib/takeoffGeometry';
import { formatFeetInchesFraction } from '@/lib/fractionInches';

const Row = ({ label, children }) => (
  <label className="block space-y-0.5">
    <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    {children}
  </label>
);
const fmtDate = (s) => (s ? new Date(s).toLocaleString() : '—');
const ta = 'w-full rounded-md border border-input bg-background px-2 py-1 text-xs resize-y';

function MarkupProps({ m, onChange, onEditText }) {
  const locked = m.locked;
  return (
    <div className="space-y-2 text-xs">
      <p className="text-sm font-semibold">{markupTypeLabel(m.type)} <span className="text-[11px] font-normal text-muted-foreground">— drawing markup, not a takeoff quantity</span></p>
      <Row label="Subject">
        <Input className="h-8 text-xs" value={m.subject || ''} disabled={locked} onChange={(e) => onChange({ subject: e.target.value })} />
      </Row>
      {isTextMarkup(m) && (
        <Row label="Text">
          <textarea className={`${ta} h-20`} value={m.text || ''} disabled={locked} onChange={(e) => onChange({ text: e.target.value })} />
          {!locked && <Button size="sm" variant="outline" className="h-7 text-xs mt-1" onClick={onEditText}><Type className="w-3 h-3 mr-1" />Edit on the drawing</Button>}
        </Row>
      )}
      {m.type === 'stamp' && (
        <Row label="Stamp">
          <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={m.stamp || 'approved'} disabled={locked} onChange={(e) => onChange({ stamp: e.target.value, style: { ...m.style, color: STAMPS.find((s) => s.id === e.target.value)?.color || m.style?.color } })}>
            {STAMPS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Row>
      )}
      <Row label={m.type === 'note' ? 'Note' : 'Comment'}>
        <textarea className={`${ta} h-16`} value={m.comment || ''} disabled={locked} onChange={(e) => onChange({ comment: e.target.value })} placeholder="Add a comment…" />
        {m.type === 'note' && !locked && <Button size="sm" variant="outline" className="h-7 text-xs mt-1" onClick={onEditText}><StickyNote className="w-3 h-3 mr-1" />Open the note</Button>}
      </Row>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span>Page</span><span className="text-foreground">{m.page_number}</span>
        <span>Author</span><span className="text-foreground">{m.author || '—'}</span>
        <span>Created</span><span className="text-foreground">{fmtDate(m.created_at)}</span>
        <span>Changed</span><span className="text-foreground">{fmtDate(m.updated_at)}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">Color, fill, line and font are on the properties strip above the drawing.</p>
    </div>
  );
}

function RowProps({ row, onRowChange, onShowRow }) {
  const isCount = row.tool === 'count' || row.tool === 'bolt_count';
  const measured = isCount ? `${row.points?.length || row.quantity || 0} pcs` : (measurementSummary(row, formatFeetInchesFraction) || '—');
  const nPts = row.points?.length || row.polygon_points?.length || row.polyline_points?.length || row.angle_points?.length || (row.point1 && row.point2 ? 2 : 0);
  return (
    <div className="space-y-2 text-xs">
      <p className="text-sm font-semibold">{toolLabel(row.tool)} <span className="text-[11px] font-normal text-muted-foreground">— takeoff row</span></p>
      <Row label="Label">
        <Input className="h-8 text-xs" value={row.label || ''} disabled={row.locked} onChange={(e) => onRowChange('label', e.target.value)} />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Shape"><Input className="h-8 text-xs" value={row.shape_type || ''} disabled={row.locked} onChange={(e) => onRowChange('shape_type', e.target.value)} /></Row>
        <Row label="Size"><Input className="h-8 text-xs" value={row.size_designation || ''} disabled={row.locked} onChange={(e) => onRowChange('size_designation', e.target.value)} /></Row>
        <Row label={isCount ? 'Quantity (from marks)' : 'Quantity'}>
          <Input className="h-8 text-xs" type="number" min={0} value={row.quantity ?? 1} disabled={row.locked || isCount} onChange={(e) => onRowChange('quantity', Number(e.target.value) || 0)} />
        </Row>
        <Row label="Phase / area"><Input className="h-8 text-xs" value={row.phase || ''} disabled={row.locked} onChange={(e) => onRowChange('phase', e.target.value)} /></Row>
      </div>
      <Row label="Notes">
        <textarea className={`${ta} h-14`} value={row.notes || ''} disabled={row.locked} onChange={(e) => onRowChange('notes', e.target.value)} />
      </Row>
      <div className="rounded-md border bg-muted/30 p-2 space-y-1">
        <p className="text-[11px] text-muted-foreground">Measured</p>
        <button type="button" className="text-sm font-semibold hover:underline" onClick={onShowRow} title="Show it on the drawing">{measured}</button>
        <p className="text-[11px] text-muted-foreground">
          {isCount ? `${nPts} mark${nPts === 1 ? '' : 's'} on page ${row.page_number || 1}` : `From ${nPts} point${nPts === 1 ? '' : 's'} on page ${row.page_number || 1}`}
          {row.scale_label ? ` at ${row.scale_label} (${row.scale_source === 'viewport' ? 'viewport scale' : row.scale_source === 'legacy' ? 'older whole-set scale' : 'page scale'})` : ''}
          {row.slope_factor && row.slope_factor !== 1 ? ` × slope ${Number(row.slope_factor).toFixed(4)}` : ''}
        </p>
        {row.unit_weight_lbs_per_ft > 0 && <p className="text-[11px] text-muted-foreground">{row.unit_weight_lbs_per_ft} lb/ft</p>}
      </div>
    </div>
  );
}

// Right side bar → Properties. One selected item: its editable fields
// (general markup or takeoff row). Several: a count with lock/delete.
// Nothing: the page's scale and notes.
export default function PropertiesPanel({
  selected, onMarkupChange, onRowChange, onDelete, onToggleLock, onEditText, onShowRow,
  pageNum, numPages, pageScaleText, onOpenScale, pageNote, onPageNoteChange,
}) {
  if (!selected.length) {
    return (
      <div className="space-y-3 text-xs">
        <div className="rounded-md border p-2 space-y-1">
          <p className="font-semibold">Page {pageNum} of {numPages}</p>
          <button type="button" className="text-primary hover:underline text-left" onClick={onOpenScale}>Scale: {pageScaleText}</button>
        </div>
        <Row label={`Notes for page ${pageNum}`}>
          <textarea key={pageNum} className={`${ta} h-32`} value={pageNote || ''} onChange={(e) => onPageNoteChange(e.target.value)} placeholder="Notes for this page…" />
        </Row>
        <p className="text-[11px] text-muted-foreground">Select a markup on the drawing or in the Markups List to see and edit its properties.</p>
      </div>
    );
  }
  const anyLocked = selected.some((s) => s.item.locked);
  return (
    <div className="space-y-3">
      {selected.length === 1 ? (
        selected[0].kind === 'markup'
          ? <MarkupProps m={selected[0].item} onChange={(patch) => onMarkupChange(selected[0].item.id, patch)} onEditText={() => onEditText(selected[0].item.id)} />
          : <RowProps row={selected[0].item} onRowChange={(f, v) => onRowChange(selected[0].item._key, f, v)} onShowRow={() => onShowRow(selected[0])} />
      ) : (
        <p className="text-sm font-semibold">{selected.length} items selected</p>
      )}
      <div className="flex flex-wrap gap-2 pt-1 border-t">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onToggleLock}>
          {anyLocked ? <><LockOpen className="w-3 h-3 mr-1" />Unlock</> : <><Lock className="w-3 h-3 mr-1" />Lock</>}
        </Button>
        {selected.length === 1 && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onShowRow(selected[0])}><Crosshair className="w-3 h-3 mr-1" />Zoom to</Button>
        )}
        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={onDelete} disabled={anyLocked}><Trash2 className="w-3 h-3 mr-1" />Delete</Button>
      </div>
    </div>
  );
}
