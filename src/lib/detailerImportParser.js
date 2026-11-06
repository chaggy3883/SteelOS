// Parses detailer-supplied CSV, KSS (KISS), and Tekla "Assembly List with
// Parts (BOM)" text-report files into the shape DetailerImportedPiece
// staging rows expect. CSV and KSS are unconfirmed against real detailer
// output — CSV column names and the KISS detail-line layout below follow
// the general documented conventions (CSV: whatever headers a shop would
// reasonably name their columns; KISS: the comma-delimited "Keep It Simple
// Steel" BOM exchange format used by SDS2 / Advance Steel / Tekla, id line +
// detail lines of Drawing No, Drawing Rev, Assembly mark, Part Mark,
// Quantity, Type of Material, Size of Material, Grade, Length, Finish,
// Notes) rather than a sample file from a specific detailer. The Tekla BOM
// parser below, by contrast, is built directly against a real exported
// report's structure. Nothing here writes to PieceMark directly — every
// parser only produces staged rows for review.
import { deriveShapeFromProfile } from '@/lib/materialProfileMatch';
import { looksLikeAssemblyBom, parseAssemblyBomToRows, groupKssRowsIntoAssemblies, assemblyToStagedRow } from '@/lib/assemblyBom';

const parseCsvText = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') { inQuotes = true; continue; }
    if (char === ',') { pushField(); continue; }
    if (char === '\r') continue;
    if (char === '\n') { pushRow(); continue; }
    field += char;
  }
  if (field.length > 0 || row.length > 0) pushRow();

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
};

const normalizeHeader = (header) => String(header || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

const CSV_HEADER_ALIASES = {
  piece_mark: ['piece_mark', 'piecemark', 'mark', 'part_mark'],
  assembly: ['assembly', 'assembly_mark'],
  material_profile: ['material_profile', 'material_shape', 'shape', 'size', 'profile'],
  material_grade: ['material_grade', 'grade'],
  drawing_number: ['drawing_number', 'drawing_no', 'drawing'],
  revision: ['revision', 'rev', 'drawing_rev'],
  quantity: ['quantity', 'qty'],
  weight: ['weight', 'weight_lbs', 'weight_lb'],
  finished_length: ['finished_length', 'length', 'finished_length_ft'],
  notes: ['notes', 'note', 'comments', 'comment'],
};

const validateStagedRow = ({ piece_mark, quantity, weight }) => {
  const errors = [];

  let quantityValue = 1;
  if (quantity !== undefined && quantity !== null && String(quantity).trim() !== '') {
    quantityValue = Number(String(quantity).replace(/,/g, ''));
    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      errors.push(`Invalid quantity "${quantity}"`);
      quantityValue = null;
    }
  }

  let weightValue = null;
  if (weight !== undefined && weight !== null && String(weight).trim() !== '') {
    weightValue = Number(String(weight).replace(/,/g, ''));
    if (!Number.isFinite(weightValue)) {
      errors.push(`Invalid weight "${weight}"`);
      weightValue = null;
    }
  }

  if (!piece_mark) errors.push('Missing piece mark');

  return { quantityValue, weightValue, errors };
};

