import React, { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { db } from '@/api/apiClient';
import { getBidHoldDays, getBidPricingHoldState } from '@/lib/bidPricingHold';

const money = (n) => `$${Math.round(n || 0).toLocaleString()}`;

// Pricing-bearing section — bids, including their dollar value, are only
// ever fetched when 'estimating_updates' is part of this specific meeting
// (see MeetingModeSession.jsx). "Remove from list" only ever writes the 3
// meeting_follow_up_dismissed* fields — status is never touched here.
export default function EstimatingUpdatesSection({ company, currentUser }) {
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRemoved, setShowRemoved] = useState(false);

  const holdDays = getBidHoldDays(company);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await db.entities.Bid.list('-bid_submitted_date', 500);
      setBids(rows);
    } catch (e) {
      setBids([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const overdue = bids
    .map((bid) => ({ bid, hold: getBidPricingHoldState(bid, holdDays) }))
    .filter(({ hold }) => hold?.level === 'expired');

  const visible = overdue.filter(({ bid }) => showRemoved || !bid.meeting_follow_up_dismissed);

  const openBid = (bidId) => window.open(`/estimating/${bidId}`, '_blank', 'noopener,noreferrer');

  const dismiss = async (bid, e) => {
    e.stopPropagation();
    try {
      await db.entities.Bid.update(bid.id, {
        meeting_follow_up_dismissed: true,
        meeting_follow_up_dismissed_by: currentUser?.id || '',
        meeting_follow_up_dismissed_at: new Date().toISOString(),
      });
      load();
    } catch (err) {}
  };

  const restore = async (bid, e) => {
    e.stopPropagation();
    try {
      await db.entities.Bid.update(bid.id, {
        meeting_follow_up_dismissed: false,
        meeting_follow_up_dismissed_by: null,
        meeting_follow_up_dismissed_at: null,
      });
      load();
    } catch (err) {}
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center"><p className="text-2xl text-slate-400">Loading estimating updates…</p></div>;
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-2xl font-semibold">Estimating Updates</h2>
        <button type="button" onClick={() => setShowRemoved((s) => !s)} className="text-sm text-slate-400 hover:text-white flex items-center gap-1.5">
          {showRemoved ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {showRemoved ? 'Hide removed' : 'Show removed'}
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-1">
        Bids submitted {holdDays}+ days ago still awaiting a Won / Lost / Did Not Bid decision.
      </p>
      <p className="text-xs text-slate-600 mb-6">
        "Remove from list" only clears a bid from this recurring follow-up list — it never changes the bid's actual status.
      </p>

      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">No bids are currently overdue for a decision.</p>
      ) : (
        <div className="space-y-2">
          {visible.map(({ bid, hold }) => (
            <div
              key={bid.id}
              onClick={() => openBid(bid.id)}
              role="button"
              tabIndex={0}
              className={`w-full flex items-center justify-between gap-4 rounded-lg border px-5 py-4 cursor-pointer transition-colors ${
                bid.meeting_follow_up_dismissed ? 'border-slate-800 opacity-50' : 'border-slate-800 hover:border-slate-600 hover:bg-slate-900/50'
              }`}
            >
              <div className="min-w-0">
                <p className="text-lg font-medium truncate">{bid.job_name}</p>
                <p className="text-sm text-slate-500 truncate">{bid.customer_name}</p>
              </div>
              <div className="flex items-center gap-6 flex-shrink-0 text-sm">
                <div className="text-right">
                  <p className="text-slate-500 text-xs uppercase tracking-wide">Bid Value</p>
                  <p className="font-medium">{money(bid.bid_quoted_price)}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500 text-xs uppercase tracking-wide">Days Since Submitted</p>
                  <p className="font-semibold text-amber-400">{hold.daysOld}</p>
                </div>
                {bid.meeting_follow_up_dismissed ? (
                  <button type="button" onClick={(e) => restore(bid, e)} className="h-9 px-3 rounded border border-slate-700 hover:bg-slate-800 text-sm">
                    Restore to list
                  </button>
                ) : (
                  <button type="button" onClick={(e) => dismiss(bid, e)} className="h-9 px-3 rounded bg-blue-600 hover:bg-blue-500 text-sm font-medium">
                    Remove from list
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
