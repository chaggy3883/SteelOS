// Detailer assembly bills of material -> assemblies with their parts.
//
// SOURCES
//  * Tekla "ASSEMBLY LIST WITH PARTS (BOM)" report — the PDF a detailer
//    sends (text is read out of the PDF, pdfTextLines.js) or the same report
//    saved as .txt. Each block: an assembly line
//      2B3  1  BEAM  418  418  SC2E        (mark, qty, type, unit lb, ext lb, finish)
//    then the main member (same mark) and the attached parts
//      2B3  1  W14X22          12'-10"
//      p185 2  PL3/8"X3 1/2"   0'-6"
//    Part quantities are TOTALS for all copies of the assembly (2B9 x3 with
//    12 of a395 = 4 per beam). The report gives no part weights and no
//    grades — part weights are calculated (AISC shapes / plate math);
//    grades come from a KSS file for the same job.
//  * KSS (KISS) files — part lines with assembly mark, part mark, qty, size,
//    grade, length, finish. Grouped here into the same assembly shape.
//
// STAGING: one DetailerImportedPiece row per ASSEMBLY (record_kind
// 'assembly', with parts). At commit expandAssemblyRows() turns each into
// one row per physical piece — 2B2 x3 -> 2B2-1, 2B2-2, 2B2-3 — so every
// piece gets its own PieceMark, serial number and QR code.

import { findAiscShape } from '@/lib/aiscShapes';
import { parseDimToken, parseLengthToInches } from '@/lib/materialEntryMath';
import { deriveShapeFromProfile } from '@/lib/materialProfileMatch';

const STEEL_LB_PER_CU_IN = 490 / 1728;
const num = (v) => Number(String(v ?? '').replace(/,/g, ''));
const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- weights

