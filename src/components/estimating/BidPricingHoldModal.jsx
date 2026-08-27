import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getBidPricingHoldState } from '@/lib/bidPricingHold';

const LEVEL_COPY = {
  normal: { label: 'Normal', class: 'text-green-600' },
  warning: { label: 'Approaching Expiration', class: 'text-yellow-600' },
  expired: { label: 'Expired', class: 'text-red-600' },
};

export default function BidPricingHoldModal({ bid, holdDays, open, onOpenChange }) {
  const state = bid ? getBidPricingHoldState(bid, holdDays) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Follow-Up Due — {bid?.bid_number}</DialogTitle>
        </DialogHeader>
        {state ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              This bid was submitted {state.holdDays} days ago (the 21-Day Response Window). If no Won / Lost /
              Did Not Bid decision is logged before it expires, it's flagged here as needing follow-up and at risk
              of being marked lost. This is a visibility flag only; it never changes the bid's status automatically.
            </p>
            <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Submitted Date</span>
              <span className="col-span-2 font-medium">{state.submittedDate}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Days Since Submitted</span>
              <span className="col-span-2 font-medium">{state.daysOld} day(s)</span>
            </div>
            <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Follow-Up Due By</span>
              <span className="col-span-2 font-medium">{state.expirationDate}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <span className="text-muted-foreground">Status</span>
              <span className={`col-span-2 font-medium ${LEVEL_COPY[state.level].class}`}>{LEVEL_COPY[state.level].label}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This bid hasn't been marked Bid Submitted yet, or is no longer awaiting a decision, so the follow-up window doesn't apply.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
