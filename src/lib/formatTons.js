// Project tons: always 2 places after the decimal (e.g. 12.35T). The bid
// keeps the Full Takeoff's exact figure for its own math; a project only
// ever shows / stores it rounded.
export const roundTons = (tons) => {
  const n = Number(tons);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

export const formatTons = (tons, suffix = 'T') => {
  const n = roundTons(tons);
  if (!n) return '—';
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
};
