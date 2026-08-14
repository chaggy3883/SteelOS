import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getPieceTimeline, pieceEventLabel, formatDuration } from '@/lib/pieceTimeline';
import { stationName } from '@/lib/shopOpsMetrics';

// The one piece-history timeline for the whole app — embedded (not a modal
// of its own) wherever a piece is opened: ShopFabrication's Active Piece
// panel, the Shop Floor Command Center's Piece Detail dialog, and
// PieceDetailModal (which LoadBuilder also opens for its Info-icon
// drill-down). See src/lib/pieceTimeline.js for the matching read side.
export default function PieceTimeline({ pieceId, className = '' }) {
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!pieceId) { setEvents([]); return; }
    let cancelled = false;
    setLoading(true);
    getPieceTimeline(pieceId)
      .then((rows) => { if (!cancelled) setEvents(rows); })
      .catch(() => { if (!cancelled) setEvents([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pieceId]);

  if (!pieceId) return null;

  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Piece History</p>
      {loading ? (
        <div className="flex items-center justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No history recorded for this piece yet.</p>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="pl-3 border-l-2 border-border text-sm">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-medium">{pieceEventLabel(event.event_type)}</span>
                {event.station_id != null && <span className="text-xs text-muted-foreground">{stationName(event.station_id)}</span>}
              </div>
              <p className="text-xs text-muted-foreground">
                {event.scanned_by || 'Unknown'} • {event.scanned_at ? new Date(event.scanned_at).toLocaleString() : '—'}
              </p>
              {event.notes && <p className="text-xs mt-0.5 whitespace-pre-wrap">{event.notes}</p>}
              {!event.isOngoing && event.durationMs != null && (
                <p className="text-xs text-muted-foreground mt-0.5">Duration in this stage: {formatDuration(event.durationMs)}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
