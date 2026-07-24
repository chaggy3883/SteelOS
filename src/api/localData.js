const STORAGE_KEY = 'steelos_local_db_v1';
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

  return {
    User: [
      {
        id: 'user-admin',
        email: 'admin@steelos.dev',
        password: 'password123',
        role: 'admin',
        full_name: 'Demo Admin',
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'user-estimator',
        email: 'estimator@steelos.dev',
        password: 'password123',
        role: 'estimator',
        full_name: 'Demo Estimator',
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'user-pm',
        email: 'projectmanager@steelos.dev',
        password: 'password123',
        role: 'project_manager',
        full_name: 'Demo Project Manager',
        is_active: true,
        created_date: now,
        updated_date: now
      },
      {
        id: 'user-purchasing',
        email: 'purchasing@steelos.dev',
        password: 'password123',
        role: 'purchasing_agent',
        full_name: 'Demo Purchasing Agent',
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
    pieces: [
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
    station_logs: [
      {
        id: 'station-log-1',
        piece_id: 'piece-1',
        piece_mark: 'PM-100',
        employee_id: 'EMP-101',
        station: 'Paint',
        status: 'Complete',
        start_time: '2026-07-21T08:00:00.000Z',
        end_time: '2026-07-21T09:15:00.000Z',
        duration_minutes: 75,
        created_date: now,
        updated_date: now
      }
    ],
    qa_inspections: [
      {
        id: 'qa-1',
        piece_id: 'piece-1',
        piece_mark: 'PM-100',
        inspector_id: 'EMP-900',
        inspection_stage: 'Layout',
        decision: 'Approve Layout',
        notes: 'Layout verified against PDF',
        created_date: now,
        updated_date: now
      }
    ],
    purchase_orders: [
      {
        id: 'po-1001',
        po_number: 'PO-1001',
        vendor_id: 'customer-peak',
        vendor_name: 'Peak Steel',
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
        const exists = mergedUsers.some((existing) => existing.email === seedUser.email || existing.id === seedUser.id);
        if (!exists) {
          mergedUsers.push(seedUser);
        }
      });
      migrated[entityName] = mergedUsers;
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

const saveStore = (store) => {
  const storage = getStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(store));
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

export const createEntityApi = (entityName) => {
  const store = getLocalStore();
  const collection = ensureCollection(store, entityName);

  const persist = () => saveStore(store);

  return {
    async list(sortField = '-created_date', limit = 100) {
      const items = sortRecords(collection, sortField);
      return items.slice(0, limit);
    },

    async get(id) {
      return collection.find((item) => item.id === id) || null;
    },

    async filter(filters = {}, sortField = '-created_date', limit = 100) {
      const items = sortRecords(
        collection.filter((item) => matchesFilters(item, filters)),
        sortField
      );
      return items.slice(0, limit);
    },

    async create(data = {}) {
      const record = normalizeRecord(entityName, { ...data });
      collection.push(record);
      persist();
      return record;
    },

    async update(id, data = {}) {
      const index = collection.findIndex((item) => item.id === id);
      if (index < 0) {
        throw new Error(`${entityName} not found`);
      }

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

      collection.splice(index, 1);
      persist();
      return true;
    },

    async updateMany(filters = {}, update = {}) {
      let changed = 0;
      collection.forEach((item) => {
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
        const record = normalizeRecord(entityName, item);
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

  const persist = () => saveStore(store);

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
        role: payload.role || 'user',
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
      const authRoutes = ['/login', '/register', '/forgot-password', '/reset-password'];

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

  const persist = () => saveStore(store);

  return {
    async inviteUser(email, role) {
      const existing = users.find((entry) => toLowerCase(entry.email) === toLowerCase(email));
      if (existing) {
        return existing;
      }

      const created = normalizeRecord('User', {
        id: createId(),
        email,
        role,
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
