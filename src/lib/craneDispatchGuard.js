import { getCertStatus } from '@/lib/certAlerts';

const DISPATCH_WINDOW_DAYS = 30;

// No inspection on file "fails open" (status Valid) — same convention as
// certAlerts.js's HR cert checks — this only flags/blocks assets that have
// an inspection record that has actually gone stale, not assets nobody has
// gotten around to inspecting yet.
export function getAssetInspectionStatuses(assetId, inspections) {
  return (inspections || [])
    .filter((i) => i.asset_id === assetId)
    .map((i) => ({ ...i, status: getCertStatus(i.expiration_date, DISPATCH_WINDOW_DAYS) }));
}

export function isAssetInspectionAtRisk(assetId, inspections) {
  return getAssetInspectionStatuses(assetId, inspections).some((i) => i.status !== 'Valid');
}

// The hard dispatcher gate: only a truly EXPIRED Crane_Annual blocks
// assignment — an inspection merely expiring soon is a warning, not a stop.
export function isCraneDispatchBlocked(assetId, inspections) {
  return getAssetInspectionStatuses(assetId, inspections)
    .some((i) => i.inspection_type === 'Crane_Annual' && i.status === 'Expired');
}
