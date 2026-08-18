import { getCertStatus } from '@/lib/certAlerts';

// Asset-only gate: this checks the CRANE's own inspection record
// (heavy_equipment_inspections), not who's operating it. OSHA 1926.1427's
// operator-certification requirement is enforced separately, at crew
// assignment time — see getEffectiveRequiredCertifications/
// findMissingCertifications in manpowerData.js, surfaced in
// ManpowerSection.jsx — since HookProductionTerminal.jsx (this guard's only
// caller) never captures which employee is running a given hook/pick, it
// has no operator identity to check against in the first place.
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
