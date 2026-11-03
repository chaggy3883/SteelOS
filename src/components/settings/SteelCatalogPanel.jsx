import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { materialCatalogPermissions } from '@/lib/materialCatalogAccess';
import { createCatalogRecord, createCatalogRecords, deleteCatalogRecord, setAdminSteelWeight, updateCatalogRecord } from '@/lib/materialCatalogWrites';
import { findDuplicateDesignation, resolveSteelWeight, savedByText } from '@/lib/catalogSizeRules';
import { formatSetDate } from '@/lib/materialEntryMath';
import MathDrill from '@/components/estimating/MathDrill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, UploadCloud, Plus, Trash2, Ruler, AlertTriangle } from 'lucide-react';
import { SHAPE_CLASSES } from '@/data/steelShapeSelector';
import StockLengthOptionsModal from '@/components/settings/StockLengthOptionsModal';

// Round HSS/Pipe is a real product family this importer now accepts, but
// steelShapeSelector.js's SHAPE_CLASSES (shared with BlueprintTakeoff.jsx
// and FullTakeoff.jsx's dropdowns) isn't part of this fix's scope — so it's
// kept purely local to this panel's own catalog-list grouping and manual
// "Add Individual Size" picker, not exported or depended on elsewhere.
const PIPE_CLASS = { value: 'Pipe', label: 'Round HSS / Pipe', hoursPerTon: 1.0, sizes: [] };
const CATALOG_DISPLAY_CLASSES = [...SHAPE_CLASSES, PIPE_CLASS];

// Loose text -> canonical shape_class resolver for the bulk importer, since
// a pasted spreadsheet column will say things like "Wide Flange" or "W" or
// "W-Beam" for the same class. Falls back to the first class rather than
// dropping the row — an imported row assigned to the wrong class is still
// visible and correctable in the list below; a silently dropped row isn't.
function resolveShapeClass(text) {
  const normalized = String(text || '').trim().toLowerCase();
  const match = SHAPE_CLASSES.find((c) =>
    c.value.toLowerCase() === normalized ||
    c.label.toLowerCase().includes(normalized) ||
    normalized.includes(c.value.toLowerCase().split('-')[0])
  );
  return match ? match.value : SHAPE_CLASSES[0].value;
}

function parseBulkText(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    const cells = line.includes('\t') ? line.split('\t') : line.split(',');
    const [typeText, sizeText] = cells.map((c) => (c || '').trim());
    return { shape_class: resolveShapeClass(typeText), size_designation: sizeText || typeText };
  }).filter((row) => row.size_designation);
}

// Converts a mixed-number/fraction token like '1 1/4' or '1/2' into a decimal.
function parseFractionalInches(token) {
  const trimmed = String(token || '').trim();
  if (!trimmed) return null;
  let total = 0;
  for (const part of trimmed.split(/\s+/)) {
    if (part.includes('/')) {
      const [num, den] = part.split('/').map(Number);
      if (!den) return null;
      total += num / den;
    } else {
      const n = parseFloat(part);
      if (Number.isNaN(n)) return null;
      total += n;
    }
  }
  return total;
}

// Trims to 3 decimal places without leaving trailing zeros, so '1/2' -> '0.5'
// and '1 1/4' -> '1.25', matching the HSS0.5x0.5 / HSS1.25x1.25 label format.
function formatDecimal(n) {
  return String(Math.round(n * 1000) / 1000);
}

// Splits a size token into a dimension pair. Handles both a combined
// 'A x B' token (HSS/Unequal Angle size columns) and a single bare number
// (Equal Angle size column, where the same value serves both legs).
function splitDimensionPair(text) {
  const normalized = String(text || '').replace(/X/gi, 'x');
  if (normalized.includes('x')) {
    const [d1Text, d2Text] = normalized.split('x').map((s) => s.trim());
    const dimension1 = parseFractionalInches(d1Text);
    const dimension2 = parseFractionalInches(d2Text);
    if (dimension1 == null || dimension2 == null) return null;
    return { dimension1, dimension2 };
  }
  const single = parseFractionalInches(normalized.trim());
  if (single == null) return null;
  return { dimension1: single, dimension2: single };
}

