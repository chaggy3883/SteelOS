import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/ui/StatusBadge';
import { Loader2 } from 'lucide-react';
import { getStatusHistory } from '@/lib/statusHistory';

const humanize = (value) => (value ? String(value).replace(/_/g, ' ') : value);

// The one status-history drill-down for the whole app — every clickable
// status badge opens this with different (entityType, entityId, fieldName)
// props instead of a bespoke per-page history dialog. See
// src/lib/statusHistory.js for the matching write side.
export default function StatusHistoryModal({ open, onOpenChange, entityType, entityId, fieldName, title, footer }) {
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    if (!open || !entityType || !entityId || !fieldName) return;
    let cancelled = false;
    setLoading(true);
    getStatusHistory(entityType, entityId, fieldName)
      .then((rows) => { if (!cancelled) setEntries(rows); })
      .catch(() => { if (!cancelled) setEntries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, entityType, entityId, fieldName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title || 'Status History'}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No history recorded before this point.</p>
        ) : (
          <div className="space-y-3">
            {[...entries].reverse().map((entry) => (
              <div key={entry.id} className="p-3 rounded-lg border border-border">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {entry.from_value && <StatusBadge status={entry.from_value} label={humanize(entry.from_value)} />}
                  {entry.from_value && <span className="text-xs text-muted-foreground">→</span>}
                  <StatusBadge status={entry.to_value} label={humanize(entry.to_value)} />
                </div>
                <p className="text-xs text-muted-foreground">{entry.changed_by} • {new Date(entry.changed_at).toLocaleString()}</p>
                {entry.note && <p className="text-sm mt-1 whitespace-pre-wrap">{entry.note}</p>}
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          {footer}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
