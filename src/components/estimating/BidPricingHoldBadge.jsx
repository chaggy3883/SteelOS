import React from 'react';
import { getBidPricingHoldState } from '@/lib/bidPricingHold';

const LEVEL_STYLES = {
  normal: 'bg-green-500/10 text-green-600 border-green-500/20',
  warning: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  expired: 'bg-red-500/10 text-red-600 border-red-500/20',
};

const LEVEL_TEXT = {
  normal: (d) => `${d}d old`,
  warning: (d) => `${d}d — expiring soon`,
  expired: (d) => `${d}d — EXPIRED`,
};

// Renders nothing when the pricing hold doesn't apply (no due date yet, or
// the bid is already won/lost/cancelled/Did_Not_Bid) — callers can render
// this unconditionally next to a StatusBadge.
export default function BidPricingHoldBadge({ bid, holdDays, onClick, className = '' }) {
  const state = getBidPricingHoldState(bid, holdDays);
  if (!state) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title="Click for pricing hold details"
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border cursor-pointer ${LEVEL_STYLES[state.level]} ${className}`}
    >
      {LEVEL_TEXT[state.level](state.daysOld)}
    </button>
  );
}