// Shared forward-fill engine for every multi-column bulk importer below.
// Spreadsheets commonly leave the identity column (Size/Section/Thickness)
// blank on every row after the first for a repeating group (Excel's
// merged-cell look) — this sticks the last non-blank value in column 1
// across those blank rows before handing the row to mapRow(). Trimming is
// done per-cell, not on the raw line, so a genuinely blank leading column
// (a real tab/comma) survives the split instead of being eaten.
function parseForwardFillBulkText(text, mapRow) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  let stickyFirstCol = '';
  const rows = [];

  lines.forEach((line) => {
    const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => (c || '').trim());
    if (cells[0]) stickyFirstCol = cells[0];
    if (!stickyFirstCol) return;
    cells[0] = stickyFirstCol;

    const row = mapRow(cells);
    if (row) rows.push(row);
  });

  return rows;
}

// HSS Tubing (Sq/Rect) — Size in Inches, Gauge/Wall, Decimal Wall Thickness, Wt/Ft.
function parseHssBulkText(text) {
  return parseForwardFillBulkText(text, (cells) => {
    const [sizeText, , wallThicknessText, weightText] = cells;
    const parsedSize = splitDimensionPair(sizeText);
    if (!parsedSize) return null;
    const { dimension1, dimension2 } = parsedSize;
    const wallThicknessIn = parseFloat(wallThicknessText) || 0;
    // A real HSS product line has multiple wall thicknesses per outer
    // envelope (e.g. HSS34x10 at 0.75/0.875/1.0in wall) — a two-segment
    // "HSS{dim1}x{dim2}" label would collide across those rows, so wall
    // thickness is always a third label segment here, same as the seed
    // catalog's own "HSS8X8X1/2" convention.
    return {
      shape_class: 'HSS Tube',
      size_designation: `HSS${formatDecimal(dimension1)}x${formatDecimal(dimension2)}x${formatDecimal(wallThicknessIn)}`,
      dimension1,
      dimension2,
      wall_thickness_in: wallThicknessIn,
      weight_per_ft: parseFloat(weightText) || 0,
    };
  });
}

// Round HSS / Pipe — Size, Gauge, Decimal Wall Thickness, Wt/Ft (same 4
// columns as HSS Tubing, but a single diameter instead of a width/height pair).
function parsePipeBulkText(text) {
  return parseForwardFillBulkText(text, (cells) => {
    const [sizeText, , wallThicknessText, weightText] = cells;
    const size = parseFractionalInches(sizeText);
    if (size == null) return null;
    return {
      shape_class: 'Pipe',
      size_designation: `PIPE${formatDecimal(size)}`,
      dimension1: size,
      dimension2: null,
      wall_thickness_in: parseFloat(wallThicknessText) || 0,
      weight_per_ft: parseFloat(weightText) || 0,
    };
  });
}

// Channels (C-Shapes) — Section, Weight, Depth, Width, Thickness.
function parseChannelBulkText(text) {
  return parseForwardFillBulkText(text, (cells) => {
    const [sectionText, weightText, depthText, widthText, thicknessText] = cells;
    const section = parseFractionalInches(sectionText);
    if (section == null) return null;
    const weight = parseFloat(weightText) || 0;
    return {
      shape_class: 'C-Channel',
      size_designation: `C${formatDecimal(section)}x${formatDecimal(weight)}`,
      dimension1: parseFractionalInches(depthText),
      dimension2: parseFractionalInches(widthText),
      wall_thickness_in: parseFractionalInches(thicknessText) || 0,
      weight_per_ft: weight,
    };
  });
}

// Equal Leg Angles — Size, Thickness, Weight. Both legs share the Size value.
function parseEqualAngleBulkText(text) {
  return parseForwardFillBulkText(text, (cells) => {
    const [sizeText, thicknessText, weightText] = cells;
    const size = parseFractionalInches(sizeText);
    if (size == null) return null;
    return {
      shape_class: 'L-Angle',
      size_designation: `L${formatDecimal(size)}x${formatDecimal(size)}x${thicknessText}`,
      dimension1: size,
      dimension2: size,
      wall_thickness_in: parseFractionalInches(thicknessText) || 0,
      weight_per_ft: parseFloat(weightText) || 0,
    };
  });
}

// Unequal Leg Angles — Size (combined 'Dim1 x Dim2' token), Thickness, Weight.
function parseUnequalAngleBulkText(text) {
  return parseForwardFillBulkText(text, (cells) => {
    const [sizeText, thicknessText, weightText] = cells;
    const parsedSize = splitDimensionPair(sizeText);
    if (!parsedSize) return null;
    const { dimension1, dimension2 } = parsedSize;
    return {
      shape_class: 'L-Angle',
      size_designation: `L${formatDecimal(dimension1)}x${formatDecimal(dimension2)}x${thicknessText}`,
      dimension1,
      dimension2,
      wall_thickness_in: parseFractionalInches(thicknessText) || 0,
      weight_per_ft: parseFloat(weightText) || 0,
    };
  });
}

