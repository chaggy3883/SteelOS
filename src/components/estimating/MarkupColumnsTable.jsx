import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Columns3, Plus, Pencil, FileDown, AlertTriangle, X } from 'lucide-react';
import { coerceColumnValue, formatColumnValue, sumColumn, getBuiltInFieldValues } from '@/lib/takeoffColumns';
import { getFormulaReferences } from '@/lib/takeoffFormula';
import { toolLabel, measurementSummary } from '@/lib/takeoffGeometry';
import { formatFeetInchesFraction } from '@/lib/fractionInches';
import { exportRowsToCsv } from '@/lib/csvExport';
import { REVIEW_FLAG_TEXT } from '@/lib/takeoffCarryForward';
import CustomColumnDialog from '@/components/estimating/CustomColumnDialog';

const SUMMABLE = new Set(['number', 'formula', 'checkbox']);

const measuredText = (r) => (r.tool === 'count' || r.tool === 'bolt_count'
  ? `${r.points?.length || r.quantity || 0} pcs`
  : (measurementSummary(r, formatFeetInchesFraction) || '—'));

// A sample markup the column dialog tries a formula against — a 20' W18X35.
const SAMPLE_BUILT_INS = getBuiltInFieldValues({ tool: 'length', length_ft: 20, plan_length_ft: 20, slope_factor: 1, quantity: 1, unit_weight_lbs_per_ft: 35 });

