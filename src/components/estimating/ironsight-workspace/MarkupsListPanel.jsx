import React, { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FileDown, Lock, AlertTriangle } from 'lucide-react';
import { toolLabel, measurementSummary } from '@/lib/takeoffGeometry';
import { formatFeetInchesFraction } from '@/lib/fractionInches';
import { formatColumnValue } from '@/lib/takeoffColumns';
import { markupTypeLabel, markupSummary } from '@/lib/drawingMarkups';
import { REVIEW_FLAG_TEXT } from '@/lib/takeoffCarryForward';
import { exportRowsToCsv } from '@/lib/csvExport';

const sel = 'h-7 rounded border border-input bg-background px-1 text-xs';

// One list entry per takeoff row (type = its tool) and per general markup
// (type "Markup"). Custom/formula columns apply to takeoff rows only.
export function buildListEntries(rows, markups, computeRow, columns) {
  const out = [];
  rows.filter((r) => r.source === 'measurement').forEach((r) => {
    const isCount = r.tool === 'count' || r.tool === 'bolt_count';
    const computed = computeRow ? computeRow(r) : { values: {}, errors: {} };
    out.push({
      key: `r:${r._key}`,
      kind: 'row',
      item: r,
      type: toolLabel(r.tool),
      subtype: '',
      subject: r.label || [r.shape_type, r.size_designation].filter(Boolean).join(' ') || toolLabel(r.tool),
      page: Number(r.page_number || 1),
      measured: isCount ? `${r.points?.length || r.quantity || 0} pcs` : (measurementSummary(r, formatFeetInchesFraction) || '—'),
      qty: Number(r.quantity || 0),
      color: r.color || '#94a3b8',
      author: r.author || '',
      date: r.created_at || '',
      status: r.review_flag ? REVIEW_FLAG_TEXT : r.pushed_to_estimate ? 'Pushed' : (r.is_accepted === false ? 'Not accepted' : ''),
      locked: Boolean(r.locked),
      values: computed.values || {},
      errors: computed.errors || {},
    });
  });
  markups.forEach((m) => {
    out.push({
      key: `m:${m.id}`,
      kind: 'markup',
      item: m,
      type: 'Markup',
      subtype: markupTypeLabel(m.type),
      subject: m.subject || markupTypeLabel(m.type),
      page: Number(m.page_number || 1),
      measured: markupSummary(m),
      qty: null,
      color: m.style?.color || '#94a3b8',
      author: m.author || '',
      date: m.updated_at || m.created_at || '',
      status: '',
      locked: Boolean(m.locked),
      values: {},
      errors: {},
    });
  });
  return out.map((e) => ({ ...e, columns }));
}

const BASE_COLS = [
  { id: 'type', label: 'Type' },
  { id: 'subject', label: 'Subject' },
  { id: 'page', label: 'Page', num: true },
  { id: 'measured', label: 'Measured / text' },
  { id: 'qty', label: 'Qty', num: true },
  { id: 'author', label: 'Author' },
  { id: 'date', label: 'Date' },
  { id: 'status', label: 'Status' },
];

