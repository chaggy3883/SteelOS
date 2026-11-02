// Exact lb/ft and surface perimeter for standard rolled and HSS shapes, read
// from src/data/aiscShapes.data.js — generated from the AISC Shapes Database
// v16.0 (aisc.org, consistent with the 16th Edition Steel Construction
// Manual) with a one-off Node script that keeps the single shapes (W, S, M,
// HP, C, MC, L, WT, MT, ST, HSS, Pipe) and their W column. Re-run it when
// AISC publishes a new database version. Pure: no db/api imports.
//
// Perimeter is AISC's "PB" (full shape perimeter, Design Guide 19) where the
// database lists it (W, S, M, HP, C, MC, L, WT, MT). Rectangular HSS use the
// outside perimeter with rounded corners (outside radius 2 x tdes), round
// HSS and pipe use pi x OD, and ST tees (no PB in the database) use
// 2 x bf + 2 x d - tw.
import AISC_SHAPES from '../data/aiscShapes.data.js';

const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

// One comparison key for every spelling of a size: upper case, no spaces or
// quotes, mixed numbers and fractions turned into decimals, so
// "L3-1/2X3-1/2X1/4", "L3 1/2 x 3 1/2 x 1/4" and "L3.5X3.5X0.25" all match.
export function aiscKey(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/["']/g, '')
    .replace(/×/g, 'X')
    .replace(/(\d+(?:\.\d+)?)[\s-]+(\d+)\/(\d+)/g, (_, w, n, d) => String(round4(Number(w) + Number(n) / Number(d))))
    .replace(/(\d+)\/(\d+)/g, (_, n, d) => String(round4(Number(n) / Number(d))))
    .replace(/\s+/g, '')
    // ".280" and "0.28" are the same wall — reprint every number the same way.
    .replace(/\d*\.?\d+/g, (n) => String(round4(Number(n))));
}

const ROWS = AISC_SHAPES.shapes || {};

function toShape(key) {
  const r = ROWS[key];
  if (!r) return null;
  const [type, label, weightPerFt, perimeterIn, perimeterBasis] = r;
  return { type, label, weightPerFt, perimeterIn, perimeterBasis, source: AISC_SHAPES.source };
}

// Compact designation as used by steel_catalog / IRONSIGHT / the old grid
// ("W12X26", "HSS6X6X3/8", "L4X4X1/2", "PIPE4STD") -> AISC shape or null.
export function findAiscShape(designation) {
  const key = aiscKey(designation);
  return key ? toShape(key) : null;
}

// Master-catalog code + size ("W", "12 x 26"; "HSS", "6 x 6 x 3/8";
// "HSSR", "6.625 x 0.28"; "L", "3 1/2 x 3 1/2 x 1/4") -> AISC shape or null.
// Pipe codes resolve through their nominal size + schedule (see
// materialEntryMath.parsePipeSize) and call findAiscPipe instead.
const PREFIX_BY_CODE = {
  W: 'W', S: 'S', M: 'M', HP: 'HP', C: 'C', MC: 'MC', WT: 'WT', MT: 'MT', ST: 'ST',
  L: 'L', LG: 'L', HSS: 'HSS', HSSR: 'HSS',
};

export function findAiscShapeForCatalog(shapeCode, sizeValue) {
  const prefix = PREFIX_BY_CODE[String(shapeCode || '').toUpperCase()];
  if (!prefix) return null;
  const tokens = String(sizeValue ?? '').split(/\s*[xX×]\s*/).map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  return findAiscShape(`${prefix}${tokens.join('X')}`);
}

// Nominal pipe size + schedule ('std' | 'xs' | 'xxs' | 's40' | 's80') ->
// AISC pipe or null. AISC lists Pipe…STD / XS / XXS; Sch 40 = STD and
// Sch 80 = XS through 10" nominal, so those map across only up to there.
export function findAiscPipe(nps, schedule) {
  if (!(nps > 0)) return null;
  let tag = { std: 'STD', xs: 'XS', xxs: 'XXS' }[schedule] || null;
  if (!tag && schedule === 's40' && nps <= 10) tag = 'STD';
  if (!tag && schedule === 's80' && nps <= 8) tag = 'XS';
  if (!tag) return null;
  return toShape(`PIPE${round4(nps)}${tag}`);
}

export const AISC_SOURCE_LABEL = AISC_SHAPES.source;
