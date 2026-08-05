import { db } from '@/api/apiClient';

const DEFAULT_SHOP_BURDEN_RATE = 65;

// Reads the admin-configured shop burden rate (Settings > Cost Variables).
export async function getShopBurdenRate() {
  try {
    const list = await db.entities.SystemSetting.filter({ setting_group: 'cost_variables' }, '-created_date', 1);
    return Number(list[0]?.shop_burden_rate) || DEFAULT_SHOP_BURDEN_RATE;
  } catch (e) {
    return DEFAULT_SHOP_BURDEN_RATE;
  }
}

// Projects burdened labor cost from tracked shop time. Aggregate-only — never
// returns or requires per-employee identity, so payroll rows stay out of this view.
export function calculateBurdenedLaborCost(stationLogs, shopBurdenRate) {
  const trackedMinutes = (stationLogs || []).reduce((sum, log) => sum + (Number(log?.duration_minutes) || 0), 0);
  const laborCost = (trackedMinutes / 60) * (Number(shopBurdenRate) || DEFAULT_SHOP_BURDEN_RATE);
  return { trackedMinutes, trackedHours: trackedMinutes / 60, laborCost };
}

const DEFAULT_FAB_SHOP_RATE = 85;
const DEFAULT_FIELD_ERECTION_RATE = 95;

// Feeds attendanceMath.js's multi-scale payroll rate matrix — reads the same
// admin-configured Shop/Field rates shown in Settings > Cost Variables
// (CostVariables.jsx), converted to cents for the matrix's cents-based math.
export async function getPayrollRateScalesCents() {
  try {
    const list = await db.entities.SystemSetting.filter({ setting_group: 'cost_variables' }, '-created_date', 1);
    const row = list[0];
    return {
      fabShopRateCents: Math.round((Number(row?.fab_shop_rate) || DEFAULT_FAB_SHOP_RATE) * 100),
      fieldErectionRateCents: Math.round((Number(row?.field_erection_rate) || DEFAULT_FIELD_ERECTION_RATE) * 100),
    };
  } catch (e) {
    return {
      fabShopRateCents: DEFAULT_FAB_SHOP_RATE * 100,
      fieldErectionRateCents: DEFAULT_FIELD_ERECTION_RATE * 100,
    };
  }
}
