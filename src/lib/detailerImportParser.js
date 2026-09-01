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
      validation_warnings: [],
    });
  }

  return { rows, fileErrors };
};

// Tekla "Assembly List with Parts (BOM)" text report. This is a PDF-derived
// export with no dedicated file extension of its own — a detailer might
// save it as .txt or paste it into a .csv-extensioned file — so it's
// recognized by a content signature (see looksLikeTeklaBomFile below) as
// well as by the .txt extension, rather than by extension alone.
//
// Layout: a header block (report title, project name, job number, date,
// time — free text, skipped wholesale until the first assembly block
// starts), then one block per assembly, bounded by dashed separator lines.
// Each block starts with a summary line — {assembly_mark} {total_qty}
// {assembly_type} {total_weight} {ext_weight}, optionally followed by a
// "(GALV.)"-style finish note in parens — then the assembly's own main
// piece line and zero or more minor/connection part lines, all sharing the
// same {piece_mark} {qty} {profile} {length} shape (main piece's mark
// equals the assembly mark; an assembly with no minor parts has only this
// one line, which is normal). Page headers ("Unit Ext. Page: N" / the
// column-label line) repeat mid-document and are stripped like the
// separators, not parsed as data. The report footer ("Total weight for N
// Assemblies: ..." / "END OF REPORT") is recognized and excluded; N is
// compared against the parsed assembly count as a validation check.
//
// Known artifact: some part lines concatenate without a line break where
// the source PDF wrapped a page (e.g. a main piece line run directly into
// the next minor part line). Rather than treating a line as always exactly
// one record, TEKLA_RECORD_REGEX is matched against each line with the
// global flag and re-run until exhausted — a line containing more than one
// {piece_mark} {qty} {profile} {length} match is split into that many rows.
//
// This report has no per-line grade column, so material_grade is left
// blank on every row rather than guessed — the existing batch-wide
// validateBatchRows (detailerImportValidation.js) already flags a blank
// material_grade as a warning during review, same as it would for any other
// parser, so no separate validation path is needed here. The assembly's
// finish note (e.g. "(GALV.)") is captured in raw_row_data for traceability
// on every row of that assembly's block; it's deliberately NOT written into
// material_grade (that would fabricate a grade value) or appended to
// material_profile (that would break steel_catalog matching for every
// finished row) — a reviewer who needs galvanized and non-galvanized stock
// of the same profile/length kept separate during optimization can use the
// captured note to set distinguishing grades by hand during staging review.
const ASSEMBLY_TYPE_KEYWORDS = ['EMBED PLATE', 'LINTEL ANGLE', 'BENT PLATE', 'HANGER POST', 'BEAM', 'COLUMN', 'BRACE', 'FRAME', 'CHANNEL', 'ANGLE', 'HANGER', 'POST'];

const TEKLA_BOM_SIGNATURE = /ASSEMBLY LIST WITH PARTS\s*\(BOM\)/i;

const TEKLA_ASSEMBLY_SUMMARY_REGEX = new RegExp(
  `^(\\S+)\\s+(\\d+)\\s+(${ASSEMBLY_TYPE_KEYWORDS.join('|')})\\s+([\\d,]+\\.?\\d*)\\s+([\\d,]+\\.?\\d*)(?:\\s*\\(([^)]+)\\))?\\s*$`,
  'i',
);

