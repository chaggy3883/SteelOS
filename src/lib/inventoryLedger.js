// The one write path for InventoryItem stock numbers. Every change to
// quantity_on_hand, quantity_reserved or the item's warehouse spot goes
// through recordInventoryChange, which updates the item AND appends one
// inventory_transactions row (see schema/entities/inventory_transactions.jsonc).
// Ledger rows are append-only (localData.js throws on update/delete for that
// entity) — a mistake is undone with reverseInventoryTransaction, which writes
// an opposite row pointing back at the original via reverses_transaction_id.
import { db } from '@/api/apiClient';

export const TRANSACTION_TYPES = ['receive', 'adjust', 'move', 'reserve', 'release', 'issue', 'return', 'scrap', 'count'];

// Plain shop language for the History view.
export const TRANSACTION_LABELS = {
  receive: 'Received',
  adjust: 'Added / took away',
  move: 'Moved',
  reserve: 'Set aside for a job',
  release: 'Freed back up',
  issue: 'Sent to a job',
  return: 'Came back from a job',
  scrap: 'Scrapped',
  count: 'Counted',
};

// Types where a person typing a number by hand is the only evidence, so a
// short "why" is mandatory. Every reversal also requires one.
export const REASON_REQUIRED_TYPES = ['adjust', 'scrap', 'count'];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const clean = (v) => String(v ?? '').trim();

export const locationOf = (item) => ({
  zone: item?.warehouse_zone || '',
  rack: item?.warehouse_rack || '',
  bin: item?.warehouse_bin || '',
});

export const formatLocation = ({ zone, rack, bin } = {}, zoneLabel = (z) => z) => {
  const parts = [zone ? zoneLabel(zone) : '', rack ? `Rack ${rack}` : '', bin ? `Bin ${bin}` : ''].filter(Boolean);
  return parts.length ? parts.join(' / ') : 'No spot set';
};

export async function getCurrentActor() {
  const me = await db.auth.me().catch(() => null);
  return { actor_id: me?.id || '', actor_name: me?.full_name || me?.email || '' };
}

// Pure: works out the item's new numbers for a change, or throws a plain-
// language error if the change isn't physically possible. Exported so the
// UI can preview "On hand goes 10 -> 15" before anything is written.
export function computeInventoryChange(item, { type, qtyDelta = 0, reservedDelta = 0 }) {
  if (!TRANSACTION_TYPES.includes(type)) throw new Error(`Unknown transaction type "${type}"`);
  const onHandBefore = num(item?.quantity_on_hand);
  const reservedBefore = num(item?.quantity_reserved);
  const onHandAfter = onHandBefore + num(qtyDelta);
  const reservedAfter = reservedBefore + num(reservedDelta);
  if (onHandAfter < 0) {
    throw new Error(`That would leave ${onHandAfter} on hand — there are only ${onHandBefore}.`);
  }
  if (reservedAfter < 0) {
    throw new Error(`Only ${reservedBefore} are set aside — can't free up ${Math.abs(num(reservedDelta))}.`);
  }
  if (num(reservedDelta) > 0 && reservedAfter > onHandAfter) {
    throw new Error(`Only ${Math.max(0, onHandAfter - reservedBefore)} are free to set aside.`);
  }
  return {
    onHandBefore,
    reservedBefore,
    onHandAfter,
    reservedAfter,
    availableAfter: Math.max(0, onHandAfter - reservedAfter),
  };
}

