export const ACTION_ITEM_STATUSES = ['Open', 'In_Progress', 'Complete'];

const todayStr = () => new Date().toISOString().slice(0, 10);

export function isOverdue(actionItem) {
  return !!actionItem.due_date && actionItem.status !== 'Complete' && actionItem.due_date < todayStr();
}

// Flattens every non-Complete action item across a project's notes into one
// {note, item} list, soonest due date first — what ProjectDetail's "Open
// Action Items" rollup and its stat card both read from, so the count and
// the list underneath it can never drift apart.
export function getOpenActionItems(notes) {
  return notes
    .flatMap((note) => (note.action_items || []).map((item) => ({ note, item })))
    .filter(({ item }) => item.status !== 'Complete')
    .sort((a, b) => (a.item.due_date || '9999-99-99').localeCompare(b.item.due_date || '9999-99-99'));
}
