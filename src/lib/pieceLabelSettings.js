// Company setting for printed piece labels (Admin → Piece Labels), stored on
// Company.piece_label_settings. Each company picks its label stock size and
// which fields print; pieceLabelPdf.js lays the label out to fit that size
// (same structure at any size: QR on the left, project / part # / sequence
// stacked beside it, shape / size / weight along the bottom).

export const LABEL_SIZE_PRESETS = [
  { key: '4x2', widthIn: 4, heightIn: 2, label: '4" x 2" (standard)' },
  { key: '4x3', widthIn: 4, heightIn: 3, label: '4" x 3"' },
  { key: '4x6', widthIn: 4, heightIn: 6, label: '4" x 6"' },
  { key: '3x2', widthIn: 3, heightIn: 2, label: '3" x 2"' },
  { key: '2.25x1.25', widthIn: 2.25, heightIn: 1.25, label: '2.25" x 1.25"' },
];

// Fields in print order. `group` is where they sit on the label.
export const LABEL_FIELDS = [
  { key: 'project', label: 'Project name & no.', group: 'side' },
  { key: 'part', label: 'Part #', group: 'side' },
  { key: 'sequence', label: 'Sequence / Area', group: 'side' },
  { key: 'shape', label: 'Shape', group: 'bottom' },
  { key: 'size', label: 'Size', group: 'bottom' },
  { key: 'weight', label: 'Weight', group: 'bottom' },
  { key: 'serial', label: 'Serial # (under the QR code)', group: 'qr' },
];

export const MIN_LABEL_IN = 1;
export const MAX_LABEL_IN = 8;

export const DEFAULT_PIECE_LABEL_SETTINGS = {
  size_key: '4x2',
  width_in: 4,
  height_in: 2,
  fields: LABEL_FIELDS.map((f) => f.key),
  uppercase: true,
};

const clampIn = (v, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_LABEL_IN, Math.max(MIN_LABEL_IN, Math.round(n * 100) / 100));
};

// Always returns a complete, valid settings object (missing or bad values
// fall back to the 4" x 2" default with every field on).
export function normalizePieceLabelSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  // Nothing saved yet → the 4" x 2" preset (not "custom").
  const sizeKey = s.size_key || (s.width_in == null && s.height_in == null ? DEFAULT_PIECE_LABEL_SETTINGS.size_key : 'custom');
  const preset = LABEL_SIZE_PRESETS.find((p) => p.key === sizeKey);
  const widthIn = preset ? preset.widthIn : clampIn(s.width_in, DEFAULT_PIECE_LABEL_SETTINGS.width_in);
  const heightIn = preset ? preset.heightIn : clampIn(s.height_in, DEFAULT_PIECE_LABEL_SETTINGS.height_in);
  const known = new Set(LABEL_FIELDS.map((f) => f.key));
  const fields = Array.isArray(s.fields) ? s.fields.filter((k) => known.has(k)) : DEFAULT_PIECE_LABEL_SETTINGS.fields;
  return {
    size_key: preset ? preset.key : 'custom',
    width_in: widthIn,
    height_in: heightIn,
    fields,
    uppercase: s.uppercase !== false,
  };
}

export function labelSizeText(settings) {
  const s = normalizePieceLabelSettings(settings);
  return `${s.width_in}" x ${s.height_in}"`;
}
