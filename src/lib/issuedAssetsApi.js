import { db } from '@/api/apiClient';
import { getEffectiveCompany } from '@/lib/tenantContext';

export const ASSET_TYPES = [
  { value: 'Hard_Hat', label: 'Hard Hat' },
  { value: 'Safety_Glasses', label: 'Safety Glasses' },
  { value: 'Prescription_Safety_Glasses', label: 'Prescription Safety Glasses' },
  { value: 'Harness', label: 'Harness' },
  { value: 'Gloves', label: 'Gloves' },
  { value: 'Steel_Toe_Boots', label: 'Steel Toe Boots' },
  { value: 'Radio', label: 'Radio' },
  { value: 'Badge', label: 'Badge' },
  { value: 'Keys', label: 'Keys' },
  { value: 'Laptop', label: 'Laptop' },
  { value: 'Phone', label: 'Phone' },
  { value: 'Other', label: 'Other' },
];

export const assetTypeLabel = (value) => ASSET_TYPES.find((a) => a.value === value)?.label || value;

// Condition at ISSUE time can be any of the full schema enum. Condition on
// RETURN is deliberately the narrower 3-way call HR actually makes at
// handoff (schema/entities/issued_assets.jsonc) — the two lists are kept
// separate so the return modal never offers "New"/"Worn" as an outcome.
export const ISSUE_CONDITIONS = ['New', 'Good', 'Worn', 'Damaged'];
export const RETURN_CONDITIONS = ['Good', 'Damaged', 'Lost'];

export const DEFAULT_KIT_FALLBACK = ['Badge', 'Keys', 'Laptop', 'Phone'];

// Company.default_issued_asset_kit (schema/entities/Company.jsonc) is the
// per-tenant policy HR configures from Admin > Company Settings; an empty/
// missing list falls back to the standard four-item kit rather than "issue
// nothing," since a brand-new tenant hasn't visited that settings screen yet.
export function getDefaultIssuedAssetKit(company) {
  return company?.default_issued_asset_kit?.length ? company.default_issued_asset_kit : DEFAULT_KIT_FALLBACK;
}

const todayDateOnly = () => new Date().toISOString().slice(0, 10);

// The one auto-issuance trigger — called from employeesApi.js's hireCandidate
// and provisionEmployee right after the employees row is created, mirroring
// how those two functions are already the sole chokepoints for every other
// on-hire default so a UI path can never accidentally skip it.
export async function provisionDefaultIssuedAssets(employeeId) {
  const company = await getEffectiveCompany();
  const kit = getDefaultIssuedAssetKit(company);
  const issued_date = todayDateOnly();
  await Promise.all(kit.map((asset_type) =>
    db.entities.issued_assets.create({ employee_id: employeeId, asset_type, issued_date, condition: 'New' })
  ));
}
