import { db } from '@/api/apiClient';

// Company standard legal baselines used to flag risky contract clauses.
// These are illustrative internal thresholds, not legal advice — adjust to
// match actual company policy / legal counsel guidance before relying on them.
export const MAX_LIQUIDATED_DAMAGES_PER_DAY = 2500;
export const MIN_NOTICE_CURE_DAYS = 2;
export const MIN_RFI_RESPONSE_WINDOW_DAYS = 10;

// SystemSetting.retainage_default_pct is stored as a whole-number percent (e.g. 10 = 10%),
// while Contract.retainage_pct is a decimal fraction (e.g. 0.10) — convert here.
export async function getRetainageBaseline() {
  try {
    const list = await db.entities.SystemSetting.filter({ setting_group: 'cost_variables' }, '-created_date', 1);
    const pct = list[0]?.retainage_default_pct;
    return typeof pct === 'number' ? pct / 100 : 0.10;
  } catch (e) {
    return 0.10;
  }
}

export async function computeRiskFlags(contract) {
  const flags = [];
  if (Number(contract.liquidated_damages_per_day) > MAX_LIQUIDATED_DAMAGES_PER_DAY) {
    flags.push('liquidated_damages_above_baseline');
  }
  if (Number(contract.notice_cure_days) > 0 && Number(contract.notice_cure_days) < MIN_NOTICE_CURE_DAYS) {
    flags.push('notice_cure_window_below_baseline');
  }
  if (Number(contract.rfi_response_window_days) > 0 && Number(contract.rfi_response_window_days) < MIN_RFI_RESPONSE_WINDOW_DAYS) {
    flags.push('rfi_response_window_below_baseline');
  }
  const retainageBaseline = await getRetainageBaseline();
  if (Number(contract.retainage_pct) > retainageBaseline) {
    flags.push('retainage_above_baseline');
  }
  return flags;
}

export const RISK_FLAG_LABELS = {
  liquidated_damages_above_baseline: `Liquidated damages exceed the $${MAX_LIQUIDATED_DAMAGES_PER_DAY.toLocaleString()}/day baseline`,
  notice_cure_window_below_baseline: `Notice/cure window is under the ${MIN_NOTICE_CURE_DAYS}-day baseline`,
  rfi_response_window_below_baseline: `RFI response window is under the ${MIN_RFI_RESPONSE_WINDOW_DAYS}-day baseline`,
  retainage_above_baseline: 'Retainage rate exceeds the company default',
};
