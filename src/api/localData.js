import { stubSignatureHash, verifyPin } from '@/lib/hrSecurity';
import { encodeFormulaPin } from '@/lib/pinFormula';
import { SHAPE_CLASSES } from '@/data/steelShapeSelector';

export const STORAGE_KEY = 'steelos_local_db_v1';
const AUTH_STORAGE_KEY = 'steelos_auth_state';
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
        subscription_plan: 'professional',
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
        subscription_plan: 'starter',
        subscription_status: 'Active',
        brand_color_hex: '#dc2626',
        is_active: true,
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
    shipping_loads: [
      {
        id: 'load-1',
        project_id: 'project-harbor',
        load_number: 'Load 1',
        trailer_type: 'Flatbed',
        carrier_name: 'Arrow Logistics',
        tons_shipped: 46,
        ship_date: '2026-07-24',
        attachment_path: '/uploads/delivery-receipt-1.pdf',
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
        status: 'Internal_Owned',
        runtime_hours: 4820,
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
        status: 'Third_Party_Rented',
        runtime_hours: 312,
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
        status: 'Internal_Owned',
        runtime_hours: 18320,
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
        status: 'Internal_Owned',
        runtime_hours: 6104,
        project_location_id: 'project-harbor',
        rental_vendor_id: '',
        rental_target_off_rent_date: '',
        is_marked_ready_for_pickup: false,
        created_date: now,
        updated_date: now
      }
    ],
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
        serial_tag: 'SB-1001',
        rigging_category: 'Spreader_Bar',
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
        serial_tag: 'CS-2004',
        rigging_category: 'Cable_Sling',
        length_inches: 72,
        diameter_inches: 0.75,
        created_at: now,
        created_date: now,
        updated_date: now
      },
      {
        id: 'rigging-3',
        company_id: 'company-hancock',
        serial_tag: 'NS-3007',
        rigging_category: 'Nylon_Sling',
        length_inches: 96,
        ply_count: '2-Ply',
        width_inches: 4,
        created_at: now,
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
        material_shape: 'W12x26',
        dimensions: '32ft x 12in',
        weight: 1840,
        blueprint_file_uri: '/drawings/PM-100.pdf',
        qr_payload_string: 'QR-PM-100',
        current_station_id: 6,
        workflow_status: 'Paint_Unlocked',
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
        pin_encrypted: encodeFormulaPin({ employee_number: '001', ssn_last4: '0000' }),
        is_timeclock_locked: false,
        has_w4_approved: true,
        has_i9_approved: true,
        ssn_last4: '0000',
        pay_rate_cents: 2800,
        is_active_login: true,
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
        pin_encrypted: encodeFormulaPin({ employee_number: '002', ssn_last4: '0000' }),
        is_timeclock_locked: true,
        has_w4_approved: true,
        has_i9_approved: false,
        ssn_last4: '0000',
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
        status: 'Open',
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

  if (!Array.isArray(migrated.change_orders)) {
    migrated.change_orders = [...seeded.change_orders];
  }

  if (!Array.isArray(migrated.shop_sequences)) {
    migrated.shop_sequences = [...seeded.shop_sequences];
  }

  if (!Array.isArray(migrated.shipping_loads)) {
    migrated.shipping_loads = [...seeded.shipping_loads];
  }

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
const syncStoreToFile = (store) => {
  if (typeof fetch !== 'function') return;
  try {
    fetch('/__db-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store),
    }).catch(() => {});
  } catch (e) {
    // no-op
  }
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
const TENANT_SCOPED_ENTITIES = ['Bid', 'Project', 'projects', 'employees', 'pieces', 'loads', 'VendorBill', 'ai_contract_reviews', 'JobCostLedgerEntry', 'executive_metrics_snapshots', 'form_layouts', 'report_templates', 'ApiIntegrationLog', 'ApiTokenVault', 'print_label_jobs', 'erection_fleet_assets', 'heavy_equipment_inspections', 'field_hook_logs', 'attendance_punches', 'credit_card_expenses', 'fleet_repair_logs', 'rigging_inventory_ledger', 'employee_documents', 'blueprint_takeoffs', 'piece_production_logs', 'company_templates', 'steel_catalog', 'BankAccount', 'BankTransaction', 'RecurringCashItem'];

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

      const token = `local-${user.id}`;
      setAuthState({ user: { ...user, password: undefined }, token });
      return { user: { ...user, password: undefined }, token };
    },

    // Shop/Field Labor login — completely uncoupled from the email/password
    // path above. Employees aren't User accounts in this app, so a
    // successful Employee Number + formula PIN match (the same check
    // EmployeeCenter.jsx's kiosk login already does) synthesizes a session
    // the same way loginViaEmailPassword does, just sourced from an
    // `employees` row instead of a `User` row.
    async loginViaEmployeePin(companyCode, employeeNumber, pin) {
      const normalizedCode = toLowerCase(companyCode);
      const company = companies.find((c) => toLowerCase(c.company_code) === normalizedCode);
      if (!company) {
        throw new Error('Company code not found');
      }
      const employee = employees.find((e) => e.company_id === company.id && e.employee_number === String(employeeNumber).trim());
      if (!employee || !verifyPin(pin, employee.pin_encrypted)) {
        throw new Error('Invalid employee number or PIN');
      }
      if (employee.is_active_login === false) {
        throw new Error('Account suspended. Please contact system administration.');
      }

      const syntheticUser = {
        id: `employee-session-${employee.id}`,
        email: '',
        full_name: employee.full_name,
        roles: ['user'],
        company_id: company.id,
        employee_id: employee.id,
        is_active: true,
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
      return getAuthenticatedUser();
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
      return {
        content: typeof payload?.prompt === 'string' ? payload.prompt : 'Local analysis complete.',
        summary: 'Local placeholder analysis completed.'
      };
    }
  }
});
