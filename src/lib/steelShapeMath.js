// Rough-order-of-magnitude coating takeoff math shared by the Blueprint
// Takeoff grid and the Full Takeoff manual bid-line grid. Perimeters are
// derived from the shape designation string itself via regex, not a real
// AISC dimension table — good enough for an early paint-area estimate, not
// a substitute for shop drawings.

// W-shapes: no threshold is given for "large column" vs "shallow section",
// so this treats 12in+ nominal depth (columns/heavier beams) as flange
// width ≈ depth, and anything shallower as flange width ≈ 0.6x depth —
// matches how W-shape proportions actually trend in practice.
function wShapePerimeterIn(shape) {
  const m = shape.match(/^W(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const depth = parseFloat(m[1]);
  const flange = depth >= 12 ? depth : depth * 0.6;
  return 4 * flange + 2 * depth;
}

function hssPerimeterIn(shape) {
  const m = shape.match(/^HSS(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const width = parseFloat(m[1]);
  const height = parseFloat(m[2]);
  return 2 * width + 2 * height;
}

// Flange width isn't encoded in a channel's designation (e.g. C10x15.3 only
// gives depth + weight/ft), so this uses a fixed 3.5in flange approximation
// common to light/mid channel sizes.
function channelPerimeterIn(shape) {
  const m = shape.match(/^C(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const depth = parseFloat(m[1]);
  const flange = 3.5;
  return 2 * flange + depth;
}

function anglePerimeterIn(shape) {
  const m = shape.match(/^L(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const leg1 = parseFloat(m[1]);
  const leg2 = parseFloat(m[2]);
  return leg1 + leg2;
}

// Plate designations put thickness before the "X" and width after it (e.g.
// PL1/2x12 = 1/2in thick, 12in wide) — only the width feeds the perimeter.
function platePerimeterIn(shape) {
  const m = shape.match(/^PL[0-9.\/-]*X(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const width = parseFloat(m[1]);
  return 2 * width;
}

const BASELINE_FALLBACK_PERIMETER_IN = 40;

// HSS rows imported through the Steel Inventory Catalog's HSS Tubing bulk
// importer carry their own exact dimension1/dimension2 (parsed straight off
// the spreadsheet, not reconstructed from the "HSS0.5x0.5" label). When a
// catalog row matches, this is the true outer bounding perimeter — no
// regex-guessing needed. Falls back to the regex parse for anything not
// sourced from the catalog (typed free text, demo rows, etc).
function hssCatalogPerimeterIn(shape, catalogRows) {
  const match = (catalogRows || []).find(
    (row) => row.shape_class === 'HSS Tube' && String(row.size_designation || '').trim().toUpperCase() === shape
  );
  if (match && match.dimension1 != null && match.dimension2 != null) {
    return 2 * Number(match.dimension1) + 2 * Number(match.dimension2);
  }
  return null;
}

function resolvePerimeterIn(shapeString, catalogRows) {
  const shape = String(shapeString || '').trim().toUpperCase();

  if (shape.startsWith('HSS')) {
    return hssCatalogPerimeterIn(shape, catalogRows) ?? hssPerimeterIn(shape) ?? BASELINE_FALLBACK_PERIMETER_IN;
  }
  if (shape.startsWith('W')) return wShapePerimeterIn(shape) ?? BASELINE_FALLBACK_PERIMETER_IN;
  if (shape.startsWith('PL')) return platePerimeterIn(shape) ?? BASELINE_FALLBACK_PERIMETER_IN;
  if (shape.startsWith('C')) return channelPerimeterIn(shape) ?? BASELINE_FALLBACK_PERIMETER_IN;
  if (shape.startsWith('L')) return anglePerimeterIn(shape) ?? BASELINE_FALLBACK_PERIMETER_IN;

  return BASELINE_FALLBACK_PERIMETER_IN;
}

export function calculateSteelSurfaceArea(shapeString, lengthFeet, quantity, catalogRows = []) {
  const perimeterIn = resolvePerimeterIn(shapeString, catalogRows);
  const lengthIn = (Number(lengthFeet) || 0) * 12;
  return perimeterIn * lengthIn * (Number(quantity) || 0);
}
