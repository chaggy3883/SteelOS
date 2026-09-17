// Single source of truth for what a Meeting Mode *format* is — the shape of
// the meeting itself, distinct from SECTION_DEFINITIONS (src/lib/
// meetingModeSections.js), which only applies to the 'sections' format.
// AddMeetingModal, MeetingModeSettingsPanel, and MeetingModeSession all read
// this same list rather than each hardcoding the two options.
export const MEETING_FORMATS = [
  {
    key: 'sections',
    label: 'Structured (Sections)',
    description: 'Pick from the standard agenda sections (Project Status, Manpower, Job Cost, etc.) — the existing Meeting Mode format.',
  },
  {
    key: 'project_notes',
    label: 'Project / Bid Notes',
    description: 'No sections — pick a project or bid, jot free-text notes, save, then move to the next one. Notes persist per project/bid across every meeting that uses this format. No cost or pricing data.',
  },
];

export function getMeetingFormat(key) {
  return MEETING_FORMATS.find((f) => f.key === key) || MEETING_FORMATS[0];
}

export const DEFAULT_MEETING_FORMAT = 'sections';
