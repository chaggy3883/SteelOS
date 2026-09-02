// Shared between TurnoverReviewPanel.jsx (edit) and turnoverReviewPdf.js
// (PDF export) so the two never drift out of sync on which fields exist.

// Simple yes/no items from the reference Turnover / Contract Review form.
// No conditional detail attached to any of these (contrast
// detailing_required/galvanizing_required, each of which gates a follow-up
// field handled separately in both the panel and the print view).
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
  checklist_items: {},
  detailing_company: '',
  galvanizing_tons: '',
  pricing_basis: '',
  erector_name: '',
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