// Plate "PL3/8"X3 1/2"" (thickness x width) -> { thickness, width } inches.
function parsePlate(profile) {
  // PL plate, BPL bent plate, FB/FLT flat bar.
  const m = String(profile || '').toUpperCase().replace(/\s+/g, ' ').match(/^(?:B?PL|FB|FLT|BAR)\s*([^X]+?)\s*X\s*(.+)$/);
  if (!m) return null;
  const t = parseDimToken(m[1].replace(/"/g, '').trim());
  const w = parseDimToken(m[2].replace(/"/g, '').trim());
  return t && w ? { thickness: t, width: w } : null;
}

// Weight of one piece of `profile` cut to `length`. { lbs, source } —
// source 'aisc' (rolled shape lb/ft), 'plate' (t x w x L x 490 lb/ft³), or
// null when the size isn't recognized (weight left blank, flagged).
export function pieceWeight(profile, length) {
  const inches = parseLengthToInches(length);
  if (!(inches > 0)) return { lbs: null, source: null };
  const shape = findAiscShape(profile);
  if (shape?.weightPerFt) return { lbs: round2((shape.weightPerFt * inches) / 12), source: 'aisc' };
  const plate = parsePlate(profile);
  if (plate) return { lbs: round2(plate.thickness * plate.width * inches * STEEL_LB_PER_CU_IN), source: 'plate' };
  return { lbs: null, source: null };
}

// ---------------------------------------------------------------- Tekla BOM

const BOM_SIGNATURE = /ASSEMBLY LIST WITH PARTS\s*\(BOM\)/i;
// mark qty TYPE unit ext [finish | (FINISH NOTE)]
// The finish can be one code ("SC2E"), several ("SC1E BC1E"), or a note in
// parentheses ("(GALV.)").
const ASSEMBLY_LINE = /^(\S+)\s+(\d+)\s+([A-Z][A-Z_ ]*?[A-Z])\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)(?:\s+(\([^)]*\)|[A-Z0-9.]+(?:\s+[A-Z0-9.]+)*))?$/i;
// mark qty profile length   (profile may contain spaces: PL3/8"X3 1/2")
const PART_LINE = /^(\S+)\s+(\d+)\s+(.+?)\s+((?:\d+'\s*-\s*)?\d+(?:\.\d+)?(?:\s+\d+\/\d+)?")$/;
const SEPARATOR = /^[\s\-=_]+$/;
const PAGE_HEADER = [/^Unit\s+Ext\.?/i, /^Mark\s+Qty\.?\s+Profile/i, /Page:\s*\d+\s*$/i];
const TOTAL_LINE = /^Total weight for\s+(\d+)\s+Assembl(?:y|ies)\s*:\s*([\d,]+(?:\.\d+)?)/i;

export const looksLikeAssemblyBom = (text) => BOM_SIGNATURE.test(String(text || '').split(/\r\n|\r|\n/).slice(0, 15).join('\n'));

// lines: array of text lines (PDF lines or .txt lines).
// -> { header, assemblies, reported: { count, weight } | null, errors }
export function parseAssemblyBom(lines) {
  const header = {};
  const assemblies = [];
  const errors = [];
  let reported = null;
  let current = null;
  let started = false;

  lines.forEach((raw, idx) => {
    const line = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!line) return;
    if (SEPARATOR.test(line)) return;
    if (PAGE_HEADER.some((re) => re.test(line))) return;
    if (/^END OF REPORT/i.test(line)) return;
    if (!started) {
      const pn = line.match(/PROJECT NAME:\s*(.+?)(?:\s+Date:.*)?$/i);
      if (pn) header.project_name = pn[1].trim();
      const jn = line.match(/JOB NUMBER:\s*(\S+)/i);
      if (jn) header.job_number = jn[1].trim();
      const dt = line.match(/Date:\s*([\d/.-]+)/i);
      if (dt) header.date = dt[1];
    }
    const total = line.match(TOTAL_LINE);
    if (total) { reported = { count: num(total[1]), weight: num(total[2]) }; return; }

    const asm = line.match(ASSEMBLY_LINE);
    if (asm && !PART_LINE.test(line)) {
      started = true;
      const finishRaw = asm[6] || '';
      current = {
        mark: asm[1],
        quantity: num(asm[2]),
        type: asm[3].replace(/_/g, ' ').trim().toUpperCase(),
        unit_weight: num(asm[4]),
        ext_weight: num(asm[5]),
        finish: finishRaw.replace(/^\(|\)$/g, '').trim(),
        main: null,
        parts: [],
        source_line: idx + 1,
      };
      assemblies.push(current);
      return;
    }
    if (!started) return; // title block
    const part = line.match(PART_LINE);
    if (!part) {
      errors.push(`Line ${idx + 1} wasn't recognized and was skipped: "${line}"`);
      return;
    }
    if (!current) { errors.push(`Line ${idx + 1} is a part with no assembly above it: "${line}"`); return; }
    const [, mark, qtyText, profile, length] = part;
    const qtyTotal = num(qtyText);
    const isMain = !current.main && mark.toUpperCase() === current.mark.toUpperCase();
    const { lbs, source } = pieceWeight(profile, length);
    const entry = {
      part_mark: mark,
      quantity_total: qtyTotal,
      quantity_per_assembly: current.quantity > 0 && qtyTotal % current.quantity === 0 ? qtyTotal / current.quantity : qtyTotal,
      profile: profile.trim(),
      length: length.replace(/\s*-\s*/, '-').trim(),
      grade: '',
      weight_each_lbs: lbs,
      weight_source: source,
    };
    // Shear studs (STUD_1/2-DIA): hardware, like the KSS's stud lines — not
    // flagged as an unrecognized size.
    if (/^STUD/i.test(entry.profile)) entry.kind = 'stud';
    if (current.quantity > 0 && qtyTotal % current.quantity !== 0) {
      entry.quantity_note = `${qtyTotal} total doesn't divide evenly by ${current.quantity} copies`;
    }
    if (isMain) current.main = entry;
    else current.parts.push(entry);
  });

  return { header, assemblies, reported, errors };
}

// ---------------------------------------------------------------- KSS

// KSS part rows (parseDetailerKssFile output) -> assemblies. The part whose
// mark equals the assembly mark is the main member; its quantity is the
// assembly count. Grades / finish / drawing / rev come straight from KSS.
export function groupKssRowsIntoAssemblies(rows) {
  const byMark = new Map();
  rows.forEach((r) => {
    const mark = (r.assembly || r.piece_mark || '').trim();
    if (!mark) return;
    if (!byMark.has(mark)) byMark.set(mark, []);
    byMark.get(mark).push(r);
  });
  return [...byMark.entries()].map(([mark, list]) => {
    const steel = list.filter((r) => !r.hardware_kind);
    const mainRow = steel.find((r) => (r.piece_mark || '').toUpperCase() === mark.toUpperCase()) || steel[0] || list[0];
    const quantity = Number(mainRow.quantity) || 1;
    const toPart = (r) => {
      const qtyTotal = Number(r.quantity) || 1;
      const { lbs, source } = r.hardware_kind ? { lbs: null, source: null } : pieceWeight(r.material_profile, r.finished_length);
      const part = {
        part_mark: r.piece_mark,
        quantity_total: qtyTotal,
        quantity_per_assembly: qtyTotal % quantity === 0 ? qtyTotal / quantity : qtyTotal,
        profile: r.material_profile,
        length: r.finished_length,
        grade: r.material_grade || '',
        weight_each_lbs: lbs,
        weight_source: source,
      };
      // Bolts / studs: hardware on the assembly (KSS Notes "Field" / "Shop").
      if (r.hardware_kind) {
        part.kind = r.hardware_kind;
        if (/^(field|shop)$/i.test(r.notes || '')) part.install = r.notes.charAt(0).toUpperCase() + r.notes.slice(1).toLowerCase();
      }
      return part;
    };
    const main = toPart(mainRow);
    const parts = list.filter((r) => r !== mainRow).map(toPart);
    const unit = [main, ...parts].reduce((s, p) => s + (p.weight_each_lbs || 0) * (p.quantity_per_assembly || 0), 0);
    return {
      mark,
      quantity,
      type: String(mainRow.notes || '').replace(/_+/g, ' ').trim().toUpperCase(),
      unit_weight: round2(unit) || null,
      ext_weight: unit ? round2(unit * quantity) : null,
      finish: mainRow.raw_row_data?.finish || '',
      main,
      parts,
      grade: mainRow.material_grade || '',
      drawing_number: mainRow.drawing_number || '',
      revision: mainRow.revision || '',
      sequence: mainRow.raw_row_data?.sequence || '',
      weight_is_calculated: true,
    };
  });
}

// ---------------------------------------------------------------- staging

// One staged row per assembly.
export function assemblyToStagedRow(a, { sourceKind } = {}) {
  const errors = [];
  if (!a.main) errors.push('No main member line found under this assembly');
  if (!(a.quantity > 0)) errors.push('Assembly quantity is missing');
  const warnings = [];
  const unweighed = [a.main, ...a.parts].filter((p) => p && !p.kind && p.weight_each_lbs == null).map((p) => p.part_mark);
  if (unweighed.length) warnings.push(`No weight calculated for ${unweighed.join(', ')} (size not recognized)`);
  return {
    record_kind: 'assembly',
    source_kind: sourceKind || '',
    piece_mark: a.mark,
    assembly: a.mark,
    assembly_type: a.type || '',
    material_profile: a.main?.profile || '',
    shape: deriveShapeFromProfile(a.main?.profile || ''),
    material_grade: a.grade || a.main?.grade || '',
    finished_length: a.main?.length || '',
    quantity: a.quantity || null,
    weight: a.unit_weight ?? null,
    finish: a.finish || '',
    drawing_number: a.drawing_number || '',
    revision: a.revision || '',
    sequence: a.sequence || '',
    notes: a.finish ? `Finish ${a.finish}` : '',
    main_member: a.main || null,
    parts: a.parts || [],
    raw_row_data: { assembly: a.mark, assembly_type: a.type, quantity: a.quantity, unit_weight: a.unit_weight, ext_weight: a.ext_weight, finish: a.finish, source_line: a.source_line },
    validation_status: errors.length ? 'error' : 'valid',
    validation_errors: errors,
    validation_warnings: warnings,
  };
}

// Full parse of a Tekla BOM (PDF lines or .txt) into staged rows + checks
// against the report's own totals.
export function parseAssemblyBomToRows(lines) {
  const { header, assemblies, reported, errors } = parseAssemblyBom(lines);
  const rows = assemblies.map((a) => assemblyToStagedRow(a, { sourceKind: 'tekla_bom' }));
  const fileErrors = [...errors];
  const pieces = assemblies.reduce((s, a) => s + (a.quantity || 0), 0);
  const weight = assemblies.reduce((s, a) => s + (a.ext_weight || 0), 0);
  if (reported) {
    if (reported.count !== pieces) fileErrors.unshift(`Report says ${reported.count} assemblies; ${pieces} were read — check for skipped lines.`);
    if (Math.abs(reported.weight - weight) > Math.max(5, reported.weight * 0.001)) fileErrors.unshift(`Report total is ${reported.weight.toLocaleString()} lb; the assemblies read add up to ${weight.toLocaleString()} lb.`);
  }
  return { rows, fileErrors, summary: { header, assemblyMarks: assemblies.length, pieces, weight, reported } };
}

// ---------------------------------------------------------------- commit

// Assembly rows -> one row per physical piece (2B2 x3 -> 2B2-1..-3), every
// copy keeping the staged row's id (so skip/commit bookkeeping still works
// per staged row). Rows for the same assembly from two files (the PDF BOM
// and the KSS) merge first: the BOM's detailer weights and type win, the
// KSS fills in grades, finish, drawing number, revision and sequence.
// Non-assembly rows (CSV, other formats) pass through untouched.
export function expandAssemblyRows(rows) {
  const out = [];
  const merged = new Map();
  rows.forEach((row) => {
    if (row.record_kind !== 'assembly') { out.push(row); return; }
    const key = String(row.assembly || row.piece_mark || '').toUpperCase();
    const prev = merged.get(key);
    if (!prev) { merged.set(key, { ...row }); return; }
    const bomFirst = prev.source_kind === 'tekla_bom' ? prev : row;
    const other = bomFirst === prev ? row : prev;
    const gradeByPart = new Map([other.main_member, ...(other.parts || [])].filter(Boolean).map((p) => [String(p.part_mark).toUpperCase(), p.grade]));
    const withGrade = (p) => (p ? { ...p, grade: p.grade || gradeByPart.get(String(p.part_mark).toUpperCase()) || '' } : p);
    // The BOM report has no bolts (studs it does list) — add the KSS's
    // hardware lines that aren't already there by part mark.
    const bomParts = (bomFirst.parts || []).map(withGrade);
    const bomMarks = new Set([bomFirst.main_member, ...bomParts].filter(Boolean).map((p) => String(p.part_mark || '').toUpperCase()).filter(Boolean));
    const hardware = (other.parts || []).filter((p) => p.kind && !(p.part_mark && bomMarks.has(String(p.part_mark).toUpperCase())));
    merged.set(key, {
      ...bomFirst,
      assembly_type: bomFirst.assembly_type || other.assembly_type || '',
      material_grade: bomFirst.material_grade || other.material_grade || '',
      finish: bomFirst.finish || other.finish || '',
      drawing_number: bomFirst.drawing_number || other.drawing_number || '',
      revision: bomFirst.revision || other.revision || '',
      sequence: bomFirst.sequence || other.sequence || '',
      sequence_area_id: bomFirst.sequence_area_id || other.sequence_area_id || null,
      main_member: withGrade(bomFirst.main_member),
      parts: [...bomParts, ...hardware],
      committed: bomFirst.committed && other.committed,
      _merged_row_ids: [bomFirst.id, other.id].filter(Boolean),
    });
  });
  merged.forEach((row) => {
    const copies = Math.max(1, Number(row.quantity) || 1);
    for (let i = 1; i <= copies; i += 1) {
      out.push({
        ...row,
        piece_mark: `${row.assembly || row.piece_mark}-${i}`,
        assembly_mark: row.assembly || row.piece_mark,
        copy_number: i,
        copy_count: copies,
        quantity: 1,
      });
    }
  });
  return out;
}
