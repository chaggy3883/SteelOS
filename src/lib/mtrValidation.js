// Non-blocking sanity checks shown in the MTR review table. None of these
// ever prevent Approve — they exist so a reviewer doesn't have to notice a
// bad number themselves before it becomes a MillTestReport record.

// Minimum yield (ksi) by common structural steel grade/spec. Deliberately a
// single number per grade even where a real spec has a shape-dependent
// minimum (e.g. A500 round vs. rectangular HSS) — good enough for a "does
// this look wrong" flag, not a substitute for engineering sign-off.
export const GRADE_MIN_YIELD_KSI = {
  A36: 36,
  A992: 50,
  'A572-42': 42,
  'A572-50': 50,
  'A572-60': 60,
  'A572-65': 65,
  A588: 50,
  A500B: 42,
  A500C: 46,
  A53: 35,
  A1085: 50,
};

const REQUIRED_CHEMISTRY_FIELDS = [
  { key: 'carbon_pct', label: 'Carbon (C)' },
  { key: 'manganese_pct', label: 'Manganese (Mn)' },
  { key: 'phosphorus_pct', label: 'Phosphorus (P)' },
  { key: 'sulfur_pct', label: 'Sulfur (S)' },
];

// Best-effort text normalization ("A572 Grade 50", "A572-50", "A572 GR. 50")
// down to the GRADE_MIN_YIELD_KSI key shape. Grades this can't confidently
// parse just fall through to no yield check, rather than guessing wrong.
export function normalizeGradeKey(raw) {
  const s = String(raw || '').toUpperCase();
  const specMatch = s.match(/A\d+/);
  if (!specMatch) return s.replace(/\s+/g, '');
  const spec = specMatch[0];
  const rest = s.slice(specMatch.index + spec.length);
  const gradeMatch = rest.match(/(\d{2,3})/);
  if (gradeMatch) return `${spec}-${gradeMatch[1]}`;
  const letterMatch = rest.match(/\b([A-D])\b/);
  if (letterMatch) return `${spec}${letterMatch[1]}`;
  return spec;
}

export function checkYieldBelowSpecMin(gradeText, yieldKsi) {
  if (yieldKsi == null || !Number.isFinite(yieldKsi)) return null;
  const key = normalizeGradeKey(gradeText);
  const minYield = GRADE_MIN_YIELD_KSI[key];
  if (minYield == null) return null;
  if (yieldKsi < minYield) {
    return `Reported yield strength (${yieldKsi} ksi) is below the ${key} spec minimum of ${minYield} ksi.`;
  }
  return null;
}

export function checkMissingChemistry(fields) {
  const missing = REQUIRED_CHEMISTRY_FIELDS.filter(({ key }) => fields[key] == null || fields[key] === '');
  if (missing.length === 0) return null;
  return `Missing chemistry: ${missing.map((m) => m.label).join(', ')}.`;
}

export function checkIllegibleFields(illegibleFields) {
  if (!Array.isArray(illegibleFields) || illegibleFields.length === 0) return null;
  return `AI flagged as illegible/unreadable on the source document: ${illegibleFields.join(', ')}.`;
}

export function checkLowHeatConfidence(confidence, threshold = 0.7) {
  if (confidence == null || !Number.isFinite(confidence)) return null;
  if (confidence < threshold) {
    return `Heat number confidence is low (${Math.round(confidence * 100)}%) — verify against the physical tag/stencil before approving.`;
  }
  return null;
}

// Single entry point the review table calls on every field change — order
// matters only for display (heat number confidence first, since heat_number
// is the key field per the MTR reader's design).
export function buildMtrWarnings(fields) {
  return [
    checkLowHeatConfidence(fields.heat_number_confidence),
    checkYieldBelowSpecMin(fields.material_grade, fields.yield_strength_ksi),
    checkMissingChemistry(fields),
    checkIllegibleFields(fields.illegible_fields),
  ].filter(Boolean);
}
