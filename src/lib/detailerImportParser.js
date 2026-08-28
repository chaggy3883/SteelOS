// Parses detailer-supplied CSV and KSS (KISS) files into the shape
// DetailerImportedPiece staging rows expect. Both formats are unconfirmed
// against real detailer output — CSV column names and the KISS detail-line
// layout below follow the general documented conventions (CSV: whatever
// headers a shop would reasonably name their columns; KISS: the
// comma-delimited "Keep It Simple Steel" BOM exchange format used by SDS2 /
// Advance Steel / Tekla, id line + detail lines of Drawing No, Drawing Rev,
// Assembly mark, Part Mark, Quantity, Type of Material, Size of Material,
// Grade, Length, Finish, Notes) rather than a sample file from a specific
// detailer. Nothing here writes to PieceMark directly — it only produces
// staged rows for review.

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
      const { quantityValue, weightValue, errors } = validateStagedRow({
        piece_mark, quantity: get(cells, 'quantity'), weight: get(cells, 'weight'),
      });

      return {
        piece_mark,
        assembly: get(cells, 'assembly'),
        material_profile: get(cells, 'material_profile'),
        material_grade: get(cells, 'material_grade'),
        finished_length: get(cells, 'finished_length'),
        quantity: quantityValue,
        weight: weightValue,
        drawing_number: get(cells, 'drawing_number'),
        revision: get(cells, 'revision'),
        raw_row_data,
        validation_status: errors.length ? 'error' : 'valid',
        validation_errors: errors,
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
    const { quantityValue, weightValue, errors } = validateStagedRow({
      piece_mark, quantity: cells[5], weight: undefined,
    });

    rows.push({
      piece_mark,
      assembly: cells[3] || '',
      material_profile: cells[7] || cells[6] || '',
      material_grade: cells[8] || '',
      finished_length: cells[9] || '',
      quantity: quantityValue,
      weight: weightValue,
      drawing_number: cells[1] || '',
      revision: cells[2] || '',
      raw_row_data,
      validation_status: errors.length ? 'error' : 'valid',
      validation_errors: errors,
    });
  }

  return { rows, fileErrors };
};

const PARSABLE_EXTENSIONS = { csv: parseDetailerCsvFile, kss: parseDetailerKssFile };

export const isParsableDetailerFile = (fileName) => {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PARSABLE_EXTENSIONS, ext);
};

export const parseDetailerImportFile = (fileName, text) => {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  const parser = PARSABLE_EXTENSIONS[ext];
  return parser ? parser(text) : null;
};
