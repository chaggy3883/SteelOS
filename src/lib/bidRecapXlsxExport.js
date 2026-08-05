import JSZip from 'jszip';

// Fills specific input cells on an existing Bid_Proposal_Template.xlsx
// (company_templates, category "Spreadsheet") — a category-rollup estimate
// with no piece-level tab, so this never adds a sheet. It only ever touches
// the exact cells the caller asks for, and only if the template's copy of
// that cell isn't itself a formula (verified empirically: this workbook's
// "blank" input cells are self-closing <c r="B4" s="19"/> placeholders —
// present but valued only by style — while every computed cell carries an
// <f> child, often as part of a shared-formula group covering a whole
// column range). Reading the .xlsx as the zip it actually is and patching
// individual <c> nodes in place — rather than a SheetJS read/write
// round-trip — is what keeps every other cell, tab, form control, image,
// and external-link formula in the file byte-identical (see the sibling
// takeoff-tab injector's commit history for why a full round-trip on this
// exact file is unsafe).
const CELL_REF_RE = /^([A-Z]+)(\d+)$/;

const escapeXmlText = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const colIndex = (letters) => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};

const parseCellRef = (ref) => {
  const m = CELL_REF_RE.exec(ref);
  if (!m) throw new Error(`Invalid cell reference: ${ref}`);
  return { col: m[1], row: Number(m[2]), colIdx: colIndex(m[1]) };
};

const cellXml = (ref, attrs, value, isString) =>
  isString
    ? `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(value)}</t></is></c>`
    : `<c r="${ref}"${attrs}><v>${Number.isFinite(Number(value)) ? Number(value) : 0}</v></c>`;

// Replaces one <c> in a single <row>...</row> block, refusing to touch
// anything that already carries a formula. Returns null (no change) if the
// cell holds a formula; otherwise the row XML with that cell replaced (or
// inserted, in the right column position, if the row has no node for it).
const patchCellInRow = (rowXml, ref, colIdx, value, isString) => {
  // Self-closing MUST be checked first: `<c r="C4" s="255"/>` also matches
  // a naive "<c ...>...</c>" pattern, because `[^>]*` happily swallows the
  // "/" right before the tag's closing ">" — the non-greedy content group
  // then scans forward for the next literal "</c>", which belongs to a
  // *different*, later cell (often one with a real <f> formula). Checking
  // self-closing first avoids ever executing that flawed match.
  const selfClosing = new RegExp(`<c r="${ref}"([^>]*)/>`).exec(rowXml);
  if (selfClosing) {
    const replacement = cellXml(ref, selfClosing[1], value, isString);
    return rowXml.slice(0, selfClosing.index) + replacement + rowXml.slice(selfClosing.index + selfClosing[0].length);
  }

  const withChildren = new RegExp(`<c r="${ref}"([^>]*)>([\\s\\S]*?)</c>`).exec(rowXml);
  if (withChildren) {
    if (/<f[ >/]/.test(withChildren[2])) return null;
    const attrs = withChildren[1].replace(/\st="[^"]*"/, '');
    const replacement = cellXml(ref, attrs, value, isString);
    return rowXml.slice(0, withChildren.index) + replacement + rowXml.slice(withChildren.index + withChildren[0].length);
  }

  // Cell isn't in the row's XML at all — insert it before the first
  // existing cell whose column comes after it, keeping column order.
  const cellTagRe = /<c r="([A-Z]+)\d+"/g;
  let insertAt = rowXml.length;
  let m;
  while ((m = cellTagRe.exec(rowXml))) {
    if (colIndex(m[1]) > colIdx) {
      insertAt = m.index;
      break;
    }
  }
  const newCell = cellXml(ref, '', value, isString);
  return rowXml.slice(0, insertAt) + newCell + rowXml.slice(insertAt);
};