// Flat Bars & Plates — Thickness, Width, Weight per foot. Thickness is the
// sticky/forward-filled column, matching how plate sheets list one
// thickness against many widths below it.
function parsePlateBulkText(text) {
  return parseForwardFillBulkText(text, (cells) => {
    const [thicknessText, widthText, weightText] = cells;
    const width = parseFractionalInches(widthText);
    if (width == null) return null;
    return {
      shape_class: 'PL-Plate',
      size_designation: `PL${thicknessText}x${formatDecimal(width)}`,
      dimension1: parseFractionalInches(thicknessText) || 0,
      dimension2: width,
      wall_thickness_in: parseFractionalInches(thicknessText) || 0,
      weight_per_ft: parseFloat(weightText) || 0,
    };
  });
}

const IMPORT_DATASET_TYPES = [
  {
    value: 'wide-flange',
    label: 'W-Beam (Wide Flange)',
    parse: parseBulkText,
    hint: 'Paste Type and Size columns from Excel (tab or comma separated) — one row per line.',
    placeholder: 'W-Beam\tW12x40\nHSS Tube\tHSS6x6x1/4',
  },
  {
    value: 'hss-tubing',
    label: 'HSS Tubing (Sq/Rect)',
    parse: parseHssBulkText,
    hint: 'Paste Size in Inches, Gauge/Wall, Decimal Wall Thickness, and Weight Per Foot (LBS) columns — one row per line. Leave the Size column blank on repeat rows for the same size, it forward-fills automatically.',
    placeholder: '1/2 x 1/2\t16 Ga\t0.065\t0.42\n\t14 Ga\t0.083\t0.51\n1 1/4 X 1 1/4\t14 Ga\t0.083\t1.35',
  },
  {
    value: 'round-pipe',
    label: 'Round HSS / Pipe',
    parse: parsePipeBulkText,
    hint: 'Paste Size, Gauge, Decimal Wall Thickness, and Weight Per Foot columns — one row per line. Blank Size cells forward-fill.',
    placeholder: '2.5\t16 Ga\t0.065\t1.61\n\t14 Ga\t0.083\t2.02',
  },
  {
    value: 'channels',
    label: 'Channels (C-Shapes)',
    parse: parseChannelBulkText,
    hint: 'Paste Section, Weight, Depth, Width, and Thickness columns — one row per line. Blank Section cells forward-fill.',
    placeholder: '10\t30\t10\t3\t0.673\n12\t25\t12\t3.05\t0.501',
  },
  {
    value: 'equal-angles',
    label: 'Equal Leg Angles',
    parse: parseEqualAngleBulkText,
    hint: 'Paste Size, Thickness, and Weight columns — one row per line. Blank Size cells forward-fill.',
    placeholder: '4\t1/4\t6.6\n\t3/8\t9.8',
  },
  {
    value: 'unequal-angles',
    label: 'Unequal Leg Angles',
    parse: parseUnequalAngleBulkText,
    hint: "Paste Size (as 'Dim1 x Dim2'), Thickness, and Weight columns — one row per line. Blank Size cells forward-fill.",
    placeholder: '6 x 4\t3/8\t11.7\n\t1/2\t15.3',
  },
  {
    value: 'plates',
    label: 'Flat Bars & Plates',
    parse: parsePlateBulkText,
    hint: 'Paste Thickness, Width, and Weight Per Foot columns — one row per line. Blank Thickness cells forward-fill.',
    placeholder: '1/2\t12\t20.4\n\t16\t27.2',
  },
];

