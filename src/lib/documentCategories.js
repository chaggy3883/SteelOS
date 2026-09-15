import { db } from '@/api/apiClient';

// Single source of truth for Document.document_type — every type-selector or
// filter dropdown in the app should read from DOCUMENT_TYPE_OPTIONS rather than
// hand-copying the enum, so the list can't silently drift out of sync again
// (Documents.jsx and Intelligence.jsx each carried their own stale partial copy
// before this file existed).
export const DOCUMENT_TYPE_OPTIONS = [
  { value: 'specification', label: 'Specs / Plans & Specifications' },
  { value: 'contract', label: 'Contract' },
  { value: 'legal_general', label: 'Legal' },
  { value: 'general_conditions', label: 'General Conditions' },
  { value: 'supplementary_conditions', label: 'Supplementary Conditions' },
  { value: 'addendum', label: 'Addenda' },
  { value: 'bulletin', label: 'Bulletin' },
  { value: 'delay_notice', label: 'Delay Notice' },
  { value: 'ifc', label: 'IFC (Issued for Construction)' },
  { value: 'structural_drawing', label: 'Drawings for Fabrication' },
  { value: 'drawing_joist_deck', label: 'Drawings for Joist and Deck' },
  { value: 'architectural_drawing', label: 'Architectural Drawing' },
  { value: 'civil_drawing', label: 'Civil Drawing' },
  { value: 'mechanical_drawing', label: 'Mechanical Drawing' },
  { value: 'electrical_drawing', label: 'Electrical Drawing' },
  { value: 'geotechnical_report', label: 'Geotechnical Report' },
  { value: 'bid_form', label: 'Bid Form & Supporting Documents' },
  { value: 'front_end_review', label: 'Front End Review Doc' },
  { value: 'scope_letter', label: 'Scope of Work' },
  { value: 'previous_recap_proposal', label: 'Previous Recaps & Proposals' },
  { value: 'meeting_minutes', label: 'Meeting Minutes' },
  { value: 'notice_of_commencement', label: 'Notice of Commencement' },
  { value: 'notice_of_furnishing', label: 'Notice of Furnishing' },
  { value: 'email', label: 'Email' },
  { value: 'rfi', label: 'RFI' },
  { value: 'submittal', label: 'Submittal' },
  { value: 'close_out', label: 'Close Out' },
  { value: 'contract_review_aisc', label: 'Contract Review Records (AISC)' },
  { value: 'leed', label: 'LEED' },
  { value: 'photo', label: 'Photo' },
  { value: 'request_for_change', label: 'Request for Change' },
  { value: 'safety', label: 'Safety' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'accounting', label: 'Accounting' },
  { value: 'vendor_pricing', label: 'Vendor Pricing' },
  { value: 'vendor_quote', label: 'Vendor Quote' },
  { value: 'vendor_invoice', label: 'Vendor Invoice' },
  { value: 'excel_file', label: 'Excel File' },
  { value: 'word_document', label: 'Word Document' },
  { value: 'mtr', label: 'MTR (Mill Test Report)' },
  { value: 'other', label: 'Other' },
];

export const documentTypeLabel = (value) =>
  DOCUMENT_TYPE_OPTIONS.find((o) => o.value === value)?.label
  || value?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  || 'Other';

