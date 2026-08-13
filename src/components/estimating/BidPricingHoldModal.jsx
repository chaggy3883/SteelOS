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
          <DialogTitle>Pricing Hold — {bid?.bid_number}</DialogTitle>
        </DialogHeader>
        {state ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Quoted pricing on this bid is held for {state.holdDays} days from the bid due date. After that,
              material and labor costs may have moved — the estimator should confirm pricing is still valid
              before proceeding, or requote. This is a visibility flag only; it never changes the bid's status.
            </p>
            <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Quote Date</span>
              <span className="col-span-2 font-medium">{state.quoteDate}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Days Old</span>
              <span className="col-span-2 font-medium">{state.daysOld} day(s)</span>
            </div>
            <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Expiration Date</span>
              <span className="col-span-2 font-medium">{state.expirationDate}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <span className="text-muted-foreground">Status</span>
              <span className={`col-span-2 font-medium ${LEVEL_COPY[state.level].class}`}>{LEVEL_COPY[state.level].label}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This bid has no due date on file, or is no longer awaiting a decision, so the pricing hold doesn't apply.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
