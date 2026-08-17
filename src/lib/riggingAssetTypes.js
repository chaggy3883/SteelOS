// Shared rigging_type vocabulary + checklist-mode mapping, used by both
// RiggingMatrix.jsx (the asset registry form) and RiggingInspectionForm.jsx
// (to auto-derive/lock which checklist an inspection uses from the linked
// asset's type) so the mapping lives in exactly one place.

export const RIGGING_TYPES = [
  { value: 'wire_rope_sling', label: 'Wire Rope Sling' },
  { value: 'synthetic_web_sling', label: 'Synthetic Web Sling' },
  { value: 'round_sling', label: 'Round Sling' },
  { value: 'chain_sling', label: 'Chain Sling' },
  { value: 'shackle', label: 'Shackle' },
  { value: 'hook', label: 'Hook' },
  { value: 'spreader_bar', label: 'Spreader Bar' },
  { value: 'below_the_hook', label: 'Below-the-Hook Device' },
];

// Old rigging_inventory_ledger.rigging_category -> new rigging_type, for
// migrateRiggingLedgerFields in src/api/localData.js. Shackle_Hook has no
// clean 1:1 mapping (the old enum merged shackles and hooks into one
// value) — defaults to 'shackle', logged as a lossy default so an admin can
// correct individual rows to 'hook' afterward.
export const LEGACY_RIGGING_CATEGORY_MAP = {
  Spreader_Bar: 'spreader_bar',
  Cable_Sling: 'wire_rope_sling',
  Nylon_Sling: 'synthetic_web_sling',
  Endless_Sling: 'round_sling',
  Shackle_Hook: 'shackle',
};

// RiggingInspection's checklist is either the sling_findings set (keyed by
// sling_type) or the hardware_findings set (keyed by subsection) — never
// both. This maps every rigging_type to exactly one of those two modes.
const CHECKLIST_MODE_BY_TYPE = {
  wire_rope_sling: { mode: 'sling', sling_type: 'Wire_Rope' },
  synthetic_web_sling: { mode: 'sling', sling_type: 'Synthetic_Web' },
  round_sling: { mode: 'sling', sling_type: 'Synthetic_Web' },
  chain_sling: { mode: 'sling', sling_type: 'Chain' },
  shackle: { mode: 'hardware', subsection: 'Shackles_Pins' },
  hook: { mode: 'hardware', subsection: 'Hooks' },
  spreader_bar: { mode: 'hardware', subsection: 'Spreader_Bars' },
  below_the_hook: { mode: 'hardware', subsection: 'Below_The_Hook' },
};

export function checklistModeForRiggingType(riggingType) {
  return CHECKLIST_MODE_BY_TYPE[riggingType] || null;
}

export function riggingTypeLabel(value) {
  return RIGGING_TYPES.find((t) => t.value === value)?.label || value;
}
