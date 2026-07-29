// ILLUSTRATIVE ONLY — NOT LEGAL ADVICE.
// Mechanics'-lien / preliminary-notice statutory deadlines vary by state, by
// project type (private/public), and change over time. This table covers a
// handful of states as a starting point for this ERP's countdown/reminder
// feature. Verify the current statute for the specific project's jurisdiction
// with legal counsel before relying on any date this produces for an actual
// filing deadline.
export const LIEN_STATUTES = {
  OH: { days: 21, notice_type: 'notice_to_owner' },
  CA: { days: 20, notice_type: 'preliminary_notice' },
  FL: { days: 45, notice_type: 'notice_to_owner' },
  TX: { days: 15, notice_type: 'preliminary_notice' },
  DEFAULT: { days: 30, notice_type: 'preliminary_notice' },
};

export function getStatutoryDeadline(state, workStartDate) {
  const entry = LIEN_STATUTES[String(state || '').toUpperCase()] || LIEN_STATUTES.DEFAULT;
  const start = workStartDate ? new Date(workStartDate) : new Date();
  const deadline = new Date(start);
  deadline.setDate(deadline.getDate() + entry.days);
  return {
    days: entry.days,
    notice_type: entry.notice_type,
    deadlineDate: deadline.toISOString().slice(0, 10),
  };
}
