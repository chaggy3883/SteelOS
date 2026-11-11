// Shared between TurnoverReviewPanel.jsx (edit) and turnoverReviewPdf.js
// (PDF export) so the two never drift out of sync on which fields exist.

// The standard yes/no items from the reference Turnover / Contract Review
// form. Each project starts with this list and can edit it (rename, reorder,
// remove, add its own) — the project's own list lives on the record as
// checklist_list. An item with detail: 'tons' asks for a tonnage once checked.
export const SIMPLE_CHECKLIST_ITEMS = [
  { key: 'specs_plans_received', label: 'Specifications & plans received and recorded' },
  { key: 'addendums_received', label: 'All Addendums received and recorded' },
  { key: 'plans_specs_sent_to_vendors', label: 'All plans/specs/addendums (including post-bid) sent to erector, detailer, engineer, joist & deck suppliers, and any other vendors receiving a subcontract or PO' },
  { key: 'vendor_quotes_saved', label: 'All vendor quotes saved in estimate folder' },
  { key: 'estimator_notes_attached', label: 'Estimator Notes attached' },
  { key: 'scope_of_work_attached', label: 'Scope of Work attached' },
  { key: 'engineering_required', label: 'Engineering required' },
  { key: 'joist_deck_required', label: 'Joist & Deck required' },
  { key: 'tc_bolt_required', label: 'TC Bolt required' },
  { key: 'fire_proofing_required', label: 'Fire Proofing required' },
  { key: 'beams_with_camber', label: 'Beams with Camber' },
];

export const DEFAULT_CHECKLIST = [
  ...SIMPLE_CHECKLIST_ITEMS,
  { key: 'galvanizing_required', label: 'Galvanizing', detail: 'tons' },
];

// Who the job is using for each outside scope. `category` is the matching
// Vendor Pricing category on the estimate (VendorPricing.jsx), so the
// estimate's vendors and quotes can be picked straight from here.
export const SCOPE_VENDOR_ROLES = [
  { key: 'detailing', label: 'Detailing', category: 'detailing_engineering' },
  { key: 'erection', label: 'Erection', category: 'erection' },
  { key: 'joist_deck', label: 'Joist & Deck', category: 'joist_deck' },
  { key: 'miscellaneous', label: 'Miscellaneous', category: 'misc_metals' },
  { key: 'rolling', label: 'Rolling', category: 'rolling' },
  { key: 'steel_material', label: 'Steel Material', category: 'steel_materials' },
];

export const FREE_TEXT_FIELDS = [
  { key: 'special_materials', label: 'Special / Unusual Materials Required' },
  { key: 'special_shipping_instructions', label: 'Special Shipping Instructions' },
  { key: 'surface_prep_instructions', label: 'Surface Preparation / Primer / Finish Paint Instructions' },
  { key: 'lintels_notes', label: 'Lintels' },
  { key: 'embeds_notes', label: 'Embeds' },
  { key: 'sequencing_notes', label: 'Sequencing' },
];

export const blankTurnoverRecord = () => ({
  id: null,
  status: 'draft',
  checklist_list: null, // null = the standard list (DEFAULT_CHECKLIST)
  checklist_items: {},
  galvanizing_tons: '',
  scope_vendors: {},
  sub_quotes: [],
  special_materials: '',
  special_shipping_instructions: '',
  surface_prep_instructions: '',
  lintels_notes: '',
  embeds_notes: '',
  sequencing_notes: '',
  required_attendees: [],
  actual_attendees: [],
  completed_by: '',
  completed_date: '',
});

// The checklist this record shows: its own edited list, else the standard one.
export const checklistFor = (record) => (Array.isArray(record?.checklist_list) ? record.checklist_list : DEFAULT_CHECKLIST);

export const blankScopeVendor = () => ({ vendor_name: '', quotes: [] });
export const scopeVendorFor = (record, roleKey) => ({ ...blankScopeVendor(), ...((record?.scope_vendors || {})[roleKey] || {}) });

// A loaded record in today's shape. Records saved before the scope-vendor
// list carried the detailer and erector as detailing_company / erector_name;
// those carry over into the Detailing and Erection rows.
export function normalizeTurnoverRecord(found) {
  const next = { ...blankTurnoverRecord(), ...found };
  const vendors = { ...(next.scope_vendors || {}) };
  if (!vendors.detailing && String(found?.detailing_company || '').trim()) {
    vendors.detailing = { ...blankScopeVendor(), vendor_name: found.detailing_company.trim() };
  }
  if (!vendors.erection && String(found?.erector_name || '').trim()) {
    vendors.erection = { ...blankScopeVendor(), vendor_name: found.erector_name.trim() };
  }
  next.scope_vendors = vendors;
  return next;
}

// "Galvanizing — 42 tons" style label for print/compare.
export function checklistItemText(item, record) {
  if (item.detail === 'tons' && record?.checklist_items?.[item.key] && String(record.galvanizing_tons ?? '').trim() !== '') {
    return `${item.label} — ${record.galvanizing_tons} tons`;
  }
  return item.label;
}

export const quoteName = (q) => q?.name || q?.file_name || 'Quote';