// Applies { cellRef: value } writes to one worksheet's XML, inserting a
// whole new <row> (in row-number order) if a target row has none at all.
const patchSheetXml = (sheetXml, cellWrites, skipped, sheetName) => {
  let result = sheetXml;

  for (const [ref, value] of Object.entries(cellWrites)) {
    if (value === undefined || value === null || value === '') continue;
    const { row, colIdx } = parseCellRef(ref);
    const isString = typeof value !== 'number';

    // Same self-closing-first ordering as patchCellInRow, and for the same
    // reason: an open/close row pattern checked first would swallow a
    // self-closing row's trailing "/" and run on into later rows entirely.
    const selfClosingRowMatch = new RegExp(`<row r="${row}"([^>]*)/>`).exec(result);
    const rowMatch = selfClosingRowMatch || new RegExp(`<row r="${row}"([^>]*)>([\\s\\S]*?)</row>`).exec(result);

    if (!rowMatch) {
      // No row at all for this row number — create one with just this cell,
      // inserted in row-number order among the sheet's other rows.
      const newRow = `<row r="${row}">${cellXml(ref, '', value, isString)}</row>`;
      const rowTagRe = /<row r="(\d+)"/g;
      let insertAt = result.indexOf('</sheetData>');
      let m;
      while ((m = rowTagRe.exec(result))) {
        if (Number(m[1]) > row) {
          insertAt = m.index;
          break;
        }
      }
      result = result.slice(0, insertAt) + newRow + result.slice(insertAt);
      continue;
    }

    const isSelfClosingRow = !!selfClosingRowMatch;
    const rowInner = isSelfClosingRow ? '' : rowMatch[2];
    const patchedInner = patchCellInRow(rowInner, ref, colIdx, value, isString);

    if (patchedInner === null) {
      skipped.push({ sheet: sheetName, cell: ref, reason: 'formula cell — not overwritten' });
      continue;
    }

    const newRowXml = `<row r="${row}"${rowMatch[1]}>${patchedInner}</row>`;
    result = result.slice(0, rowMatch.index) + newRowXml + result.slice(rowMatch.index + rowMatch[0].length);
  }

  return result;
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveSheetPaths = (workbookXml, relsXml, sheetNames) => {
  const paths = {};
  for (const name of sheetNames) {
    const xmlEscapedName = name.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const sheetTag = new RegExp(`<sheet\\b[^>]*\\bname="${escapeRegExp(xmlEscapedName)}"[^>]*/>`).exec(workbookXml);
    if (!sheetTag) throw new Error(`Sheet "${name}" not found in template — refusing to write blind`);
    const rid = /r:id="([^"]+)"/.exec(sheetTag[0])?.[1];
    const relTag = new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*/>`).exec(relsXml);
    const target = relTag && /Target="([^"]+)"/.exec(relTag[0])?.[1];
    if (!target) throw new Error(`Could not resolve worksheet part for sheet "${name}"`);
    paths[name] = `xl/${target}`;
  }
  return paths;
};

const withFullCalcOnLoad = (workbookXml) => {
  if (/<calcPr\b[^>]*\bfullCalcOnLoad=/.test(workbookXml)) return workbookXml;
  if (/<calcPr\b[^>]*\/>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
  }
  return workbookXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
};

// `sheetWrites` = { "Structural": { B4: 1200, A7: "Handrails" }, "RECAP": { C9: "Acme Co", K1: "E26-045" }, ... }
// Returns { bytes, skipped } — `skipped` lists any requested cell that
// turned out to already hold a formula, so the caller can surface that
// instead of silently losing the write.
export async function writeBidRecapCells(templateArrayBuffer, sheetWrites) {
  const zip = await JSZip.loadAsync(templateArrayBuffer);
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');

  const sheetPaths = resolveSheetPaths(workbookXml, relsXml, Object.keys(sheetWrites));
  const skipped = [];

  for (const [sheetName, cellWrites] of Object.entries(sheetWrites)) {
    const path = sheetPaths[sheetName];
    const sheetXml = await zip.file(path).async('string');
    zip.file(path, patchSheetXml(sheetXml, cellWrites, skipped, sheetName));
  }

  zip.file('xl/workbook.xml', withFullCalcOnLoad(workbookXml));

  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return { bytes, skipped };
}

export function downloadWorkbook(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
