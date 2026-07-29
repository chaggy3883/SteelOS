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
  const afterFeet = feetMatch ? str.slice(feetMatch.index + feetMatch[0].length) : str;
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
