// IRONSIGHT drawing scale — per page, plus optional rectangular viewports on
// a page that each carry their own scale (a detail drawn at 1" = 1'-0" on a
// sheet that's otherwise 1/8" = 1'-0", for example).
//
// Units: everything here is in IRONSIGHT's PDF space — the page's own
// coordinate system at zoom 1, which pdf.js gives us in PDF points (72 per
// inch of paper). A scale is stored as `pts_per_ft`: how many PDF points of
// paper equal one real-world foot. That's the exact same ratio the old
// single-session `px_per_ft` field held (its "px" were always PDF-space
// units at scale=1, never screen pixels), so an older session's value drops
// straight in as a fallback with no conversion.
//
// Pure functions only — no React, no db — so the math can be checked by hand.

export const PDF_POINTS_PER_INCH = 72;

// pts_per_ft for "paperIn inches on the sheet = realFt feet in the field".
//   1/8" = 1'-0"  ->  0.125 * 72 / 1  = 9 pts per ft
//   1"   = 10'    ->  1 * 72 / 10     = 7.2 pts per ft
export const ptsPerFtFromPaper = (paperIn, realFt) => (paperIn * PDF_POINTS_PER_INCH) / realFt;

// Metric 1:N — one unit on paper is N of the same unit in the field. One
// real foot is 12 real inches, so it's 12/N inches of paper = 864/N points.
//   1:100 -> 8.64 pts per ft     1:12 -> 72 (same as 1" = 1'-0")
export const ptsPerFtFromRatio = (n) => (12 * PDF_POINTS_PER_INCH) / n;

const arch = (id, label, paperIn) => ({ id, group: 'Architectural', label, ptsPerFt: ptsPerFtFromPaper(paperIn, 1) });
const eng = (feet) => ({ id: `eng-${feet}`, group: 'Engineering', label: `1" = ${feet}'`, ptsPerFt: ptsPerFtFromPaper(1, feet) });
const metric = (n) => ({ id: `metric-${n}`, group: 'Metric', label: `1:${n}`, ptsPerFt: ptsPerFtFromRatio(n) });

export const SCALE_PRESETS = [
  arch('arch-1-16', '1/16" = 1\'-0"', 1 / 16),
  arch('arch-3-32', '3/32" = 1\'-0"', 3 / 32),
  arch('arch-1-8', '1/8" = 1\'-0"', 1 / 8),
  arch('arch-3-16', '3/16" = 1\'-0"', 3 / 16),
  arch('arch-1-4', '1/4" = 1\'-0"', 1 / 4),
  arch('arch-3-8', '3/8" = 1\'-0"', 3 / 8),
  arch('arch-1-2', '1/2" = 1\'-0"', 1 / 2),
  arch('arch-3-4', '3/4" = 1\'-0"', 3 / 4),
  arch('arch-1', '1" = 1\'-0"', 1),
  arch('arch-1-1-2', '1-1/2" = 1\'-0"', 1.5),
  arch('arch-3', '3" = 1\'-0"', 3),
  eng(10), eng(20), eng(30), eng(40), eng(50), eng(60), eng(100),
  metric(10), metric(20), metric(25), metric(50), metric(75), metric(100), metric(200), metric(500),
];

export const SCALE_PRESET_GROUPS = ['Architectural', 'Engineering', 'Metric'];

export const findPreset = (id) => SCALE_PRESETS.find((p) => p.id === id) || null;

// Readable label for any pts_per_ft — the matching preset's own label when
// it's within 0.5% of one, otherwise "1" = X'-Y"" (feet of field per inch of
// paper), which is how a shop reads an odd calibrated scale off the sheet.
export function scaleLabelFromPtsPerFt(ptsPerFt) {
  if (!(ptsPerFt > 0)) return 'Not set';
  const match = SCALE_PRESETS.find((p) => Math.abs(p.ptsPerFt - ptsPerFt) / p.ptsPerFt < 0.005);
  if (match) return match.label;
  const feetPerPaperInch = PDF_POINTS_PER_INCH / ptsPerFt;
  const totalInches = Math.round(feetPerPaperInch * 12 * 8) / 8;
  const ft = Math.floor(totalInches / 12);
  const inches = Math.round((totalInches - ft * 12) * 8) / 8;
  return `1" = ${ft}'-${inches}"`;
}

export const normalizeRect = (a, b) => ({
  x1: Math.min(a.pdfX, b.pdfX),
  y1: Math.min(a.pdfY, b.pdfY),
  x2: Math.max(a.pdfX, b.pdfX),
  y2: Math.max(a.pdfY, b.pdfY),
});