export const parseDetailerCsvFile = (text) => {
  const table = parseCsvText(text);
  if (table.length === 0) return { rows: [], fileErrors: ['File is empty.'] };

  const [headerRow, ...dataRows] = table;
  const headers = headerRow.map((h) => String(h || '').trim());
  const normalizedHeaders = headers.map(normalizeHeader);

  const columnIndex = {};
  Object.entries(CSV_HEADER_ALIASES).forEach(([field, aliases]) => {
    const idx = normalizedHeaders.findIndex((h) => aliases.includes(h));
    if (idx !== -1) columnIndex[field] = idx;
  });

  if (columnIndex.piece_mark === undefined) {
    return { rows: [], fileErrors: ['CSV is missing a piece mark column (expected a header like "piece_mark").'] };
  }

  const get = (cells, field) => (columnIndex[field] !== undefined ? String(cells[columnIndex[field]] || '').trim() : '');

  const rows = dataRows
    .filter((cells) => cells.some((cell) => String(cell || '').trim() !== ''))
    .map((cells) => {
      const raw_row_data = {};
      headers.forEach((h, i) => { raw_row_data[h || `column_${i + 1}`] = cells[i] ?? ''; });

      const piece_mark = get(cells, 'piece_mark');
      const material_profile = get(cells, 'material_profile');
      const { quantityValue, weightValue, errors } = validateStagedRow({
        piece_mark, quantity: get(cells, 'quantity'), weight: get(cells, 'weight'),
      });

      return {
        piece_mark,
        assembly: get(cells, 'assembly'),
        material_profile,
        shape: deriveShapeFromProfile(material_profile),
        material_grade: get(cells, 'material_grade'),
        finished_length: get(cells, 'finished_length'),
        quantity: quantityValue,
        weight: weightValue,
        drawing_number: get(cells, 'drawing_number'),
        revision: get(cells, 'revision'),
        notes: get(cells, 'notes'),
        raw_row_data,
        validation_status: errors.length ? 'error' : 'valid',
        validation_errors: errors,
        validation_warnings: [],
      };
    });

  return { rows, fileErrors: [] };
};

// KISS detail-line field order (id line's own fields aside): Line Identifier,
// Drawing No, Drawing Rev, Assembly mark, Part Mark, Quantity, Type of
// Material, Size of Material, Grade, Length, Finish, Notes.
const KSS_DETAIL_FIELDS = ['line_id', 'drawing_number', 'revision', 'assembly', 'piece_mark', 'quantity', 'material_type', 'material_profile', 'material_grade', 'finished_length', 'finish', 'notes'];
const KSS_MIN_DETAIL_FIELDS = 10;

export const parseDetailerKssFile = (text) => {
  const lines = text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { rows: [], fileErrors: ['File is empty.'] };

  const fileErrors = [];
  let startIndex = 0;
  if (/^kiss\b/i.test(lines[0])) {
    startIndex = 1;
  } else {
    fileErrors.push('First line is not a recognized KISS identification line ("KISS,<version>,<product>") — parsing every line as a detail line instead.');
  }

  const rows = [];
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 254) fileErrors.push(`Line ${i + 1} exceeds the 254-character KISS line limit — parsed anyway.`);

    const cells = line.split(',').map((c) => c.trim());
    if (cells.length < KSS_MIN_DETAIL_FIELDS) {
      fileErrors.push(`Line ${i + 1} has too few fields to be a KISS detail line — skipped (likely a header, labor, or sequencing line).`);
      continue;
    }

    const raw_row_data = {};
    KSS_DETAIL_FIELDS.forEach((field, idx) => { raw_row_data[field] = cells[idx] ?? ''; });

    const piece_mark = cells[4] || '';
    const material_profile = cells[7] || cells[6] || '';
    const { quantityValue, weightValue, errors } = validateStagedRow({
      piece_mark, quantity: cells[5], weight: undefined,
    });

    rows.push({
      piece_mark,
      assembly: cells[3] || '',
      material_profile,
      shape: deriveShapeFromProfile(material_profile),
      material_grade: cells[8] || '',
      finished_length: cells[9] || '',
      quantity: quantityValue,
      weight: weightValue,
      drawing_number: cells[1] || '',
      revision: cells[2] || '',
      notes: cells[11] || '',
      raw_row_data,
      validation_status: errors.length ? 'error' : 'valid',
      validation_errors: errors,
      validation_warnings: [],
    });
  }

  // Lines carry an assembly mark -> group the parts under their assemblies
  // (assemblyBom.js), same shape as the PDF BOM: one staged row per
  // assembly with its parts and their grades. KSS has no assembly weight,
  // so the assembly's weight is the sum of its calculated part weights.
  // A file with no assembly marks stays one row per line, as before.
  if (rows.some((r) => r.assembly)) {
    const grouped = groupKssRowsIntoAssemblies(rows.filter((r) => r.validation_status !== 'error'));
    const errorRows = rows.filter((r) => r.validation_status === 'error');
    return {
      rows: [...grouped.map((a) => assemblyToStagedRow(a, { sourceKind: 'kss' })), ...errorRows],
      fileErrors,
    };
  }

  return { rows, fileErrors };
};

