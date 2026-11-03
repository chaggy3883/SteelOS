import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { db } from '@/api/apiClient';
import { Calculator, Gauge, Clock3, Save, Plus, Trash2, Minus, Download, FileDown, FileSpreadsheet, Combine, AlertTriangle, Scale, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { getShapeClass } from '@/data/steelShapeSelector';
import {
  calcCatalogRow, calcLegacyRow, entryFamily, defaultGradeFor, parseLengthToInches, parseDimToken, splitSizeTokens,
  formatFtIn, formatInches, LEGACY_SHAPE_CLASS_TO_CODE, CODE_TO_LEGACY_SHAPE_CLASS, WEIGHT_SOURCE_LABELS,
} from '@/lib/materialEntryMath';
import { exportRequisitionToPdf } from '@/lib/requisitionPdfExport';
import { exportRequisitionToXlsx } from '@/lib/requisitionXlsxExport';
import { ShapePicker, SizePicker, GradePicker } from '@/components/estimating/CatalogMaterialPicker';
import MathDrill from '@/components/estimating/MathDrill';
import CombineForOrderingDialog from '@/components/estimating/CombineForOrderingDialog';
import AddCatalogSizeDialog from '@/components/estimating/AddCatalogSizeDialog';
import { useAuth } from '@/lib/AuthContext';
import { materialCatalogPermissions } from '@/lib/materialCatalogAccess';
import { sizeKey, typedWeightDecision, savedByText } from '@/lib/catalogSizeRules';
import { saveTypedSizeWeight } from '@/lib/materialCatalogWrites';
import { buildAreaBreakdown, automaticAreaPercents, areaFollowsTakeoff } from '@/lib/areaBreakdown';

const COATING_TYPES = ['No Coating', 'Paint', 'Galvanized'];

// Rows come in two kinds:
//   - catalog rows (shape_code set): Material / Size / Grade picked from the
//     master Material Catalog (MaterialShapeType ~95 codes, MaterialSizeOption,
//     MaterialGradeOption), weighed by materialEntryMath.js calcCatalogRow;
//   - older rows saved with only the 5-value shape_class (W-Beam / HSS Tube /
//     C-Channel / L-Angle / PL-Plate) — shown under the matching catalog code
//     (W/HSS/C/L/PL) but still calculated by calcLegacyRow, the old rowCalc
//     unchanged, so a saved bid's tons, hours and paint area never move.
//     Picking a new material or size on one turns it into a catalog row.

const fmtNum = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');

// Width/length/thickness boxes on plate rows read a bare number as INCHES
// (24 = 24"); a foot mark switches to ft-in (2'-0"). The Length box on
// linear rows reads a bare number as FEET, as the old decimal-ft box did.
function parseInchEntry(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.includes("'")) return parseLengthToInches(s);
  return parseDimToken(s.replace(/"$/, ''));
}

function emptyRow(shapeType, sizes = [], grades = []) {
  const code = shapeType?.shape_code || 'W';
  return {
    id: null,
    legacy: false,
    shape_code: code,
    size_value: sizes[0] || '',
    grade: defaultGradeFor(code, grades),
    length_raw: '',
    length_in: null,
    width_raw: '',
    width_in: null,
    thickness_raw: '',
    thickness_in: null,
    quantity: '',
    weight_override: '',
    coating_type: 'No Coating',
    sequence_area_id: null,
  };
}

// Typed weights: when a row says "Weight needed" and a weight is typed, it
// is saved to that size in the master catalog (MaterialSizeOption) the
// first time the box loses focus or the takeoff is saved — every takeoff
// then reads it as "Saved weight" and the row drops its own override. If
// the size already has any weight (saved, steel catalog, AISC, computed),
// the typed value stays on that row only. Two rows racing on the same
// unknown size: the first save wins and the other keeps its value as a row
// override, with a note (materialCatalogWrites.js serializes the saves).
const FullTakeoff = forwardRef(function FullTakeoff({ bid, onSaved }, ref) {
  const { toast } = useToast();
  const { user } = useAuth();
  const catalogPerms = materialCatalogPermissions(user?.roles || user?.user?.roles || []);
  const [rows, setRows] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [shapeTypes, setShapeTypes] = useState([]);
  const [sizesByCode, setSizesByCode] = useState({});
  const [gradesByCode, setGradesByCode] = useState({});
  // Every MaterialSizeOption record (active or not) by shape_code — the
  // saved weight lives on these.
  const [sizeOptionsByCode, setSizeOptionsByCode] = useState({});
  const [addSize, setAddSize] = useState(null); // { idx, shapeType, text }
  const savingWeightRef = useRef(new Set());
  const [shopEfficiencyPct, setShopEfficiencyPct] = useState(bid?.shop_efficiency_pct ?? 100);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [sequenceAreas, setSequenceAreas] = useState([]);
  const [areaFilter, setAreaFilter] = useState('all'); // 'all' | 'unassigned' | area.id
  const [combineOpen, setCombineOpen] = useState(false);

  useEffect(() => { loadRows(); }, [bid?.id]);
  useEffect(() => {
    db.entities.steel_catalog.list('size_designation', 2000).then(setCatalog).catch(() => setCatalog([]));
  }, []);

  // Bid-stage Areas (see BidAreaManager.jsx's "Build Areas" tab) — same
  // entity/query shape, scoped by bid_id since a bid isn't a project yet.
  // Purely additive: a bid with none defined leaves sequenceAreas empty and
  // the Area column/filter below stay hidden entirely.
  // Re-read when the bid is saved too: this tab stays mounted (BidDetail's
  // forceMount), so an Area added on the Areas tab must show up here.
  useEffect(() => {
    if (!bid?.id) return;
    db.entities.ProjectSequenceArea.filter({ bid_id: bid.id }, 'production_priority', 200)
      .then(setSequenceAreas)
      .catch(() => setSequenceAreas([]));
  }, [bid?.id, bid?.updated_date]);

  // The whole master Material Catalog, loaded once: every active
  // MaterialShapeType plus its sizes and grades, keyed by shape_code.
  useEffect(() => {
    (async () => {
      try {
        const [types, sizes, grades] = await Promise.all([
          db.entities.MaterialShapeType.filter({ is_active: true }, 'shape_code', 500),
          db.entities.MaterialSizeOption.list('sort_order', 10000),
          db.entities.MaterialGradeOption.list('sort_order', 5000),
        ]);
        const codeById = new Map(types.map((t) => [t.id, t.shape_code]));
        const bucket = (list, field) => {
          const out = {};
          [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).forEach((o) => {
            if (o.is_active === false) return;
            const code = codeById.get(o.shape_type_id);
            if (!code) return;
            (out[code] = out[code] || []).push(o[field]);
          });
          return out;
        };
        const records = {};
        sizes.forEach((o) => {
          const code = codeById.get(o.shape_type_id);
          if (code) (records[code] = records[code] || []).push(o);
        });
        setShapeTypes(types);
        setSizeOptionsByCode(records);
        setSizesByCode(bucket(sizes, 'size_value'));
        setGradesByCode(bucket(grades, 'grade_value'));
      } catch (e) {
        setShapeTypes([]);
      }
    })();
  }, []);

  const shapeTypesByCode = useMemo(() => new Map(shapeTypes.map((s) => [s.shape_code, s])), [shapeTypes]);
  // "+ Add size" shows for anyone who can add (and for a super_admin who
  // hasn't picked a company, so the dialog can say why it's blocked).
  const canOfferAddSize = catalogPerms.canAdd || catalogPerms.needsCompany;

  const loadRows = async () => {
    if (!bid?.id) return;
    setLoading(true);
    try {
      const existing = await db.entities.MaterialTakeoffLine.filter({ bid_id: bid.id }, '-created_date', 200);
      // Rows with neither a catalog shape_code nor a 5-class shape_class
      // (MarkupsList.jsx's Bolt Count / Volume / Angle pushes, intentionally
      // left without a structural shape) stay out of this grid as before —
      // handleSave rewrites every row it loaded, so loading one would
      // overwrite it with values it never had.
      const gridRows = existing.filter((r) => r.shape_code || r.shape_class);
      setRows(gridRows.length ? gridRows.map((r) => {
        if (r.shape_code) {
          const lengthIn = r.length_in ?? (r.length_ft != null ? Number(r.length_ft) * 12 : null);
          const family = r.entry_family || entryFamily(r.shape_code);
          return {
            id: r.id,
            legacy: false,
            shape_code: r.shape_code,
            size_value: r.size_value || '',
            grade: r.grade || '',
            length_raw: r.length_raw || (lengthIn ? (family === 'plate' ? formatInches(lengthIn) : formatFtIn(lengthIn)) : ''),
            length_in: lengthIn,
            width_raw: r.width_in ? formatInches(r.width_in) : '',
            width_in: r.width_in ?? null,
            thickness_raw: '',
            thickness_in: null,
            thickness_saved: r.thickness_in ?? null,
            quantity: r.quantity ?? '',
            weight_override: r.weight_override ?? '',
            coating_type: r.coating_type || 'No Coating',
            source: r.source || 'manual',
            sequence_area_id: r.sequence_area_id || null,
          };
        }
        const shapeClass = r.shape_class || 'W-Beam';
        const lengthFt = r.length_ft ?? r.length_decimal_ft ?? '';
        return {
          id: r.id,
          legacy: true,
          shape_class: shapeClass,
          material_size: r.material_size || getShapeClass(shapeClass).sizes[0],
          grade: r.grade || '',
          length_ft: lengthFt,
          length_raw: lengthFt === '' ? '' : String(lengthFt),
          quantity: r.quantity ?? '',
          coating_type: r.coating_type || 'No Coating',
          source: r.source || 'manual',
          sequence_area_id: r.sequence_area_id || null,
        };
      }) : [emptyRow()]);
    } catch (e) {
      setRows([emptyRow()]);
    } finally {
      setLoading(false);
      setDirty(false);
    }
  };

  const newRow = () => {
    const shape = shapeTypesByCode.get('W');
    return emptyRow(shape, sizesByCode.W || [], gradesByCode.W || []);
  };

  // Defaults a new line to whichever Area is currently filtered/grouped on,
  // so adding a line while scoped to one Area doesn't drop it into
  // Unassigned and out of view — 'all'/'unassigned' both mean no default.
  const addRow = () => {
    const defaultAreaId = areaFilter !== 'all' && areaFilter !== 'unassigned' ? areaFilter : null;
    setRows((prev) => [...prev, { ...newRow(), sequence_area_id: defaultAreaId }]);
    setDirty(true);
  };
  const removeRow = (idx) => { setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)); setDirty(true); };

  const updateRow = (idx, patch) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  // Picking a material resets size/grade to that shape's first size and
  // family default grade, and clears per-shape entries (thickness, typed
  // weight). An older 5-class row becomes a catalog row here; its length
  // and quantity carry over.
  const changeShape = (idx, shapeType) => {
    const code = shapeType.shape_code;
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const lengthIn = r.legacy ? (Number(r.length_ft) || 0) * 12 || null : r.length_in;
      const family = entryFamily(code, shapeType.category);
      return {
        ...r,
        legacy: false,
        shape_code: code,
        size_value: (sizesByCode[code] || [])[0] || '',
        grade: defaultGradeFor(code, gradesByCode[code] || []),
        length_in: lengthIn,
        length_raw: lengthIn ? (family === 'plate' ? formatInches(lengthIn) : formatFtIn(lengthIn)) : '',
        width_raw: r.legacy ? '' : r.width_raw,
        width_in: r.legacy ? null : r.width_in,
        thickness_raw: '',
        thickness_in: null,
        thickness_saved: null,
        weight_override: '',
      };
    }));
    setDirty(true);
  };

  const changeSize = (idx, sizeValue) => {
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      if (r.legacy) {
        // Same as picking the mapped material first, then this size.
        const code = LEGACY_SHAPE_CLASS_TO_CODE[r.shape_class] || 'W';
        const lengthIn = (Number(r.length_ft) || 0) * 12 || null;
        return { ...r, legacy: false, shape_code: code, size_value: sizeValue, grade: r.grade || defaultGradeFor(code, gradesByCode[code] || []), length_in: lengthIn, length_raw: lengthIn ? formatFtIn(lengthIn) : '', width_raw: '', width_in: null, thickness_raw: '', thickness_in: null, weight_override: '' };
      }
      const next = { ...r, size_value: sizeValue, thickness_raw: '', thickness_in: null, thickness_saved: null };
      // Floor-plate style sizes that carry width/length ("1/4\" x 25\" x 25\"")
      // fill those boxes when they're still empty.
      if (entryFamily(r.shape_code, shapeTypesByCode.get(r.shape_code)?.category) === 'plate') {
        const dims = splitSizeTokens(sizeValue).slice(1).map((t) => parseDimToken(t));
        if (!r.width_in && dims[0] > 0) { next.width_in = dims[0]; next.width_raw = formatInches(dims[0]); }
        if (!r.length_in && dims[1] > 0) { next.length_in = dims[1]; next.length_raw = formatInches(dims[1]); }
      }
      return next;
    }));
    setDirty(true);
  };

  const updateShopEfficiencyPct = (value) => {
    setShopEfficiencyPct(value);
    setDirty(true);
  };

  // The size's MaterialSizeOption record: exact spelling first, else the
  // same size spelled another way.
  const sizeOptionFor = (code, sizeValue, opts = sizeOptionsByCode) => {
    const list = opts[code] || [];
    const exact = list.find((o) => o.size_value === sizeValue);
    if (exact || !sizeValue) return exact || null;
    const key = sizeKey(code, sizeValue);
    return list.find((o) => sizeKey(code, o.size_value) === key) || null;
  };

  const calcFor = (row, opts = sizeOptionsByCode) => {
    if (row.legacy) return calcLegacyRow(row, catalog);
    const shapeType = shapeTypesByCode.get(row.shape_code) || { shape_code: row.shape_code };
    const thickness = row.thickness_in ?? row.thickness_saved ?? null;
    return calcCatalogRow({ ...row, thickness_in: thickness }, { shapeType, catalogRows: catalog, sizeOption: sizeOptionFor(row.shape_code, row.size_value, opts) });
  };

  const calcs = useMemo(() => rows.map((row) => calcFor(row)), [rows, catalog, shapeTypesByCode, sizeOptionsByCode]);

  const replaceSizeOption = (opts, code, record) => {
    const list = opts[code] || [];
    const has = list.some((o) => o.id === record.id);
    return { ...opts, [code]: has ? list.map((o) => (o.id === record.id ? record : o)) : [...list, record] };
  };

  // Writes a row's typed weight to its size when the row (without that
  // typed value) would say "Weight needed". Returns what changed —
  // { rowPatch, record, message } or null — and never throws.
  const commitTypedWeight = async (row, opts) => {
    if (row.legacy || row.weight_override === '' || row.weight_override == null) return null;
    const shapeType = shapeTypesByCode.get(row.shape_code) || { shape_code: row.shape_code };
    const sizeOption = sizeOptionFor(row.shape_code, row.size_value, opts);
    const thickness = row.thickness_in ?? row.thickness_saved ?? null;
    const decision = typedWeightDecision({ row: { ...row, thickness_in: thickness }, shapeType, catalogRows: catalog, sizeOption });
    const label = `${row.shape_code} ${row.size_value}`;
    if (decision.reason === 'has_weight') {
      // Typed while the size still needed one, but another line saved first.
      if (row.typed_for_needed && decision.baseSource === 'saved') {
        return { rowPatch: { weight_override: '', typed_for_needed: false, weight_note: `${label} already has a saved weight (${sizeOption?.[decision.field]} ${decision.unit}, ${savedByText(sizeOption)}) — this line uses it. Only an admin can change it (Material Catalog).` } };
      }
      return null;
    }
    if (decision.reason === 'not_in_catalog') {
      return { rowPatch: { weight_note: `${label} isn't in the catalog, so this weight stays on this line — add the size with "+ Add size" to save it for every takeoff.` } };
    }
    if (!decision.save) return null;
    if (!catalogPerms.canAdd) {
      return { rowPatch: { weight_note: catalogPerms.needsCompany ? 'Pick a company to work as (Impersonate) to save this weight to the catalog — it stays on this line for now.' : 'Only estimators and admins can save weights to the catalog — this one stays on this line.' } };
    }
    try {
      const result = await saveTypedSizeWeight({ sizeOptionId: sizeOption.id, family: decision.family, value: decision.value });
      if (result.saved) {
        return {
          record: result.record,
          rowPatch: { weight_override: '', typed_for_needed: false, weight_note: '' },
          message: `Saved ${decision.value} ${decision.unit} for ${label} — every takeoff will use it.`,
        };
      }
      const existing = result.existing;
      return {
        record: existing,
        rowPatch: { weight_override: '', typed_for_needed: false, weight_note: `${label} was given a weight first (${existing[decision.field] ?? '—'} ${decision.unit}, ${savedByText(existing)}) — this line uses it. Only an admin can change it (Material Catalog).` },
      };
    } catch (e) {
      return { rowPatch: { weight_note: `Couldn't save the weight to the catalog (${e?.message || 'error'}) — it stays on this line.` } };
    }
  };

  const handleTypedWeightBlur = async (idx) => {
    const row = rows[idx];
    if (!row || savingWeightRef.current.has(idx)) return;
    savingWeightRef.current.add(idx);
    try {
      const out = await commitTypedWeight(row, sizeOptionsByCode);
      if (!out) return;
      if (out.record) setSizeOptionsByCode((prev) => replaceSizeOption(prev, row.shape_code, out.record));
      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...out.rowPatch } : r)));
      if (out.message) toast({ title: out.message });
    } finally {
      savingWeightRef.current.delete(idx);
    }
  };

  // Before saving lines: commit any typed weight still waiting for a blur,
  // one row at a time (so a second row for the same size sees the first
  // one's save). Returns the rows / size records the save should use.
  const commitPendingWeights = async () => {
    let opts = sizeOptionsByCode;
    const next = [...rows];
    const messages = [];
    for (let i = 0; i < next.length; i += 1) {
      const row = next[i];
      if (row.legacy || !row.typed_for_needed) continue;
      const out = await commitTypedWeight(row, opts);
      if (!out) continue;
      if (out.record) opts = replaceSizeOption(opts, row.shape_code, out.record);
      next[i] = { ...row, ...out.rowPatch };
      if (out.message) messages.push(out.message);
    }
    if (opts !== sizeOptionsByCode) setSizeOptionsByCode(opts);
    messages.forEach((m) => toast({ title: m }));
    return { rows: next, opts };
  };

  // Area filter/grouping — same "group by ProjectSequenceArea, Unassigned
  // last" shape as ProjectDetail.jsx's Sequence/Area piece assignment
  // (seqGroupEntries). Indices below are always the row's real index into
  // `rows`/`calcs`, never a filtered position, so addRow/updateRow/removeRow
  // keep working unchanged regardless of which group a row renders under.
  const sequenceAreasById = useMemo(() => new Map(sequenceAreas.map((a) => [a.id, a])), [sequenceAreas]);
  const areaKeyForRow = (row) => (row.sequence_area_id && sequenceAreasById.has(row.sequence_area_id) ? row.sequence_area_id : 'unassigned');
  const rowGroups = useMemo(() => {
    if (sequenceAreas.length === 0) return [[null, rows.map((row, idx) => ({ row, idx }))]];
    const indexed = rows.map((row, idx) => ({ row, idx })).filter(({ row }) => areaFilter === 'all' || areaKeyForRow(row) === areaFilter);
    const map = new Map();
    indexed.forEach((item) => {
      const key = areaKeyForRow(item.row);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    const groups = [
      ...sequenceAreas.map((a) => [a.id, map.get(a.id) || []]),
      ['unassigned', map.get('unassigned') || []],
    ];
    return areaFilter === 'all' ? groups : groups.filter(([key]) => key === areaFilter);
  }, [rows, sequenceAreas, sequenceAreasById, areaFilter]);

  const lineLabel = (row, idx) => {
    if (row.legacy) return `Line ${idx + 1} — ${row.material_size}`;
    return `Line ${idx + 1} — ${calcs[idx]?.profile || row.shape_code}`;
  };

  const totalTons = calcs.reduce((sum, c) => sum + c.tons, 0);
  const totalLbs = calcs.reduce((sum, c) => sum + (c.totalLbs || 0), 0);
  const totalPlateAreaSqIn = calcs.reduce((sum, c) => sum + (c.plateAreaSqIn || 0), 0);
  const totalSurfaceSqIn = calcs.reduce((sum, c) => sum + (c.surfaceSqIn || 0), 0);
  const needsWeightCount = calcs.filter((c) => c.needsWeight).length;
  const baselineManHours = calcs.reduce((sum, c) => sum + c.tons * (c.hoursPerTon || 0), 0);
  const efficiencyFactor = (Number(shopEfficiencyPct) || 0) / 100;
  const totalManHours = efficiencyFactor > 0 ? baselineManHours / efficiencyFactor : baselineManHours;
  // One line's share of totalManHours, same math line by line (tons x the
  // shape's hrs/ton, then the Shop Efficiency % adjustment) — shown on each
  // line so the Bid Worksheet's "From takeoff: X hrs" on Structural
  // Fabrication can be traced back to the lines that produced it.
  const rowManHours = (idx) => {
    const baseline = calcs[idx].tons * (calcs[idx].hoursPerTon || 0);
    return efficiencyFactor > 0 ? baseline / efficiencyFactor : baseline;
  };
  // Pushed to Bid.estimated_paint_area_sqft / estimated_galvanizing_tons on
  // save so TakeoffEngine.jsx's Bid Worksheet can auto-fill Primer (Paint)
  // and Galvanizing quantities from this takeoff instead of the estimator
  // re-deriving them by hand. paintAreaSqIn is already 0 for any row not
  // coated 'Paint', so summing every row is correct as-is.
  // Two decimals, the same as the Bid Worksheet's Primer (Paint) sq ft.
  const totalPaintAreaSqFt = Math.round((calcs.reduce((sum, c) => sum + (c.paintAreaSqIn || 0), 0) / 144) * 100) / 100;
  const totalGalvanizedTons = rows.reduce((sum, row, i) => (row.coating_type === 'Galvanized' ? sum + calcs[i].tons : sum), 0);
  // Each Build Area's share of the project by tons (and hours alongside) —
  // see areaBreakdown.js. Only when the bid has Areas.
  const areaLines = rows.map((row, i) => ({ sequence_area_id: row.sequence_area_id || null, tons: calcs[i]?.tons || 0, hours: calcs[i] ? rowManHours(i) : 0, label: lineLabel(row, i) }));
  const areaBreakdown = sequenceAreas.length > 0 ? buildAreaBreakdown(sequenceAreas, areaLines) : null;
  const areaRowByKey = new Map((areaBreakdown?.rows || []).map((r) => [r.key, r]));

  // Returns true when saved (or nothing to save). { quiet } is Save
  // Estimate: it skips the success toast and an untouched takeoff, so a
  // takeoff nobody edited never rewrites the bid's tons / hours / paint area.
  const handleSave = async ({ quiet = false } = {}) => {
    if (!bid?.id) return false;
    if (quiet && !dirty) return true;
    setSaving(true);
    try {
      const committed = await commitPendingWeights();
      const saveRows = committed.rows;
      const saveCalcs = saveRows.map((row) => calcFor(row, committed.opts));
      const ops = saveRows.map((row, i) => {
        const c = saveCalcs[i];
        let payload;
        if (row.legacy) {
          // Exactly the old payload, plus the three display totals.
          payload = {
            bid_id: bid.id,
            shape_class: row.shape_class,
            material_type: getShapeClass(row.shape_class).label,
            material_size: row.material_size,
            grade: row.grade || '',
            length_ft: c.lengthFt || 0,
            quantity: Number(row.quantity) || 0,
            weight_per_ft: c.weightPerFt || 0,
            tons_per_piece: c.tonsPerPiece || 0,
            total_tons: c.totalTons || 0,
            coating_type: row.coating_type || 'No Coating',
            paint_area_sq_in: c.paintAreaSqIn || 0,
            sequence_area_id: row.sequence_area_id || null,
            total_weight_lbs: c.totalLbs || 0,
            sq_in_area: c.plateAreaSqIn || 0,
            sq_in_surface: c.surfaceSqIn || 0,
          };
        } else {
          const shapeType = shapeTypesByCode.get(row.shape_code);
          const qty = Number(row.quantity) || 0;
          const override = Number(row.weight_override);
          payload = {
            bid_id: bid.id,
            shape_code: row.shape_code,
            shape_description: shapeType?.description || '',
            shape_class: CODE_TO_LEGACY_SHAPE_CLASS[row.shape_code] || null,
            material_type: shapeType?.description || row.shape_code,
            material_size: c.profile,
            size_value: row.size_value || '',
            entry_family: c.family,
            grade: row.grade || '',
            length_raw: c.family === 'each' ? '' : (row.length_raw || ''),
            length_in: c.family === 'each' ? 0 : (c.lengthIn || 0),
            length_ft: c.family === 'each' ? 0 : (c.lengthFt || 0),
            width_in: c.family === 'plate' ? (c.widthIn || 0) : null,
            thickness_in: c.family === 'plate' ? (c.thicknessIn ?? null) : null,
            quantity: qty,
            weight_per_ft: c.family === 'linear' ? (c.unitWeight || 0) : 0,
            weight_per_sq_ft: c.family === 'plate' ? (c.unitWeight || 0) : null,
            weight_per_each: c.family === 'each' ? (c.unitWeight || 0) : null,
            weight_source: c.weightSource,
            weight_override: row.weight_override !== '' && Number.isFinite(override) && override > 0 ? override : null,
            tons_per_piece: qty ? c.tons / qty : 0,
            total_tons: c.tons || 0,
            total_weight_lbs: c.totalLbs || 0,
            sq_in_area: c.plateAreaSqIn || 0,
            sq_in_surface: c.surfaceSqIn || 0,
            coating_type: row.coating_type || 'No Coating',
            paint_area_sq_in: c.paintAreaSqIn || 0,
            sequence_area_id: row.sequence_area_id || null,
          };
        }
        if (row.id) return db.entities.MaterialTakeoffLine.update(row.id, payload);
        return db.entities.MaterialTakeoffLine.create(payload);
      });
      await Promise.all(ops);
      // Areas that follow the takeoff (not set by hand) get their % of the
      // project re-worked from these lines (by tons) before the bid save
      // below, so the Areas tab picks the new figures up on its reload.
      if (sequenceAreas.length > 0) {
        const autoPct = automaticAreaPercents(sequenceAreas, saveRows.map((row, i) => ({ sequence_area_id: row.sequence_area_id || null, tons: saveCalcs[i]?.tons || 0 })));
        await Promise.all(sequenceAreas
          .filter((a) => areaFollowsTakeoff(a) && autoPct.has(a.id) && (a.pct_source !== 'takeoff' || Math.abs((Number(a.contract_value_pct) || 0) - autoPct.get(a.id)) > 1e-9))
          .map((a) => db.entities.ProjectSequenceArea.update(a.id, { contract_value_pct: autoPct.get(a.id), pct_source: 'takeoff' })));
      }
      await db.entities.Bid.update(bid.id, {
        estimated_tons: totalTons,
        estimated_man_hours: totalManHours,
        shop_efficiency_pct: Number(shopEfficiencyPct) || 100,
        estimated_paint_area_sqft: totalPaintAreaSqFt,
        estimated_galvanizing_tons: totalGalvanizedTons,
      });
      if (!quiet) toast({ title: 'Material takeoff saved', description: 'Tons and man-hours were pushed to the bid workspace.' });
      setDirty(false);
      onSaved?.();
      loadRows();
      return true;
    } catch (e) {
      toast({ title: 'Unable to save material takeoff', description: e?.message || 'Please retry.', variant: 'destructive' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({
    save: handleSave,
    isDirty: () => dirty,
  }));

  // Export columns are unchanged from the 5-class grid. A catalog row fills
  // them the same way: its code + description as the shape type, the
  // compact size (plate includes its width), its length in ft.
  const shapeTypeLabel = (row) => (row.legacy ? getShapeClass(row.shape_class).label : `${row.shape_code} — ${shapeTypesByCode.get(row.shape_code)?.description || ''}`);
  const sizeLabel = (row, i) => (row.legacy ? row.material_size : (calcs[i].profile || row.size_value));
  const lengthFtOf = (row, i) => (row.legacy ? (row.length_ft || 0) : Number((calcs[i].lengthFt || 0).toFixed(4)));
  const unitWeightText = (row, i) => {
    const c = calcs[i];
    if (row.legacy) return c.weightPerFt ? c.weightPerFt.toFixed(1) : '0';
    if (c.needsWeight) return 'weight needed';
    return c.family === 'linear' ? c.unitWeight.toFixed(1) : `${c.unitWeight.toFixed(2)} ${c.weightUnit}`;
  };

  // "Unpriced" on purpose — this goes to suppliers for a quote, so cost/margin
  // columns are deliberately left out. The computed paint area rides along
  // as its own column, same as every other quantity/spec field.
  const handleExportUnpricedCsv = () => {
    const header = ['Material Type', 'Size', 'Grade', 'Length', 'Quantity', 'Coating', 'Paint Area (Sq In)'];
    const csvRows = [header, ...rows.map((row, i) => [
      shapeTypeLabel(row),
      sizeLabel(row, i),
      row.grade || '',
      lengthFtOf(row, i),
      row.quantity || 0,
      row.coating_type || 'No Coating',
      calcs[i].paintAreaSqIn ? calcs[i].paintAreaSqIn.toFixed(0) : '0',
    ])];
    const csvText = csvRows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvText], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bid?.bid_number || 'takeoff'}-unpriced-supplier.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportRequisitionPdf = async () => {
    await exportRequisitionToPdf({
      title: 'Material Takeoff Requisition',
      subtitle: `${bid?.bid_number || 'Bid TBD'} — ${bid?.job_name || ''} — unpriced, for supplier quoting`,
      columns: ['Shape Type', 'Selected Size', 'Length (ft)', 'Weight (lb/ft)', 'Qty', 'Coating', 'Calculated Metrics'],
      rows: rows.map((row, i) => [
        shapeTypeLabel(row),
        sizeLabel(row, i),
        lengthFtOf(row, i),
        unitWeightText(row, i),
        row.quantity || 0,
        row.coating_type || 'No Coating',
        row.coating_type === 'Paint' ? `${calcs[i].paintAreaSqIn.toLocaleString(undefined, { maximumFractionDigits: 0 })} Sq In`
          : row.coating_type === 'Galvanized' ? `${calcs[i].tons.toFixed(3)} Tons`
          : '—',
      ]),
    });
  };

  const handleExportRequisitionXlsx = async () => {
    await exportRequisitionToXlsx({
      title: 'Material Takeoff Requisition',
      subtitle: `${bid?.bid_number || 'Bid TBD'} — ${bid?.job_name || ''} — unpriced, for supplier quoting`,
      columns: ['Shape Type', 'Selected Size', 'Length (ft)', 'Weight (lb/ft)', 'Qty', 'Coating', 'Calculated Metrics'],
      rows: rows.map((row, i) => [
        shapeTypeLabel(row),
        sizeLabel(row, i),
        lengthFtOf(row, i),
        row.legacy ? (calcs[i].weightPerFt || 0) : (calcs[i].family === 'linear' ? (calcs[i].unitWeight || 0) : unitWeightText(row, i)),
        row.quantity || 0,
        row.coating_type || 'No Coating',
        row.coating_type === 'Paint' ? calcs[i].paintAreaSqIn
          : row.coating_type === 'Galvanized' ? calcs[i].tons
          : '—',
      ]),
    });
  };

  // Pieces for "Combine for ordering": linear rows (old and new) become
  // lengths, plate rows become parts; each items and IRONSIGHT-pushed lines
  // (stored as one summed length — combine those from IRONSIGHT, which
  // keeps the individual runs) are listed as not combined.
  const combineInput = useMemo(() => {
    const pieces = [];
    const excluded = [];
    rows.forEach((row, idx) => {
      const c = calcs[idx];
      const label = lineLabel(row, idx);
      const area = row.sequence_area_id && sequenceAreasById.get(row.sequence_area_id);
      const seq = { sequence_key: area ? area.id : '', sequence_label: area ? area.name : 'Unassigned' };
      const qty = Math.round(Number(row.quantity) || 0);
      if (row.source === 'ironsight') { excluded.push({ label, reason: 'Pushed from IRONSIGHT as one summed length — run Combine from that IRONSIGHT session instead' }); return; }
      if (c.family === 'each') { excluded.push({ label, reason: 'Ordered by count — nothing to combine' }); return; }
      if (qty <= 0) { excluded.push({ label, reason: 'No quantity' }); return; }
      if (row.legacy) {
        if (!(c.lengthFt > 0)) { excluded.push({ label, reason: 'No length' }); return; }
        pieces.push({ id: `row-${idx}`, source_label: label, family: 'linear', shape_code: LEGACY_SHAPE_CLASS_TO_CODE[row.shape_class] || '', profile: row.material_size, grade: row.grade || '', ...seq, length_in: c.lengthFt * 12, quantity: qty, weight_per_ft: c.weightPerFt || 0 });
        return;
      }
      if (c.family === 'plate') {
        if (!(c.widthIn > 0) || !(c.lengthIn > 0)) { excluded.push({ label, reason: 'Plate needs width and length' }); return; }
        pieces.push({ id: `row-${idx}`, source_label: label, family: 'plate', shape_code: row.shape_code, profile: c.profile, grade: row.grade || '', ...seq, thickness_in: c.thicknessIn || 0, width_in: c.widthIn, length_in: c.lengthIn, quantity: qty, lb_per_sq_in: (c.unitWeight || 0) / 144 });
        return;
      }
      if (!(c.lengthIn > 0)) { excluded.push({ label, reason: 'No length' }); return; }
      pieces.push({ id: `row-${idx}`, source_label: label, family: 'linear', shape_code: row.shape_code, profile: c.profile, grade: row.grade || '', ...seq, length_in: c.lengthIn, quantity: qty, weight_per_ft: c.unitWeight || 0 });
    });
    return { pieces, excluded };
  }, [rows, calcs, sequenceAreasById]);

  if (loading) return <div className="h-64 bg-muted rounded-xl animate-pulse" />;

  const sumLines = (field, label, unit, d) => [
    ...rows.map((row, i) => `${lineLabel(row, i)}: ${fmtNum(calcs[i][field] || 0, d)} ${unit}`),
    `Total ${label}: ${fmtNum(calcs.reduce((s, c) => s + (c[field] || 0), 0), d)} ${unit}`,
  ];

  return (
    <div className="space-y-4">
      <div className="steel-card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-primary" />
            <h4 className="font-semibold">Material Takeoff</h4>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {sequenceAreas.length > 0 && (
              <Select value={areaFilter} onValueChange={setAreaFilter}>
                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Areas</SelectItem>
                  {sequenceAreas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" onClick={() => setCombineOpen(true)}>
              <Combine className="w-3.5 h-3.5 mr-1" />Combine for ordering
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportRequisitionPdf}>
              <FileDown className="w-3.5 h-3.5 mr-1" />EXPORT REQUISITION TO PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportRequisitionXlsx}>
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />EXPORT REQUISITION TO EXCEL
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportUnpricedCsv}>
              <Download className="w-3.5 h-3.5 mr-1" />Export Unpriced Supplier CSV
            </Button>
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus className="w-3.5 h-3.5 mr-1" />Add Material Line
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {rowGroups.map(([groupKey, items]) => (
            <div key={groupKey ?? 'flat'}>
              {sequenceAreas.length > 0 && (
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {groupKey === 'unassigned' ? 'Unassigned' : sequenceAreasById.get(groupKey)?.name}
                  </span>
                  <span className="text-xs text-muted-foreground">{items.length} line{items.length === 1 ? '' : 's'}</span>
                  {areaRowByKey.has(groupKey) && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {fmtNum(areaRowByKey.get(groupKey).tons, 3)} t ·{' '}
                      <MathDrill value={`${areaRowByKey.get(groupKey).pctTons.toFixed(1)}% of project`} title={`${areaRowByKey.get(groupKey).name} — share of project`} lines={areaRowByKey.get(groupKey).steps} className="text-foreground font-semibold" />
                    </span>
                  )}
                </div>
              )}
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1 pb-2">No material lines assigned to this Area yet.</p>
              ) : (
                <div className="space-y-2">
                {items.map(({ row, idx }) => {
                  const calc = calcs[idx];
                  const code = row.legacy ? (LEGACY_SHAPE_CLASS_TO_CODE[row.shape_class] || 'W') : row.shape_code;
                  const family = row.legacy ? 'linear' : calc.family;
                  const sizeThickness = !row.legacy && family === 'plate' ? calc.thicknessIn : null;
                  const lengthHint = row.legacy
                    ? (row.length_raw && !(calc.lengthFt > 0) ? "Can't read that length" : calc.lengthFt > 0 ? `= ${formatFtIn(calc.lengthFt * 12)}` : '')
                    : (row.length_raw && !(calc.lengthIn > 0) ? "Can't read that length" : calc.lengthIn > 0 ? `= ${family === 'plate' ? formatInches(calc.lengthIn) : formatFtIn(calc.lengthIn)}` : '');
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end rounded-lg border border-border p-2">
                {(row.source === 'ironsight' || row.legacy) && (
                  <div className="col-span-12 flex items-center gap-2">
                    {row.source === 'ironsight' && <Badge variant="outline" className="text-blue-600 border-blue-300 text-[10px]">IRONSIGHT</Badge>}
                    {row.legacy && <span className="text-[10px] text-muted-foreground">Older line ({row.shape_class} {row.material_size}) — calculated exactly as before. Pick a material or size to switch it to the full catalog.</span>}
                  </div>
                )}
                <div className="col-span-12 sm:col-span-3">
                  <Label className="text-xs">Material / Shape</Label>
                  <div className="mt-1"><ShapePicker shapeTypes={shapeTypes} value={code} onChange={(s) => changeShape(idx, s)} /></div>
                </div>

                <div className="col-span-6 sm:col-span-2">
                  <Label className="text-xs">Size</Label>
                  <div className="mt-1">
                    <SizePicker
                      sizes={sizesByCode[code] || []}
                      value={row.legacy ? row.material_size : row.size_value}
                      onChange={(v) => changeSize(idx, v)}
                      onAddSize={canOfferAddSize && shapeTypesByCode.get(code) ? (text) => setAddSize({ idx, shapeType: shapeTypesByCode.get(code), text }) : undefined}
                    />
                  </div>
                </div>

                <div className="col-span-6 sm:col-span-2">
                  <Label className="text-xs">Grade</Label>
                  <GradePicker key={`${idx}-${code}`} className="mt-1" grades={gradesByCode[code] || []} value={row.grade} onChange={(v) => updateRow(idx, { grade: v })} />
                </div>

                {family === 'linear' && (
                  <div className="col-span-6 sm:col-span-3">
                    <Label className="text-xs">Length (ft-in, e.g. 20'-6 1/2")</Label>
                    <Input
                      value={row.length_raw ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const inches = parseLengthToInches(raw);
                        if (row.legacy) updateRow(idx, { length_raw: raw, length_ft: inches == null ? '' : inches / 12 });
                        else updateRow(idx, { length_raw: raw, length_in: inches });
                      }}
                      className="mt-1 h-8 text-sm"
                      placeholder={`20'-6 1/2"`}
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5 h-3">{lengthHint}</p>
                  </div>
                )}
                {family === 'plate' && (
                  <div className="col-span-12 sm:col-span-3 grid grid-cols-3 gap-1">
                    <div>
                      <Label className="text-xs">Thick (in)</Label>
                      <Input
                        value={row.thickness_raw ?? ''}
                        onChange={(e) => updateRow(idx, { thickness_raw: e.target.value, thickness_in: parseInchEntry(e.target.value) })}
                        className="mt-1 h-8 text-sm px-1.5"
                        placeholder={sizeThickness ? formatInches(sizeThickness) : 'from size'}
                        title="Read from the size — type to change"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Width (in)</Label>
                      <Input value={row.width_raw ?? ''} onChange={(e) => updateRow(idx, { width_raw: e.target.value, width_in: parseInchEntry(e.target.value) })} className="mt-1 h-8 text-sm px-1.5" placeholder="24" />
                    </div>
                    <div>
                      <Label className="text-xs">Length (in)</Label>
                      <Input value={row.length_raw ?? ''} onChange={(e) => updateRow(idx, { length_raw: e.target.value, length_in: parseInchEntry(e.target.value) })} className="mt-1 h-8 text-sm px-1.5" placeholder="36" />
                    </div>
                    <p className="col-span-3 text-[10px] text-muted-foreground h-3">{calc.thicknessIn ? `${formatInches(calc.thicknessIn)} thick` : 'No thickness in the size — type one'}{calc.widthIn > 0 && calc.lengthIn > 0 ? ` · ${formatInches(calc.widthIn)} × ${formatInches(calc.lengthIn)}` : ''}</p>
                  </div>
                )}
                {family === 'each' && (
                  <div className="col-span-6 sm:col-span-3">
                    <Label className="text-xs">Entry</Label>
                    <p className="mt-1 h-8 flex items-center text-xs text-muted-foreground">Quantity only (each)</p>
                  </div>
                )}

                <div className="col-span-6 sm:col-span-2">
                  <Label className="text-xs">Qty</Label>
                  <div className="flex items-center gap-1 mt-1">
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => updateRow(idx, { quantity: Math.max(0, (Number(row.quantity) || 0) - 1) })}>
                      <Minus className="w-3.5 h-3.5" />
                    </Button>
                    <Input type="number" value={row.quantity} onChange={(e) => updateRow(idx, { quantity: e.target.value === '' ? '' : (parseFloat(e.target.value) || 0) })} className="h-8 text-sm text-center px-1" />
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => updateRow(idx, { quantity: (Number(row.quantity) || 0) + 1 })}>
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="col-span-12 flex items-center gap-x-4 gap-y-1 flex-wrap border-t border-border/60 pt-2 mt-1">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs whitespace-nowrap">Coating</Label>
                    <select
                      value={row.coating_type || 'No Coating'}
                      onChange={(e) => updateRow(idx, { coating_type: e.target.value })}
                      className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {COATING_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  {sequenceAreas.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs whitespace-nowrap">Area</Label>
                      <Select value={row.sequence_area_id || 'unassigned'} onValueChange={(v) => updateRow(idx, { sequence_area_id: v === 'unassigned' ? null : v })}>
                        <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {sequenceAreas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    {calc.needsWeight
                      ? <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300"><AlertTriangle className="w-3 h-3 mr-0.5" />Weight needed</Badge>
                      : <Badge variant="outline" className="text-[10px]">{WEIGHT_SOURCE_LABELS[calc.weightSource] || calc.weightSource}</Badge>}
                    <MathDrill value={calc.needsWeight ? '—' : `${fmtNum(calc.unitWeight, family === 'linear' ? 2 : 3)} ${calc.weightUnit}`} title="Unit weight" lines={calc.steps?.weight?.slice(0, 1)} align="start" />
                  </span>
                  {/* The weight box only shows while the size has no weight of
                      its own (it's then saved to the size). A size that has
                      one is locked here — an admin changes it in Material
                      Catalog. */}
                  {!row.legacy && (calc.needsWeight || calc.weightSource === 'override') && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Label className="text-xs whitespace-nowrap">Enter {calc.weightUnit}</Label>
                      <Input
                        type="number"
                        min={0}
                        value={row.weight_override ?? ''}
                        onChange={(e) => updateRow(idx, {
                          weight_override: e.target.value,
                          // Typed while the size had no weight of its own:
                          // a candidate for saving to the catalog.
                          typed_for_needed: calc.needsWeight || (row.typed_for_needed && calc.weightSource === 'override'),
                          weight_note: '',
                        })}
                        onBlur={() => handleTypedWeightBlur(idx)}
                        className={`h-7 w-20 text-xs ${calc.needsWeight ? 'border-amber-400' : ''}`}
                        placeholder="needed"
                        title="Saved to this size in the catalog when you leave the box — every takeoff will use it"
                      />
                    </span>
                  )}
                  {!row.legacy && calc.overrideIgnored && (
                    <p className="w-full text-[11px] text-muted-foreground flex items-center gap-1"><AlertTriangle className="w-3 h-3 flex-shrink-0" />{calc.overrideIgnored}</p>
                  )}
                  {!row.legacy && row.weight_note && (
                    <p className="w-full text-[11px] text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3 flex-shrink-0" />{row.weight_note}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Weight: <MathDrill value={`${fmtNum(calc.totalLbs, 1)} lb`} title="Weight (lb)" lines={calc.steps?.weight} className="text-foreground" align="start" />
                  </p>
                  {(family === 'plate' || calc.plateAreaSqIn > 0) && (
                    <p className="text-xs text-muted-foreground">
                      Plate area sq in: <MathDrill value={fmtNum(calc.plateAreaSqIn, 0)} title="Plate area (sq in)" lines={calc.steps?.plateArea} className="text-foreground" align="start" />
                    </p>
                  )}
                  {family !== 'each' && (
                    <p className="text-xs text-muted-foreground">
                      Surface sq in: <MathDrill value={calc.surfaceSqIn == null ? '—' : fmtNum(calc.surfaceSqIn, 0)} title="Surface (paint) area, sq in" lines={calc.steps?.surface} className="text-foreground" align="start" />
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Calculated Metrics: {calc.paintAreaSqIn ? `${calc.paintAreaSqIn.toLocaleString(undefined, { maximumFractionDigits: 0 })} Sq In paint` : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Shop hours:{' '}
                    <MathDrill
                      value={rowManHours(idx).toFixed(1)}
                      title="Shop hours"
                      lines={[
                        `${calc.tons.toFixed(4)} tons × ${calc.hoursPerTon} hrs/ton${row.legacy ? ` (${row.shape_class})` : calc.hoursClass ? ` (rate for ${calc.hoursClass})` : ' (hardware: 0)'} = ${(calc.tons * (calc.hoursPerTon || 0)).toFixed(3)} hrs`,
                        (Number(shopEfficiencyPct) || 0) > 0 && Number(shopEfficiencyPct) !== 100 ? `÷ ${Number(shopEfficiencyPct)}% shop efficiency = ${rowManHours(idx).toFixed(3)} hrs` : '',
                      ]}
                      className="text-foreground font-semibold"
                      align="start"
                    />
                  </p>
                </div>

                <div className="col-span-9 sm:col-span-11 text-right">
                  <Label className="text-xs">Tons</Label>
                  <p className="mt-1 h-8 flex items-center justify-end text-sm font-bold">
                    <MathDrill value={calc.tons.toFixed(3)} title="Tons" lines={[...(calc.steps?.weight || []), ...(calc.steps?.tons || [])]} />
                  </p>
                </div>

                <div className="col-span-3 sm:col-span-1 flex justify-end">
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600" onClick={() => removeRow(idx)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
          </div>
              )}
            </div>
          ))}
        </div>

        {/* Repeats the header's "Add Material Line" button, pinned to the
            bottom of the viewport as the rows list grows (same sticky
            bottom-0 pattern as BlueprintTakeoff.jsx's summary bar) — so
            entering several lines in a row never requires scrolling back to
            the top just to add the next one. */}
        <div className="sticky bottom-0 z-10 -mx-5 mt-3 px-5 py-2.5 bg-background/95 backdrop-blur border-t border-border flex justify-end">
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="w-3.5 h-3.5 mr-1" />Add Material Line
          </Button>
        </div>
      </div>

      <div className="steel-card p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-primary">
            <Gauge className="w-4 h-4" />
            <span className="text-sm font-semibold">Shop Efficiency %</span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={shopEfficiencyPct}
              onChange={(e) => updateShopEfficiencyPct(parseFloat(e.target.value) || 0)}
              className="h-8 w-24 text-sm text-right"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Applied to baseline man-hours/ton. 100% = baseline; below 100% (less efficient) increases hours; above 100% decreases them.</p>
      </div>

      {needsWeightCount > 0 && (
        <p className="text-xs text-amber-700 flex items-center gap-1 px-1">
          <AlertTriangle className="w-3.5 h-3.5" />{needsWeightCount} line{needsWeightCount === 1 ? ' has' : 's have'} no weight yet and count 0 lb in the totals until one is typed.
        </p>
      )}

      {areaBreakdown && (
        <div className="steel-card p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <h4 className="font-semibold text-sm">Build Area breakdown — % of total project</h4>
            <span className="text-xs text-muted-foreground">By tons; hours shown alongside. Saving the takeoff updates each Area's % on the Areas tab (unless it was set by hand).</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left py-1.5 pr-2">Area</th>
                  <th className="text-right py-1.5 px-2">Lines</th>
                  <th className="text-right py-1.5 px-2">Tons</th>
                  <th className="text-right py-1.5 px-2">% of project</th>
                  <th className="text-right py-1.5 px-2">Shop hours</th>
                  <th className="text-right py-1.5 pl-2">% of hours</th>
                </tr>
              </thead>
              <tbody>
                {areaBreakdown.rows.map((r) => (
                  <tr key={r.key} className={`border-t border-border ${r.key === 'unassigned' ? 'text-amber-700 dark:text-amber-400' : ''}`}>
                    <td className="py-1.5 pr-2">
                      <button type="button" className="hover:underline text-left" onClick={() => setAreaFilter(r.key)}>{r.name}</button>
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">{r.lineCount}</td>
                    <td className="py-1.5 px-2 text-right font-mono"><MathDrill value={fmtNum(r.tons, 3)} title={`${r.name} — tons`} lines={r.steps.slice(0, -2).concat(`Total ${fmtNum(r.tons, 4)} t`)} /></td>
                    <td className="py-1.5 px-2 text-right font-mono font-semibold"><MathDrill value={`${r.pctTons.toFixed(1)}%`} title={`${r.name} — % of project`} lines={r.steps} /></td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmtNum(r.hours, 1)}</td>
                    <td className="py-1.5 pl-2 text-right font-mono">{r.pctHours.toFixed(1)}%</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-1.5 pr-2">Total project</td>
                  <td className="py-1.5 px-2 text-right font-mono">{areaBreakdown.totals.lineCount}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{fmtNum(areaBreakdown.totals.tons, 3)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{areaBreakdown.totals.tons > 0 ? '100.0%' : '—'}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{fmtNum(areaBreakdown.totals.hours, 1)}</td>
                  <td className="py-1.5 pl-2 text-right font-mono">{areaBreakdown.totals.hours > 0 ? '100.0%' : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {areaBreakdown.unassigned && areaBreakdown.unassigned.tons > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-2 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />{fmtNum(areaBreakdown.unassigned.tons, 3)} t isn't in any Area yet — assign those lines so every ton counts toward an Area.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="steel-card p-4">
          <div className="flex items-center gap-2 text-primary"><Gauge className="w-4 h-4" /><span className="text-sm font-semibold">Total Estimated Tons</span></div>
          <p className="text-2xl font-bold mt-2"><MathDrill value={totalTons.toFixed(2)} title="Total tons" lines={sumLines('tons', 'tons', 'tons', 4)} align="start" /></p>
        </div>
        <div className="steel-card p-4">
          <div className="flex items-center gap-2 text-primary"><Scale className="w-4 h-4" /><span className="text-sm font-semibold">Total Weight (lb)</span></div>
          <p className="text-2xl font-bold mt-2"><MathDrill value={fmtNum(totalLbs, 0)} title="Total weight" lines={[...sumLines('totalLbs', 'weight', 'lb', 1), `${fmtNum(totalLbs, 1)} lb ÷ 2000 = ${totalTons.toFixed(4)} tons`]} align="start" /></p>
        </div>
        <div className="steel-card p-4">
          <div className="flex items-center gap-2 text-primary"><Square className="w-4 h-4" /><span className="text-sm font-semibold">Plate Area (Sq In)</span></div>
          <p className="text-2xl font-bold mt-2"><MathDrill value={fmtNum(totalPlateAreaSqIn, 0)} title="Plate area" lines={sumLines('plateAreaSqIn', 'plate area', 'sq in', 0)} align="start" /></p>
          <p className="text-[11px] text-muted-foreground mt-1">Width × length × qty of plate-type lines.</p>
        </div>
        <div className="steel-card p-4">
          <div className="flex items-center gap-2 text-primary"><Square className="w-4 h-4" /><span className="text-sm font-semibold">Surface Area (Sq In)</span></div>
          <p className="text-2xl font-bold mt-2"><MathDrill value={fmtNum(totalSurfaceSqIn, 0)} title="Surface area" lines={sumLines('surfaceSqIn', 'surface', 'sq in', 0)} align="start" /></p>
          <p className="text-[11px] text-muted-foreground mt-1">Every line, any coating. Only Paint lines feed the paint area below.</p>
        </div>
        <div className="steel-card p-4">
          <div className="flex items-center gap-2 text-primary"><Clock3 className="w-4 h-4" /><span className="text-sm font-semibold">Total Estimated Man-Hours</span></div>
          <p className="text-2xl font-bold mt-2"><MathDrill value={totalManHours.toFixed(1)} title="Man-hours" lines={[...rows.map((row, i) => `${lineLabel(row, i)}: ${rowManHours(i).toFixed(2)} hrs`), `Total: ${totalManHours.toFixed(2)} hrs`]} align="start" /></p>
          <p className="text-[11px] text-muted-foreground mt-1">Fills in the Structural Fabrication hours on the Bid Worksheet when saved. Each line's share is shown as "Shop hours" above.</p>
        </div>
        <div className="steel-card p-4">
          <div className="flex items-center gap-2 text-primary"><Gauge className="w-4 h-4" /><span className="text-sm font-semibold">Total Paint Area (Sq Ft)</span></div>
          <p className="text-2xl font-bold mt-2"><MathDrill value={totalPaintAreaSqFt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} title="Paint area" lines={[...sumLines('paintAreaSqIn', 'paint area', 'sq in', 0), `÷ 144 = ${fmtNum(totalPaintAreaSqFt, 2)} sq ft`]} align="start" /></p>
          <p className="text-[11px] text-muted-foreground mt-1">Auto-fills Primer (Paint) qty on the Bid Worksheet.</p>
        </div>
        <div className="steel-card p-4">
          <div className="flex items-center gap-2 text-primary"><Gauge className="w-4 h-4" /><span className="text-sm font-semibold">Total Galvanized Tons</span></div>
          <p className="text-2xl font-bold mt-2"><MathDrill value={totalGalvanizedTons.toFixed(2)} title="Galvanized tons" lines={[...rows.map((row, i) => (row.coating_type === 'Galvanized' ? `${lineLabel(row, i)}: ${calcs[i].tons.toFixed(4)} tons` : null)).filter(Boolean), `Total: ${totalGalvanizedTons.toFixed(4)} tons`]} align="start" /></p>
          <p className="text-[11px] text-muted-foreground mt-1">Auto-fills Galvanizing qty on the Bid Worksheet.</p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">
          <Save className="w-4 h-4 mr-2" />{saving ? 'Saving…' : 'Save Material Takeoff'}
        </Button>
      </div>

      <AddCatalogSizeDialog
        open={Boolean(addSize)}
        onOpenChange={(o) => { if (!o) setAddSize(null); }}
        target={addSize ? { kind: 'master', shapeType: addSize.shapeType } : null}
        existingValues={addSize ? (sizeOptionsByCode[addSize.shapeType.shape_code] || []).map((o) => o.size_value) : []}
        initialText={addSize?.text || ''}
        catalogRows={catalog}
        onAdded={({ value, record, mirror }) => {
          const code = addSize.shapeType.shape_code;
          setSizeOptionsByCode((prev) => replaceSizeOption(prev, code, record));
          setSizesByCode((prev) => ({ ...prev, [code]: [...(prev[code] || []), value] }));
          if (mirror?.created) setCatalog((prev) => [...prev, mirror.created]);
          if (addSize.idx != null) changeSize(addSize.idx, value);
        }}
        onUseExisting={(value) => { if (addSize?.idx != null) changeSize(addSize.idx, value); }}
      />

      <CombineForOrderingDialog
        open={combineOpen}
        onOpenChange={setCombineOpen}
        source="manual"
        bidId={bid?.id}
        title={`${bid?.bid_number || 'Bid'} — ${bid?.job_name || ''}`}
        subtitle={`Full Takeoff, ${combineInput.pieces.length} line${combineInput.pieces.length === 1 ? '' : 's'} to combine${dirty ? ' (includes unsaved edits)' : ''}`}
        pieces={combineInput.pieces}
        excluded={combineInput.excluded}
      />
    </div>
  );
});

export default FullTakeoff;
