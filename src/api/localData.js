import { stubSignatureHash, verifyPin } from '@/lib/hrSecurity';
import { encodeFormulaPin } from '@/lib/pinFormula';
import { isEmployeeActive, DEACTIVATION_MESSAGE } from '@/lib/employeeAuth';
import { SHAPE_CLASSES } from '@/data/steelShapeSelector';
import { SERVICE_SCHEDULE_SEEDS } from '@/lib/serviceScheduleSeedData';
import { LEGACY_RIGGING_CATEGORY_MAP } from '@/lib/riggingAssetTypes';

export const STORAGE_KEY = 'steelos_local_db_v1';
const AUTH_STORAGE_KEY = 'steelos_auth_state';
// One-time hand-off for the "you were logged out because your account was
// deactivated" message: db.auth.me() sets this the instant it detects a
// forced logout, then a full-page redirect lands on Login.jsx, which reads
// and clears it. This is a UI message relay ONLY — the actual liveness check
// always re-reads the employees record fresh (see isEmployeeActive callers
// below), so this key is never treated as a source of truth for access.
const DEACTIVATION_MESSAGE_KEY = 'steelos_deactivation_message';

export const getAndClearDeactivationMessage = () => {
  const storage = getStorage();
  const message = storage.getItem(DEACTIVATION_MESSAGE_KEY);
  if (message) storage.removeItem(DEACTIVATION_MESSAGE_KEY);
  return message;
};
const fallbackStorage = (() => {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
})();

const getStorage = () => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return fallbackStorage;
};

const createId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const toLowerCase = (value) => String(value || '').toLowerCase();

