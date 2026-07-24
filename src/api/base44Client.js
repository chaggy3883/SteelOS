import { createEntityApi, createAuthApi, createUsersApi, createIntegrationsApi } from '@/api/localData';

const createLocalApi = () => ({
  entities: {
    AuditLog: createEntityApi('AuditLog'),
    ApiCredential: createEntityApi('ApiCredential'),
    AIFinding: createEntityApi('AIFinding'),
    Bid: createEntityApi('Bid'),
    Company: createEntityApi('Company'),
    Customer: createEntityApi('Customer'),
    Contact: createEntityApi('Contact'),
    CustomRole: createEntityApi('CustomRole'),
    Document: createEntityApi('Document'),
    HistoricalVariance: createEntityApi('HistoricalVariance'),
    InventoryItem: createEntityApi('InventoryItem'),
    MillPricing: createEntityApi('MillPricing'),
    Notification: createEntityApi('Notification'),
    PieceMark: createEntityApi('PieceMark'),
    pieces: createEntityApi('pieces'),
    station_logs: createEntityApi('station_logs'),
    qa_inspections: createEntityApi('qa_inspections'),
    Project: createEntityApi('Project'),
    projects: createEntityApi('projects'),
    change_orders: createEntityApi('change_orders'),
    shop_sequences: createEntityApi('shop_sequences'),
    shipping_loads: createEntityApi('shipping_loads'),
    purchase_orders: createEntityApi('purchase_orders'),
    purchase_requisitions: createEntityApi('purchase_requisitions'),
    receiving_logs: createEntityApi('receiving_logs'),
    payable_invoices: createEntityApi('payable_invoices'),
    RFI: createEntityApi('RFI'),
    SystemSetting: createEntityApi('SystemSetting'),
    TakeoffLine: createEntityApi('TakeoffLine'),
    TaxRate: createEntityApi('TaxRate'),
    User: createEntityApi('User'),
    UserDashboardConfig: createEntityApi('UserDashboardConfig'),
    VendorPricingLink: createEntityApi('VendorPricingLink')
  },
  auth: createAuthApi(),
  users: createUsersApi(),
  integrations: createIntegrationsApi()
});

export const base44 = createLocalApi();