// One steel_catalog row edited in place: size, dimensions and lb/ft each save
// when their box loses focus (admin only — materialCatalogWrites.js, and
// localData.js checks again). The lb/ft drills down to who set it and when.
function SteelRow({ row, siblings, canEdit, onUpdated, onRemoved, onStockLengths }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const val = (field) => (draft[field] ?? (row[field] != null ? String(row[field]) : ''));
  const setField = (field, v) => setDraft((d) => ({ ...d, [field]: v }));
  const clear = (field) => setDraft((d) => { const next = { ...d }; delete next[field]; return next; });

  const run = async (fn, label) => {
    setBusy(true);
    try {
      onUpdated(await fn());
    } catch (e) {
      toast({ title: `Couldn't save ${label}`, description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const commitDesignation = () => {
    const v = (draft.size_designation ?? row.size_designation).trim();
    clear('size_designation');
    if (v === row.size_designation) return;
    if (!v) { toast({ title: 'A size can\'t be blank', variant: 'destructive' }); return; }
    const dup = findDuplicateDesignation(v, siblings.filter((r) => r.id !== row.id).map((r) => r.size_designation));
    if (dup) { toast({ title: `"${dup}" is already in ${row.shape_class}`, variant: 'destructive' }); return; }
    run(() => updateCatalogRecord('steel_catalog', row.id, { size_designation: v }), 'the size');
  };

  const commitNumber = (field, label) => {
    if (draft[field] == null) return;
    const raw = draft[field].trim();
    clear(field);
    const n = raw === '' ? null : Number(raw);
    if (n != null && !(n >= 0)) { toast({ title: `${label} must be a number`, variant: 'destructive' }); return; }
    if (n === (row[field] ?? null)) return;
    if (field === 'weight_per_ft') run(() => setAdminSteelWeight(row, n), 'the weight');
    else run(() => updateCatalogRecord('steel_catalog', row.id, { [field]: n }), label);
  };

  const handleDelete = async () => {
    if (!confirm(`Remove ${row.size_designation} from the catalog? Its stock lengths stay on file but won't be reachable.`)) return;
    setBusy(true);
    try {
      await deleteCatalogRecord('steel_catalog', row.id);
      onRemoved(row.id);
    } catch (e) {
      toast({ title: 'Failed to remove size', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const fallback = row.weight_per_ft > 0 ? null : resolveSteelWeight(row.size_designation, []);
  const weightLines = row.weight_per_ft > 0
    ? [`${row.weight_per_ft} lb/ft stored on ${row.size_designation}`, row.weight_set_by ? savedByText(row) : 'Entered with the catalog row (no who/when recorded)', row.weight_source ? `Source: ${row.weight_source}` : '']
    : [fallback ? `Nothing stored — takeoffs use ${fallback.text}` : 'Nothing stored and no AISC match — weight needed'];
  const numberCell = (field, label, placeholder) => (
    <Input type="number" min={0} step="any" value={val(field)} onChange={(e) => setField(field, e.target.value)} onBlur={() => commitNumber(field, label)} disabled={!canEdit || busy} placeholder={placeholder} className="h-7 text-xs w-20" />
  );

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-2 py-1.5 text-xs text-muted-foreground whitespace-nowrap">{row.shape_class}</td>
      <td className="px-2 py-1.5">
        <Input value={val('size_designation')} onChange={(e) => setField('size_designation', e.target.value)} onBlur={commitDesignation} disabled={!canEdit || busy} className="h-7 text-xs font-mono min-w-[8rem]" />
      </td>
      <td className="px-2 py-1.5">{numberCell('dimension1', 'Dim 1', 'in')}</td>
      <td className="px-2 py-1.5">{numberCell('dimension2', 'Dim 2', 'in')}</td>
      <td className="px-2 py-1.5">{numberCell('wall_thickness_in', 'Wall', 'in')}</td>
      <td className="px-2 py-1.5">{numberCell('weight_per_ft', 'Weight', 'lb/ft')}</td>
      <td className="px-2 py-1.5 text-xs">
        <MathDrill
          value={row.weight_per_ft > 0 ? (row.weight_source === 'typed' || row.weight_source === 'admin' ? 'Saved weight' : 'Stored') : fallback ? (fallback.source === 'aisc' ? 'AISC v16.0' : 'Catalog') : 'Weight needed'}
          title={`${row.size_designation} weight`}
          lines={weightLines}
          align="start"
          className={row.weight_per_ft > 0 || fallback ? '' : 'text-amber-700'}
        />
      </td>
      <td className="px-2 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
        {row.is_custom ? 'custom' : 'seed'}{row.created_by ? ` · ${row.created_by}` : ''}{row.created_date ? ` · ${formatSetDate(row.created_date)}` : ''}
      </td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onStockLengths(row)} title="Stock lengths and costs"><Ruler className="w-3.5 h-3.5" /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!canEdit || busy} onClick={handleDelete} title="Remove"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
      </td>
    </tr>
  );
}

// IRONSIGHT's steel_catalog (the 5 shape classes + Pipe): bulk import, add
// one size, and every row editable in place — size, dimensions, lb/ft (with
// who/when), stock lengths and costs. Shown on the Material Catalog page and
// the Admin page's Steel Inventory Catalog tab. Read-only unless the session
// can edit the material catalog (admin, or super_admin working as a company).
export default function SteelCatalogPanel({ onCatalogChange }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const perms = materialCatalogPermissions(user?.roles || user?.user?.roles || []);
  const canEdit = perms.canEdit;
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bulkText, setBulkText] = useState('');
  const [importDatasetType, setImportDatasetType] = useState('wide-flange');
  const [importing, setImporting] = useState(false);
  const [newClass, setNewClass] = useState(SHAPE_CLASSES[0].value);
  const [newSizeId, setNewSizeId] = useState('');
  const [savingSize, setSavingSize] = useState(false);
  const [stockLengthItem, setStockLengthItem] = useState(null);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [weightFilter, setWeightFilter] = useState('all');
  const [limit, setLimit] = useState(150);

  // Keeps the Material Catalog page's copy (weights for its size lists) current.
  useEffect(() => { if (!loading) onCatalogChange?.(catalog); }, [catalog, loading]);

  useEffect(() => { loadCatalog(); }, []);

  const loadCatalog = async () => {
    setLoading(true);
    try {
      const rows = await db.entities.steel_catalog.list('shape_class', 10000);
      setCatalog(rows);
    } catch (e) {
      toast({ title: 'Failed to load steel catalog', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return catalog
      .filter((row) => (classFilter === 'all' || row.shape_class === classFilter))
      .filter((row) => !needle || String(row.size_designation || '').toLowerCase().includes(needle))
      .filter((row) => {
        if (weightFilter === 'has_weight') return row.weight_per_ft > 0 || !!resolveSteelWeight(row.size_designation, []);
        if (weightFilter === 'needed') return !(row.weight_per_ft > 0) && !resolveSteelWeight(row.size_designation, []);
        if (weightFilter === 'from_takeoff') return row.created_from === 'ironsight' || row.created_from === 'takeoff';
        return true;
      })
      .sort((a, b) => String(a.shape_class).localeCompare(String(b.shape_class)) || String(a.size_designation).localeCompare(String(b.size_designation)));
  }, [catalog, search, classFilter, weightFilter]);

  const handleBulkImport = async () => {
    const activeDataset = IMPORT_DATASET_TYPES.find((d) => d.value === importDatasetType) || IMPORT_DATASET_TYPES[0];
    const parsedRows = activeDataset.parse(bulkText);
    if (parsedRows.length === 0) {
      toast({
        title: 'Nothing to import',
        description: `Paste the columns described for "${activeDataset.label}" first.`,
        variant: 'destructive',
      });
      return;
    }
    setImporting(true);
    try {
      await createCatalogRecords('steel_catalog', parsedRows.map((r) => ({
        item_id: `STL-${r.shape_class.replace(/\s+/g, '').toUpperCase()}-${r.size_designation.replace(/[^A-Z0-9]/gi, '')}`,
        shape_class: r.shape_class,
        size_designation: r.size_designation,
        is_custom: true,
        ...(r.dimension1 != null ? { dimension1: r.dimension1, dimension2: r.dimension2, wall_thickness_in: r.wall_thickness_in, weight_per_ft: r.weight_per_ft, weight_source: 'import' } : {}),
      })));
      toast({ title: `Imported ${parsedRows.length} size(s)` });
      setBulkText('');
      loadCatalog();
    } catch (e) {
      toast({ title: 'Bulk import failed', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  const handleAddSize = async () => {
    if (!newSizeId.trim()) {
      toast({ title: 'Enter a Custom Size ID first', variant: 'destructive' });
      return;
    }
    const dup = findDuplicateDesignation(newSizeId.trim(), catalog.filter((r) => r.shape_class === newClass).map((r) => r.size_designation));
    if (dup) {
      toast({ title: `"${dup}" is already in ${newClass}`, variant: 'destructive' });
      return;
    }
    setSavingSize(true);
    try {
      await createCatalogRecord('steel_catalog', {
        item_id: `STL-${newClass.replace(/\s+/g, '').toUpperCase()}-${newSizeId.trim().replace(/[^A-Z0-9]/gi, '')}`,
        shape_class: newClass,
        size_designation: newSizeId.trim(),
        is_custom: true,
      });
      toast({ title: 'Size added to catalog' });
      setNewSizeId('');
      loadCatalog();
    } catch (e) {
      toast({ title: 'Failed to add size', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setSavingSize(false);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      {perms.readOnly && (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 text-xs flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          You&apos;re signed in as the platform operator. The steel catalog belongs to one company — pick a company to work as (Impersonate) before changing it.
        </div>
      )}
      {!canEdit && !perms.readOnly && (
        <p className="text-xs text-muted-foreground">Read-only — only an Admin or Super Admin can change the steel catalog.</p>
      )}

      {canEdit && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="steel-card p-6">
            <h3 className="font-semibold mb-1">Bulk Spreadsheet Importer</h3>
            <div className="mb-3">
              <Label className="text-xs">Import Shape Dataset Type</Label>
              <Select value={importDatasetType} onValueChange={setImportDatasetType}>
                <SelectTrigger className="mt-1 max-w-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {IMPORT_DATASET_TYPES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {(IMPORT_DATASET_TYPES.find((d) => d.value === importDatasetType) || IMPORT_DATASET_TYPES[0]).hint}
            </p>
            <Textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              className="min-h-[120px] font-mono text-xs"
              placeholder={(IMPORT_DATASET_TYPES.find((d) => d.value === importDatasetType) || IMPORT_DATASET_TYPES[0]).placeholder}
            />
            <div className="flex justify-end mt-3">
              <Button onClick={handleBulkImport} disabled={importing} className="steel-gradient text-white border-0">
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                Import Rows
              </Button>
            </div>
          </div>

          <div className="steel-card p-6">
            <h3 className="font-semibold mb-1">Add Individual Size</h3>
            <p className="text-xs text-muted-foreground mb-3">Add one catalog entry directly — then set its dimensions and lb/ft in the list below.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <Label className="text-xs">Structural Class</Label>
                <Select value={newClass} onValueChange={setNewClass}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATALOG_DISPLAY_CLASSES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Custom Size ID</Label>
                <Input value={newSizeId} onChange={(e) => setNewSizeId(e.target.value)} className="mt-1" placeholder="e.g. W12x40" />
              </div>
              <Button onClick={handleAddSize} disabled={savingSize} className="steel-gradient text-white border-0">
                {savingSize ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Save Size
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border flex flex-wrap items-center gap-2">
          <h3 className="font-semibold mr-auto">Catalog — {catalog.length} size(s)</h3>
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setLimit(150); }} placeholder="Search sizes…" className="h-8 w-48 text-xs" />
          <Select value={classFilter} onValueChange={(v) => { setClassFilter(v); setLimit(150); }}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {CATALOG_DISPLAY_CLASSES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={weightFilter} onValueChange={(v) => { setWeightFilter(v); setLimit(150); }}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any weight</SelectItem>
              <SelectItem value="has_weight">Has a weight</SelectItem>
              <SelectItem value="needed">Weight needed</SelectItem>
              <SelectItem value="from_takeoff">Added from a takeoff</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-2 py-2 font-medium">Class</th>
                <th className="px-2 py-2 font-medium">Size</th>
                <th className="px-2 py-2 font-medium">Dim 1 (in)</th>
                <th className="px-2 py-2 font-medium">Dim 2 (in)</th>
                <th className="px-2 py-2 font-medium">Wall (in)</th>
                <th className="px-2 py-2 font-medium">lb/ft</th>
                <th className="px-2 py-2 font-medium">Weight source</th>
                <th className="px-2 py-2 font-medium">Added</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-xs text-muted-foreground">No sizes match.</td></tr>
              ) : filteredRows.slice(0, limit).map((row) => (
                <SteelRow
                  key={row.id}
                  row={row}
                  siblings={catalog.filter((r) => r.shape_class === row.shape_class)}
                  canEdit={canEdit}
                  onUpdated={(updated) => setCatalog((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))}
                  onRemoved={(id) => setCatalog((prev) => prev.filter((r) => r.id !== id))}
                  onStockLengths={setStockLengthItem}
                />
              ))}
            </tbody>
          </table>
        </div>
        {filteredRows.length > limit && (
          <div className="p-3 border-t border-border">
            <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + 150)}>Show more ({filteredRows.length - limit} left)</Button>
          </div>
        )}
      </div>

      {stockLengthItem && (
        <StockLengthOptionsModal item={stockLengthItem} readOnly={!canEdit} onClose={() => setStockLengthItem(null)} />
      )}
    </div>
  );
}