const buildSeedData = () => {
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const certExpiredDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const certExpiringSoonDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const certValidDate = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const scheduleStartThisWeek = new Date(Date.now()).toISOString().slice(0, 10);
  const scheduleEndThisWeek = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const scheduleStartNextMonth = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const scheduleEndNextMonth = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return {
    User: [
      {
        id: 'user-admin',
        email: 'admin@steelos.dev',
        password: 'password123',
        roles: ['admin', 'super_admin'],
        full_name: 'Demo Admin',
        is_active: true,
        company_id: 'company-hancock',
        created_date: now,
        updated_date: now
      },
      {
        id: 'user-estimator',
        email: 'estimator@steelos.dev',
        password: 'password123',
        roles: ['estimator'],
        full_name: 'Demo Estimator',
        is_active: true,
        company_id: 'company-hancock',
        created_date: now,
        updated_date: now
      },
      {
        id: 'user-pm',
        email: 'projectmanager@steelos.dev',
        password: 'password123',
        roles: ['project_manager'],
        full_name: 'Demo Project Manager',
        is_active: true,
        company_id: 'company-hancock',
        created_date: now,
        updated_date: now
      },
      {
        id: 'user-purchasing',
        email: 'purchasing@steelos.dev',
        password: 'password123',
        roles: ['purchasing_agent'],
        full_name: 'Demo Purchasing Agent',
        is_active: true,
        company_id: 'company-hancock',
        created_date: now,
        updated_date: now
      },
      {
        id: 'user-super-admin',
        email: 'superadmin@steelos.dev',
        password: 'password123',
        roles: ['super_admin'],
        full_name: 'Platform Super Admin',
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'user-hancock-controller',
        email: 'controller@hancocksteel.com',
        password: 'password123',
        roles: ['finance_department'],
        full_name: 'Hancock Controller',
        company_id: 'company-hancock',
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'user-hancock-estimator',
        email: 'estimator@hancocksteel.com',
        password: 'password123',
        roles: ['estimator'],
        full_name: 'Hancock Estimator',
        company_id: 'company-hancock',
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'user-hancock-pm',
        email: 'pm@hancocksteel.com',
        password: 'password123',
        roles: ['project_manager'],
        full_name: 'Hancock PM',
        company_id: 'company-hancock',
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'user-hancock-hr',
        email: 'hr@hancocksteel.com',
        password: 'password123',
        roles: ['hr_admin'],
        full_name: 'Hancock HR Director',
        company_id: 'company-hancock',
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'user-hancock-shop',
        email: 'shop@hancocksteel.com',
        password: 'password123',
        roles: ['shop_foreman'],
        full_name: 'Hancock Shop Manager',
        company_id: 'company-hancock',
        is_active: true,
        created_date: now,
        updated_date: now
      }
    ],
    Company: [
      {
        id: 'company-hancock',
        name: 'Hancock Steel',
        company_code: 'hancock',
        company_type: 'structural_steel_fabricator',
        city: 'Findlay',
        state: 'OH',
        logo_url: '',
        // Enterprise Connect — Hancock's seed data spans both shop fabrication
        // and field erection (fleet, rigging, jobsite receiving), so it needs
        // every module pack bundles. See src/lib/modulePacks.js.
        subscription_plan: 'Enterprise_Connect',
        subscription_status: 'Active',
        brand_color_hex: '#2563eb',
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'company-arlington',
        name: 'Arlington Fab',
        company_code: 'arlington',
        company_type: 'miscellaneous_metals',
        city: 'Arlington',
        state: 'TX',
        logo_url: '',
        // Fabricator pack only — deliberately narrower than Hancock so the two
        // demo tenants exercise different module-pack gates (no Field
        // Operations/rigging/equipment-service; see modulePacks.js).
        subscription_plan: 'SteelOS_Fab',
        subscription_status: 'Active',
        brand_color_hex: '#dc2626',
        is_active: true,
        created_date: now,
        updated_date: now
      }
    ],
    CostCode: [
      { id: 'cost-code-delivery', company_id: 'company-hancock', code_name: 'DELIVERY', description: 'Freight and mileage to jobsite', is_active: true, created_date: now, updated_date: now },
      { id: 'cost-code-labor', company_id: 'company-hancock', code_name: 'LABOR', description: 'Shop and field labor', is_active: true, created_date: now, updated_date: now },
      { id: 'cost-code-materials', company_id: 'company-hancock', code_name: 'MATERIALS', description: 'Raw steel and consumables', is_active: true, created_date: now, updated_date: now },
      { id: 'cost-code-equipment', company_id: 'company-hancock', code_name: 'EQUIPMENT', description: 'Owned/rented equipment usage', is_active: true, created_date: now, updated_date: now },
      { id: 'cost-code-subcontractor', company_id: 'company-hancock', code_name: 'SUBCONTRACTOR', description: 'Subcontracted scope', is_active: true, created_date: now, updated_date: now }
    ],
    DeliveryPricingTier: [
      { id: 'delivery-tier-1', company_id: 'company-hancock', min_miles: 0, max_miles: 25, cost_per_trip: 750, created_date: now, updated_date: now },
      { id: 'delivery-tier-2', company_id: 'company-hancock', min_miles: 25, max_miles: 50, cost_per_trip: 1200, created_date: now, updated_date: now },
      { id: 'delivery-tier-3', company_id: 'company-hancock', min_miles: 50, max_miles: 75, cost_per_trip: 1650, created_date: now, updated_date: now },
      { id: 'delivery-tier-4', company_id: 'company-hancock', min_miles: 75, max_miles: 100, cost_per_trip: 2100, created_date: now, updated_date: now },
      { id: 'delivery-tier-5', company_id: 'company-hancock', min_miles: 100, max_miles: 125, cost_per_trip: 2550, created_date: now, updated_date: now }
    ],
    SalesCommissionConfig: [
      {
        id: 'config-1',
        company_id: 'company-hancock',
        commission_enabled: true,
        default_commission_rate: 5,
        default_commission_rate_description: 'Percent (%)',
        commission_calc_method: 'profit_percent',
        flat_rate_amount: null,
        per_salesman_override: true,
        payment_trigger: 'on_payment_received',
        next_payroll_cycle: true,
        allow_salesmen_see_pipeline: true,
        default_dashboard_widgets: ['pipeline', 'my_projects', 'commission', 'recent_rfis', 'change_orders', 'addenda', 'quick_stats'],
        created_by: 'admin',
        created_date: now,
      },
    ],
    SalesmanCommissionRate: [
      {
        id: 'rate-1',
        company_id: 'company-hancock',
        salesman_id: 'employee-1',
        rate: 5,
        effective_date: now.slice(0, 10),
        end_date: null,
        created_date: now,
      },
    ],
    // Seeded as configurable rules, not hardcoded alerts — each mirrors a
    // signal the app already needs (see src/lib/intelligenceRuleEngine.js for
    // the candidate-metric builder each entity_watched value maps to).
    IntelligenceRule: [
      {
        id: 'intel-rule-bid-pricing-hold',
        company_id: 'company-hancock',
        rule_name: 'Bid pricing past hold window',
        description: 'Flags active bids whose quoted pricing has aged past the company’s pricing hold window (default 21 days).',
        entity_watched: 'Bid',
        condition: { field: 'days_old', operator: '>', threshold: 21 },
        severity: 'warning',
        is_active: true,
        notify_roles: ['estimator', 'admin'],
        source: 'manual',
        approval_status: 'approved',
        created_date: now,
        updated_date: now
      },
      {
        id: 'intel-rule-project-health',
        company_id: 'company-hancock',
        rule_name: 'Project health score below threshold',
        description: 'Flags active projects whose health score has dropped below a healthy range.',
        entity_watched: 'Project',
        condition: { field: 'health_score', operator: '<', threshold: 60 },
        severity: 'critical',
        is_active: true,
        notify_roles: ['project_manager', 'admin'],
        source: 'manual',
        approval_status: 'approved',
        created_date: now,
        updated_date: now
      },
      {
        id: 'intel-rule-dwell-time',
        company_id: 'company-hancock',
        rule_name: 'Station dwell time bottleneck',
        description: 'Flags shop stations where average dwell time is running well over the target minutes for that operation.',
        entity_watched: 'Piece',
        condition: { field: 'dwell_variance_pct', operator: '>', threshold: 25 },
        severity: 'warning',
        is_active: true,
        notify_roles: ['shop_manager'],
        source: 'manual',
        approval_status: 'approved',
        created_date: now,
        updated_date: now
      },
      {
        id: 'intel-rule-equipment-inspection',
        company_id: 'company-hancock',
        rule_name: 'Rigging/equipment inspection overdue',
        description: 'Flags heavy equipment and rigging inspections past their expiration date.',
        entity_watched: 'Equipment',
        condition: { field: 'days_until_expiration', operator: '<=', threshold: 0 },
        severity: 'critical',
        is_active: true,
        notify_roles: ['Maintenance_Manager', 'admin'],
        source: 'manual',
        approval_status: 'approved',
        created_date: now,
        updated_date: now
      },
      {
        id: 'intel-rule-job-cost-overrun',
        company_id: 'company-hancock',
        rule_name: 'Job cost exceeding estimate',
        description: 'Flags cost codes where job-to-date hours exceed the winning bid’s estimate by 15% or more.',
        entity_watched: 'JobCost',
        condition: { field: 'overrun_pct', operator: '>=', threshold: 15 },
        severity: 'warning',
        is_active: true,
        notify_roles: ['project_manager', 'controller'],
        source: 'manual',
        approval_status: 'approved',
        created_date: now,
        updated_date: now
      },
      {
        id: 'intel-rule-cert-expiring',
        company_id: 'company-hancock',
        rule_name: 'Certification expiring soon',
        description: 'Flags employee certifications and training expiring within 30 days.',
        entity_watched: 'Certification',
        condition: { field: 'days_until_expiration', operator: '<=', threshold: 30 },
        severity: 'info',
        is_active: true,
        notify_roles: ['hr_admin'],
        source: 'manual',
        approval_status: 'approved',
        created_date: now,
        updated_date: now
      },
      {
        id: 'intel-rule-ai-suggested-example',
        company_id: 'company-hancock',
        rule_name: 'Bid margin trending below plan',
        description: 'Suggested rule watching for bids priced with an unusually thin margin percentage — not yet reviewed.',
        entity_watched: 'Bid',
        condition: { field: 'days_old', operator: '>', threshold: 10 },
        severity: 'info',
        is_active: false,
        notify_roles: [],
        source: 'ai_suggested',
        approval_status: 'pending_review',
        ai_suggestion_rationale: 'Demonstrates the AI-authored review queue — requires explicit admin approval before it can be activated.',
        created_date: now,
        updated_date: now
      }
    ],
    Customer: [
      {
        id: 'customer-acme',
        name: 'Acme Construction',
        customer_type: 'general_contractor',
        primary_contact: 'Jordan Lee',
        email: 'jordan@acme.com',
        city: 'Austin',
        state: 'TX',
        is_active: true,
        portal_enabled: true,
        portal_email: 'portal@acmeconstruction.com',
        portal_password: 'portal123',
        created_date: now,
        updated_date: now
      },
      {
        id: 'customer-peak',
        name: 'Peak Steel',
        customer_type: 'subcontractor',
        primary_contact: 'Mina Patel',
        email: 'mina@peak.com',
        city: 'Denver',
        state: 'CO',
        is_active: true,
        created_date: now,
        updated_date: now
      }
    ],
    Project: [
      {
        id: 'project-harbor',
        company_id: 'company-hancock',
        name: 'Harbor Tower',
        project_number: 'JOB-26-008',
        customer_id: 'customer-acme',
        customer_name: 'Acme Construction',
        status: 'active',
        execution_status: 'Prefabrication',
        is_archived: false,
        original_contract_value: 1250000,
        approved_change_orders_total: 0,
        current_revised_contract_value: 1250000,
        total_invoiced_to_date: 420000,
        remaining_project_balance: 830000,
        estimated_tons: 280,
        fabricated_tons: 92,
        drawing_release_date: '2026-07-10',
        detailer_crm_link: 'https://crm.local/detailer/harbor',
        approved_shop_drawings_path: '/uploads/harbor-shop-drawings.pdf',
        erector_crm_link: 'https://crm.local/erector/harbor',
        field_mobilization_date: '2026-08-01',
        crane_setup_date: '2026-08-05',
        erection_progress: 24,
        contract_value: 1250000,
        created_date: now,
        updated_date: now
      }
    ],
    projects: [
      {
        id: 'project-harbor',
        company_id: 'company-hancock',
        name: 'Harbor Tower',
        project_number: 'JOB-26-008',
        customer_id: 'customer-acme',
        customer_name: 'Acme Construction',
        status: 'active',
        execution_status: 'Prefabrication',
        is_archived: false,
        original_contract_value: 1250000,
        approved_change_orders_total: 0,
        current_revised_contract_value: 1250000,
        total_invoiced_to_date: 420000,
        remaining_project_balance: 830000,
        estimated_tons: 280,
        fabricated_tons: 92,
        drawing_release_date: '2026-07-10',
        detailer_crm_link: 'https://crm.local/detailer/harbor',
        approved_shop_drawings_path: '/uploads/harbor-shop-drawings.pdf',
        erector_crm_link: 'https://crm.local/erector/harbor',
        field_mobilization_date: '2026-08-01',
        crane_setup_date: '2026-08-05',
        erection_progress: 24,
        contract_value: 1250000,
        created_date: now,
        updated_date: now
      }
    ],
    change_orders: [
      {
        id: 'co-1',
        project_id: 'project-harbor',
        change_order_id: 'CO-001',
        description: 'Added stair tower revisions',
        cost_impact: 18000,
        schedule_impact: 4,
        status: 'Approved',
        attachment_path: '/uploads/co-001.pdf',
        created_date: now,
        updated_date: now
      }
    ],
    shop_sequences: [
      {
        id: 'seq-anchor-bolts',
        project_id: 'project-harbor',
        sequence_name: 'Sequence 1 - Anchor Bolts',
        material_received: true,
        fabrication_started: true,
        qa_inspection_passed: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'seq-columns',
        project_id: 'project-harbor',
        sequence_name: 'Sequence 2 - Columns',
        material_received: true,
        fabrication_started: false,
        qa_inspection_passed: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'seq-beams',
        project_id: 'project-harbor',
        sequence_name: 'Sequence 3 - Beams',
        material_received: false,
        fabrication_started: false,
        qa_inspection_passed: false,
        created_date: now,
        updated_date: now
      }
    ],
    Bid: [
      {
        id: 'bid-1001',
        company_id: 'company-hancock',
        bid_number: 'BID-1001',
        project_id: 'project-harbor',
        customer_id: 'customer-acme',
        customer_name: 'Acme Construction',
        status: 'in_progress',
        bid_due_date: '2026-08-15',
        created_date: now,
        updated_date: now
      }
    ],
    Document: [
      {
        id: 'document-1',
        name: 'Project Overview.pdf',
        project_id: 'project-harbor',
        status: 'approved',
        is_archived: false,
        created_date: now,
        updated_date: now
      }
    ],
    AIFinding: [
      {
        id: 'finding-1',
        project_id: 'project-harbor',
        review_package: 'accounting',
        review_status: 'new',
        title: 'Budget variance detected',
        created_date: now,
        updated_date: now
      }
    ],
    AIReviewSkill: [
      {
        id: 'skill-scope-gap',
        name: 'Scope Gap Finder',
        description: 'Flags scope items mentioned in specs/drawings that are missing from the bid inclusions/exclusions.',
        system_prompt: 'You are a steel estimating reviewer. Compare the attached project documents against this bid\'s scope summary, inclusions, and exclusions. List any scope items referenced in the documents that are not clearly addressed.',
        accepts_attachments: true,
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'skill-spec-compliance',
        name: 'Spec Compliance Check',
        description: 'Checks the bid against attached specification sections for material/coating/testing requirements.',
        system_prompt: 'You are a steel estimating reviewer. Review the attached specification excerpts and flag any material grade, coating, welding, or testing requirements that may not be reflected in this bid.',
        accepts_attachments: true,
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'skill-exclusions-risk',
        name: 'Exclusions Risk Review',
        description: 'Reviews the bid\'s exclusions text for language that could create risk or ambiguity with the GC.',
        system_prompt: 'You are a steel estimating reviewer. Review this bid\'s exclusions text for vague or missing language that could create scope disputes with the general contractor.',
        accepts_attachments: false,
        is_active: true,
        created_date: now,
        updated_date: now
      }
    ],
    RFI: [
      {
        id: 'rfi-1',
        rfi_number: 'RFI-001',
        project_id: 'project-harbor',
        status: 'draft',
        date_submitted: '2026-07-21',
        status_history: [{ from: null, to: 'draft', changed_by: 'System', changed_at: now, note: 'RFI created.' }],
        created_date: now,
        updated_date: now
      }
    ],
    PieceMark: [
      {
        id: 'piece-1',
        piece_mark: 'PM-100',
        project_id: 'project-harbor',
        assembly: 'North Frame',
        weight_lbs: 1840,
        material_shape: 'W12x26',
        length_ft: 32,
        material_grade: 'A572-50',
        drawing_number: 'DWG-1001',
        drawing_path: '/drawings/PM-100.pdf',
        qr_code: 'QR-PM-100',
        station_status: 'Paint',
        qa_layout_status: 'Approved',
        qa_weld_status: 'Approved',
        status: 'painted',
        created_date: now,
        updated_date: now
      }
    ],
    InventoryItem: [
      {
        id: 'inventory-1',
        name: 'W12x26 Beam',
        sku: 'BEAM-001',
        is_active: true,
        unit_cost: 120,
        created_date: now,
        updated_date: now
      }
    ],
    MillPricing: [
      {
        id: 'mill-price-1',
        mill_name: 'North Steel',
        material: 'W12x26',
        effective_date: '2026-07-01',
        price: 875,
        is_active: true,
        created_date: now,
        updated_date: now
      }
    ],
    Vendor: [
      {
        id: 'vendor-peak-steel',
        name: 'Peak Steel',
        vendor_type: 'supplier',
        contact_name: 'Dana Whitfield',
        phone: '419-555-0142',
        email: 'sales@peaksteel.example',
        is_active: true,
        portal_enabled: true,
        portal_email: 'portal@peaksteel.example',
        portal_password: 'portal123',
        created_date: now,
        updated_date: now
      },
      {
        id: 'vendor-hancock-erectors',
        name: 'Hancock County Erectors',
        vendor_type: 'subcontractor',
        contact_name: 'Marcus Reyes',
        phone: '419-555-0198',
        email: 'ops@hancockerectors.example',
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'vendor-arrow-logistics',
        name: 'Arrow Logistics',
        vendor_type: 'carrier',
        contact_name: 'Sam Ortega',
        phone: '419-555-0177',
        email: 'dispatch@arrowlogistics.example',
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'vendor-buckeye-steel',
        name: 'Buckeye Steel Distributors',
        vendor_type: 'supplier',
        contact_name: 'Leah Farrow',
        phone: '419-555-0163',
        email: 'sales@buckeyesteel.example',
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'vendor-midwest-fastener',
        name: 'Midwest Fastener Supply',
        vendor_type: 'supplier',
        contact_name: 'Ray Colton',
        phone: '419-555-0189',
        email: 'orders@midwestfastener.example',
        is_active: true,
        created_date: now,
        updated_date: now
      }
    ],
    VendorPricingLink: [
      {
        id: 'vendor-link-1',
        bid_id: 'bid-1001',
        vendor_id: 'customer-peak',
        vendor_name: 'Peak Steel',
        is_approved: true,
        created_date: now,
        updated_date: now
      }
    ],
    Notification: [
      {
        id: 'notification-1',
        title: 'Welcome to SteelOS',
        message: 'Your local workspace is ready.',
        is_read: false,
        created_date: now,
        updated_date: now
      }
    ],
    CustomRole: [
      {
        id: 'role-admin',
        role_name: 'Estimator',
        is_active: true,
        is_system: false,
        created_date: now,
        updated_date: now
      }
    ],
    ApiCredential: [],
    steel_catalog: SHAPE_CLASSES.flatMap((cls) =>
      cls.sizes.map((size) => ({
        id: `steel-catalog-${cls.value}-${size}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
        item_id: `STL-${cls.value.replace(/\s+/g, '').toUpperCase()}-${size.replace(/[^A-Z0-9]/gi, '')}`,
        company_id: 'company-hancock',
        shape_class: cls.value,
        size_designation: size,
        is_custom: false,
        created_date: now,
        updated_date: now
      }))
    ),
    erection_fleet_assets: [
      {
        id: 'fleet-asset-1',
        company_id: 'company-hancock',
        asset_name: 'Crane 1 — Grove GMK5250L',
        asset_type: 'Crane',
        equipment_type: 'MOBILE_CRANE',
        status: 'Internal_Owned',
        runtime_hours: 4820,
        severe_duty_multiplier: 0.7,
        last_service_by_level: {
          A: { date: yesterday.slice(0, 10), runtime_hours: 4800 },
          B: { date: '2025-06-01', runtime_hours: 4500 }
        },
        project_location_id: 'project-harbor',
        rental_vendor_id: '',
        rental_target_off_rent_date: '',
        is_marked_ready_for_pickup: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'fleet-asset-2',
        company_id: 'company-hancock',
        asset_name: 'Rented Man-Lift — 60ft Boom',
        asset_type: 'Rigging_Equipment',
        equipment_type: 'AERIAL_BOOM_LIFT',
        status: 'Third_Party_Rented',
        runtime_hours: 312,
        severe_duty_multiplier: 1,
        last_service_by_level: {
          A: { date: yesterday.slice(0, 10), runtime_hours: 300 }
        },
        project_location_id: 'project-harbor',
        rental_vendor_id: 'vendor-arrow-logistics',
        rental_target_off_rent_date: yesterday.slice(0, 10),
        is_marked_ready_for_pickup: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'fleet-asset-3',
        company_id: 'company-hancock',
        asset_name: 'Truck 4 — Kenworth T880',
        asset_type: 'Truck',
        equipment_type: 'SEMI_TRACTOR',
        status: 'Internal_Owned',
        runtime_hours: 18320,
        odometer_miles: 162000,
        severe_duty_multiplier: 1,
        last_service_by_level: {
          A: { date: '2025-07-01', odometer_miles: 150000 },
          B: { date: '2026-06-01', odometer_miles: 155000 },
          C: { date: '2026-05-01', odometer_miles: 140000 },
          D: { date: '2026-06-01', odometer_miles: 130000 }
        },
        project_location_id: '',
        rental_vendor_id: '',
        rental_target_off_rent_date: '',
        is_marked_ready_for_pickup: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'fleet-asset-4',
        company_id: 'company-hancock',
        asset_name: 'Crane 2 — Link-Belt 175',
        asset_type: 'Crane',
        equipment_type: 'MOBILE_CRANE',
        status: 'Internal_Owned',
        runtime_hours: 6104,
        severe_duty_multiplier: 1,
        last_service_by_level: {},
        project_location_id: 'project-harbor',
        rental_vendor_id: '',
        rental_target_off_rent_date: '',
        is_marked_ready_for_pickup: false,
        created_date: now,
        updated_date: now
      }
    ],
    ServiceSchedule: SERVICE_SCHEDULE_SEEDS.map((s) => ({
      id: `service-schedule-${s.equipment_type}-${s.service_level}`.toLowerCase(),
      company_id: 'company-hancock',
      is_active: true,
      ...s,
      created_date: now,
      updated_date: now
    })),
    heavy_equipment_inspections: [
      {
        id: 'inspection-1',
        company_id: 'company-hancock',
        asset_id: 'fleet-asset-1',
        inspection_type: 'Crane_Annual',
        executed_date: '2025-08-01',
        expiration_date: certExpiringSoonDate,
        status_passed: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'inspection-2',
        company_id: 'company-hancock',
        asset_id: 'fleet-asset-3',
        inspection_type: 'DOT_Vehicle',
        executed_date: '2025-01-15',
        expiration_date: certValidDate,
        status_passed: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'inspection-3',
        company_id: 'company-hancock',
        asset_id: 'fleet-asset-2',
        inspection_type: 'Rigging_Quarterly',
        executed_date: '2024-11-01',
        expiration_date: certExpiredDate,
        status_passed: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'inspection-4',
        company_id: 'company-hancock',
        asset_id: 'fleet-asset-4',
        inspection_type: 'Crane_Annual',
        executed_date: '2024-06-01',
        expiration_date: certExpiredDate,
        status_passed: true,
        created_date: now,
        updated_date: now
      }
    ],
    field_hook_logs: [
      {
        id: 'hook-log-1',
        company_id: 'company-hancock',
        project_id: 'project-harbor',
        crane_asset_id: 'fleet-asset-1',
        piece_mark_id: 'piece-1',
        hooked_at: yesterday,
        bolted_complete_at: now,
        elapsed_minutes: 42,
        created_date: now,
        updated_date: now
      }
    ],
    fleet_repair_logs: [
      {
        id: 'repair-log-1',
        company_id: 'company-hancock',
        asset_id: 'fleet-asset-1',
        repair_category: 'Routine_PM',
        runtime_hours_at_repair: 4800,
        cost_cents: 32500,
        repair_date: yesterday.slice(0, 10),
        notes: '250-hour service — fluids, filters, boom cable inspection.',
        created_at: now,
        created_date: now,
        updated_date: now
      }
    ],
    rigging_inventory_ledger: [
      {
        id: 'rigging-1',
        company_id: 'company-hancock',
        rigging_id: 'SB-1001',
        rigging_type: 'spreader_bar',
        description: '12ft spreader bar',
        manufacturer: 'Caldwell',
        wll_rated_capacity: '20 tons',
        length_or_size: '12 ft beam',
        in_service_date: '2024-02-01',
        status: 'in_service',
        length_inches: 144,
        capacity_tons: 20,
        beam_width_feet: 12,
        created_at: now,
        created_date: now,
        updated_date: now
      },
      {
        id: 'rigging-2',
        company_id: 'company-hancock',
        rigging_id: 'CS-2004',
        rigging_type: 'wire_rope_sling',
        description: '3/4in wire rope sling, 72in',
        manufacturer: 'Slingmax',
        wll_rated_capacity: '8.5 tons',
        length_or_size: '3/4in x 72in',
        in_service_date: '2023-09-15',
        status: 'removed_from_service',
        removed_date: '2025-07-20',
        removed_reason: 'Corrosion progressed to visible wire wear at end termination — removed per 29 CFR 1926.251(c)(4).',
        length_inches: 72,
        diameter_inches: 0.75,
        created_at: now,
        created_date: now,
        updated_date: now
      },
      {
        id: 'rigging-3',
        company_id: 'company-hancock',
        rigging_id: 'NS-3007',
        rigging_type: 'synthetic_web_sling',
        description: '4in x 96in synthetic web sling, 2-ply',
        manufacturer: 'Lift-All',
        wll_rated_capacity: '6 tons',
        length_or_size: '4in x 96in, 2-ply',
        in_service_date: '2024-11-01',
        status: 'in_service',
        length_inches: 96,
        ply_count: '2-Ply',
        width_inches: 4,
        created_at: now,
        created_date: now,
        updated_date: now
      }
    ],
    RiggingInspection: [
      {
        id: 'rigging-inspection-1',
        company_id: 'company-hancock',
        rigging_asset_id: 'rigging-1',
        inspection_date: '2025-06-01',
        inspector_name: 'Dale Hutchins',
        inspection_type: 'Monthly',
        equipment_id: 'SB-1001',
        equipment_description: '12ft spreader bar',
        tag_legible: true,
        wll_readable: true,
        hardware_findings: [
          { subsection: 'Spreader_Bars', item: 'Structural deformation', checked: false, notes: '' },
          { subsection: 'Spreader_Bars', item: 'Weld integrity', checked: false, notes: '' },
          { subsection: 'Spreader_Bars', item: 'Proof-load test current', checked: false, notes: '' }
        ],
        deficiencies: '',
        disposal_action: 'Pass',
        disposal_notes: '',
        documents: [],
        created_date: now,
        updated_date: now
      },
      {
        id: 'rigging-inspection-2',
        company_id: 'company-hancock',
        rigging_asset_id: 'rigging-1',
        inspection_date: '2025-08-10',
        inspector_name: 'Dale Hutchins',
        inspection_type: 'Monthly',
        equipment_id: 'SB-1001',
        equipment_description: '12ft spreader bar',
        tag_legible: true,
        wll_readable: true,
        hardware_findings: [
          { subsection: 'Spreader_Bars', item: 'Structural deformation', checked: false, notes: '' },
          { subsection: 'Spreader_Bars', item: 'Weld integrity', checked: false, notes: '' },
          { subsection: 'Spreader_Bars', item: 'Proof-load test current', checked: false, notes: '' }
        ],
        deficiencies: '',
        disposal_action: 'Pass',
        disposal_notes: '',
        documents: [],
        created_date: now,
        updated_date: now
      },
      {
        id: 'rigging-inspection-3',
        company_id: 'company-hancock',
        rigging_asset_id: 'rigging-2',
        inspection_date: '2025-03-01',
        inspector_name: 'Maria Ortiz',
        inspection_type: 'Monthly',
        equipment_id: 'CS-2004',
        equipment_description: '3/4in wire rope sling, 72in',
        tag_legible: true,
        wll_readable: true,
        sling_type: 'Wire_Rope',
        sling_findings: [
          { item: 'Broken wires per lay', checked: false, notes: '' },
          { item: 'Kinking', checked: false, notes: '' },
          { item: 'Birdcaging', checked: false, notes: '' },
          { item: 'Core protrusion', checked: false, notes: '' },
          { item: 'Corrosion', checked: true, notes: 'Light surface corrosion near mid-span — monitor.' },
          { item: 'End termination damage', checked: false, notes: '' }
        ],
        deficiencies: 'Light surface corrosion noted near mid-span.',
        disposal_action: 'Pass',
        disposal_notes: '',
        documents: [],
        created_date: now,
        updated_date: now
      },
      {
        id: 'rigging-inspection-4',
        company_id: 'company-hancock',
        rigging_asset_id: 'rigging-2',
        inspection_date: '2025-05-15',
        inspector_name: 'Maria Ortiz',
        inspection_type: 'Monthly',
        equipment_id: 'CS-2004',
        equipment_description: '3/4in wire rope sling, 72in',
        tag_legible: true,
        wll_readable: true,
        sling_type: 'Wire_Rope',
        sling_findings: [
          { item: 'Broken wires per lay', checked: false, notes: '' },
          { item: 'Kinking', checked: false, notes: '' },
          { item: 'Birdcaging', checked: false, notes: '' },
          { item: 'Core protrusion', checked: false, notes: '' },
          { item: 'Corrosion', checked: true, notes: 'Corrosion progressing near mid-span.' },
          { item: 'End termination damage', checked: false, notes: '' }
        ],
        deficiencies: 'Corrosion progressing near mid-span since last inspection.',
        disposal_action: 'Requires_Repair',
        disposal_notes: 'Schedule for closer inspection/cleaning before next use.',
        documents: [],
        created_date: now,
        updated_date: now
      },
      {
        id: 'rigging-inspection-5',
        company_id: 'company-hancock',
        rigging_asset_id: 'rigging-2',
        inspection_date: '2025-07-20',
        inspector_name: 'Maria Ortiz',
        inspection_type: 'Monthly',
        equipment_id: 'CS-2004',
        equipment_description: '3/4in wire rope sling, 72in',
        tag_legible: true,
        wll_readable: true,
        sling_type: 'Wire_Rope',
        sling_findings: [
          { item: 'Broken wires per lay', checked: false, notes: '' },
          { item: 'Kinking', checked: false, notes: '' },
          { item: 'Birdcaging', checked: false, notes: '' },
          { item: 'Core protrusion', checked: false, notes: '' },
          { item: 'Corrosion', checked: true, notes: 'Corrosion has progressed further — visible wire wear at end termination.' },
          { item: 'End termination damage', checked: true, notes: 'Visible wire wear at end termination.' }
        ],
        deficiencies: 'Corrosion has progressed to visible wire wear at the end termination.',
        disposal_action: 'Removed_From_Service',
        disposal_notes: 'Corrosion progressed to visible wire wear at end termination — removed per 29 CFR 1926.251(c)(4).',
        documents: [],
        created_date: now,
        updated_date: now
      }
    ],
    ApiIntegrationLog: [
      {
        id: 'api-log-1',
        company_id: 'company-hancock',
        endpoint_url: 'https://api.procore.com/webhooks/pay',
        payload_direction: 'Incoming',
        payload_json: JSON.stringify({ invoice_receivable_id: 'inv-rec-1', status: 'approved' }),
        response_status: 200,
        latency_ms: 184,
        processed_at: now,
        created_date: now,
        updated_date: now
      },
      {
        id: 'api-log-2',
        company_id: 'company-hancock',
        endpoint_url: 'https://api.texturacorp.com/sov/export',
        payload_direction: 'Outgoing',
        payload_json: JSON.stringify({ sov_status: 'Released', invoice_receivable_id: 'inv-rec-2' }),
        response_status: 200,
        latency_ms: 312,
        processed_at: yesterday,
        created_date: yesterday,
        updated_date: yesterday
      },
      {
        id: 'api-log-3',
        company_id: 'company-hancock',
        endpoint_url: 'https://sage100.internal/gl/export',
        payload_direction: 'Outgoing',
        payload_json: JSON.stringify({ batch_id: 'gl-2026-07-28', line_count: 42 }),
        response_status: 500,
        latency_ms: 2140,
        processed_at: yesterday,
        created_date: yesterday,
        updated_date: yesterday
      }
    ],
    print_label_jobs: [],
    ApiTokenVault: [
      {
        id: 'api-token-1',
        company_id: 'company-hancock',
        token_name: 'Procore Webhook Key',
        partial_key_string: 'st_live_...4a2b',
        encrypted_secret_key: 'c3RfbGl2ZV9wcm9jb3JlXzRhMmI=',
        status: 'Active',
        created_at: now,
        created_date: now,
        updated_date: now
      },
      {
        id: 'api-token-2',
        company_id: 'company-hancock',
        token_name: 'Textura Billing Sync',
        partial_key_string: 'st_live_...9f01',
        encrypted_secret_key: 'c3RfbGl2ZV90ZXh0dXJhXzlmMDE=',
        status: 'Revoked',
        created_at: yesterday,
        created_date: yesterday,
        updated_date: yesterday
      }
    ],
    SystemSetting: [
      {
        id: 'setting-cost-vars',
        setting_group: 'cost_variables',
        value: '{}',
        created_date: now,
        updated_date: now
      }
    ],
    AuditLog: [
      {
        id: 'audit-1',
        action: 'initialized',
        created_date: now,
        updated_date: now
      }
    ],
    UserDashboardConfig: [],
    HistoricalVariance: [
      {
        id: 'variance-1',
        project_id: 'project-harbor',
        completed_date: '2026-06-30',
        variance_amount: 4500,
        created_date: now,
        updated_date: now
      }
    ],
    TakeoffLine: [],
    report_templates: [
      {
        id: 'report-template-proposal-1',
        company_id: 'company-hancock',
        document_type_key: 'proposal',
        version_string: '1.0',
        header_footer_config_json: { show_header: true, show_footer: false, footer_text: '' },
        column_visibility_flags_json: {
          show_fabrication: true,
          show_detailing: true,
          show_engineering: true,
          show_erection: true,
          show_admin_allocation: true,
          show_tax_breakdown: true,
        },
        is_active: true,
        created_date: now,
        updated_date: now
      }
    ],
    form_layouts: [],
    JobCostLedgerEntry: [
      {
        id: 'ledger-1',
        company_id: 'company-hancock',
        project_id: 'project-harbor',
        cost_code: 'MAT-STL',
        cost_class: 'MAT',
        amount: 268000,
        transaction_date: '2026-06-15',
        source_type: 'material',
        description: 'Structural steel material draw',
        created_date: now,
        updated_date: now
      },
      {
        id: 'ledger-2',
        company_id: 'company-hancock',
        project_id: 'project-harbor',
        cost_code: 'LAB-FAB',
        cost_class: 'LAB',
        amount: 142000,
        transaction_date: '2026-07-01',
        source_type: 'labor',
        description: 'Shop fabrication labor, June',
        created_date: now,
        updated_date: now
      },
      {
        id: 'ledger-3',
        company_id: 'company-hancock',
        project_id: 'project-harbor',
        cost_code: 'SUB-ERECT',
        cost_class: 'SUB',
        amount: 38500,
        transaction_date: '2026-07-15',
        source_type: 'vendor_bill',
        description: 'Erection subcontractor mobilization',
        created_date: now,
        updated_date: now
      }
    ],
    pieces: [
      {
        id: 'piece-1',
        project_id: 'project-harbor',
        company_id: 'company-hancock',
        piece_mark: 'PM-100',
        piece_mark_id: 'piece-1',
        material_shape: 'W12x26',
        dimensions: '32ft x 12in',
        weight: 1840,
        blueprint_file_uri: '/drawings/PM-100.pdf',
        qr_payload_string: 'QR-PM-100',
        current_station_id: 6,
        workflow_status: 'Paint_Unlocked',
        field_status: 'In_Shop',
        created_date: now,
        updated_date: now
      },
      {
        id: 'piece-2',
        project_id: 'project-harbor',
        company_id: 'company-hancock',
        piece_mark: 'PM-101',
        material_shape: 'HSS6x6x1/4',
        dimensions: '18ft x 6in',
        weight: 620,
        blueprint_file_uri: '/drawings/PM-101.pdf',
        qr_payload_string: 'QR-PM-101',
        current_station_id: 2,
        workflow_status: 'In_Fabrication',
        created_date: now,
        updated_date: now
      },
      {
        id: 'piece-3',
        project_id: 'project-harbor',
        company_id: 'company-hancock',
        piece_mark: 'PM-102',
        material_shape: 'W10x22',
        dimensions: '24ft x 10in',
        weight: 980,
        blueprint_file_uri: '/drawings/PM-102.pdf',
        qr_payload_string: 'QR-PM-102',
        current_station_id: 5,
        workflow_status: 'Inspector_Queue',
        created_date: now,
        updated_date: now
      },
      {
        id: 'piece-4',
        project_id: 'project-harbor',
        company_id: 'company-hancock',
        piece_mark: 'PM-103',
        material_shape: 'L4x4x1/2',
        dimensions: '12ft x 4in',
        weight: 310,
        blueprint_file_uri: '/drawings/PM-103.pdf',
        qr_payload_string: 'QR-PM-103',
        current_station_id: 5,
        workflow_status: 'Weld_Unlocked',
        created_date: now,
        updated_date: now
      }
    ],
    station_logs: [
      {
        id: 'station-log-1',
        piece_id: 'piece-1',
        employee_id: 'EMP-101',
        station_id: 6,
        status: 'Complete',
        start_time: '2026-07-21T08:00:00.000Z',
        end_time: '2026-07-21T09:15:00.000Z',
        elapsed_minutes: 75,
        auto_paused: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'station-log-2',
        piece_id: 'piece-4',
        employee_id: 'EMP-204',
        station_id: 5,
        status: 'In_Progress',
        start_time: yesterday,
        end_time: null,
        elapsed_minutes: 0,
        auto_paused: false,
        created_date: now,
        updated_date: now
      }
    ],
    // Append-only scan audit trail — one row per QR scan event (start/
    // complete/hold/resume), additive to station_logs rather than a
    // replacement for it. See src/lib/pieceScan.js and
    // ShopFloorCommandCenter.jsx for the scan flow that populates this.
    piece_timing_events: [],
    qa_inspections: [
      {
        id: 'qa-1',
        piece_id: 'piece-1',
        stage: '1_Layout',
        inspector_id: 'EMP-900',
        digital_stamp_credentials: 'INSP-JD-4471',
        status: 'Approved',
        notes: 'Layout verified against PDF',
        inspected_at: '2026-07-21T08:30:00.000Z',
        created_date: now,
        updated_date: now
      },
      {
        id: 'qa-2',
        piece_id: 'piece-1',
        stage: '2_Weld',
        inspector_id: 'EMP-900',
        digital_stamp_credentials: 'INSP-JD-4471',
        status: 'Approved',
        notes: 'Structural weld profile inspected and stamped',
        inspected_at: '2026-07-21T09:00:00.000Z',
        created_date: now,
        updated_date: now
      }
    ],
    loads: [
      {
        id: 'load-9-1',
        project_id: 'project-harbor',
        company_id: 'company-hancock',
        load_number_id: 'LOAD-001',
        status: 'Draft',
        total_weight_lbs: 1840,
        carrier_vendor_id: 'vendor-arrow-logistics',
        max_weight_capacity_lbs: 45000,
        is_overweight_permit_authorized: false,
        created_date: now,
        updated_date: now
      },
      // Folded forward from the now-removed legacy shipping_loads seed
      // ('load-1' — Load 1, Arrow Logistics, 46 tons, delivered 2026-07-24,
      // delivery receipt on file). No PieceMark was ever assigned to it in
      // seed data, so it has no load_items counterpart. tons_shipped -> lbs
      // (x2000); the legacy record's ship_date + attachment_path implied a
      // completed delivery, so status is Delivered here rather than Draft.
      {
        id: 'load-legacy-1',
        project_id: 'project-harbor',
        company_id: 'company-hancock',
        load_number_id: 'LOAD-LEGACY-1',
        status: 'Delivered',
        total_weight_lbs: 92000,
        carrier_vendor_id: 'vendor-arrow-logistics',
        max_weight_capacity_lbs: 45000,
        is_overweight_permit_authorized: false,
        created_date: '2026-07-24T00:00:00.000Z',
        updated_date: '2026-07-24T00:00:00.000Z'
      }
    ],
    load_items: [
      {
        id: 'load-item-1',
        load_id: 'load-9-1',
        piece_id: 'piece-1',
        sequence_number: 1,
        status: 'Staged',
        created_date: now,
        updated_date: now
      }
    ],
    shipping_manifests: [],
    candidate_profiles: [
      {
        id: 'candidate-1',
        candidate_name: 'Jordan Blake',
        email: 'jordan.blake@example.com',
        phone: '419-555-0133',
        position_applied: 'Ironworker',
        status: 'Interviewing',
        applied_date: '2026-07-10',
        hired_employee_id: '',
        notes: 'Second interview scheduled with shop manager.',
        created_date: now,
        updated_date: now
      },
      {
        id: 'candidate-2',
        candidate_name: 'Priya Shah',
        email: 'priya.shah@example.com',
        phone: '419-555-0187',
        position_applied: 'Welder',
        status: 'Interviewing',
        applied_date: '2026-07-15',
        hired_employee_id: '',
        notes: 'Strong welding certifications, first-round interview pending.',
        created_date: now,
        updated_date: now
      },
      {
        id: 'candidate-3',
        candidate_name: 'Marcus Webb',
        email: 'marcus.webb@example.com',
        phone: '419-555-0142',
        position_applied: 'Fabricator',
        status: 'Interviewing',
        applied_date: '2026-07-18',
        hired_employee_id: '',
        notes: 'Referred by Casey Nguyen.',
        created_date: now,
        updated_date: now
      }
    ],
    calendar_events: [
      {
        id: 'calendar-event-1',
        event_type: 'Interview',
        candidate_id: 'candidate-1',
        candidate_name: 'Jordan Blake',
        interviewer: 'Casey Nguyen',
        scheduled_datetime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        notes: 'Second-round interview — shop floor walkthrough.',
        created_date: now,
        updated_date: now
      },
      {
        id: 'calendar-event-2',
        event_type: 'Interview',
        candidate_id: 'candidate-2',
        candidate_name: 'Priya Shah',
        interviewer: 'Shop Manager',
        scheduled_datetime: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
        notes: 'First-round phone interview.',
        created_date: now,
        updated_date: now
      },
      {
        id: 'calendar-event-3',
        event_type: 'Interview',
        candidate_id: 'candidate-3',
        candidate_name: 'Marcus Webb',
        interviewer: 'HR Admin',
        scheduled_datetime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        notes: 'On-site interview and shop tour.',
        created_date: now,
        updated_date: now
      }
    ],
    employees: [
      {
        id: 'employee-1',
        company_id: 'company-hancock',
        employee_number: '001',
        full_name: 'Casey Nguyen',
        classification: 'Welder',
        hire_date: '2024-03-10',
        is_active: true,
        pin_encrypted: encodeFormulaPin({ employee_number: '001', ssn_last4: '4471' }),
        is_timeclock_locked: false,
        has_w4_approved: true,
        i9_on_file: true,
        i9_date: '2024-03-10',
        i9_reverification_due_date: '2027-03-10',
        i9_reverification_completed_date: '',
        e_verify_status: 'verified',
        e_verify_initiated_date: '2024-03-11',
        e_verify_verified_date: '2024-03-12',
        e_verify_recheck_due_date: '2026-09-01',
        ssn_last4: '4471',
        pay_rate_cents: 2800,
        is_active_login: true,
        is_salesman: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'employee-2',
        company_id: 'company-hancock',
        employee_number: '002',
        full_name: 'Riley Foster',
        classification: 'Fabricator',
        hire_date: '2026-07-20',
        is_active: true,
        pin_encrypted: encodeFormulaPin({ employee_number: '002', ssn_last4: '8823' }),
        is_timeclock_locked: true,
        has_w4_approved: true,
        i9_on_file: false,
        i9_date: '',
        i9_reverification_due_date: '2029-07-20',
        i9_reverification_completed_date: '',
        e_verify_status: 'not_submitted',
        e_verify_initiated_date: '',
        e_verify_verified_date: '',
        e_verify_recheck_due_date: '',
        ssn_last4: '8823',
        pay_rate_cents: 2400,
        is_active_login: false,
        created_date: now,
        updated_date: now
      }
    ],
    employee_certifications: [
      {
        id: 'cert-1',
        employee_id: 'employee-1',
        cert_type: 'Welding_6G',
        cert_number: 'WLD-6G-0001',
        issued_date: '2024-03-15',
        expiration_date: certValidDate,
        file_uri: '/certs/casey-welding-6g.pdf',
        status: 'Valid',
        created_date: now,
        updated_date: now
      },
      {
        id: 'cert-2',
        employee_id: 'employee-1',
        cert_type: 'OSHA_10',
        cert_number: 'OSHA10-0001',
        issued_date: '2024-01-05',
        expiration_date: certExpiringSoonDate,
        file_uri: '/certs/casey-osha10.pdf',
        status: 'Expiring_Soon',
        created_date: now,
        updated_date: now
      },
      {
        id: 'cert-3',
        employee_id: 'employee-2',
        cert_type: 'Forklift',
        cert_number: 'FORK-0002',
        issued_date: '2023-06-01',
        expiration_date: certExpiredDate,
        file_uri: '/certs/riley-forklift.pdf',
        status: 'Expired',
        created_date: now,
        updated_date: now
      }
    ],
    issued_assets: [
      {
        id: 'asset-1',
        employee_id: 'employee-1',
        asset_type: 'Hard_Hat',
        asset_tag: 'HH-0104',
        issued_date: '2024-03-10',
        returned_date: '',
        condition: 'Good',
        created_date: now,
        updated_date: now
      }
    ],
    disciplinary_records: [
      {
        id: 'discipline-1',
        employee_id: 'employee-2',
        incident_date: '2026-07-22',
        category: 'Attendance',
        description: 'Late arrival, third occurrence this quarter.',
        action_taken: 'Verbal warning issued.',
        signature_hash: stubSignatureHash('EMP-002-2026-07-22'),
        recorded_by: 'EMP-900',
        created_date: now,
        updated_date: now
      }
    ],
    shop_schedules: [
      {
        id: 'schedule-1',
        project_id: 'project-harbor',
        sequence_number: 1,
        scheduled_start_date: scheduleStartThisWeek,
        scheduled_end_date: scheduleEndThisWeek,
        target_tons: 120,
        priority_weight: 5,
        created_date: now,
        updated_date: now
      },
      {
        id: 'schedule-2',
        project_id: 'project-harbor',
        sequence_number: 2,
        scheduled_start_date: scheduleStartNextMonth,
        scheduled_end_date: scheduleEndNextMonth,
        target_tons: 80,
        priority_weight: 2,
        created_date: now,
        updated_date: now
      }
    ],
    remnant_inventory: [
      {
        id: 'remnant-1',
        material_shape: 'W12x26',
        dimensions: '4ft-2in remainder',
        length_in: 50,
        heat_number_string: 'HT-88213',
        source_project_id: 'project-harbor',
        inventory_zone_id: '',
        created_date: now,
        updated_date: now
      }
    ],
    manager_overrides: [],
    time_off_requests: [
      {
        id: 'timeoff-1',
        employee_id: 'employee-1',
        leave_type: 'PTO',
        start_date: '2026-08-03',
        end_date: '2026-08-05',
        total_hours: 24,
        reason: 'Family trip',
        status: 'Approved',
        created_date: now,
        updated_date: now
      },
      {
        id: 'timeoff-2',
        employee_id: 'employee-2',
        leave_type: 'Sick',
        start_date: '2026-08-01',
        end_date: '2026-08-01',
        total_hours: 8,
        reason: 'Doctor appointment',
        status: 'Submitted',
        created_date: now,
        updated_date: now
      }
    ],
    // Balances/transactions are deliberately NOT hand-seeded here — they're
    // populated live by src/lib/ptoEngine.js's anniversary check (run on HR
    // page load / Employee Center login) so demo data always matches what
    // the real accrual math computes, rather than a hand-authored snapshot
    // that could silently drift from the algorithm. This also means the
    // pre-existing Approved timeoff-1 request above (which predates this
    // feature) is never retroactively decremented — the same way rolling
    // out a ledger-based balance system for real would require an explicit
    // opening-balance adjustment, not a magic backfill.
    PtoPolicy: [
      {
        id: 'pto-policy-pto',
        company_id: 'company-hancock',
        policy_name: 'Standard PTO',
        leave_type: 'PTO',
        accrual_method: 'anniversary_grant',
        annual_hours: 80,
        accrual_rate: 0,
        max_balance: 240,
        carryover_allowed: true,
        max_carryover_hours: 40,
        waiting_period_days: 90,
        tenure_tiers: [
          { years_of_service: 0, annual_hours: 80 },
          { years_of_service: 3, annual_hours: 120 },
          { years_of_service: 6, annual_hours: 160 }
        ],
        overdraft_action: 'hard_block',
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pto-policy-sick',
        company_id: 'company-hancock',
        policy_name: 'Standard Sick',
        leave_type: 'Sick',
        accrual_method: 'anniversary_grant',
        annual_hours: 40,
        accrual_rate: 0,
        max_balance: 80,
        carryover_allowed: false,
        max_carryover_hours: 0,
        waiting_period_days: 0,
        tenure_tiers: [],
        overdraft_action: 'allow_negative',
        is_active: true,
        created_date: now,
        updated_date: now
      }
    ],
    payroll_document_mappings: [
      {
        id: 'payroll-doc-1',
        employee_id: 'employee-1',
        tax_year: 2026,
        document_type: 'PayStub',
        payout_date: '2026-07-25',
        gross_wages_cents: 224000,
        net_pay_cents: 168000,
        file_secure_uri: '/secure/paystubs/employee-1-2026-07-25.pdf',
        created_date: now,
        updated_date: now
      },
      {
        id: 'payroll-doc-2',
        employee_id: 'employee-1',
        tax_year: 2025,
        document_type: 'W2',
        payout_date: '2026-01-15',
        gross_wages_cents: 5824000,
        net_pay_cents: 4368000,
        file_secure_uri: '/secure/w2/employee-1-2025.pdf',
        created_date: now,
        updated_date: now
      }
    ],
    attendance_punches: [],
    credit_card_expenses: [
      {
        id: 'cc-expense-1',
        company_id: 'company-hancock',
        employee_id: 'employee-1',
        project_id: 'project-harbor',
        card_last4: '4821',
        merchant_name: 'Hampton Inn — Harbor City',
        expense_category: 'Lodging',
        amount_cents: 14500,
        expense_date: yesterday.slice(0, 10),
        receipt_file_uri: '/uploads/receipts/hampton-inn-1.pdf',
        per_diem_allowance_cents: 6500,
        is_out_of_town_travel: true,
        status: 'Pending',
        created_date: now,
        updated_date: now
      }
    ],
    demo_requests: [],
    employee_documents: [],
    employee_portal_sessions: [],
    purchase_orders: [
      {
        id: 'po-1001',
        po_number: 'PO-1001',
        vendor_id: 'vendor-peak-steel',
        vendor_name: 'Peak Steel',
        project_id: 'project-harbor',
        material_category: 'Structural Shapes',
        budgeted_cost: 240000,
        actual_cost: 228000,
        variance: 12000,
        quantity_ordered: 140,
        payment_terms: 'Net 30',
        status: 'Partial Receipt',
        created_date: now,
        updated_date: now
      },
      {
        id: 'po-1002',
        po_number: 'PO-1002',
        vendor_id: 'vendor-buckeye-steel',
        vendor_name: 'Buckeye Steel Distributors',
        project_id: 'project-harbor',
        material_category: 'Plate',
        budgeted_cost: 25760,
        actual_cost: 0,
        variance: 25760,
        quantity_ordered: 80,
        payment_terms: 'Net 30',
        status: 'Open',
        created_date: now,
        updated_date: now
      },
      {
        id: 'po-1003',
        po_number: 'PO-1003',
        vendor_id: 'vendor-midwest-fastener',
        vendor_name: 'Midwest Fastener Supply',
        project_id: 'project-harbor',
        material_category: 'Bolts/Fasteners',
        budgeted_cost: 2310,
        actual_cost: 1365,
        variance: 945,
        quantity_ordered: 2800,
        payment_terms: 'Net 30',
        status: 'Partial Receipt',
        created_date: now,
        updated_date: now
      },
      {
        id: 'po-1004',
        po_number: 'PO-1004',
        vendor_id: 'vendor-peak-steel',
        vendor_name: 'Peak Steel',
        project_id: 'project-harbor',
        material_category: 'Consumables',
        budgeted_cost: 4980,
        actual_cost: 4980,
        variance: 0,
        quantity_ordered: 55,
        payment_terms: 'Net 30',
        status: 'Fully Received',
        created_date: now,
        updated_date: now
      },
      {
        id: 'po-1005',
        po_number: 'PO-1005',
        vendor_id: 'vendor-buckeye-steel',
        vendor_name: 'Buckeye Steel Distributors',
        project_id: 'project-harbor',
        material_category: 'Structural Shapes',
        budgeted_cost: 46650,
        actual_cost: 0,
        variance: 46650,
        quantity_ordered: 56,
        payment_terms: 'Net 45',
        status: 'Open',
        created_date: now,
        updated_date: now
      }
    ],
    purchase_order_lines: [
      {
        id: 'pol-1001-1',
        po_id: 'po-1001',
        line_number: 1,
        description: 'W14x90 Wide Flange Columns',
        material_category: 'Structural Shapes',
        quantity_ordered: 24,
        unit_of_measure: 'pc',
        unit_cost: 2800,
        line_total: 24 * 2800,
        quantity_received: 24,
        quantity_remaining: 0,
        is_fully_received: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1001-2',
        po_id: 'po-1001',
        line_number: 2,
        description: 'W18x35 Wide Flange Beams',
        material_category: 'Structural Shapes',
        quantity_ordered: 48,
        unit_of_measure: 'pc',
        unit_cost: 890,
        line_total: 48 * 890,
        quantity_received: 24,
        quantity_remaining: 24,
        is_fully_received: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1001-3',
        po_id: 'po-1001',
        line_number: 3,
        description: 'HSS 6x6x1/4 Tube Columns',
        material_category: 'Structural Shapes',
        quantity_ordered: 36,
        unit_of_measure: 'pc',
        unit_cost: 640,
        line_total: 36 * 640,
        quantity_received: 24,
        quantity_remaining: 12,
        is_fully_received: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1001-4',
        po_id: 'po-1001',
        line_number: 4,
        description: 'Misc Plate and Connection Material',
        material_category: 'Misc Metals',
        quantity_ordered: 1,
        unit_of_measure: 'lot',
        unit_cost: 18000,
        line_total: 18000,
        quantity_received: 0,
        quantity_remaining: 1,
        is_fully_received: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1002-1',
        po_id: 'po-1002',
        line_number: 1,
        description: '1/2" x 4\' x 20\' A36 Plate',
        material_category: 'Plate',
        quantity_ordered: 12,
        unit_of_measure: 'pc',
        unit_cost: 620,
        line_total: 12 * 620,
        quantity_received: 0,
        quantity_remaining: 12,
        is_fully_received: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1002-2',
        po_id: 'po-1002',
        line_number: 2,
        description: '3/8" x 8\' x 20\' A36 Plate',
        material_category: 'Plate',
        quantity_ordered: 8,
        unit_of_measure: 'pc',
        unit_cost: 540,
        line_total: 8 * 540,
        quantity_received: 0,
        quantity_remaining: 8,
        is_fully_received: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1002-3',
        po_id: 'po-1002',
        line_number: 3,
        description: 'L4x4x1/4 Angle, 20\' Stock',
        material_category: 'Structural Shapes',
        quantity_ordered: 40,
        unit_of_measure: 'pc',
        unit_cost: 145,
        line_total: 40 * 145,
        quantity_received: 0,
        quantity_remaining: 40,
        is_fully_received: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1002-4',
        po_id: 'po-1002',
        line_number: 4,
        description: 'C10x20 Channel, 20\' Stock',
        material_category: 'Structural Shapes',
        quantity_ordered: 20,
        unit_of_measure: 'pc',
        unit_cost: 410,
        line_total: 20 * 410,
        quantity_received: 0,
        quantity_remaining: 20,
        is_fully_received: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1003-1',
        po_id: 'po-1003',
        line_number: 1,
        description: '3/4" x 2" A325 Structural Bolt Kits (bolt/nut/washer)',
        material_category: 'Bolts/Fasteners',
        quantity_ordered: 500,
        unit_of_measure: 'ea',
        unit_cost: 2.10,
        line_total: 500 * 2.10,
        quantity_received: 500,
        quantity_remaining: 0,
        is_fully_received: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1003-2',
        po_id: 'po-1003',
        line_number: 2,
        description: '7/8" x 2-1/2" A490 Structural Bolt Kits',
        material_category: 'Bolts/Fasteners',
        quantity_ordered: 300,
        unit_of_measure: 'ea',
        unit_cost: 3.40,
        line_total: 300 * 3.40,
        quantity_received: 150,
        quantity_remaining: 150,
        is_fully_received: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1003-3',
        po_id: 'po-1003',
        line_number: 3,
        description: '1/4" Flat Washers, Galvanized',
        material_category: 'Bolts/Fasteners',
        quantity_ordered: 2000,
        unit_of_measure: 'ea',
        unit_cost: 0.12,
        line_total: 2000 * 0.12,
        quantity_received: 0,
        quantity_remaining: 2000,
        is_fully_received: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1004-1',
        po_id: 'po-1004',
        line_number: 1,
        description: 'E70 Welding Wire, .045" Spool',
        material_category: 'Consumables',
        quantity_ordered: 24,
        unit_of_measure: 'spool',
        unit_cost: 85,
        line_total: 24 * 85,
        quantity_received: 24,
        quantity_remaining: 0,
        is_fully_received: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1004-2',
        po_id: 'po-1004',
        line_number: 2,
        description: '7018 Stick Weld Rod, 50lb Box',
        material_category: 'Consumables',
        quantity_ordered: 10,
        unit_of_measure: 'box',
        unit_cost: 120,
        line_total: 10 * 120,
        quantity_received: 10,
        quantity_remaining: 0,
        is_fully_received: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1004-3',
        po_id: 'po-1004',
        line_number: 3,
        description: 'Zinc-Rich Primer, 5 Gal Pail',
        material_category: 'Consumables',
        quantity_ordered: 6,
        unit_of_measure: 'pail',
        unit_cost: 210,
        line_total: 6 * 210,
        quantity_received: 6,
        quantity_remaining: 0,
        is_fully_received: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1004-4',
        po_id: 'po-1004',
        line_number: 4,
        description: 'Grinding Discs, 4.5" (box of 25)',
        material_category: 'Consumables',
        quantity_ordered: 15,
        unit_of_measure: 'box',
        unit_cost: 32,
        line_total: 15 * 32,
        quantity_received: 15,
        quantity_remaining: 0,
        is_fully_received: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1005-1',
        po_id: 'po-1005',
        line_number: 1,
        description: 'W12x26 Wide Flange Beams',
        material_category: 'Structural Shapes',
        quantity_ordered: 30,
        unit_of_measure: 'pc',
        unit_cost: 980,
        line_total: 30 * 980,
        quantity_received: 0,
        quantity_remaining: 30,
        is_fully_received: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1005-2',
        po_id: 'po-1005',
        line_number: 2,
        description: 'HSS 4x4x1/4 Tube',
        material_category: 'Structural Shapes',
        quantity_ordered: 25,
        unit_of_measure: 'pc',
        unit_cost: 310,
        line_total: 25 * 310,
        quantity_received: 0,
        quantity_remaining: 25,
        is_fully_received: false,
        created_date: now,
        updated_date: now
      },
      {
        id: 'pol-1005-3',
        po_id: 'po-1005',
        line_number: 3,
        description: 'Misc Base Plates & Connection Material',
        material_category: 'Misc Metals',
        quantity_ordered: 1,
        unit_of_measure: 'lot',
        unit_cost: 9500,
        line_total: 9500,
        quantity_received: 0,
        quantity_remaining: 1,
        is_fully_received: false,
        created_date: now,
        updated_date: now
      }
    ],
    purchase_requisitions: [
      {
        id: 'req-1001',
        job_number: 'JOB-26-008',
        item_description: 'Field bolts and hardware',
        required_on_site_date: '2026-07-28',
        urgency: 'Critical',
        requisition_total: 7800,
        status: 'Pending Executive Approval',
        requires_signature: true,
        created_date: now,
        updated_date: now
      }
    ],
    receiving_logs: [
      {
        id: 'rcv-1001',
        po_id: 'po-1001',
        po_number: 'PO-1001',
        quantity_ordered: 140,
        quantity_received: 92,
        delivery_status: 'Partial Delivery',
        packing_list: 'Packing List A',
        material_heat_number: 'HT-4412',
        attachment_path: '/uploads/bol-001.pdf',
        created_date: now,
        updated_date: now
      }
    ],
    payable_invoices: [
      {
        id: 'inv-1001',
        po_id: 'po-1001',
        invoice_number: 'INV-2201',
        invoice_amount: 228100,
        quantity_received: 92,
        expected_cost: 228000,
        expected_quantity: 140,
        status: 'Approved for Payment',
        match_result: 'Matched within 1%',
        created_date: now,
        updated_date: now
      }
    ]
  };
};

const isLegacyPieceShape = (item) => !!item && (item.qr_code !== undefined || item.current_station_id === undefined);
const isLegacyStationLogShape = (item) => !!item && (item.station !== undefined || item.station_id === undefined);
const isLegacyQaShape = (item) => !!item && (item.inspection_stage !== undefined || item.stage === undefined);

// One-time forward migration off the legacy shipping_loads + PieceMark.
// shipping_load_id system (no schema file, superseded by loads/load_items/
// shipping_manifests) onto the maintained tables. Runs from migrateStore()
// below on every load, but is a no-op after the first successful run for a
// given store: it clears migrated.shipping_loads at the end, so the guard at
// the top (legacyLoads.length === 0) short-circuits on every call after.
// Never silently drops data:
//  - every legacy shipping_loads row always becomes a loads row (carrier
//    name -> carrier_vendor_id is a best-effort exact-name match against
//    Vendor; unmatched carriers/trailer types/attachment paths have no
//    equivalent field on loads/shipping_manifests to hold them — logged via
//    console.warn rather than fabricated into a fake manifest, since
//    shipping_manifests.driver_name is required and legacy records never
//    captured a driver).
//  - every PieceMark.shipping_load_id assignment becomes a load_items row,
//    linked via the explicit pieces.piece_mark_id FK (never an inferred
//    project_id+piece_mark string match) — a PieceMark with no bridged shop
//    pieces row yet has nothing to link, so it's reported via console.warn
//    and its shipping_load_id is left untouched (not cleared) rather than
//    deleted, so the raw assignment is still recoverable from storage.
const migrateLegacyShippingLoads = (migrated) => {
  const legacyLoads = Array.isArray(migrated.shipping_loads) ? migrated.shipping_loads : [];
  if (legacyLoads.length === 0) return;

  if (!Array.isArray(migrated.loads)) migrated.loads = [];
  if (!Array.isArray(migrated.load_items)) migrated.load_items = [];
  const vendors = Array.isArray(migrated.Vendor) ? migrated.Vendor : [];
  const pieceMarks = Array.isArray(migrated.PieceMark) ? migrated.PieceMark : [];
  const shopPieces = Array.isArray(migrated.pieces) ? migrated.pieces : [];
  const migratedMarkIds = new Set();

  legacyLoads.forEach((legacy) => {
    const matchedVendor = vendors.find((v) => toLowerCase(v.name) === toLowerCase(legacy.carrier_name));
    if (legacy.carrier_name && !matchedVendor) {
      console.warn(`[migrateLegacyShippingLoads] No Vendor named "${legacy.carrier_name}" — carrier_vendor_id left blank on the migrated load for legacy shipping_loads/${legacy.id}.`);
    }
    if (legacy.attachment_path) {
      console.warn(`[migrateLegacyShippingLoads] legacy shipping_loads/${legacy.id} had attachment_path "${legacy.attachment_path}" with no driver on file — shipping_manifests.driver_name is required, so no manifest was created. Re-attach manually via Yard Scanning if still needed.`);
    }

    const newLoad = {
      id: createId(),
      company_id: legacy.company_id || '',
      project_id: legacy.project_id || '',
      load_number_id: legacy.load_number || `LOAD-LEGACY-${legacy.id}`,
      status: legacy.ship_date ? 'Delivered' : 'Draft',
      total_weight_lbs: Math.round((Number(legacy.tons_shipped) || 0) * 2000),
      carrier_vendor_id: matchedVendor?.id || '',
      max_weight_capacity_lbs: 45000,
      is_overweight_permit_authorized: false,
      created_date: legacy.created_date || legacy.ship_date || new Date().toISOString(),
      updated_date: new Date().toISOString(),
    };
    migrated.loads.push(newLoad);

    const linkedMarks = pieceMarks.filter((pm) => pm.shipping_load_id === legacy.id);
    let nextSeq = 1;
    linkedMarks.forEach((pm) => {
      const piece = shopPieces.find((p) => p.piece_mark_id === pm.id);
      if (!piece) {
        console.warn(`[migrateLegacyShippingLoads] PieceMark ${pm.id} (${pm.piece_mark}) was assigned to legacy load ${legacy.id} but has no bridged pieces row (piece_mark_id) — left as-is, not migrated to load_items.`);
        return;
      }
      migrated.load_items.push({
        id: createId(),
        company_id: legacy.company_id || '',
        load_id: newLoad.id,
        piece_id: piece.id,
        sequence_number: nextSeq++,
        status: 'Staged',
        created_date: newLoad.created_date,
        updated_date: newLoad.updated_date,
      });
      migratedMarkIds.add(pm.id);
    });
  });

  migrated.PieceMark = pieceMarks.map((pm) => (migratedMarkIds.has(pm.id) ? { ...pm, shipping_load_id: '' } : pm));
  migrated.shipping_loads = [];
};

// rigging_inventory_ledger's serial_tag/rigging_category -> rigging_id/
// rigging_type rename+remap. Idempotent: a row already on the new shape
// (rigging_id set) is left untouched. Shackle_Hook has no clean 1:1 mapping
// (the old enum merged shackles and hooks) — defaults to 'shackle' and
// warns, since that's a lossy guess an admin may want to correct to 'hook'.
const migrateRiggingLedgerFields = (migrated) => {
  const rows = Array.isArray(migrated.rigging_inventory_ledger) ? migrated.rigging_inventory_ledger : [];
  migrated.rigging_inventory_ledger = rows.map((row) => {
    if (row.rigging_id) return row.status ? row : { ...row, status: 'in_service' };
    const newType = LEGACY_RIGGING_CATEGORY_MAP[row.rigging_category] || 'wire_rope_sling';
    if (row.rigging_category === 'Shackle_Hook') {
      console.warn(`[migrateRiggingLedgerFields] rigging_inventory_ledger/${row.id} (serial_tag "${row.serial_tag}") was category Shackle_Hook, which has no exact match in the new rigging_type enum — defaulted to 'shackle'. Correct to 'hook' in the Rigging Registry if this item is actually a hook.`);
    }
    return { ...row, rigging_id: row.serial_tag || row.id, rigging_type: newType, status: row.status || 'in_service' };
  });
};

// Backfills RiggingInspection.rigging_asset_id by matching trimmed/
// case-insensitive equipment_id against rigging_inventory_ledger.rigging_id.
// Must run AFTER migrateRiggingLedgerFields so rigging_id actually exists.
// Idempotent (skips records that already have the FK). Unmatched records
// are warned about and left exactly as-is — equipment_id preserved,
// rigging_asset_id left blank — never dropped.
const migrateRiggingInspectionAssetLinks = (migrated) => {
  const inspections = Array.isArray(migrated.RiggingInspection) ? migrated.RiggingInspection : [];
  if (inspections.length === 0) return;
  const assets = Array.isArray(migrated.rigging_inventory_ledger) ? migrated.rigging_inventory_ledger : [];

  migrated.RiggingInspection = inspections.map((inspection) => {
    if (inspection.rigging_asset_id) return inspection;
    const match = assets.find((a) => toLowerCase(a.rigging_id) === toLowerCase(inspection.equipment_id) && toLowerCase(a.rigging_id) !== '');
    if (!match) {
      console.warn(`[migrateRiggingInspectionAssetLinks] RiggingInspection/${inspection.id} has equipment_id "${inspection.equipment_id}" with no matching rigging_inventory_ledger.rigging_id — left unlinked, not dropped. Link it manually from the Rigging Registry if the asset exists under a different tag.`);
      return inspection;
    }
    return { ...inspection, rigging_asset_id: match.id };
  });
};

// Generic backfill for the shared StatusHistoryEntry log (src/lib/
// statusHistory.js, StatusHistoryModal) — every entity below writes its
// status changes there now instead of a bespoke per-entity history. Runs on
// every load but is idempotent per record: a record is only ever backfilled
// once, since after that its (entity_type, entity_id, field_name) already
// has a StatusHistoryEntry row and the guard below skips it on every
// subsequent call.
const STATUS_HISTORY_BACKFILL_TARGETS = [
  { entityKey: 'Bid', fieldName: 'status' },
  { entityKey: 'Project', fieldName: 'status' },
  { entityKey: 'pieces', fieldName: 'workflow_status' },
  { entityKey: 'pieces', fieldName: 'field_status' },
  { entityKey: 'DisciplinaryAction', fieldName: 'status', changedByField: 'supervisor_name' },
  { entityKey: 'loads', fieldName: 'status' },
  { entityKey: 'qa_inspections', fieldName: 'status', changedByField: 'inspector_id' },
  { entityKey: 'rigging_inventory_ledger', fieldName: 'status' },
];

const backfillStatusHistory = (migrated) => {
  if (!Array.isArray(migrated.StatusHistoryEntry)) migrated.StatusHistoryEntry = [];
  const history = migrated.StatusHistoryEntry;
  const hasEntry = (entityType, entityId, fieldName) =>
    history.some((h) => h.entity_type === entityType && h.entity_id === entityId && h.field_name === fieldName);
  const pushEntry = (entry) => {
    const changedAt = entry.changed_at || new Date().toISOString();
    history.push({
      id: createId(),
      company_id: entry.company_id || '',
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      field_name: entry.field_name,
      from_value: entry.from_value ?? null,
      to_value: entry.to_value,
      changed_by: entry.changed_by || 'Unknown',
      changed_at: changedAt,
      note: entry.note || '',
      created_date: changedAt,
      updated_date: changedAt,
    });
  };

  // RFI predates this system and kept its own embedded status_history array
  // (RFIs.jsx) with a real reconstructed trail for seeded/demo data
  // (demoDataSeeder.js) — convert every real entry from that array instead
  // of collapsing it to one synthetic line, so that fidelity isn't lost in
  // the move to the shared system. Falls back to a single synthetic entry
  // only for a row that somehow has neither. RFI itself carries no
  // company_id (it predates tenant scoping too), so the best-effort source
  // for one is its linked Project.
  if (Array.isArray(migrated.RFI)) {
    migrated.RFI.forEach((r) => {
      if (hasEntry('RFI', r.id, 'status')) return;
      const project = (migrated.Project || []).find((p) => p.id === r.project_id);
      const companyId = project?.company_id || '';
      const sourceEntries = Array.isArray(r.status_history) && r.status_history.length > 0
        ? r.status_history
        : [{
          from: null,
          to: r.status || 'draft',
          changed_by: r.submitted_by || 'System',
          changed_at: r.updated_date || r.created_date,
          note: 'Backfilled — no history recorded before this point.',
        }];
      sourceEntries.forEach((entry) => pushEntry({
        company_id: companyId,
        entity_type: 'RFI',
        entity_id: r.id,
        field_name: 'status',
        from_value: entry.from,
        to_value: entry.to,
        changed_by: entry.changed_by,
        changed_at: entry.changed_at || r.created_date,
        note: entry.note,
      }));
    });
  }

  STATUS_HISTORY_BACKFILL_TARGETS.forEach(({ entityKey, fieldName, changedByField }) => {
    const rows = Array.isArray(migrated[entityKey]) ? migrated[entityKey] : [];
    rows.forEach((record) => {
      if (hasEntry(entityKey, record.id, fieldName)) return;
      const value = record[fieldName];
      if (value === undefined || value === null || value === '') return;
      pushEntry({
        company_id: record.company_id,
        entity_type: entityKey,
        entity_id: record.id,
        field_name: fieldName,
        from_value: null,
        to_value: value,
        changed_by: (changedByField && record[changedByField]) || 'System',
        changed_at: record.updated_date || record.created_date,
        note: 'Backfilled — no history recorded before this point.',
      });
    });
  });
};

// Backfills the piece-lifecycle events (piece_timing_events.event_type
// qr_created/received) that predate this feature, so every existing piece's
// PieceTimeline has a starting point instead of an empty history. Guarded by
// hasEvent exactly like backfillStatusHistory above — this runs on every
// persist() call, so it must be a no-op once the events already exist rather
// than re-inserting them.
//
// qr_created has no real generation timestamp anywhere in this app (pieces
// are seed-only — there is no in-app pieces.create() flow — and
// qr_payload_string is a static seeded string with no companion timestamp
// field). created_date is used as the best-effort proxy per product
// decision, not a claim that it's the true QR-generation time.
const backfillPieceLifecycleEvents = (migrated) => {
  if (!Array.isArray(migrated.piece_timing_events)) migrated.piece_timing_events = [];
  const events = migrated.piece_timing_events;
  const hasEvent = (pieceId, eventType) => events.some((e) => e.piece_id === pieceId && e.event_type === eventType);
  const pushEvent = (event) => {
    events.push({
      id: createId(),
      company_id: event.company_id || '',
      piece_id: event.piece_id,
      station_id: event.station_id ?? null,
      event_type: event.event_type,
      scanned_by: event.scanned_by || 'System',
      scanned_at: event.scanned_at,
      notes: event.notes || 'Backfilled — no history recorded before this point.',
      created_date: event.scanned_at,
      updated_date: event.scanned_at,
    });
  };

  (Array.isArray(migrated.pieces) ? migrated.pieces : []).forEach((piece) => {
    if (!hasEvent(piece.id, 'qr_created')) {
      pushEvent({
        company_id: piece.company_id,
        piece_id: piece.id,
        event_type: 'qr_created',
        scanned_at: piece.created_date || new Date().toISOString(),
      });
    }
    if (piece.field_status === 'On_Site' && !hasEvent(piece.id, 'received')) {
      pushEvent({
        company_id: piece.company_id,
        piece_id: piece.id,
        event_type: 'received',
        scanned_at: piece.updated_date || piece.created_date || new Date().toISOString(),
      });
    }
  });
};

const migrateStore = (store) => {
  const seeded = buildSeedData();
  const migrated = { ...store };

  Object.entries(seeded).forEach(([entityName, seedItems]) => {
    if (!Array.isArray(migrated[entityName])) {
      migrated[entityName] = [...seedItems];
      return;
    }

    if (entityName === 'User') {
      const mergedUsers = [...migrated[entityName]];
      seedItems.forEach((seedUser) => {
        const existing = mergedUsers.find((entry) => entry.email === seedUser.email || entry.id === seedUser.id);
        if (!existing) {
          mergedUsers.push(seedUser);
          return;
        }
        // The primary demo admin's role/tenant assignment is authoritative
        // from the seed — patch it onto an already-persisted browser session
        // too, not just brand-new installs, otherwise this fix would be
        // inert for anyone who already has local data (the exact case this
        // was reported against).
        if (existing.email === 'admin@steelos.dev') {
          existing.roles = seedUser.roles;
          existing.company_id = seedUser.company_id;
        }
      });
      migrated[entityName] = mergedUsers;
      return;
    }

    // The pieces/station_logs/qa_inspections schemas were reshaped (new field
    // names, new enums). Reseed ONLY while a pre-reshape (legacy-shaped) row
    // is still present — this must not be unconditional, since persist() calls
    // loadStore()/migrateStore() on every single write to any entity, and an
    // unconditional reseed here would wipe real data on someone else's write.
    if (entityName === 'pieces' && migrated[entityName].some(isLegacyPieceShape)) {
      migrated[entityName] = [...seedItems];
      return;
    }
    if (entityName === 'station_logs' && migrated[entityName].some(isLegacyStationLogShape)) {
      migrated[entityName] = [...seedItems];
      return;
    }
    if (entityName === 'qa_inspections' && migrated[entityName].some(isLegacyQaShape)) {
      migrated[entityName] = [...seedItems];
      return;
    }

    if (entityName === 'Project' || entityName === 'projects') {
      const targetId = seedItems[0]?.id;
      const existing = migrated[entityName].find((item) => item.id === targetId);
      if (existing) {
        Object.assign(existing, { ...seedItems[0], ...existing });
      } else if (migrated[entityName].length === 0) {
        migrated[entityName] = [...seedItems];
      }
      return;
    }

    if (migrated[entityName].length === 0) {
      migrated[entityName] = [...seedItems];
    }
  });

  if (!Array.isArray(migrated.projects)) {
    migrated.projects = Array.isArray(migrated.Project) ? migrated.Project.map((item) => ({ ...item })) : [...seeded.projects];
  }

  // quality_inspection_records predates the AISC Fabricator/Erector track
  // split (Quality.jsx) and has no seed data, so the seeded-entity loop above
  // never touches it. Backfill `track` on every existing row from its old
  // category text rather than orphaning pre-split records from the new
  // track-based reporting — this app's cert tracker was Fabricator-only
  // before the split, so only the field-bolting category is inferred as
  // Erector and everything else defaults to Fabricator.
  if (Array.isArray(migrated.quality_inspection_records)) {
    migrated.quality_inspection_records = migrated.quality_inspection_records.map((r) => {
      if (r.track === 'fabricator' || r.track === 'erector') return r;
      const category = String(r.category || '').toLowerCase();
      return { ...r, track: category.includes('bolt') ? 'erector' : 'fabricator' };
    });
  }

  if (!Array.isArray(migrated.change_orders)) {
    migrated.change_orders = [...seeded.change_orders];
  }

  if (!Array.isArray(migrated.shop_sequences)) {
    migrated.shop_sequences = [...seeded.shop_sequences];
  }

  migrateLegacyShippingLoads(migrated);
  migrateRiggingLedgerFields(migrated);
  migrateRiggingInspectionAssetLinks(migrated);
  backfillStatusHistory(migrated);
  backfillPieceLifecycleEvents(migrated);

  return migrated;
};

const loadStore = () => {
  const storage = getStorage();
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = buildSeedData();
    storage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }

  try {
    const parsed = JSON.parse(raw);
    const migrated = migrateStore(parsed);
    if (JSON.stringify(migrated) !== JSON.stringify(parsed)) {
      storage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    const seeded = buildSeedData();
    storage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
};

// Best-effort mirror of every save out to db.json on disk, via the dev-server
// middleware in vite.config.js (see the comment there for why this can't be
// a direct filesystem write from here — this file runs in the browser).
// Fire-and-forget and silently swallowed on failure: this only exists under
// `npm run dev`, so it must be a strict no-op everywhere else (production
// build, tests, SSR) rather than something callers have to guard against.
//
// Debounced rather than fired per-call: a burst of writes (bulk seeding, for
// example) previously queued one unsequenced POST per call, and since these
// are all in-flight concurrently against the same localhost endpoint, an
// EARLIER call's request could complete AFTER a later one's — last write
// wins on disk, so the earlier (staler, less-complete) snapshot could
// silently clobber the later one, losing data on the next reload even
// though localStorage itself (read synchronously, same-tab) was always
// correct. Collapsing a burst into a single POST of the latest snapshot,
// sent once the burst goes quiet, removes that race entirely.
let pendingSyncStore = null;
let pendingSyncTimer = null;
const SYNC_DEBOUNCE_MS = 250;

const syncStoreToFile = (store) => {
  // Dev-only: the /__db-sync endpoint is provided by the Vite dev-server
  // middleware in vite.config.js and does not exist in any production build.
  // Without this guard every write POSTs the entire store and 405s.
  if (!import.meta.env?.DEV) return;
  if (typeof fetch !== 'function') return;
  pendingSyncStore = store;
  if (pendingSyncTimer) clearTimeout(pendingSyncTimer);
  pendingSyncTimer = setTimeout(() => {
    const toSend = pendingSyncStore;
    pendingSyncTimer = null;
    pendingSyncStore = null;
    try {
      fetch('/__db-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSend),
      }).catch(() => {});
    } catch (e) {
      // no-op
    }
  }, SYNC_DEBOUNCE_MS);
};

const saveStore = (store) => {
  const storage = getStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(store));
  syncStoreToFile(store);
};

const ensureCollection = (store, entityName) => {
  if (!store[entityName]) {
    store[entityName] = [];
  }
  return store[entityName];
};

const normalizeRecord = (entityName, record) => {
  const now = new Date().toISOString();
  return {
    id: record.id || createId(),
    created_date: record.created_date || now,
    updated_date: record.updated_date || now,
    ...record
  };
};

const sortRecords = (records, sortField = '-created_date') => {
  const direction = sortField.startsWith('-') ? -1 : 1;
  const field = sortField.replace(/^[+-]/, '');

  return [...records].sort((left, right) => {
    const leftValue = left[field];
    const rightValue = right[field];

    if (leftValue === rightValue) return 0;

    if (leftValue == null) return 1;
    if (rightValue == null) return -1;

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return (leftValue - rightValue) * direction;
    }

    return String(leftValue).localeCompare(String(rightValue)) * direction;
  });
};

const matchesFilters = (record, filters = {}) => {
  if (!filters || typeof filters !== 'object') return true;

  return Object.entries(filters).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return expected.$in.includes(record[key]);
    }

    return record[key] === expected;
  });
};

export const getLocalStore = () => {
  const store = loadStore();
  return store;
};

export const getAuthState = () => {
  const storage = getStorage();
  const raw = storage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const setAuthState = (state) => {
  const storage = getStorage();
  if (!state) {
    storage.removeItem(AUTH_STORAGE_KEY);
    return;
  }

  storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
};

// Multi-tenant firewall. HONESTY NOTE: this app has no real backend — every
// tenant's data still lives in one browser's single localStorage blob. This
// filter makes tenant isolation behave correctly for normal in-app use; it
// is NOT a real security boundary (devtools access to storage bypasses it
// entirely). Only entities in this whitelist are scoped — everything else in
// this app is unaffected.
const TENANT_SCOPED_ENTITIES = ['Bid', 'Project', 'projects', 'employees', 'pieces', 'loads', 'VendorBill', 'ai_contract_reviews', 'JobCostLedgerEntry', 'executive_metrics_snapshots', 'form_layouts', 'report_templates', 'ApiIntegrationLog', 'ApiTokenVault', 'print_label_jobs', 'erection_fleet_assets', 'heavy_equipment_inspections', 'field_hook_logs', 'attendance_punches', 'credit_card_expenses', 'fleet_repair_logs', 'rigging_inventory_ledger', 'employee_documents', 'blueprint_takeoffs', 'piece_production_logs', 'piece_timing_events', 'company_templates', 'steel_catalog', 'BankAccount', 'BankTransaction', 'RecurringCashItem', 'MonthEndClose', 'CloseChecklistItem', 'BudgetLine', 'UserSessionLog', 'ReviewChecklistItem', 'purchase_order_lines', 'Subcontract', 'SubcontractPayApp', 'LienWaiver', 'EquipmentUsageLog', 'CertifiedPayrollSubmission', 'PayPeriod', 'PayrollRegisterLine', 'CostCode', 'DeliveryPricingTier', 'RiggingInspection', 'EquipmentService', 'ServiceSchedule', 'SafetyMeeting', 'DisciplinaryAction', 'IntelligenceRule', 'CrewAssignment', 'ProjectMeetingNote', 'StatusHistoryEntry', 'PtoPolicy', 'PtoBalance', 'PtoTransaction', 'safety_incidents', 'ncr_records', 'saved_kpi_dashboards', 'SalesCommissionConfig', 'SalesmanCommissionRate', 'ProjectCommission', 'ProjectCommissionPayment', 'SalesCommissionPayout', 'ProjectBulletin', 'Notification'];

const getEffectiveCompanyId = () => {
  const auth = getAuthState();
  if (!auth?.user) return null;
  return auth.impersonating_company_id || auth.user.company_id || null;
};

// A super_admin session that is NOT currently impersonating a tenant sees
// every tenant's data unfiltered — that's the platform-operator visibility
// the super-admin dashboard needs. The moment they impersonate, scoping
// applies normally using the impersonated tenant's company_id.
const isSuperAdminSession = () => {
  const auth = getAuthState();
  if (auth?.impersonating_company_id) return false;
  const roles = (auth?.user?.roles || []).map((r) => String(r).toLowerCase());
  return roles.includes('super_admin');
};

// Fails OPEN (no filter) when there's no resolvable tenant — this is a demo
// app where correctness/non-breakage during edge cases (auth still loading,
// seed/migration code running before any session exists) matters more than
// pretending this is a real security control.
const applyTenantScope = (entityName, records) => {
  if (!TENANT_SCOPED_ENTITIES.includes(entityName) || isSuperAdminSession()) return records;
  const companyId = getEffectiveCompanyId();
  if (!companyId) return records;
  return records.filter((item) => item.company_id === companyId);
};

const stampTenant = (entityName, data) => {
  if (!TENANT_SCOPED_ENTITIES.includes(entityName) || data.company_id) return data;
  const companyId = getEffectiveCompanyId();
  return companyId ? { ...data, company_id: companyId } : data;
};

const assertTenantAccess = (entityName, record) => {
  if (!TENANT_SCOPED_ENTITIES.includes(entityName) || isSuperAdminSession()) return;
  const companyId = getEffectiveCompanyId();
  if (!companyId || !record.company_id) return;
  if (record.company_id !== companyId) {
    throw new Error('Cross-tenant access denied.');
  }
};

// Hard DB-layer constraint: a station_logs write may never route a piece into
// station_id 6 (Paint) unless qa_inspections already has an Approved 2_Weld
// record for that piece. Enforced here — inside the mock DB itself — rather
// than only in the UI, so no caller (this app or a future one) can bypass it.
const enforcePaintStationLock = (entityName, data) => {
  if (entityName !== 'station_logs') return;
  if (Number(data.station_id) !== 6) return;

  const store = getLocalStore();

  // Module 10b Emergency Bypass: an active Expedite_Part manager override on
  // this piece skips the QA lock entirely — this is the same hard DB-layer
  // guard from Module 8, so the bypass has to live here too, not just in the
  // tablet UI, or it would only ever be cosmetic.
  const expedited = (store.manager_overrides || []).some(
    (o) => o.piece_id === data.piece_id && o.override_type === 'Expedite_Part'
  );
  if (expedited) return;

  const weldApproved = (store.qa_inspections || []).some(
    (qa) => qa.piece_id === data.piece_id && qa.stage === '2_Weld' && qa.status === 'Approved'
  );
  if (!weldApproved) {
    throw new Error('Piece cannot be routed to Paint (station 6) without an Approved 2_Weld QA inspection.');
  }
};

export const createEntityApi = (entityName) => {
  const store = getLocalStore();
  const collection = ensureCollection(store, entityName);

  // Each entity API holds its own snapshot of the whole store from load time.
  // Re-read the current on-disk store and overlay only this entity's live
  // collection before saving, so a save here can't clobber other entities'
  // collections back to their stale load-time state.
  const persist = () => {
    const latest = loadStore();
    latest[entityName] = collection;
    saveStore(latest);
  };

  return {
    async list(sortField = '-created_date', limit = 100) {
      const items = sortRecords(applyTenantScope(entityName, collection), sortField);
      return items.slice(0, limit);
    },

    async get(id) {
      const scoped = applyTenantScope(entityName, collection);
      return scoped.find((item) => item.id === id) || null;
    },

    async filter(filters = {}, sortField = '-created_date', limit = 100) {
      const scoped = applyTenantScope(entityName, collection);
      const items = sortRecords(
        scoped.filter((item) => matchesFilters(item, filters)),
        sortField
      );
      return items.slice(0, limit);
    },

    async create(data = {}) {
      enforcePaintStationLock(entityName, data);
      const record = normalizeRecord(entityName, stampTenant(entityName, data));
      collection.push(record);
      persist();
      return record;
    },

    async update(id, data = {}) {
      const index = collection.findIndex((item) => item.id === id);
      if (index < 0) {
        throw new Error(`${entityName} not found`);
      }

      assertTenantAccess(entityName, collection[index]);
      enforcePaintStationLock(entityName, { ...collection[index], ...data });
      const updated = normalizeRecord(entityName, { ...collection[index], ...data, id, updated_date: new Date().toISOString() });
      collection[index] = updated;
      persist();
      return updated;
    },

    async delete(id) {
      const index = collection.findIndex((item) => item.id === id);
      if (index < 0) {
        throw new Error(`${entityName} not found`);
      }

      assertTenantAccess(entityName, collection[index]);
      collection.splice(index, 1);
      persist();
      return true;
    },

    async updateMany(filters = {}, update = {}) {
      const scoped = applyTenantScope(entityName, collection);
      let changed = 0;
      scoped.forEach((item) => {
        if (!matchesFilters(item, filters)) {
          return;
        }

        Object.assign(item, update, { updated_date: new Date().toISOString() });
        changed += 1;
      });
      if (changed > 0) {
        persist();
      }
      return changed;
    },

    async bulkCreate(items = []) {
      const created = items.map((item) => {
        const record = normalizeRecord(entityName, stampTenant(entityName, item));
        collection.push(record);
        return record;
      });
      persist();
      return created;
    }
  };
};

export const createAuthApi = () => {
  const store = getLocalStore();
  const users = ensureCollection(store, 'User');
  const employees = ensureCollection(store, 'employees');
  const companies = ensureCollection(store, 'Company');

  const persist = () => {
    const latest = loadStore();
    latest.User = users;
    saveStore(latest);
  };

  const getAuthenticatedUser = () => {
    const authState = getAuthState();
    if (!authState?.user) {
      throw Object.assign(new Error('Not authenticated'), { status: 401 });
    }
    return authState.user;
  };

  return {
    async loginViaEmailPassword(email, password) {
      const normalizedEmail = toLowerCase(email);
      const user = users.find((entry) => toLowerCase(entry.email) === normalizedEmail && entry.password === password);
      if (!user) {
        throw new Error('Invalid email or password');
      }
      if (user.is_active === false) {
        throw new Error('This account has been deactivated. Please contact your administrator.');
      }
      // Office/portal accounts can optionally be linked to an employees row
      // (System Access Portal / Users.jsx's "Link to Employee" picker) — a
      // person who is BOTH a portal user and a timeclock employee loses
      // portal access the same instant they're terminated. Read live rather
      // than the `employees` closure captured at db construction time, since
      // that copy never sees writes made through db.entities.employees.
      if (user.employee_id) {
        const liveEmployees = ensureCollection(getLocalStore(), 'employees');
        const linkedEmployee = liveEmployees.find((e) => e.id === user.employee_id);
        if (!isEmployeeActive(linkedEmployee)) {
          throw new Error(DEACTIVATION_MESSAGE);
        }
      }

      const token = `local-${user.id}`;
      setAuthState({ user: { ...user, password: undefined }, token });
      return { user: { ...user, password: undefined }, token };
    },

    // Shop/Field Labor login — completely uncoupled from the email/password
    // path above. Employees aren't User accounts in this app, so a
    // successful Employee Number + PIN match (the same check
    // EmployeeCenter.jsx's kiosk login already does) synthesizes a session
    // the same way loginViaEmailPassword does, just sourced from an
    // `employees` row instead of a `User` row. is_kiosk_pin_session marks
    // this as a shared-terminal identity — NavBar.jsx/EmployeeCenter.jsx key
    // off that flag (not employee_id alone) to decide kiosk-only UI, since
    // employee_id can now also appear on a real portal session (see
    // loginViaEmailPassword above) that must NOT be treated as a shared kiosk.
    async loginViaEmployeePin(companyCode, employeeNumber, pin) {
      const normalizedCode = toLowerCase(companyCode);
      const company = companies.find((c) => toLowerCase(c.company_code) === normalizedCode);
      if (!company) {
        throw new Error('Company code not found');
      }
      // Fresh read, not the `employees` closure — see the comment above.
      const liveEmployees = ensureCollection(getLocalStore(), 'employees');
      const employee = liveEmployees.find((e) => e.company_id === company.id && e.employee_number === String(employeeNumber).trim());
      if (!employee || !verifyPin(pin, employee.pin_encrypted)) {
        throw new Error('Invalid employee number or PIN');
      }
      if (employee.is_active_login === false) {
        throw new Error('Account suspended. Please contact system administration.');
      }
      if (!isEmployeeActive(employee)) {
        throw new Error(DEACTIVATION_MESSAGE);
      }

      const syntheticUser = {
        id: `employee-session-${employee.id}`,
        email: '',
        full_name: employee.full_name,
        roles: ['user'],
        company_id: company.id,
        employee_id: employee.id,
        is_active: true,
        is_kiosk_pin_session: true,
      };
      const token = `local-employee-${employee.id}`;
      setAuthState({ user: syntheticUser, token });
      return { user: syntheticUser, token };
    },

    async register(payload = {}) {
      const normalizedEmail = toLowerCase(payload.email);
      const existing = users.find((entry) => toLowerCase(entry.email) === normalizedEmail);
      if (existing) {
        throw new Error('An account with this email already exists');
      }

      const userRecord = normalizeRecord('User', {
        id: createId(),
        email: payload.email,
        password: payload.password,
        roles: Array.isArray(payload.roles) && payload.roles.length > 0 ? payload.roles : [payload.role || 'user'],
        full_name: payload.full_name || payload.email,
        is_active: true
      });

      users.push(userRecord);
      persist();

      const token = `local-${userRecord.id}`;
      setAuthState({ user: { ...userRecord, password: undefined }, token });
      return { user: { ...userRecord, password: undefined }, token };
    },

    async verifyOtp(payload = {}) {
      const user = users.find((entry) => toLowerCase(entry.email) === toLowerCase(payload.email));
      if (!user) {
        throw new Error('Unable to verify account');
      }

      const token = `local-${user.id}`;
      setAuthState({ user: { ...user, password: undefined }, token });
      return { access_token: token, user: { ...user, password: undefined } };
    },

    async resendOtp(email) {
      return { email };
    },

    async resetPasswordRequest(email) {
      return { email };
    },

    async resetPassword(payload = {}) {
      const user = users.find((entry) => toLowerCase(entry.email) === toLowerCase(payload.email));
      if (!user) {
        throw new Error('Unable to reset password');
      }

      user.password = payload.newPassword;
      user.updated_date = new Date().toISOString();
      persist();
      return true;
    },

    async loginWithProvider(provider, redirectTo = '/') {
      const user = users[0];
      const token = `local-${user.id}`;
      setAuthState({ user: { ...user, password: undefined }, token });
      if (typeof window !== 'undefined') {
        window.location.assign(redirectTo);
      }
      return { user: { ...user, password: undefined }, token };
    },

    async me() {
      const user = getAuthenticatedUser();
      // Re-validated on every call (not just at login) so a session already
      // sitting on a page — a kiosk tablet mid-shift, or an office tab left
      // open — is caught the moment the app next checks auth, without
      // waiting for that browser to log out and back in. Read live rather
      // than the `employees` closure captured at db construction time; see
      // loginViaEmailPassword's comment for why that copy is unusable here.
      if (user.employee_id) {
        const liveEmployees = ensureCollection(getLocalStore(), 'employees');
        const liveEmployee = liveEmployees.find((e) => e.id === user.employee_id);
        if (!isEmployeeActive(liveEmployee)) {
          setAuthState(null);
          getStorage().setItem(DEACTIVATION_MESSAGE_KEY, DEACTIVATION_MESSAGE);
          throw Object.assign(new Error(DEACTIVATION_MESSAGE), { status: 401, reason: 'employee_deactivated' });
        }
      }
      return user;
    },

    logout(redirectTo = '/') {
      setAuthState(null);
      if (typeof window !== 'undefined' && redirectTo) {
        window.location.assign(redirectTo);
      }
    },

    redirectToLogin(redirectTo = '/') {
      if (typeof window === 'undefined') {
        return;
      }

      const currentPath = window.location.pathname;
      const authRoutes = ['/login', '/forgot-password', '/reset-password'];

      if (authRoutes.includes(currentPath)) {
        return;
      }

      const target = redirectTo && redirectTo.startsWith('/') ? redirectTo : '/';
      window.location.assign(`/login?redirect=${encodeURIComponent(target)}`);
    },

    setToken(token) {
      const authState = getAuthState();
      if (!authState) {
        return;
      }
      setAuthState({ ...authState, token });
    },

    async getToken() {
      return getAuthState()?.token || null;
    }
  };
};

export const createUsersApi = () => {
  const store = getLocalStore();
  const users = ensureCollection(store, 'User');

  const persist = () => {
    const latest = loadStore();
    latest.User = users;
    saveStore(latest);
  };

  return {
    async inviteUser(email, roles) {
      const existing = users.find((entry) => toLowerCase(entry.email) === toLowerCase(email));
      if (existing) {
        return existing;
      }

      const created = normalizeRecord('User', {
        id: createId(),
        email,
        roles: Array.isArray(roles) && roles.length > 0 ? roles : ['user'],
        password: 'changeme123',
        full_name: email,
        is_active: true
      });
      users.push(created);
      persist();
      return created;
    }
  };
};

export const createIntegrationsApi = () => ({
  Core: {
    async UploadFile({ file }) {
      const fileUrl = typeof window !== 'undefined' && file ? URL.createObjectURL(file) : '/placeholder-file';
      return { file_url: fileUrl, name: file?.name || 'uploaded-file' };
    },
    async InvokeLLM(payload) {
      const proxyUrl = import.meta.env?.VITE_AI_PROXY_URL;
      if (proxyUrl) {
        try {
          const res = await fetch(`${proxyUrl}/invoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
          const data = await res.json();
          return { content: data.content ?? data.text ?? '', summary: data.summary ?? '' };
        } catch (err) {
          console.warn('[InvokeLLM] Proxy call failed, falling back to mock:', err.message);
        }
      }
      // Fallback — mock echo, same as before. Active when VITE_AI_PROXY_URL
      // is not set (local dev, flash drive demo, no backend yet).
      return {
        content: typeof payload?.prompt === 'string' ? payload.prompt : 'Local analysis complete.',
        summary: 'Local placeholder analysis completed.'
      };
    }
  }
});
