import { db } from '@/api/apiClient';
import { getLiveProjects } from '@/lib/meetingModeData';

// Shared vocabulary for both a job's stated manpower_needs.trade and an
// assignment's role_on_job, so the two sides of the staffing comparison
// actually line up instead of drifting on free-text spelling. The UI also
// accepts a typed-in value outside this list (some jobs need something not
// on it), it's just not offered as a quick-pick.
export const TRADE_OPTIONS = ['Ironworker', 'Welder', 'Fitter', 'Rigger', 'Crane Operator', 'Foreman', 'Laborer', 'Painter'];

// employee_certifications.jsonc's own cert_type enum — mirrored here rather
// than imported since that file is schema documentation, not a runtime
// module.
export const CERT_TYPE_OPTIONS = ['OSHA_10', 'OSHA_30', 'Crane_Operator', 'Forklift', 'Welding_6G', 'Welding_3G', 'Rigging'];

// Leave statuses that represent a real, still-relevant absence — 'Rejected'
// never blocks anything. Both 'Approved' and the still-pending statuses are
// checked (and labeled differently) since a pending request already signals
// the employee expects to be out, even before a supervisor signs off.
const OPEN_LEAVE_STATUSES = ['Approved', 'Submitted', 'Pending'];

// Same "still a real, open thing" filter CrewAssignment conflict checks use
// for a subcontract's committed value in meetingModeData.js — draft/
// cancelled assignments don't exist as a status here (CrewAssignment has
// none), so every row is live; kept as its own function anyway so a future
// status field doesn't require hunting down every call site.
const dateRangesOverlap = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd;

// The employee roster + certification records — the only two lookups
// shared by every meeting-mode section that deals with people (Manpower's
// full conflict-checking included, but also the lighter Project Review
// notes panel, which just needs a picker and a name-to-detail lookup).
export async function loadEmployeeRoster() {
  const [employees, certifications] = await Promise.all([
    db.entities.employees.filter({ is_active: true }, 'full_name', 500),
    db.entities.employee_certifications.list('-created_date', 2000),
  ]);
  return { employees, certifications };
}

export async function loadManpowerAgendaData() {
  const [liveProjects, allProjects, { employees, certifications }, assignments, leaveRequests, assets] = await Promise.all([
    getLiveProjects(),
    // Unfiltered, so a double-booking against an archived/otherwise-not-live
    // job still resolves to a real project name instead of falling back to
    // "another job".
    db.entities.Project.list('-created_date', 500),
    loadEmployeeRoster(),
    db.entities.CrewAssignment.list('-created_date', 2000),
    db.entities.time_off_requests.list('-created_date', 1000),
    db.entities.erection_fleet_assets.list('-created_date', 500),
  ]);

  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const projectsById = new Map(allProjects.map((p) => [p.id, p]));

  const projectData = liveProjects.map((project) => {
    const projectAssignments = assignments
      .filter((a) => a.project_id === project.id)
      .map((a) => ({ ...a, employee: employeeById.get(a.employee_id) || null }))
      // Assignments referencing a since-deactivated/deleted employee still
      // display (as "Unknown employee") rather than silently vanishing —
      // the write happened and the record still exists.
      .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));

    const assignedByTrade = {};
    projectAssignments.forEach((a) => {
      const trade = a.role_on_job || 'Unassigned Role';
      assignedByTrade[trade] = (assignedByTrade[trade] || 0) + 1;
    });

    const needs = project.manpower_needs || [];
    const staffing = needs.map((need) => ({
      trade: need.trade,
      needed: need.headcount_needed || 0,
      assigned: assignedByTrade[need.trade] || 0,
    }));
    // Trades with people assigned but no stated need still show up, flagged
    // distinctly, rather than being silently absent from the staffing view.
    Object.keys(assignedByTrade).forEach((trade) => {
      if (!needs.some((n) => n.trade === trade)) {
        staffing.push({ trade, needed: null, assigned: assignedByTrade[trade] });
      }
    });

    return { project, assignments: projectAssignments, staffing };
  });

  return { projectData, employees, certifications, assignments, leaveRequests, projectsById, assets };
}

// OSHA 1926.1427 requires the crane OPERATOR to be certified, separate from
// craneDispatchGuard.js's asset-inspection gate (which only covers the crane
// ITSELF, not who's running it). A job with a mobile crane on-site should
// require Crane_Operator without a PM having to remember to toggle it on —
// this is the auto-derived half of that requirement.
export function getCraneAssetsForProject(assets, projectId) {
  return (assets || []).filter((a) => a.project_location_id === projectId && a.equipment_type === 'MOBILE_CRANE');
}

// Union of the job's manually-toggled required_certifications and whatever
// OSHA requires automatically given the assets on-site — manual toggles
// stay fully in the PM's control, auto-derived ones can't be un-toggled off
// (see the "isAutoRequired" lock in ManpowerSection.jsx's chip UI).
export function getEffectiveRequiredCertifications(project, craneAssets) {
  const manual = project?.required_certifications || [];
  const auto = (craneAssets || []).length > 0 ? ['Crane_Operator'] : [];
  return Array.from(new Set([...manual, ...auto]));
}

// Every conflict-check below is required to run before a write per the
// "conflicts are required, not optional" instruction — the caller shows all
// three results together rather than short-circuiting on the first hit.

// Returns the OTHER jobs this employee is already booked on for any date
// that overlaps [startDate, endDate], excluding the job being assigned to.
export function findDoubleBookings({ employeeId, startDate, endDate, excludeProjectId, allAssignments, projectsById }) {
  return allAssignments
    .filter((a) => a.employee_id === employeeId && a.project_id !== excludeProjectId)
    .filter((a) => dateRangesOverlap(startDate, endDate, a.start_date, a.end_date))
    .map((a) => ({ assignment: a, project: projectsById.get(a.project_id) || null }));
}

// Returns the required certification types this employee either has no
// record of, or whose expiration_date falls before the assignment's own
// end_date — recomputed against the assignment window directly rather than
// trusting the record's stored `status` field (which reflects staleness as
// of whenever it was last written, not "valid through this specific job").
export function findMissingCertifications({ requiredCertTypes, employeeId, endDate, allCertifications }) {
  if (!requiredCertTypes || requiredCertTypes.length === 0) return [];
  const employeeCerts = allCertifications.filter((c) => c.employee_id === employeeId);
  return requiredCertTypes
    .map((certType) => ({ certType, record: employeeCerts.find((c) => c.cert_type === certType) || null }))
    .filter(({ record }) => !record || !record.expiration_date || record.expiration_date < endDate)
    .map(({ certType, record }) => ({ cert_type: certType, existingRecord: record }));
}

// Returns open (approved or pending) leave requests that overlap the
// proposed assignment window.
export function findLeaveConflicts({ employeeId, startDate, endDate, allLeaveRequests }) {
  return allLeaveRequests
    .filter((r) => r.employee_id === employeeId && OPEN_LEAVE_STATUSES.includes(r.status))
    .filter((r) => dateRangesOverlap(startDate, endDate, r.start_date, r.end_date));
}
