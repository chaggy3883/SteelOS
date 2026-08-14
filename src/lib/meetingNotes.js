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

// localStorage draft key — scoped per project so switching which job's on
// screen in Meeting Mode never bleeds one job's in-progress note into
// another's, and scoped to the browser tab only (never a real
// ProjectMeetingNote row until the PM explicitly clicks Save).
export const noteDraftKey = (projectId) => `steelos_meeting_note_draft_${projectId}`;
