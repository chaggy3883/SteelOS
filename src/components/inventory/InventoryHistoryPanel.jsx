import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { History, Undo2 } from 'lucide-react';
import {
  TRANSACTION_LABELS,
  findReversalOf,
  formatLocation,
  reverseInventoryTransaction,
} from '@/lib/inventoryLedger';

const signed = (n) => (Number(n) > 0 ? `+${n}` : `${n}`);
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

// Every row is clickable (standing rule 1) and opens the full ledger record,
// including where it came from and an "Undo this change" action that writes
// an opposite row — the original is never edited or deleted.
export default function InventoryHistoryPanel({ item, shopFloorZones = [], projects = [], refreshKey = 0, onChanged }) {
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [undoReason, setUndoReason] = useState('');
  const [undoing, setUndoing] = useState(false);
  const [sourceInfo, setSourceInfo] = useState({});
  const zoneLabel = (id) => shopFloorZones.find((z) => z.id === id)?.label || id;
  const projectName = (id) => projects.find((p) => p.id === id)?.name || id;

  const load = async () => {
    setLoading(true);
    try {
      const data = await db.entities.inventory_transactions.filter({ inventory_item_id: item.id }, '-transaction_at', 1000);
      setRows(data);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [item.id, refreshKey]);

  const openRow = async (row) => {
    const next = openId === row.id ? null : row.id;
    setOpenId(next);
    setUndoReason('');
    if (next && row.po_id && !sourceInfo[row.id]) {
      const [po, log] = await Promise.all([
        db.entities.purchase_orders.get(row.po_id).catch(() => null),
        row.source_type === 'receiving_log' && row.source_id ? db.entities.receiving_logs.get(row.source_id).catch(() => null) : Promise.resolve(null),
      ]);
      setSourceInfo((prev) => ({ ...prev, [row.id]: { po, log } }));
    }
  };

  const undo = async (row) => {
    setUndoing(true);
    try {
      const { item: updated } = await reverseInventoryTransaction(row, { reason: undoReason });
      toast({ title: 'Change undone — an opposite entry was added to History' });
      setOpenId(null);
      setUndoReason('');
      onChanged(updated);
      load();
    } catch (e) {
      toast({ title: e.message || 'Unable to undo', variant: 'destructive' });
    } finally {
      setUndoing(false);
    }
  };

  if (loading) return <div className="h-24 bg-muted rounded animate-pulse" />;

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        <History className="w-6 h-6 mx-auto mb-2" />
        No stock changes recorded yet. Anything changed from here on shows up in this list.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row) => {
        const reversal = findReversalOf(row, rows);
        const original = row.reverses_transaction_id ? rows.find((r) => r.id === row.reverses_transaction_id) : null;
        const isOpen = openId === row.id;
        const qtyText = Number(row.qty_delta)
          ? `${signed(row.qty_delta)} ${row.unit_of_measure || ''}`.trim()
          : Number(row.reserved_delta) ? `${signed(row.reserved_delta)} set aside` : '—';
        const info = sourceInfo[row.id];
        return (
          <div key={row.id} className={`rounded-lg border ${isOpen ? 'border-primary/50 bg-primary/5' : 'border-border'}`}>
            <button type="button" onClick={() => openRow(row)} className="w-full flex items-center justify-between gap-3 p-2.5 text-left text-sm hover:bg-muted/50 rounded-lg">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{TRANSACTION_LABELS[row.transaction_type] || row.transaction_type}</span>
                  {row.reverses_transaction_id && <Badge variant="outline" className="text-[10px]">Undo</Badge>}
                  {reversal && <Badge variant="outline" className="text-[10px] text-orange-600 border-orange-400/50">Undone</Badge>}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {when(row.transaction_at)}{row.actor_name ? ` · ${row.actor_name}` : ''}{row.reason ? ` · ${row.reason}` : ''}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`font-semibold ${Number(row.qty_delta) < 0 ? 'text-red-500' : Number(row.qty_delta) > 0 ? 'text-green-600' : ''}`}>{qtyText}</p>
                <p className="text-xs text-muted-foreground">On hand after: {row.qty_after}</p>
              </div>
            </button>

            {isOpen && (
              <div className="px-3 pb-3 text-sm space-y-2 border-t border-border/50 pt-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">When</span><span>{when(row.transaction_at)}</span>
                  <span className="text-muted-foreground">Who</span><span>{row.actor_name || '—'}</span>
                  <span className="text-muted-foreground">On hand change</span><span>{signed(row.qty_delta || 0)} → {row.qty_after}</span>
                  <span className="text-muted-foreground">Set aside change</span><span>{signed(row.reserved_delta || 0)} → {row.reserved_after ?? '—'}</span>
                  <span className="text-muted-foreground">From</span><span>{formatLocation({ zone: row.from_zone, rack: row.from_rack, bin: row.from_bin }, zoneLabel)}</span>
                  <span className="text-muted-foreground">To</span><span>{formatLocation({ zone: row.to_zone, rack: row.to_rack, bin: row.to_bin }, zoneLabel)}</span>
                  {row.heat_number && (<><span className="text-muted-foreground">Heat number</span><span className="font-mono">{row.heat_number}</span></>)}
                  {row.project_id && (<><span className="text-muted-foreground">Job</span><span>{projectName(row.project_id)}</span></>)}
                  {row.unit_cost ? (<><span className="text-muted-foreground">Unit cost</span><span>${Number(row.unit_cost).toFixed(2)}</span></>) : null}
                  <span className="text-muted-foreground">Why</span><span>{row.reason || '—'}</span>
                  {info?.po && (<><span className="text-muted-foreground">Purchase order</span><span>{info.po.po_number} · {info.po.vendor_name || ''}</span></>)}
                  {info?.log && (<><span className="text-muted-foreground">Receiving entry</span><span>{info.log.quantity_received_this_delivery} received by {info.log.receiver_name || '—'} ({info.log.delivery_status})</span></>)}
                </div>

                {original && (
                  <button type="button" onClick={() => openRow(original)} className="text-xs text-primary hover:underline">
                    This undoes the {TRANSACTION_LABELS[original.transaction_type]?.toLowerCase()} entry from {when(original.transaction_at)} — view it
                  </button>
                )}
                {reversal && (
                  <button type="button" onClick={() => openRow(reversal)} className="text-xs text-primary hover:underline block">
                    Undone on {when(reversal.transaction_at)}{reversal.actor_name ? ` by ${reversal.actor_name}` : ''} — view the undo entry
                  </button>
                )}

                {!reversal && !row.reverses_transaction_id && (
                  <div className="pt-1 space-y-1.5">
                    <Label className="text-xs">Undo this change — why?</Label>
                    <div className="flex gap-2">
                      <Input value={undoReason} onChange={(e) => setUndoReason(e.target.value)} placeholder="e.g. typed the wrong number" className="h-8" />
                      <Button size="sm" variant="outline" disabled={undoing || !undoReason.trim()} onClick={() => undo(row)}>
                        <Undo2 className="w-3.5 h-3.5 mr-1" />{undoing ? 'Undoing…' : 'Undo'}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Adds an opposite entry; this one stays in the history.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