// Categories that already have a real, dedicated system elsewhere in the app.
// Filtering Documents by one of these queries the owning entity directly
// instead of a manual-upload bucket — per the standing "link, don't duplicate"
// rule, change_orders/purchase_orders/certified_payroll deliberately have NO
// matching document_type value at all (nothing above to accidentally pick).
// rfi/safety/schedule/contract_review_aisc do have a real document_type (for a
// standalone file that isn't itself a formal record of that system), so their
// query result is unioned with any manually-uploaded Documents of that type.
export const LINKED_DOCUMENT_CATEGORIES = [
  {
    key: 'change_orders',
    label: 'Change Orders',
    documentType: null,
    query: (projectId) => db.entities.change_orders.filter({ project_id: projectId }, '-created_date', 100),
    titleOf: (r) => `${r.change_order_id || `CO #${String(r.id).slice(-5)}`}${r.description ? ` — ${r.description}` : ''}`,
    linkFor: (r) => ({ type: 'route', to: `/projects/change-orders?open=${r.id}` }),
  },
  {
    key: 'rfi',
    label: 'RFI',
    documentType: 'rfi',
    query: (projectId) => db.entities.RFI.filter({ project_id: projectId }, '-created_date', 100),
    titleOf: (r) => `RFI ${r.rfi_number || ''}${r.subject ? ` — ${r.subject}` : ''}`,
    linkFor: (r) => ({ type: 'route', to: `/rfis?open=${r.id}` }),
  },
  {
    key: 'submittals',
    label: 'Submittals',
    documentType: 'submittal',
    query: (projectId) => db.entities.Submittal.filter({ project_id: projectId }, '-created_date', 100),
    titleOf: (r) => `${r.submittal_number || ''}${r.revision_number ? ` Rev ${r.revision_number}` : ''}${r.submittal_description ? ` — ${r.submittal_description}` : ''}`,
    linkFor: (r) => ({ type: 'route', to: `/submittals?open=${r.id}` }),
  },
  {
    key: 'purchase_orders',
    label: 'Purchase Orders',
    documentType: null,
    query: (projectId) => db.entities.purchase_orders.filter({ project_id: projectId }, '-created_date', 100),
    titleOf: (r) => `${r.po_number || `PO #${String(r.id).slice(-5)}`}${r.vendor_name ? ` — ${r.vendor_name}` : ''}`,
    linkFor: (r) => ({ type: 'route', to: `/purchasing/module?open=${r.id}` }),
  },
  {
    key: 'certified_payroll',
    label: 'Certified Payroll',
    documentType: null,
    query: (projectId) => db.entities.CertifiedPayrollSubmission.filter({ project_id: projectId }, '-created_date', 100),
    titleOf: (r) => `Certified Payroll — Week Ending ${r.week_ending_date || ''}${r.subcontractor_name ? ` — ${r.subcontractor_name}` : ''}`,
    linkFor: (r) => ({ type: 'route', to: `/certified-payroll?open=${r.id}` }),
  },
  {
    key: 'schedule',
    label: 'Schedule',
    documentType: 'schedule',
    query: (projectId) => db.entities.shop_schedules.filter({ project_id: projectId }, 'sequence_number', 100),
    titleOf: (r) => `Schedule Item #${r.sequence_number ?? ''}${r.target_tons ? ` — ${r.target_tons} tons` : ''}`,
    // No per-record detail view exists for shop_schedules anywhere in the app
    // today — link goes to the page level only, not a fabricated deep link.
    linkFor: () => ({ type: 'route', to: '/shop-fabrication' }),
  },
  {
    key: 'safety',
    label: 'Safety',
    documentType: 'safety',
    query: (projectId) => db.entities.SafetyMeeting.filter({ project_id: projectId }, '-meeting_date', 100),
    titleOf: (r) => `Safety Meeting — ${r.meeting_date || ''}${r.topic ? ` — ${r.topic}` : ''}`,
    linkFor: (r) => ({ type: 'route', to: `/safety?open=${r.id}` }),
  },
  {
    key: 'contract_review_aisc',
    label: 'Contract Review Records (AISC)',
    documentType: 'contract_review_aisc',
    query: (projectId) => db.entities.TurnoverMeetingRecord.filter({ project_id: projectId }, '-created_date', 100),
    titleOf: (r) => `Contract Review Turnover — ${(r.created_date || '').slice(0, 10)} (${r.status || 'draft'})`,
    // Lives inside ProjectDetail's own Handoff tab, not a separate route.
    linkFor: () => ({ type: 'tab', tab: 'handoff' }),
  },
];
