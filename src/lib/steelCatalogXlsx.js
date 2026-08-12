import * as XLSX from 'xlsx';
import { SHAPE_CLASSES } from '@/data/steelShapeSelector';

function fmt(n) {
  return String(Math.round(n * 1000) / 1000);
}

function parseFractionalInches(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  let total = 0;
  for (const part of t.split(/\s+/)) {
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

function decodeValue(v) {
  if (typeof v === 'number' && v > 1000) {
    const d = XLSX.SSF.parse_date_code(v);
    return { decimal: d.m / d.d, text: `${d.m}/${d.d}` };
  }
  if (typeof v === 'number') return { decimal: v, text: String(v) };
  return { decimal: null, text: String(v || '') };
}

// Steel sizes .xlsx's Sheet1 packs five shape families side-by-side in fixed
// column/row blocks (Wide Flange A-F, HSS H-K, Pipe M-R, Channel T-Y, Angle
// AA-AF) rather than one flat [Shape Type][Size][...] table — these ranges
// were validated against the real file (see extract_final.cjs, the one-time
// script that produced extracted_catalog_rows.json from the same layout).
export function parseSteelCatalogWorkbook(workbook) {
  const sheet = workbook.Sheets['Sheet1'];
  if (!sheet) throw new Error('Sheet1 not found in Steel sizes workbook');
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const grouped = {
    'W-Beam': new Set(),
    'HSS Tube': new Set(),
    Pipe: new Set(),
    'C-Channel': new Set(),
    'L-Angle': new Set(),
  };

  let stickySection = '';
  for (let r = 4; r <= 282 && r < data.length; r++) {
    const section = data[r][0], weight = data[r][1], depth = data[r][2];
    if (section !== '') stickySection = section;
    if (stickySection === '' || weight === '' || depth === '') continue;
    grouped['W-Beam'].add(`${stickySection}x${weight}`);
  }

  let stickyHssSize = '';
  for (let r = 4; r <= 454 && r < data.length; r++) {
    const sizeText = data[r][7], wall = data[r][9], weight = data[r][10];
    if (sizeText !== '') stickyHssSize = sizeText;
    if (stickyHssSize === '' || wall === '' || weight === '') continue;
    const [d1t, d2t] = String(stickyHssSize).replace(/X/gi, 'x').split('x').map((s) => s.trim());
    const dim1 = parseFractionalInches(d1t), dim2 = parseFractionalInches(d2t);
    if (dim1 == null || dim2 == null) continue;
    grouped['HSS Tube'].add(`HSS${fmt(dim1)}x${fmt(dim2)}x${fmt(wall)}`);
  }

  let stickyNomRaw = '';
  for (let r = 4; r <= 186 && r < data.length; r++) {
    const nomRaw = data[r][12], wall = data[r][16], weight = data[r][17];
    if (nomRaw !== '') stickyNomRaw = nomRaw;
    if (stickyNomRaw === '' || wall === '' || weight === '') continue;
    const nom = decodeValue(stickyNomRaw);
    grouped.Pipe.add(`PIPE${fmt(nom.decimal)}x${fmt(wall)}`);
  }

  let stickyChSection = '';
  for (let r = 7; r <= 37 && r < data.length; r++) {
    const section = data[r][19], weight = data[r][20];
    if (section !== '') stickyChSection = section;
    if (stickyChSection === '' || weight === '') continue;
    grouped['C-Channel'].add(`C${stickyChSection}x${weight}`);
  }

  let stickyLegA = '', stickyLegC = '';
  for (let r = 4; r <= 144 && r < data.length; r++) {
    const a = data[r][26], c = data[r][28], e = data[r][30], weight = data[r][31];
    if (a !== '') { stickyLegA = a; stickyLegC = c; }
    if (stickyLegA === '' || e === '' || weight === '') continue;
    const legA = decodeValue(stickyLegA), legC = decodeValue(stickyLegC), thick = decodeValue(e);
    grouped['L-Angle'].add(`L${fmt(legA.decimal)}x${fmt(legC.decimal)}x${thick.text}`);
  }

  return Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, Array.from(v)]));
}

// Used when the bundled workbook is missing or fails to parse — the same
// seed sizes steel_catalog itself is built from, so the takeoff flow's size
// dropdowns still have something reasonable to offer.
export const FALLBACK_STEEL_CATALOG = Object.fromEntries(SHAPE_CLASSES.map((c) => [c.value, c.sizes]));