// change: {
//   type, qtyDelta, reservedDelta,
//   toLocation: { zone, rack, bin } — written onto the ledger row; also
//     becomes the item's spot when moveItem is true (always for 'move'),
//   moveItem, reason, projectId, sourceType, sourceId, poId, poLineId,
//   heatNumber, unitCost, reversesTransactionId, actor ({actor_id, actor_name})
// }
// Returns { item, transaction }.
export async function recordInventoryChange(itemId, change) {
  const {
    type,
    qtyDelta = 0,
    reservedDelta = 0,
    toLocation = null,
    moveItem = type === 'move',
    reason = '',
    projectId = '',
    sourceType = 'manual',
    sourceId = '',
    poId = '',
    poLineId = '',
    heatNumber = '',
    unitCost,
    reversesTransactionId = '',
    actor,
  } = change;

  const trimmedReason = clean(reason);
  if ((REASON_REQUIRED_TYPES.includes(type) || reversesTransactionId) && !trimmedReason) {
    throw new Error('Please say why — a short reason is required for this change.');
  }

  // Always re-read the item so two quick edits can't compute from a stale copy.
  const item = await db.entities.InventoryItem.get(itemId);
  if (!item) throw new Error('Inventory item not found');

  const numbers = computeInventoryChange(item, { type, qtyDelta, reservedDelta });
  const from = locationOf(item);
  const to = toLocation ? { zone: clean(toLocation.zone), rack: clean(toLocation.rack), bin: clean(toLocation.bin) } : null;

  if (type === 'move') {
    if (!to) throw new Error('Pick where it went.');
    if (to.zone === from.zone && to.rack === from.rack && to.bin === from.bin) {
      throw new Error("That's the spot it's already in.");
    }
  }
  if (num(qtyDelta) === 0 && num(reservedDelta) === 0 && type !== 'move' && type !== 'count') {
    throw new Error('Enter a quantity greater than zero.');
  }

  const itemPatch = {
    quantity_on_hand: numbers.onHandAfter,
    quantity_reserved: numbers.reservedAfter,
    quantity_available: numbers.availableAfter,
  };
  if (to && moveItem) {
    itemPatch.warehouse_zone = to.zone;
    itemPatch.warehouse_rack = to.rack;
    itemPatch.warehouse_bin = to.bin;
  }
  // InventoryItem.heat_number is a single field; one item can hold several
  // heats, so only fill it when blank — every receipt's heat lives on its
  // own ledger row regardless.
  if (clean(heatNumber) && !item.heat_number) itemPatch.heat_number = clean(heatNumber);

  const resolvedActor = actor || (await getCurrentActor());
  const updatedItem = await db.entities.InventoryItem.update(item.id, itemPatch);

  let transaction;
  try {
    transaction = await db.entities.inventory_transactions.create({
      transaction_type: type,
      inventory_item_id: item.id,
      qty_delta: num(qtyDelta),
      qty_after: numbers.onHandAfter,
      reserved_delta: num(reservedDelta),
      reserved_after: numbers.reservedAfter,
      unit_of_measure: item.unit_of_measure || '',
      unit_cost: unitCost !== undefined && unitCost !== null && unitCost !== '' ? num(unitCost) : num(item.unit_cost),
      from_zone: from.zone,
      from_rack: from.rack,
      from_bin: from.bin,
      to_zone: to ? to.zone : (type === 'move' ? '' : from.zone),
      to_rack: to ? to.rack : (type === 'move' ? '' : from.rack),
      to_bin: to ? to.bin : (type === 'move' ? '' : from.bin),
      heat_number: clean(heatNumber),
      project_id: projectId || '',
      source_type: sourceType,
      source_id: sourceId || '',
      po_id: poId || '',
      po_line_id: poLineId || '',
      reason: trimmedReason,
      actor_id: resolvedActor.actor_id || '',
      actor_name: resolvedActor.actor_name || '',
      transaction_at: new Date().toISOString(),
      reverses_transaction_id: reversesTransactionId || '',
    });
  } catch (e) {
    // Keep item and ledger in step: if the ledger row couldn't be written,
    // put the item's numbers/spot back the way they were.
    await db.entities.InventoryItem.update(item.id, {
      quantity_on_hand: item.quantity_on_hand,
      quantity_reserved: item.quantity_reserved,
      quantity_available: item.quantity_available,
      warehouse_zone: item.warehouse_zone,
      warehouse_rack: item.warehouse_rack,
      warehouse_bin: item.warehouse_bin,
      heat_number: item.heat_number,
    }).catch(() => {});
    throw e;
  }

  return { item: updatedItem, transaction };
}

