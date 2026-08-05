// Structural classification metadata + the seed sizes used to populate the
// steel_catalog entity on first load. The Blueprint Takeoff grid and the
// Full Takeoff manual bid-line grid no longer read `.sizes` directly for
// their "Available Size" dropdown — that now comes live from
// db.entities.steel_catalog, filtered by shape_class. `.sizes` here only
// seeds that catalog and only runs once (see localData.js buildSeedData).
//
// `value` strings match steel_catalog.jsonc's shape_class enum exactly, so a
// row's stored shape_class can be used directly as the filter/lookup key.
export const SHAPE_CLASSES = [
  { value: 'W-Beam', label: 'W-Beam (Wide Flange)', hoursPerTon: 1.15, sizes: ['W14X90', 'W14X22', 'W18X35', 'W24X68', 'W30X90'] },
  { value: 'HSS Tube', label: 'HSS (Hollow Structural Section)', hoursPerTon: 1.0, sizes: ['HSS8X8X1/2', 'HSS10X6X3/8', 'HSS4X4X1/4', 'HSS6X6X3/8'] },
  { value: 'C-Channel', label: 'C-Channel', hoursPerTon: 0.95, sizes: ['C10X30', 'C12X25', 'C15X50', 'C8X11.5'] },
  { value: 'L-Angle', label: 'L-Angle', hoursPerTon: 0.85, sizes: ['L4X4X1/4', 'L6X4X3/8', 'L3X3X1/4', 'L8X8X1/2'] },
  { value: 'PL-Plate', label: 'PL-Plate', hoursPerTon: 0.7, sizes: ['PL1/2X12', 'PL1/4X8', 'PL3/4X10', 'PL1X12'] },
];

export function getShapeClass(value) {
  return SHAPE_CLASSES.find((c) => c.value === value) || SHAPE_CLASSES[0];
}

function fractionToDecimal(token) {
  if (!token) return 0;
  if (token.includes('/')) {
    const [num, den] = token.split('/').map(Number);
    return den ? num / den : 0;
  }
  return parseFloat(token) || 0;
}

// Approximate weight/ft for a given size string. W and C designations
// literally encode their own weight/ft in the number after the "x" (the
// same AISC convention steelShapes.js's old catalog relied on); HSS/L/PL
// don't encode it, so those fall back to the girth-or-leg-sum x thickness x
// steel-density method steelShapes.js's plate weight calc already uses
// (0.2836 lb/in^3 -> ~3.4 lb/ft per inch of width per inch of thickness).
export function estimateWeightPerFt(shapeClassValue, sizeString) {
  const size = String(sizeString || '').toUpperCase();

  if (shapeClassValue === 'W-Beam' || shapeClassValue === 'C-Channel') {
    const m = size.match(/X(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  if (shapeClassValue === 'HSS Tube') {
    const m = size.match(/^HSS(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)X([\d./]+)/);
    if (!m) return 0;
    const width = parseFloat(m[1]);
    const height = parseFloat(m[2]);
    const thickness = fractionToDecimal(m[3]);
    return (2 * width + 2 * height) * thickness * 3.4;
  }

  if (shapeClassValue === 'L-Angle') {
    const m = size.match(/^L(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)X([\d./]+)/);
    if (!m) return 0;
    const leg1 = parseFloat(m[1]);
    const leg2 = parseFloat(m[2]);
    const thickness = fractionToDecimal(m[3]);
    return (leg1 + leg2) * thickness * 3.4;
  }

  if (shapeClassValue === 'PL-Plate') {
    const m = size.match(/^PL([\d./]+)X(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    const thickness = fractionToDecimal(m[1]);
    const width = parseFloat(m[2]);
    return width * thickness * 3.4;
  }

  return 0;
}
