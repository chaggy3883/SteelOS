import React from 'react';
import { Button } from '@/components/ui/button';
import { Check, X } from 'lucide-react';
import CountMarkerSwatch from './CountMarkerSwatch';

// The running-tally counter for an active Count/Bolt Count click-to-mark
// session — visible on screen the entire time that session is live, per the
// spec. Save commits session.points.length as the takeoff row's quantity
// (creating a new line item, or updating the one being resumed via "Add
// Pieces"); Cancel discards this session's marks without touching any
// already-saved row.
export default function CountTallyPanel({ session, label, onSave, onCancel }) {
  if (!session) return null;
  const tally = session.points?.length || 0;

  return (
    <div className="fixed top-4 right-4 z-[65] rounded-lg border bg-card shadow-2xl px-4 py-3 flex items-center gap-3">
      <CountMarkerSwatch color={session.color} symbol={session.symbol} size={22} />
      <div className="leading-tight">
        <p className="text-xs text-muted-foreground max-w-[180px] truncate" title={label}>{label}</p>
        <p className="text-2xl font-bold tabular-nums">{tally}</p>
      </div>
      <div className="flex flex-col gap-1.5 ml-2">
        <Button size="sm" onClick={onSave} disabled={tally === 0}>
          <Check className="w-3.5 h-3.5 mr-1" />Save
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          <X className="w-3.5 h-3.5 mr-1" />Cancel
        </Button>
      </div>
    </div>
  );
}