// Tekla "Assembly List with Parts (BOM)" report — the PDF a detailer sends
// (DetailerImports.jsx reads its text out first, pdfTextLines.js) or the
// same report saved as .txt. Parsed by assemblyBom.js into ONE staged row
// per assembly (mark, copies, type, main member, finish, detailer weight)
// with its attached parts and their calculated weights; commit splits each
// into one piece per copy (2B2-1, 2B2-2 …). The report's own
// "Total weight for N Assemblies" line is checked against what was read.
const looksLikeTeklaBomFile = looksLikeAssemblyBom;

export const parseDetailerTeklaBomFile = (text) => {
  const lines = String(text || '').split(/\r\n|\r|\n/);
  if (lines.every((l) => l.trim() === '')) return { rows: [], fileErrors: ['File is empty.'] };
  return parseAssemblyBomToRows(lines);
};

// A PDF that is a bill of materials (not a drawing): read for data instead
// of being matched to a piece as a drawing. Judged by name before it's read
// (DetailerImports.jsx confirms the report signature after reading it).
const BOM_PDF_NAME = /\b(bom|bill of material|material list|assembly list|parts list)\b/i;
export const isBomPdfName = (fileName) => /\.pdf$/i.test(String(fileName || '')) && BOM_PDF_NAME.test(String(fileName || '').replace(/[_-]+/g, ' '));

// Extension-based dispatch is the default, but Tekla BOM content is
// recognized by its own signature line first — regardless of extension —
// since a detailer may have saved/pasted it under .csv or another extension
// PARSABLE_EXTENSIONS already accepts. isParsableDetailerFile only sees the
// file name (called before the file is fetched, just to show the Parse
// button), so 'txt' is added to PARSABLE_EXTENSIONS as the Tekla BOM
// parser's extension fast-path; the content-signature check in
// parseDetailerImportFile is what makes routing correct once the file is
// actually read, including the .csv-pasted-content case.
const PARSABLE_EXTENSIONS = { csv: parseDetailerCsvFile, kss: parseDetailerKssFile, txt: parseDetailerTeklaBomFile };

export const isParsableDetailerFile = (fileName) => {
  if (isBomPdfName(fileName)) return true;
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PARSABLE_EXTENSIONS, ext);
};

// CNC fabrication files (NC1, DXF) are also non-parsable data-wise, but they
// already get their own dedicated intake path (auto-matched to a PieceMark
// by filename at upload time, with their own unmatched-assignment UI — see
// DetailerImports.jsx's matchAndAttachCncFiles) — shared here so that path
// and isDrawingFile below classify files identically instead of drifting.
const CNC_EXTENSIONS = ['nc1', 'dxf'];
export const isCncFile = (fileName) => CNC_EXTENSIONS.includes(String(fileName || '').split('.').pop().toLowerCase());

// Everything else non-parsable (PDFs, and any other file type a detailer
// export happens to include) is a "drawing" for review purposes — surfaced
// in BatchReviewModal.jsx's Attached Drawings section instead of vanishing,
// and matched to a PieceMark by filename at commit time (detailerImportCommit.js)
// the same way PieceMarkPdfIntake.jsx matches drawings dropped directly onto
// the Pieces section.
export const isDrawingFile = (fileName) => !isParsableDetailerFile(fileName) && !isCncFile(fileName);

export const parseDetailerImportFile = (fileName, text) => {
  if (looksLikeTeklaBomFile(text)) return parseDetailerTeklaBomFile(text);
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  const parser = PARSABLE_EXTENSIONS[ext];
  return parser ? parser(text) : null;
};