export const pointInRect = (pt, r) => pt.pdfX >= r.x1 && pt.pdfX <= r.x2 && pt.pdfY >= r.y1 && pt.pdfY <= r.y2;

const pageKey = (pageNumber) => String(pageNumber || 1);

export const pageEntryFor = (pageScales, pageNumber) => (pageScales || {})[pageKey(pageNumber)] || null;

// Restores scale state from a saved blueprint_takeoffs record. Sessions
// saved before per-page scale existed only have `px_per_ft` — that value is
// kept as the whole-set fallback (exactly how it behaved before: one scale
// for every page) and is never rewritten, so an old session measures the
// same on every page until the estimator sets a page-specific scale.
export function migrateScaleState(takeoff) {
  const legacy = Number(takeoff?.px_per_ft);
  return {
    pageScales: takeoff?.page_scales && typeof takeoff.page_scales === 'object' ? takeoff.page_scales : {},
    legacyPtsPerFt: legacy > 0 ? legacy : null,
  };
}

// Which scale a measurement uses: the viewport containing `pt` (its first
// click), else the page's own scale, else the older whole-set fallback.
// Returns null when nothing applies — the caller must block measuring. A
// point inside a viewport that has no scale yet also returns a blocked
// result rather than silently falling back to the page scale, since the
// whole reason a viewport exists is that its scale differs from the page.
export function resolveScaleAt(pageScales, legacyPtsPerFt, pageNumber, pt) {
  const entry = pageEntryFor(pageScales, pageNumber);
  if (pt && entry?.viewports?.length) {
    const vp = entry.viewports.find((v) => pointInRect(pt, v));
    if (vp) {
      if (!(vp.pts_per_ft > 0)) return { ptsPerFt: null, source: 'viewport', viewportId: vp.id, name: vp.name, label: 'Not set', blocked: true };
      return { ptsPerFt: vp.pts_per_ft, source: 'viewport', viewportId: vp.id, name: vp.name, label: vp.label || scaleLabelFromPtsPerFt(vp.pts_per_ft) };
    }
  }
  if (entry?.pts_per_ft > 0) {
    return { ptsPerFt: entry.pts_per_ft, source: 'page', label: entry.label || scaleLabelFromPtsPerFt(entry.pts_per_ft) };
  }
  if (legacyPtsPerFt > 0) {
    return { ptsPerFt: legacyPtsPerFt, source: 'legacy', label: scaleLabelFromPtsPerFt(legacyPtsPerFt) };
  }
  return null;
}

// "Can a measuring tool be turned on for this page at all" — true when the
// page itself is scaled, the older whole-set scale applies, or at least one
// of its viewports has a scale (measuring is then allowed inside it only).
export function pageHasAnyScale(pageScales, legacyPtsPerFt, pageNumber) {
  const entry = pageEntryFor(pageScales, pageNumber);
  if (entry?.pts_per_ft > 0 || legacyPtsPerFt > 0) return true;
  return Boolean(entry?.viewports?.some((v) => v.pts_per_ft > 0));
}

// Check Scale: + means the drawing measures long under the current scale.
export const scaleCheckPercent = (measuredFt, knownFt) => (knownFt > 0 ? ((measuredFt - knownFt) / knownFt) * 100 : null);

export const scaleCheckTier = (pct) => {
  const abs = Math.abs(pct ?? Infinity);
  if (abs <= 1) return 'good';
  if (abs <= 3) return 'close';
  return 'off';
};

// ---- immutable updaters (used by useTakeoffScales) ----

export function withPageScale(pageScales, pageNumbers, scale) {
  const next = { ...(pageScales || {}) };
  pageNumbers.forEach((n) => {
    const key = pageKey(n);
    next[key] = { ...(next[key] || {}), ...scale, viewports: next[key]?.viewports || [] };
  });
  return next;
}

export function withViewport(pageScales, pageNumber, viewport) {
  const key = pageKey(pageNumber);
  const entry = pageScales?.[key] || { viewports: [] };
  return { ...(pageScales || {}), [key]: { ...entry, viewports: [...(entry.viewports || []), viewport] } };
}

export function withViewportPatch(pageScales, pageNumber, viewportId, patch) {
  const key = pageKey(pageNumber);
  const entry = pageScales?.[key];
  if (!entry) return pageScales;
  return { ...pageScales, [key]: { ...entry, viewports: (entry.viewports || []).map((v) => (v.id === viewportId ? { ...v, ...patch } : v)) } };
}

export function withoutViewport(pageScales, pageNumber, viewportId) {
  const key = pageKey(pageNumber);
  const entry = pageScales?.[key];
  if (!entry) return pageScales;
  return { ...pageScales, [key]: { ...entry, viewports: (entry.viewports || []).filter((v) => v.id !== viewportId) } };
}
