import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { MapPin, Package, CheckCircle2, SkipForward } from 'lucide-react';
import {
  computeInventoryChange,
  createInventoryItemWithStock,
  formatLocation,
  locationOf,
  recordInventoryChange,
  suggestInventoryMatches,
} from '@/lib/inventoryLedger';

const CATEGORIES = ['wide_flange', 'hss', 'angle', 'channel', 'plate', 'rebar', 'bolt', 'weld_material', 'paint', 'other'];
const SKIP_REASONS = ['Going straight to a job', 'Sent back / rejected', 'Other'];

// Best guess only — every field stays editable before anything is written.
const guessCategory = (desc = '') => {
  const d = desc.trim().toUpperCase();
  if (/^W\d/.test(d)) return 'wide_flange';
  if (/^HSS/.test(d)) return 'hss';
  if (/^L\d/.test(d)) return 'angle';
  if (/^(C|MC)\d/.test(d)) return 'channel';
  if (/^PL/.test(d)) return 'plate';
  if (/REBAR|^#\d/.test(d)) return 'rebar';
  if (/BOLT/.test(d)) return 'bolt';
  return 'other';
};
const guessSize = (desc = '') => (desc.trim().split(/\s+/)[0] || '');

// Guided "Put it away" step shown after a PO line is received in
// ReceivingKiosk.jsx — one receiving_logs row at a time:
//   1. Where did it go?   2. Which stock item is it?   3. Check and save
// or "Not going into stock" with a required reason. Writes only on the final
// click: a 'receive' inventory_transactions row for exactly this delivery's
// quantity (receiving_logs.quantity_received_this_delivery — a partial
// receipt adds only what arrived), and stamps the receiving log so it can't
// be put away twice.
export default function PutAwayStep({ log, line, po, shopFloorZones = [], position, total, onFinished }) {
  const { toast } = useToast();
  const [step, setStep] = useState('where');
  const [spot, setSpot] = useState({ zone: '', rack: '', bin: '' });
  const [items, setItems] = useState([]);
  const [mtrGrade, setMtrGrade] = useState('');
  const [choice, setChoice] = useState(null); // item id | 'new'
  const [newItem, setNewItem] = useState(null);
  const [makeMainSpot, setMakeMainSpot] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [skipNote, setSkipNote] = useState('');
  const [saving, setSaving] = useState(false);

  const qty = Number(log.quantity_received_this_delivery) || 0;
  const uom = line?.unit_of_measure || 'ea';
  const heat = (log.material_heat_number || '').trim();
  const zoneLabel = (id) => shopFloorZones.find((z) => z.id === id)?.label || id;

  useEffect(() => {
    setStep('where');
    setSpot({ zone: '', rack: '', bin: '' });
    setChoice(null);
    setSkipReason('');
    setSkipNote('');
    setNewItem({
      description: line?.description || '',
      category: guessCategory(line?.description),
      size: guessSize(line?.description),
      material_grade: '',
      unit_of_measure: uom,
    });
    Promise.all([
      db.entities.InventoryItem.filter({ is_active: true }, 'description', 1000).catch(() => []),
      line?.id ? db.entities.MillTestReport.filter({ po_line_id: line.id }, '-created_date', 5).catch(() => []) : Promise.resolve([]),
    ]).then(([itemList, mtrs]) => {
      setItems(itemList);
      const grade = mtrs.find((m) => m.material_grade)?.material_grade || '';
      setMtrGrade(grade);
      setNewItem((n) => ({ ...n, material_grade: grade }));
    });
  }, [log.id]);

  const suggestions = useMemo(() => suggestInventoryMatches(line, items, { grade: mtrGrade }), [line, items, mtrGrade]);
  const chosenItem = choice && choice !== 'new' ? items.find((i) => i.id === choice) : null;
  const itemHasSpot = chosenItem && (chosenItem.warehouse_zone || chosenItem.warehouse_rack || chosenItem.warehouse_bin);
  const spotDiffers = itemHasSpot && formatLocation(locationOf(chosenItem)) !== formatLocation(spot);

  useEffect(() => { setMakeMainSpot(false); }, [choice]);

  let preview = null;
  if (chosenItem) {
    try { preview = computeInventoryChange(chosenItem, { type: 'receive', qtyDelta: qty }); } catch { preview = null; }
  }
  const chosenUomMismatch = chosenItem && chosenItem.unit_of_measure && line?.unit_of_measure &&
    chosenItem.unit_of_measure.toLowerCase() !== line.unit_of_measure.toLowerCase();

  // Re-read the log right before writing so a second tab / double click
  // can't stock the same delivery twice.
  const assertStillPending = async () => {
    const fresh = await db.entities.receiving_logs.get(log.id);
    if (!fresh || fresh.put_away_status !== 'pending') throw new Error('This delivery was already put away or skipped.');
  };

  const putAway = async () => {
    setSaving(true);
    try {
      await assertStillPending();
      let itemId = choice;
      if (choice === 'new') {
        if (!newItem.description.trim()) throw new Error('Give the new stock item a description.');
        const { item } = await createInventoryItemWithStock({
          description: newItem.description.trim(),
          category: newItem.category,
          size: newItem.size.trim(),
          material_grade: newItem.material_grade.trim(),
          unit_of_measure: newItem.unit_of_measure.trim() || 'ea',
          unit_cost: Number(line?.unit_cost) || 0,
          vendor_id: po?.vendor_id || '',
        });
        itemId = item.id;
      }
      const { transaction } = await recordInventoryChange(itemId, {
        type: 'receive',
        qtyDelta: qty,
        toLocation: spot,
        moveItem: choice === 'new' || !itemHasSpot || makeMainSpot,
        heatNumber: heat,
        unitCost: line?.unit_cost,
        projectId: po?.project_id || '',
        sourceType: 'receiving_log',
        sourceId: log.id,
        poId: log.po_id,
        poLineId: log.line_id,
        reason: `PO ${log.po_number}${line?.line_number ? ` line ${line.line_number}` : ''}`,
      });
      await db.entities.receiving_logs.update(log.id, {
        put_away_status: 'stocked',
        inventory_item_id: itemId,
        inventory_transaction_id: transaction.id,
        put_away_at: new Date().toISOString(),
      });
      toast({ title: `Put away: ${qty} ${uom} added to stock`, className: 'bg-green-600 text-white border-0' });
      onFinished();
    } catch (e) {
      toast({ title: e.message || 'Unable to put it away', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    setSaving(true);
    try {
      await assertStillPending();
      const reason = skipReason === 'Other' ? skipNote.trim() : `${skipReason}${skipNote.trim() ? ` — ${skipNote.trim()}` : ''}`;
      await db.entities.receiving_logs.update(log.id, {
        put_away_status: 'skipped',
        put_away_skip_reason: reason,
        put_away_at: new Date().toISOString(),
      });
      toast({ title: 'Skipped — not added to stock. Reason saved on the receiving entry.' });
      onFinished();
    } catch (e) {
      toast({ title: e.message || 'Unable to skip', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const canSkip = skipReason && (skipReason !== 'Other' || skipNote.trim());

  return (
    <div className="steel-card p-6 mb-6 space-y-4 ring-2 ring-primary/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Put it away{total > 1 ? ` · ${position} of ${total}` : ''}</p>
          <h3 className="text-lg font-bold">{qty} {uom} · {line?.description || 'PO line'}</h3>
          <p className="text-sm text-muted-foreground">PO {log.po_number}{heat ? ` · Heat ${heat}` : ''}{mtrGrade ? ` · Grade ${mtrGrade} (from MTR)` : ''}</p>
        </div>
        {step !== 'skip' && (
          <Button variant="ghost" size="sm" onClick={() => setStep('skip')}>
            <SkipForward className="w-4 h-4 mr-1" />Not going into stock
          </Button>
        )}
      </div>

      {step === 'where' && (
        <div className="space-y-3">
          <p className="font-semibold flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" />Step 1 — Where did it go?</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <Label>Zone / bay</Label>
              <Select value={spot.zone} onValueChange={(v) => setSpot((s) => ({ ...s, zone: v }))}>
                <SelectTrigger className="mt-1 h-12"><SelectValue placeholder="Pick a zone" /></SelectTrigger>
                <SelectContent>
                  {shopFloorZones.map((z) => <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Rack (optional)</Label>
              <Input value={spot.rack} onChange={(e) => setSpot((s) => ({ ...s, rack: e.target.value }))} className="mt-1 h-12" />
            </div>
            <div>
              <Label>Bin (optional)</Label>
              <Input value={spot.bin} onChange={(e) => setSpot((s) => ({ ...s, bin: e.target.value }))} className="mt-1 h-12" />
            </div>
          </div>
          {shopFloorZones.length === 0 && <p className="text-xs text-muted-foreground">No zones set up yet — add them in the 3D Warehouse. Rack/bin alone is fine for now.</p>}
          <Button className="w-full h-12" disabled={!spot.zone && !spot.rack.trim() && !spot.bin.trim()} onClick={() => setStep('which')}>Next</Button>
        </div>
      )}

      {step === 'which' && newItem && (
        <div className="space-y-3">
          <p className="font-semibold flex items-center gap-2"><Package className="w-4 h-4 text-primary" />Step 2 — Which stock item is this?</p>
          {suggestions.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Looks like it could be one of these (matched on size{mtrGrade ? ' and grade' : ''}) — tap the right one:</p>
              {suggestions.map(({ item, gradeHit, uomMatch }) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setChoice(item.id)}
                  className={`w-full flex items-center justify-between gap-3 p-3 rounded-lg border text-left text-sm transition ${choice === item.id ? 'ring-2 ring-primary bg-primary/5 border-transparent' : 'border-border hover:bg-muted/50'}`}
                >
                  <span>
                    <span className="font-medium">{item.description}</span>
                    <span className="block text-xs text-muted-foreground">
                      {item.size || '—'} · {item.material_grade || 'no grade'} · {formatLocation(locationOf(item), zoneLabel)}
                    </span>
                  </span>
                  <span className="text-right text-xs">
                    <span className="block">{item.quantity_on_hand ?? 0} {item.unit_of_measure || ''} on hand</span>
                    {gradeHit && <Badge variant="outline" className="text-[10px]">grade match</Badge>}
                    {!uomMatch && <Badge variant="outline" className="text-[10px] text-orange-600">different unit</Badge>}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No stock item clearly matches this line.</p>
          )}

          <div>
            <Label className="text-xs">Or pick any stock item</Label>
            <Select value={choice && choice !== 'new' ? choice : ''} onValueChange={setChoice}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Search the list…" /></SelectTrigger>
              <SelectContent>
                {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.description}{i.size ? ` · ${i.size}` : ''}{i.material_grade ? ` · ${i.material_grade}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <button
            type="button"
            onClick={() => setChoice('new')}
            className={`w-full p-3 rounded-lg border text-left text-sm ${choice === 'new' ? 'ring-2 ring-primary bg-primary/5 border-transparent' : 'border-dashed border-border hover:bg-muted/50'}`}
          >
            <span className="font-medium">It&apos;s new — make a new stock item</span>
          </button>
          {choice === 'new' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <Label>Description</Label>
                <Input value={newItem.description} onChange={(e) => setNewItem((n) => ({ ...n, description: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Category</Label>
                <Select value={newItem.category} onValueChange={(v) => setNewItem((n) => ({ ...n, category: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Size</Label>
                <Input value={newItem.size} onChange={(e) => setNewItem((n) => ({ ...n, size: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Grade</Label>
                <Input value={newItem.material_grade} onChange={(e) => setNewItem((n) => ({ ...n, material_grade: e.target.value }))} className="mt-1" placeholder="A992" />
              </div>
              <div>
                <Label>Unit</Label>
                <Input value={newItem.unit_of_measure} onChange={(e) => setNewItem((n) => ({ ...n, unit_of_measure: e.target.value }))} className="mt-1" />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="h-12" onClick={() => setStep('where')}>Back</Button>
            <Button className="flex-1 h-12" disabled={!choice} onClick={() => setStep('confirm')}>Next</Button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-3">
          <p className="font-semibold flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" />Step 3 — Check and save</p>
          <div className="rounded-lg bg-muted/50 p-4 text-sm space-y-1">
            <p>Adding <span className="font-semibold">{qty} {uom}</span> to <span className="font-semibold">{chosenItem ? chosenItem.description : `new item "${newItem.description}"`}</span></p>
            <p>Put in: <span className="font-semibold">{formatLocation(spot, zoneLabel)}</span></p>
            <p>Heat number: <span className="font-semibold font-mono">{heat || 'none entered'}</span></p>
            {chosenItem && preview && <p>On hand: {preview.onHandBefore} → <span className="font-semibold">{preview.onHandAfter}</span></p>}
            {choice === 'new' && <p>On hand: 0 → <span className="font-semibold">{qty}</span></p>}
          </div>
          {chosenUomMismatch && (
            <p className="text-sm text-orange-600">Heads up: this PO line is in “{line.unit_of_measure}” but the stock item counts in “{chosenItem.unit_of_measure}”. {qty} will be added as-is — go Back and pick or make a different item if that&apos;s wrong.</p>
          )}
          {spotDiffers && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="w-4 h-4 mt-0.5" checked={makeMainSpot} onChange={(e) => setMakeMainSpot(e.target.checked)} />
              <span>This item is listed at {formatLocation(locationOf(chosenItem), zoneLabel)}. Make {formatLocation(spot, zoneLabel)} its listed spot instead?</span>
            </label>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="h-12" onClick={() => setStep('which')}>Back</Button>
            <Button className="flex-1 h-12 text-base" disabled={saving} onClick={putAway}>
              {saving ? 'Saving…' : 'Put it away'}
            </Button>
          </div>
        </div>
      )}

      {step === 'skip' && (
        <div className="space-y-3">
          <p className="font-semibold">Not going into stock — why?</p>
          <div className="flex flex-wrap gap-2">
            {SKIP_REASONS.map((r) => (
              <Button key={r} variant={skipReason === r ? 'default' : 'outline'} onClick={() => setSkipReason(r)}>{r}</Button>
            ))}
          </div>
          <Input
            value={skipNote}
            onChange={(e) => setSkipNote(e.target.value)}
            placeholder={skipReason === 'Other' ? 'Say why (required)' : 'Note (optional), e.g. job name'}
          />
          <p className="text-xs text-muted-foreground">Nothing gets added to stock. The reason is saved on this receiving entry.</p>
          <div className="flex gap-2">
            <Button variant="outline" className="h-12" onClick={() => setStep('where')}>Back</Button>
            <Button className="flex-1 h-12" disabled={!canSkip || saving} onClick={skip}>{saving ? 'Saving…' : 'Skip — don’t add to stock'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
