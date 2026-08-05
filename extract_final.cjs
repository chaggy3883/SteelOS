const XLSX = require('xlsx');
const fs = require('fs');
const wb = XLSX.readFile('Steel sizes .xlsx');
const sheet = wb.Sheets['Sheet1'];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

function fmt(n) { return String(Math.round(n * 1000) / 1000); }
function parseFractionalInches(token) {
  const t = String(token || '').trim(); if (!t) return null;
  let total = 0;
  for (const part of t.split(/\s+/)) {
    if (part.includes('/')) { const [n,d]=part.split('/').map(Number); if(!d) return null; total+=n/d; }
    else { const n=parseFloat(part); if(Number.isNaN(n)) return null; total+=n; }
  }
  return total;
}
function decodeValue(v) {
  if (typeof v === 'number' && v > 1000) { const d = XLSX.SSF.parse_date_code(v); return { decimal: d.m/d.d, text: d.m+'/'+d.d }; }
  if (typeof v === 'number') return { decimal: v, text: String(v) };
  return { decimal: null, text: String(v||'') };
}
function dedupe(rows) {
  const seen = {};
  const out = [];
  let renamed = 0;
  rows.forEach((r) => {
    let label = r.size_designation;
    let n = 1;
    while (seen[r.shape_class + '|' + label]) { n++; label = r.size_designation + '-' + n; }
    if (n > 1) renamed++;
    seen[r.shape_class + '|' + label] = true;
    out.push({ ...r, size_designation: label });
  });
  return { out, renamed };
}

// --- Wide Flange (A-F, rows 4-282) ---
let stickySection = '';
let wRowsRaw = [];
for (let r = 4; r <= 282; r++) {
  const section = data[r][0], weight = data[r][1], depth = data[r][2], flangeW = data[r][3], flangeT = data[r][4];
  if (section !== '') stickySection = section;
  if (stickySection === '' || weight === '' || depth === '') continue;
  wRowsRaw.push({ shape_class: 'W-Beam', size_designation: `${stickySection}x${weight}`, dimension1: depth, dimension2: flangeW, wall_thickness_in: flangeT, weight_per_ft: weight });
}

// --- HSS (H-K, rows 4-454) ---
let stickyHssSize = '';
let hssRowsRaw = [];
for (let r = 4; r <= 454; r++) {
  const sizeText = data[r][7], wall = data[r][9], weight = data[r][10];
  if (sizeText !== '') stickyHssSize = sizeText;
  if (stickyHssSize === '' || wall === '' || weight === '') continue;
  const [d1t, d2t] = String(stickyHssSize).replace(/X/gi, 'x').split('x').map((s) => s.trim());
  const dim1 = parseFractionalInches(d1t), dim2 = parseFractionalInches(d2t);
  if (dim1 == null || dim2 == null) continue;
  hssRowsRaw.push({ shape_class: 'HSS Tube', size_designation: `HSS${fmt(dim1)}x${fmt(dim2)}x${fmt(wall)}`, dimension1: dim1, dimension2: dim2, wall_thickness_in: wall, weight_per_ft: weight });
}

// --- Pipe (M-R, rows 4-186) --- label now uses wall thickness, not schedule text
// (schedule is "*" for large pipe sizes -- unreliable as a disambiguator, wall thickness always varies per row)
let stickyNomRaw = '', stickyOD = '';
let pipeRowsRaw = [];
for (let r = 4; r <= 186; r++) {
  const nomRaw = data[r][12], od = data[r][13], wall = data[r][16], weight = data[r][17];
  if (nomRaw !== '') { stickyNomRaw = nomRaw; stickyOD = od; }
  if (stickyNomRaw === '' || wall === '' || weight === '') continue;
  const nom = decodeValue(stickyNomRaw);
  pipeRowsRaw.push({ shape_class: 'Pipe', size_designation: `PIPE${fmt(nom.decimal)}x${fmt(wall)}`, dimension1: stickyOD, dimension2: null, wall_thickness_in: wall, weight_per_ft: weight });
}

// --- Channel (T-Y, rows 7-37) ---
let stickyChSection = '';
let chRowsRaw = [];
for (let r = 7; r <= 37; r++) {
  const section = data[r][19], weight = data[r][20], depth = data[r][21], width = data[r][22], thickness = data[r][23];
  if (section !== '') stickyChSection = section;
  if (stickyChSection === '' || weight === '') continue;
  chRowsRaw.push({ shape_class: 'C-Channel', size_designation: `C${stickyChSection}x${weight}`, dimension1: depth, dimension2: width, wall_thickness_in: thickness, weight_per_ft: weight });
}

// --- Angles (AA-AF, rows 4-144) ---
let stickyLegA = '', stickyLegC = '';
let angleRowsRaw = [];
for (let r = 4; r <= 144; r++) {
  const a = data[r][26], c = data[r][28], e = data[r][30], weight = data[r][31];
  if (a !== '') { stickyLegA = a; stickyLegC = c; }
  if (stickyLegA === '' || e === '' || weight === '') continue;
  const legA = decodeValue(stickyLegA), legC = decodeValue(stickyLegC), thick = decodeValue(e);
  angleRowsRaw.push({ shape_class: 'L-Angle', size_designation: `L${fmt(legA.decimal)}x${fmt(legC.decimal)}x${thick.text}`, dimension1: legA.decimal, dimension2: legC.decimal, wall_thickness_in: thick.decimal, weight_per_ft: weight });
}

const results = {};
[['wBeam', wRowsRaw], ['hss', hssRowsRaw], ['pipe', pipeRowsRaw], ['channel', chRowsRaw], ['angle', angleRowsRaw]].forEach(([key, rows]) => {
  const { out, renamed } = dedupe(rows);
  results[key] = out;
  console.log(key, '-> total:', out.length, 'renamed-to-disambiguate:', renamed);
});

const allRows = [...results.wBeam, ...results.hss, ...results.pipe, ...results.channel, ...results.angle];
console.log('TOTAL EXTRACTED:', allRows.length);
fs.writeFileSync('extracted_catalog_rows.json', JSON.stringify(allRows, null, 2));
console.log('Written to extracted_catalog_rows.json');