// piece_mark, qty, profile (non-greedy — profile itself may contain a
// literal " for inches, e.g. PL3/8"X4"), length (feet-inches-fraction, e.g.
// 39'-4 3/8", or bare inches for short parts, e.g. 8").
const TEKLA_RECORD_REGEX = /([A-Za-z0-9]+)\s+(\d+)\s+([A-Za-z0-9./"]+?)\s+((?:\d+'-)?\d+(?:\s+\d+\/\d+)?")/g;

const TEKLA_SEPARATOR_LINE_REGEX = /^[\s-]+$/;
const TEKLA_PAGE_HEADER_REGEXES = [/^Unit Ext\.?\s*Page:\s*\d+/i, /^Mark\s+Qty\.?\s+Profile\s+Length\s+Weight\s+Weight\s+Finish/i];
const TEKLA_TOTAL_WEIGHT_REGEX = /^Total weight for\s+(\d+)\s+Assemblies?:/i;
const TEKLA_END_OF_REPORT_REGEX = /^END OF REPORT/i;

const looksLikeTeklaBomFile = (text) => TEKLA_BOM_SIGNATURE.test(String(text || '').split(/\r\n|\r|\n/).slice(0, 10).join('\n'));

export const parseDetailerTeklaBomFile = (text) => {
  const lines = String(text || '').split(/\r\n|\r|\n/);
  if (lines.every((l) => l.trim() === '')) return { rows: [], fileErrors: ['File is empty.'] };

  const fileErrors = [];
  const rows = [];

  let inHeader = true;
  let currentAssembly = null;
  let currentAssemblyMeta = null;
  let isFirstRowOfBlock = false;
  let parsedAssemblyCount = 0;
  let reportedAssemblyCount = null;

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    const lineNumber = idx + 1;
    if (line === '') return;
    if (TEKLA_SEPARATOR_LINE_REGEX.test(line) && line.replace(/\s/g, '').length >= 3) return;
    if (TEKLA_PAGE_HEADER_REGEXES.some((re) => re.test(line))) return;
    if (TEKLA_END_OF_REPORT_REGEX.test(line)) return;

    const totalMatch = line.match(TEKLA_TOTAL_WEIGHT_REGEX);
    if (totalMatch) { reportedAssemblyCount = Number(totalMatch[1]); return; }

    const summaryMatch = line.match(TEKLA_ASSEMBLY_SUMMARY_REGEX);
    if (summaryMatch) {
      inHeader = false;
      parsedAssemblyCount += 1;
      currentAssembly = summaryMatch[1];
      currentAssemblyMeta = {
        assembly_type: summaryMatch[3],
        total_qty: summaryMatch[2],
        total_weight: summaryMatch[4],
        ext_weight: summaryMatch[5],
        finish_note: summaryMatch[6] || '',
      };
      isFirstRowOfBlock = true;
      return;
    }

    if (inHeader) return; // report title / project name / job number / date / time

    if (!currentAssembly) {
      fileErrors.push(`Line ${lineNumber} looks like a part record but no assembly block has started yet — skipped: "${line}"`);
      return;
    }

    const records = [];
    TEKLA_RECORD_REGEX.lastIndex = 0;
    let match;
    while ((match = TEKLA_RECORD_REGEX.exec(line)) !== null) {
      records.push({ piece_mark: match[1], quantity: match[2], profile: match[3], length: match[4] });
    }

    if (records.length === 0) {
      fileErrors.push(`Line ${lineNumber} could not be parsed as a part record — skipped: "${line}"`);
      return;
    }
    if (records.length > 1) {
      fileErrors.push(`Line ${lineNumber} contained ${records.length} concatenated part records (source PDF line-wrap artifact) — split automatically.`);
    }

    records.forEach((record) => {
      const raw_row_data = {
        assembly: currentAssembly,
        piece_mark: record.piece_mark,
        quantity: record.quantity,
        profile: record.profile,
        length: record.length,
        source_line: line,
      };
      if (currentAssemblyMeta?.finish_note) raw_row_data.finish_note = currentAssemblyMeta.finish_note;
      if (isFirstRowOfBlock) {
        raw_row_data.assembly_type = currentAssemblyMeta.assembly_type;
        raw_row_data.assembly_total_qty = currentAssemblyMeta.total_qty;
        raw_row_data.assembly_total_weight = currentAssemblyMeta.total_weight;
        raw_row_data.assembly_ext_weight = currentAssemblyMeta.ext_weight;
      }

      const { quantityValue, weightValue, errors } = validateStagedRow({
        piece_mark: record.piece_mark, quantity: record.quantity, weight: undefined,
      });

      rows.push({
        piece_mark: record.piece_mark,
        assembly: currentAssembly,
        material_profile: record.profile,
        material_grade: '',
        finished_length: record.length,
        quantity: quantityValue,
        weight: weightValue,
        drawing_number: '',
        revision: '',
        raw_row_data,
        validation_status: errors.length ? 'error' : 'valid',
        validation_errors: errors,
        validation_warnings: [],
      });

      isFirstRowOfBlock = false;
    });
  });

  if (reportedAssemblyCount != null && reportedAssemblyCount !== parsedAssemblyCount) {
    fileErrors.push(`Report states ${reportedAssemblyCount} assemblies but ${parsedAssemblyCount} were parsed — verify no assembly blocks were missed or mis-parsed.`);
  }

  return { rows, fileErrors };
};

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
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PARSABLE_EXTENSIONS, ext);
};

export const parseDetailerImportFile = (fileName, text) => {
  if (looksLikeTeklaBomFile(text)) return parseDetailerTeklaBomFile(text);
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  const parser = PARSABLE_EXTENSIONS[ext];
  return parser ? parser(text) : null;
};
