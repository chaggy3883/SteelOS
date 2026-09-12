function parseInchesToken(token) {
  const t = String(token || '').trim();
  if (!t) return 0;
  const wholeAndFraction = t.match(/^(\d+(?:\.\d+)?)[\s-]+(\d+)\/(\d+)$/);
  if (wholeAndFraction) {
    return parseFloat(wholeAndFraction[1]) + parseInt(wholeAndFraction[2], 10) / parseInt(wholeAndFraction[3], 10);
  }
  const fractionOnly = t.match(/^(\d+)\/(\d+)$/);
  if (fractionOnly) {
    return parseInt(fractionOnly[1], 10) / parseInt(fractionOnly[2], 10);
  }
  const num = parseFloat(t);
  return Number.isFinite(num) ? num : 0;
}

// Parses structural fraction notation like `20' 6-1/2"`, `20'`, `6-1/2"`, or a plain
// decimal (treated as feet) into decimal feet. Returns null if unparseable.
export function parseStructuralLength(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str) return null;

  if (/^-?\d+(\.\d+)?$/.test(str)) return parseFloat(str);

  const feetMatch = str.match(/(-?\d+(?:\.\d+)?)\s*'/);
  let afterFeet = feetMatch ? str.slice(feetMatch.index + feetMatch[0].length) : str;
  // A feet value is sometimes followed directly by "-" as a bare
  // concatenation separator (e.g. "17'-7.5\"", "39'-4 3/8\"" — this is
  // exactly what detailerImportParser.js's Tekla BOM parser produces), not a
  // negative sign or the whole/fraction separator (that one only ever
  // appears mid-token, e.g. "6-1/2", never immediately after the feet
  // quote). Left unstripped, parseInchesToken below reads it as a negative
  // inches value and drops any trailing fraction (parseFloat("-4 3/8") stops
  // at "-4"), silently underestimating every such length by ~2x the inches
  // component.
  if (feetMatch && afterFeet.startsWith('-')) afterFeet = afterFeet.slice(1);
  const inchMatch = afterFeet.match(/([\d./\s-]+)"/) || (!feetMatch ? afterFeet.match(/^([\d./\s-]+)$/) : null);

  if (!feetMatch && !inchMatch) return null;

  const feet = feetMatch ? parseFloat(feetMatch[1]) : 0;
  const inches = inchMatch ? parseInchesToken(inchMatch[1]) : 0;
  const total = feet + inches / 12;
  return Number.isFinite(total) ? total : null;
}

export function formatStructuralLength(ft) {
  if (!Number.isFinite(ft)) return '';
  const wholeFeet = Math.floor(ft);
  const roundedInches = Math.round((ft - wholeFeet) * 12 * 16) / 16;
  if (roundedInches === 0) return `${wholeFeet}'`;
  return `${wholeFeet}' ${roundedInches}"`;
}
