import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { PlusCircle, ClipboardCheck, MoveRight, Lock, Unlock, Trash2 } from 'lucide-react';
import {
  computeInventoryChange,
  formatLocation,
  locationOf,
  recordInventoryChange,
  REASON_REQUIRED_TYPES,
} from '@/lib/inventoryLedger';

// Guided "change the stock" step for one InventoryItem. Each action is phrased
// the way the shop says it and maps to one inventory_transactions type —
// recordInventoryChange is the only thing that writes.
const ACTIONS = [
  { key: 'adjust', label: 'Add or take away', hint: 'Found extra, short a few, fixing a typo', icon: PlusCircle },
  { key: 'count', label: 'We counted it', hint: 'Set the on-hand number to what is really there', icon: ClipboardCheck },
  { key: 'move', label: 'Move it', hint: 'It went to a different zone / rack / bin', icon: MoveRight },
  { key: 'reserve', label: 'Set aside for a job', hint: 'Hold some so nobody else uses it', icon: Lock },
  { key: 'release', label: 'Free it back up', hint: 'A job no longer needs what was held', icon: Unlock },
  { key: 'scrap', label: 'Scrap it', hint: 'Damaged, rusted, cut wrong', icon: Trash2 },
];

const blank = (item) => ({ qty: '', direction: 'remove', counted: '', reason: '', projectId: '', ...locationOf(item) });

export default function InventoryStockActions({ item, shopFloorZones = [], projects = [], onChanged }) {
  const { toast } = useToast();
  const [action, setAction] = useState(null);
  const [form, setForm] = useState(() => blank(item));
  const [saving, setSaving] = useState(false);
  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));
  const zoneLabel = (id) => shopFloorZones.find((z) => z.id === id)?.label || id;
  const uom = item.unit_of_measure || 'ea';

  const pick = (key) => { setAction(key); setForm(blank(item)); };

  const qty = Math.abs(Number(form.qty) || 0);
  const change = (() => {
    switch (action) {
      case 'adjust': return { type: 'adjust', qtyDelta: form.direction === 'add' ? qty : -qty };
      case 'count': return { type: 'count', qtyDelta: (Number(form.counted) || 0) - (Number(item.quantity_on_hand) || 0) };
      case 'move': return { type: 'move', toLocation: { zone: form.zone, rack: form.rack, bin: form.bin } };
      case 'reserve': return { type: 'reserve', reservedDelta: qty, projectId: form.projectId };
      case 'release': return { type: 'release', reservedDelta: -qty, projectId: form.projectId };
      case 'scrap': return { type: 'scrap', qtyDelta: -qty };
      default: return null;
    }
  })();

  let preview = null;
  let previewError = '';
  if (change && action !== 'move') {
    try { preview = computeInventoryChange(item, change); } catch (e) { previewError = e.message; }
  }
  const needsReason = action && REASON_REQUIRED_TYPES.includes(action);
  const countMissing = action === 'count' && form.counted === '';
  const qtyMissing = ['adjust', 'reserve', 'release', 'scrap'].includes(action) && qty <= 0;
  const canSave = change && !previewError && !saving && !countMissing && !qtyMissing && (!needsReason || form.reason.trim());

  const save = async () => {
    setSaving(true);
    try {
      const { item: updated } = await recordInventoryChange(item.id, { ...change, reason: form.reason });
      toast({ title: 'Stock updated — saved to History' });
      setAction(null);
      onChanged(updated);
    } catch (e) {
      toast({ title: e.message || 'Unable to save change', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!action) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map(({ key, label, hint, icon: Icon }) => (
          <button
            type="button"
            key={key}
            onClick={() => pick(key)}
            className="flex items-start gap-3 p-3 rounded-lg border border-border text-left hover:bg-muted/50 hover:ring-2 hover:ring-primary/30 transition"
          >
            <Icon className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
            <span>
              <span className="block font-medium text-sm">{label}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  const current = ACTIONS.find((a) => a.key === action);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{current.label}</p>
        <Button size="sm" variant="ghost" onClick={() => setAction(null)}>Back</Button>
      </div>

      {action === 'adjust' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button size="sm" variant={form.direction === 'add' ? 'default' : 'outline'} onClick={() => set('direction')('add')}>Add</Button>
            <Button size="sm" variant={form.direction === 'remove' ? 'default' : 'outline'} onClick={() => set('direction')('remove')}>Take away</Button>
          </div>
          <Label>How many {uom}?</Label>
          <Input type="number" min={0} value={form.qty} onChange={(e) => set('qty')(e.target.value)} className="w-40" />
        </div>
      )}

      {action === 'count' && (
        <div className="space-y-2">
          <Label>How many {uom} are actually there?</Label>
          <Input type="number" min={0} value={form.counted} onChange={(e) => set('counted')(e.target.value)} className="w-40" />
          <p className="text-xs text-muted-foreground">The system shows {item.quantity_on_hand ?? 0}.</p>
        </div>
      )}

      {['reserve', 'release', 'scrap'].includes(action) && (
        <div className="space-y-2">
          <Label>How many {uom}?</Label>
          <Input type="number" min={0} value={form.qty} onChange={(e) => set('qty')(e.target.value)} className="w-40" />
        </div>
      )}

      {(action === 'reserve' || action === 'release') && (
        <div>
          <Label>Which job? (optional)</Label>
          <Select value={form.projectId || 'none'} onValueChange={(v) => set('projectId')(v === 'none' ? '' : v)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="No specific job" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No specific job</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {action === 'move' && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Right now it is in: <span className="font-medium text-foreground">{formatLocation(locationOf(item), zoneLabel)}</span></p>
          <p className="text-sm font-medium">Where did it go?</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Zone</Label>
              <Select value={form.zone} onValueChange={set('zone')}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Pick a zone" /></SelectTrigger>
                <SelectContent>
                  {shopFloorZones.map((z) => <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Rack</Label>
              <Input value={form.rack} onChange={(e) => set('rack')(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Bin</Label>
              <Input value={form.bin} onChange={(e) => set('bin')(e.target.value)} className="mt-1" />
            </div>
          </div>
        </div>
      )}

      <div>
        <Label>Why? {needsReason ? <span className="text-destructive">(required)</span> : <span className="text-muted-foreground">(optional)</span>}</Label>
        <Input
          value={form.reason}
          onChange={(e) => set('reason')(e.target.value)}
          placeholder={action === 'scrap' ? 'e.g. bent in the yard' : action === 'count' ? 'e.g. monthly count' : 'Short note'}
          className="mt-1"
        />
      </div>

      {preview && (
        <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-0.5">
          <p>On hand: {preview.onHandBefore} → <span className="font-semibold">{preview.onHandAfter}</span> {uom}</p>
          <p>Set aside: {preview.reservedBefore} → <span className="font-semibold">{preview.reservedAfter}</span></p>
          <p>Free to use: <span className="font-semibold">{preview.availableAfter}</span></p>
        </div>
      )}
      {previewError && <p className="text-sm text-destructive">{previewError}</p>}

      <Button onClick={save} disabled={!canSave} className="w-full steel-gradient text-white border-0">
        {saving ? 'Saving…' : 'Save this change'}
      </Button>
    </div>
  );
}