// Per-markup view of the takeoff with the company tool set's columns plus
// this job's own. Typed columns are edited right in the cell (saved on the
// row as column_values[columnId]); formula columns recalculate on every
// render and can't be typed over. Click a row to find it on the drawing;
// click a formula value to see exactly what it was worked out from.
export default function MarkupColumnsTable({
  rows, columns, toolSetColumns = [], customColumns = [], computeRow, onRowsChange, onCustomColumnsChange, onRowClick, takeoffName,
}) {
  const [editing, setEditing] = useState(null); // { column | null }
  const [explain, setExplain] = useState(null); // { rowKey, alias }

  const markupRows = useMemo(() => rows.filter((r) => r.source === 'measurement' && r.is_accepted !== false), [rows]);
  const computed = useMemo(() => markupRows.map((r) => ({ row: r, ...computeRow(r) })), [markupRows, computeRow]);
  const companyIds = new Set(toolSetColumns.map((c) => c.id));
  const customIds = new Set(customColumns.map((c) => c.id));

  const setCell = (row, column, raw) => {
    // Numbers are kept as typed ("1." mid-entry) — computeColumnValues
    // coerces stored values every time it reads them.
    const value = column.type === 'number' ? raw : coerceColumnValue(column, raw);
    onRowsChange(rows.map((r) => (r._key === row._key ? { ...r, column_values: { ...(r.column_values || {}), [column.id]: value } } : r)));
  };

  const handleSaveColumn = (col) => {
    const exists = customColumns.some((c) => c.id === col.id);
    onCustomColumnsChange(exists ? customColumns.map((c) => (c.id === col.id ? col : c)) : [...customColumns, col]);
    setEditing(null);
  };

  const handleDeleteColumn = (col) => {
    onCustomColumnsChange(customColumns.filter((c) => c.id !== col.id));
    setEditing(null);
  };

  const handleExportCsv = () => {
    exportRowsToCsv({
      filename: `${takeoffName || 'takeoff'}_markups`,
      columns: ['Page', 'Tool', 'Label', 'Shape', 'Size', 'Measured', 'Qty', 'Weight (lb)', 'Review', ...columns.map((c) => (c.unit ? `${c.name} (${c.unit})` : c.name))],
      rows: computed.map(({ row, values, errors }) => [
        row.page_number || 1, toolLabel(row.tool), row.label || '', row.shape_type || '', row.size_designation || '',
        measuredText(row), values.Qty, Math.round(values.Weight || 0), row.review_flag ? REVIEW_FLAG_TEXT : '',
        ...columns.map((c) => (errors[c.alias] ? `#ERROR: ${errors[c.alias]}` : (values[c.alias] ?? ''))),
      ]),
    });
  };

  const explainRow = explain ? computed.find((c) => c.row._key === explain.rowKey) : null;
  const explainCol = explain ? columns.find((c) => c.alias === explain.alias) : null;

  const renderCell = (c, { row, values, errors }) => {
    if (c.type === 'formula') {
      const err = errors[c.alias];
      return (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExplain({ rowKey: row._key, alias: c.alias }); }}
          className={`w-full text-right font-mono hover:underline ${err ? 'text-red-600' : ''}`}
          title={err || 'Show how this was worked out'}
        >
          {err ? 'error' : formatColumnValue(c, values[c.alias]) || '—'}
        </button>
      );
    }
    const stored = row.column_values?.[c.id];
    const v = c.type === 'number' && stored !== undefined && stored !== null ? stored : values[c.alias];
    const stop = (e) => e.stopPropagation();
    if (c.type === 'checkbox') return <input type="checkbox" checked={Boolean(v)} onClick={stop} onChange={(e) => setCell(row, c, e.target.checked)} />;
    if (c.type === 'choice') {
      return (
        <select value={v ?? ''} onClick={stop} onChange={(e) => setCell(row, c, e.target.value)} className="h-7 w-full rounded border border-input bg-background px-1 text-xs">
          <option value="">—</option>
          {(c.choices || []).map((ch) => <option key={ch} value={ch}>{ch}</option>)}
        </select>
      );
    }
    return (
      <Input
        type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
        step="any"
        value={v ?? ''}
        onClick={stop}
        onChange={(e) => setCell(row, c, e.target.value)}
        className="h-7 text-xs min-w-20"
      />
    );
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="bg-muted/40 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Columns3 className="w-4 h-4" />Markup columns
          <span className="text-xs font-normal text-muted-foreground">
            {columns.length === 0 ? 'No custom columns yet' : `${columns.length} column${columns.length === 1 ? '' : 's'} · ${markupRows.length} markup${markupRows.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing({ column: null })}><Plus className="w-3.5 h-3.5 mr-1" />Add column</Button>
          <Button size="sm" variant="outline" onClick={handleExportCsv} disabled={markupRows.length === 0}><FileDown className="w-3.5 h-3.5 mr-1" />Export CSV</Button>
        </div>
      </div>

      {markupRows.length === 0 ? (
        <p className="text-xs text-muted-foreground p-3">Measure something on the drawing to fill in these columns.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/20 text-muted-foreground">
              <tr>
                <th className="text-left p-2 whitespace-nowrap">Page</th>
                <th className="text-left p-2 whitespace-nowrap">Markup</th>
                <th className="text-left p-2 whitespace-nowrap">Measured</th>
                <th className="text-right p-2 whitespace-nowrap">Weight</th>
                {columns.map((c) => (
                  <th key={c.id} className="text-left p-2 whitespace-nowrap">
                    <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => setEditing({ column: c })} title={c.type === 'formula' ? `= ${c.formula}` : 'Edit column'}>
                      {c.name}{c.unit ? ` (${c.unit})` : ''}
                      {companyIds.has(c.id) && !customIds.has(c.id) && <Badge variant="outline" className="text-[9px] px-1 py-0 leading-4">company</Badge>}
                      {companyIds.has(c.id) && customIds.has(c.id) && <Badge variant="outline" className="text-[9px] px-1 py-0 leading-4 text-amber-700 border-amber-300">changed for this job</Badge>}
                      <Pencil className="w-3 h-3 opacity-60" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {computed.map((cr) => (
                <tr key={cr.row._key} className="border-t cursor-pointer hover:bg-muted/40" onClick={() => onRowClick?.(cr.row)} title="Show on the drawing">
                  <td className="p-2 text-muted-foreground">{cr.row.page_number || 1}</td>
                  <td className="p-2 whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: cr.row.color || '#94a3b8' }} />
                    {cr.row.label || toolLabel(cr.row.tool)}
                    {cr.row.review_flag && (
                      <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0 leading-4 text-amber-700 border-amber-300">
                        <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />{REVIEW_FLAG_TEXT}
                      </Badge>
                    )}
                  </td>
                  <td className="p-2 whitespace-nowrap">{measuredText(cr.row)}</td>
                  <td className="p-2 text-right font-mono whitespace-nowrap" title={`${cr.values.TrueLength?.toFixed(2)} ft × ${cr.values.WtPerFt} lb/ft × ${cr.values.Qty}`}>
                    {cr.values.Weight ? `${Math.round(cr.values.Weight).toLocaleString()} lb` : '—'}
                  </td>
                  {columns.map((c) => <td key={c.id} className="p-1.5">{renderCell(c, cr)}</td>)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="p-2" colSpan={3}>Totals</td>
                <td className="p-2 text-right font-mono">{Math.round(sumColumn(computed, 'Weight')).toLocaleString()} lb</td>
                {columns.map((c) => (
                  <td key={c.id} className="p-2 text-right font-mono">
                    {SUMMABLE.has(c.type) ? formatColumnValue(c.type === 'checkbox' ? { ...c, type: 'number', decimals: 0 } : c, sumColumn(computed, c.alias)) : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {explainRow && explainCol && (
        <div className="border-t bg-muted/20 px-3 py-2 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{explainCol.name} for {explainRow.row.label || toolLabel(explainRow.row.tool)} (page {explainRow.row.page_number || 1})</p>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setExplain(null)}><X className="w-3 h-3" /></Button>
          </div>
          <p className="font-mono">= {explainCol.formula}</p>
          <ul className="font-mono text-muted-foreground">
            {getFormulaReferences(explainCol.formula).map((name) => {
              const key = Object.keys(explainRow.values).find((k) => k.toLowerCase() === name.toLowerCase()) || name;
              const v = explainRow.values[key];
              return <li key={name}>{key} = {typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 4 }) : String(v ?? '—')}</li>;
            })}
          </ul>
          <p>
            Result:{' '}
            {explainRow.errors[explainCol.alias]
              ? <span className="text-red-600">{explainRow.errors[explainCol.alias]}</span>
              : <span className="font-mono font-semibold">{formatColumnValue(explainCol, explainRow.values[explainCol.alias])}</span>}
          </p>
        </div>
      )}

      <CustomColumnDialog
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        column={editing?.column || null}
        allColumns={columns}
        isCompanyColumn={!!editing?.column && companyIds.has(editing.column.id)}
        sampleBuiltIns={SAMPLE_BUILT_INS}
        onSave={handleSaveColumn}
        onDelete={editing?.column && customIds.has(editing.column.id) ? handleDeleteColumn : undefined}
      />
    </div>
  );
}
