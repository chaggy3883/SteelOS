const XLSX = require('xlsx');
const wb = XLSX.readFile('Steel sizes .xlsx');
const sheet = wb.Sheets['Sheet1'];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

function fmt(n) { return String(Math.round(n * 1000) / 1000); }

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

function decodeValue(v) {
  if (typeof v === 'number' && v > 1000) {
    const d = XLSX.SSF.parse_date_code(v);
    return { decimal: d.m / d.d, text: `${d.m}/${d.d}` };
  }
  if (typeof v === 'number') return { decimal: v, text: String(v) };
  return { decimal: null, text: String(v || '') };
}

// --- Wide Flange (A-F, rows 4-282) ---
let stickySection = '';
const wRows = [];
for (let r = 4; r <= 282; r++) {
  const section = data[r][0], weight = data[r][1], depth = data[r][2], flangeW = data[r][3], flangeT = data[r][4];
  if (section !== '') stickySection = section;
  if (stickySection === '' || weight === '' || depth === '') continue;
  wRows.push({ shape_class: 'W-Beam', size_designation: `${stickySection}x${weight}`, dimension1: depth, dimension2: flangeW, wall_thickness_in: flangeT, weight_per_ft: weight });
}

// --- HSS (H-K, rows 4-454) ---
let stickyHssSize = '';
const hssRows = [];
for (let r = 4; r <= 454; r++) {
  const sizeText = data[r][7], wall = data[r][9], weight = data[r][10];
  if (sizeText !== '') stickyHssSize = sizeText;
  if (stickyHssSize === '' || wall === '' || weight === '') continue;
  const [d1t, d2t] = String(stickyHssSize).replace(/X/gi, 'x').split('x').map((s) => s.trim());
  const dim1 = parseFractionalInches(d1t), dim2 = parseFractionalInches(d2t);
  if (dim1 == null || dim2 == null) continue;
  hssRows.push({ shape_class: 'HSS Tube', size_designation: `HSS${fmt(dim1)}x${fmt(dim2)}x${fmt(wall)}`, dimension1: dim1, dimension2: dim2, wall_thickness_in: wall, weight_per_ft: weight });
}

// --- Pipe (M-R, rows 4-186) ---
let stickyNomRaw = '', stickyOD = '';
const pipeRows = [];
for (let r = 4; r <= 186; r++) {
  const nomRaw = data[r][12], od = data[r][13], schedule = data[r][14], wall = data[r][16], weight = data[r][17];
  if (nomRaw !== '') { stickyNomRaw = nomRaw; stickyOD = od; }
  if (stickyNomRaw === '' || wall === '' || weight === '') continue;
  const nom = decodeValue(stickyNomRaw);
  const scheduleSlug = String(schedule).replace(/[^A-Z0-9]/gi, '').toUpperCase();
  pipeRows.push({ shape_class: 'Pipe', size_designation: `PIPE${fmt(nom.decimal)}-SCH${scheduleSlug}`, dimension1: stickyOD, dimension2: null, wall_thickness_in: wall, weight_per_ft: weight });
}

// --- Channel (T-Y, rows 7-37) ---
let stickyChSection = '';
const chRows = [];
for (let r = 7; r <= 37; r++) {
  const section = data[r][19], weight = data[r][20], depth = data[r][21], width = data[r][22], thickness = data[r][23];
  if (section !== '') stickyChSection = section;
  if (stickyChSection === '' || weight === '') continue;
  chRows.push({ shape_class: 'C-Channel', size_designation: `C${stickyChSection}x${weight}`, dimension1: depth, dimension2: width, wall_thickness_in: thickness, weight_per_ft: weight });
}

// --- Angles (AA-AF, rows 4-144) ---
let stickyLegA = '', stickyLegC = '';
const angleRows = [];
for (let r = 4; r <= 144; r++) {
  const a = data[r][26], c = data[r][28], e = data[r][30], weight = data[r][31];
  if (a !== '') { stickyLegA = a; stickyLegC = c; }
  if (stickyLegA === '' || e === '' || weight === '') continue;
  const legA = decodeValue(stickyLegA), legC = decodeValue(stickyLegC), thick = decodeValue(e);
  angleRows.push({ shape_class: 'L-Angle', size_designation: `L${fmt(legA.decimal)}x${fmt(legC.decimal)}x${thick.text}`, dimension1: legA.decimal, dimension2: legC.decimal, wall_thickness_in: thick.decimal, weight_per_ft: weight });
}

console.log('W-Beam rows:', wRows.length);
console.log('HSS rows:', hssRows.length);
console.log('Pipe rows:', pipeRows.length);
console.log('Channel rows:', chRows.length);
console.log('Angle rows:', angleRows.length);
console.log('TOTAL:', wRows.length + hssRows.length + pipeRows.length + chRows.length + angleRows.length);

console.log('\n--- samples ---');
console.log('W-Beam first/last:', JSON.stringify(wRows[0]), JSON.stringify(wRows[wRows.length-1]));
console.log('HSS first/last:', JSON.stringify(hssRows[0]), JSON.stringify(hssRows[hssRows.length-1]));
console.log('Pipe first/last:', JSON.stringify(pipeRows[0]), JSON.stringify(pipeRows[pipeRows.length-1]));
console.log('Channel first/last:', JSON.stringify(chRows[0]), JSON.stringify(chRows[chRows.length-1]));
console.log('Angle first/last:', JSON.stringify(angleRows[0]), JSON.stringify(angleRows[angleRows.length-1]));

// duplicate label check within each set
[['W-Beam',wRows],['HSS',hssRows],['Pipe',pipeRows],['Channel',chRows],['Angle',angleRows]].forEach(([name, rows]) => {
  const seen = new Set();
  let dupes = 0;
  rows.forEach(r => { const k = r.shape_class+'|'+r.size_designation; if (seen.has(k)) dupes++; seen.add(k); });
  console.log(name, 'duplicate labels within set:', dupes);
});

require('fs').writeFileSync('/tmp/extracted_preview.json', JSON.stringify({ wRows, hssRows, pipeRows, chRows, angleRows }, null, 2));