// Creates a new InventoryItem at zero and then books its starting quantity
// through the ledger, so even an item's first number has a history row.
export async function createInventoryItemWithStock(itemData, { startingQty = 0, reason = 'Starting quantity when the item was added', actor } = {}) {
  const created = await db.entities.InventoryItem.create({
    ...itemData,
    quantity_on_hand: 0,
    quantity_reserved: 0,
    quantity_available: 0,
    is_active: itemData.is_active ?? true,
  });
  const qty = num(startingQty);
  if (qty <= 0) return { item: created, transaction: null };
  return recordInventoryChange(created.id, {
    type: 'count',
    qtyDelta: qty,
    reason,
    sourceType: 'item_created',
    sourceId: created.id,
    actor,
  });
}

// Has `transaction` already been undone? (Derived — the original row is
// never modified.)
export const findReversalOf = (transaction, allTransactions) =>
  allTransactions.find((t) => t.reverses_transaction_id === transaction.id) || null;

// Writes the opposite of `transaction` (same type, negated deltas, a move
// goes back where it came from). Never deletes or edits the original.
export async function reverseInventoryTransaction(transaction, { reason, actor } = {}) {
  if (!clean(reason)) throw new Error('Please say why you are undoing this.');
  const existing = await db.entities.inventory_transactions.filter({ reverses_transaction_id: transaction.id }, '-created_date', 1);
  if (existing.length > 0) throw new Error('This change was already undone.');
  if (transaction.reverses_transaction_id) {
    throw new Error('This row is itself an undo — undo the original change again instead of undoing the undo.');
  }

  const isMove = transaction.transaction_type === 'move';
  return recordInventoryChange(transaction.inventory_item_id, {
    type: transaction.transaction_type,
    qtyDelta: -num(transaction.qty_delta),
    reservedDelta: -num(transaction.reserved_delta),
    toLocation: isMove ? { zone: transaction.from_zone, rack: transaction.from_rack, bin: transaction.from_bin } : null,
    moveItem: isMove,
    reason,
    projectId: transaction.project_id,
    sourceType: 'reversal',
    sourceId: transaction.id,
    poId: transaction.po_id,
    poLineId: transaction.po_line_id,
    heatNumber: transaction.heat_number,
    unitCost: transaction.unit_cost,
    reversesTransactionId: transaction.id,
    actor,
  });
}

// --- Receiving put-away matching -------------------------------------------

const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, '').replace(/×/g, 'x');

// Conservative: an item is only suggested when its size string appears in
// the PO line's description (e.g. size "W12x26" in "W12x26 x 40' A992"), and
// it's ruled out when both sides name a grade and the grades differ. Never
// auto-selects anything the user doesn't confirm — this only orders the list.
export function suggestInventoryMatches(poLine, items, { grade = '' } = {}) {
  const desc = norm(poLine?.description);
  const wantedGrade = norm(grade);
  if (!desc) return [];
  return items
    .filter((item) => item.is_active !== false)
    .map((item) => {
      const size = norm(item.size);
      const sizeHit = size.length >= 3 && desc.includes(size);
      const itemGrade = norm(item.material_grade);
      const gradeConflict = wantedGrade && itemGrade && wantedGrade !== itemGrade;
      const gradeHit = (wantedGrade && itemGrade === wantedGrade) || (!wantedGrade && itemGrade && desc.includes(itemGrade));
      const uomMatch = !poLine?.unit_of_measure || !item.unit_of_measure || norm(poLine.unit_of_measure) === norm(item.unit_of_measure);
      return { item, sizeHit, gradeHit, gradeConflict, uomMatch };
    })
    .filter((m) => m.sizeHit && !m.gradeConflict)
    .sort((a, b) => (Number(b.gradeHit) - Number(a.gradeHit)) || (Number(b.uomMatch) - Number(a.uomMatch)));
}