// Bottom panel → Markups List: every takeoff row and drawing markup in one
// sortable, filterable table, with the company/job custom columns. Click a
// row to select it and zoom the drawing to it (that's its source);
// Ctrl/Shift-click adds to the selection.
export default function MarkupsListPanel({ entries, columns = [], selectedKeys = [], currentPage, onRowClick, takeoffName }) {
  const [sort, setSort] = useState({ id: 'page', dir: 'asc' });
  const [text, setText] = useState('');
  const [kind, setKind] = useState('all');
  const [scope, setScope] = useState('all');
  const [typeFilter, setTypeFilter] = useState('');

  const types = useMemo(() => Array.from(new Set(entries.map((e) => (e.kind === 'markup' ? `Markup: ${e.subtype}` : e.type)))).sort(), [entries]);
  const selected = new Set(selectedKeys);

  const visible = useMemo(() => {
    const q = text.trim().toLowerCase();
    const list = entries.filter((e) => {
      if (kind === 'takeoff' && e.kind !== 'row') return false;
      if (kind === 'markup' && e.kind !== 'markup') return false;
      if (scope === 'page' && e.page !== currentPage) return false;
      if (typeFilter && (e.kind === 'markup' ? `Markup: ${e.subtype}` : e.type) !== typeFilter) return false;
      if (q && ![e.type, e.subtype, e.subject, e.measured, e.author, e.status, e.item.notes, e.item.comment].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const col = columns.find((c) => c.id === sort.id);
    const val = (e) => {
      if (col) return e.values[col.alias];
      if (sort.id === 'type') return e.kind === 'markup' ? `Markup ${e.subtype}` : e.type;
      return e[sort.id];
    };
    return list.slice().sort((a, b) => {
      const av = val(a); const bv = val(b);
      const cmp = typeof av === 'number' || typeof bv === 'number' ? (Number(av) || 0) - (Number(bv) || 0) : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [entries, kind, scope, typeFilter, text, sort, columns, currentPage]);

  const clickHeader = (id) => setSort((s) => (s.id === id ? { id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { id, dir: 'asc' }));
  const arrow = (id) => (sort.id === id ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  const exportCsv = () => exportRowsToCsv({
    filename: `${takeoffName || 'takeoff'}_markups_list`,
    columns: [...BASE_COLS.map((c) => c.label), ...columns.map((c) => (c.unit ? `${c.name} (${c.unit})` : c.name))],
    rows: visible.map((e) => [
      e.kind === 'markup' ? `Markup (${e.subtype})` : e.type, e.subject, e.page, e.measured, e.qty ?? '', e.author, e.date, e.status,
      ...columns.map((c) => (e.kind === 'row' ? (e.errors[c.alias] ? `#ERROR: ${e.errors[c.alias]}` : (e.values[c.alias] ?? '')) : '')),
    ]),
  });

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1 border-b text-xs flex-shrink-0">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter…" className="h-7 w-44 text-xs" />
        <select className={sel} value={kind} onChange={(e) => setKind(e.target.value)} title="Which items">
          <option value="all">Takeoff + markups</option>
          <option value="takeoff">Takeoff rows only</option>
          <option value="markup">Drawing markups only</option>
        </select>
        <select className={sel} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} title="Type">
          <option value="">All types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className={sel} value={scope} onChange={(e) => setScope(e.target.value)} title="Pages">
          <option value="all">All pages</option>
          <option value="page">This page ({currentPage})</option>
        </select>
        <span className="text-muted-foreground">{visible.length} of {entries.length}</span>
        <Button size="sm" variant="outline" className="h-7 text-xs ml-auto" onClick={exportCsv} disabled={!visible.length}><FileDown className="w-3 h-3 mr-1" />CSV</Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-left sticky top-0 z-10">
            <tr>
              <th className="p-1.5 w-4" />
              {BASE_COLS.map((c) => (
                <th key={c.id} className={`p-1.5 font-medium cursor-pointer select-none whitespace-nowrap ${c.num ? 'text-right' : ''}`} onClick={() => clickHeader(c.id)}>{c.label}{arrow(c.id)}</th>
              ))}
              {columns.map((c) => (
                <th key={c.id} className="p-1.5 font-medium cursor-pointer select-none whitespace-nowrap" onClick={() => clickHeader(c.id)} title={c.type === 'formula' ? `= ${c.formula}` : c.name}>
                  {c.name}{c.unit ? ` (${c.unit})` : ''}{arrow(c.id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr
                key={e.key}
                onClick={(ev) => onRowClick(e, { additive: ev.ctrlKey || ev.metaKey || ev.shiftKey })}
                className={`border-t cursor-pointer hover:bg-muted/40 ${selected.has(e.key) ? 'bg-primary/10' : ''}`}
                title="Click to find it on the drawing"
              >
                <td className="p-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full border border-black/10" style={{ backgroundColor: e.color }} /></td>
                <td className="p-1.5 whitespace-nowrap">{e.kind === 'markup' ? <><span className="font-medium">Markup</span><span className="text-muted-foreground"> · {e.subtype}</span></> : e.type}</td>
                <td className="p-1.5 whitespace-nowrap max-w-[220px] truncate">{e.locked && <Lock className="w-3 h-3 inline mr-1 text-slate-500" />}{e.subject}</td>
                <td className="p-1.5 text-right">{e.page}</td>
                <td className="p-1.5 max-w-[260px] truncate">{e.measured}</td>
                <td className="p-1.5 text-right font-mono">{e.qty ?? '—'}</td>
                <td className="p-1.5 whitespace-nowrap">{e.author || '—'}</td>
                <td className="p-1.5 whitespace-nowrap">{e.date ? new Date(e.date).toLocaleDateString() : '—'}</td>
                <td className="p-1.5 whitespace-nowrap">{e.status ? <span className={e.status === REVIEW_FLAG_TEXT ? 'text-amber-700 flex items-center gap-1' : ''}>{e.status === REVIEW_FLAG_TEXT && <AlertTriangle className="w-3 h-3" />}{e.status}</span> : ''}</td>
                {columns.map((c) => (
                  <td key={c.id} className="p-1.5 whitespace-nowrap font-mono text-right">
                    {e.kind !== 'row' ? '' : e.errors[c.alias] ? <span className="text-red-600" title={e.errors[c.alias]}>error</span> : formatColumnValue(c, e.values[c.alias]) || '—'}
                  </td>
                ))}
              </tr>
            ))}
            {!visible.length && (
              <tr><td colSpan={BASE_COLS.length + columns.length + 1} className="p-4 text-center text-muted-foreground">{entries.length ? 'Nothing matches the filter.' : 'No markups yet — measure or mark up the drawing.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
