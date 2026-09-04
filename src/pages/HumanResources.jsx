import React, { useEffect, useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSearchParams, Link } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { listEmployeesForRole, hasFullEmployeeAccess, hireCandidate, rejectCandidate, reevaluateTimeclockLock, syncFormulaPin, terminationReasonLabel, assignPlatformRoles } from '@/lib/employeesApi';
import { getAllRoles, getUserGranularPermissions } from '@/components/dashboard/rbacConfig';
import { verifyPin } from '@/lib/hrSecurity';
import { getExpiringCertifications } from '@/lib/certAlerts';
import { getComplianceAlerts } from '@/lib/i9Compliance';
import { decidePtoRequest, runAnniversaryRenewalCheckForCompany } from '@/lib/ptoEngine';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import EmployeeProfileDialog from '@/components/hr/EmployeeProfileDialog';
import EmergencyContactPanel from '@/components/hr/EmergencyContactPanel';
import EmployeeFilesPanel from '@/components/hr/EmployeeFilesPanel';
import CandidateApplicationDialog from '@/components/hr/CandidateApplicationDialog';
import HiringDocumentsPanel from '@/components/hr/HiringDocumentsPanel';
import StatusHistoryModal from '@/components/shared/StatusHistoryModal';
import RoleMultiSelect from '@/components/admin/RoleMultiSelect';
import { isCapabilityAllowed, GRANULAR_ACTIONS, hasGranularPermission } from '@/lib/permissionCatalog';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';
import { UserPlus, Lock, Unlock, AlertTriangle, ShieldCheck, EyeOff, IdCard, CalendarClock, CheckCircle2, Ban, HeartPulse, CalendarPlus, FileText, History } from 'lucide-react';

// Classification is the prevailing-wage/certified-payroll labor
// classification (certifiedPayrollReport.js) — kept separate from
// job_title (general HR title, JOB_TITLES below). "Welder" stays here even
// though it's been folded into "Fabricator" for job_title purposes, since
// certified payroll still needs the distinct wage classification.
export const POSITIONS = ['Ironworker', 'Welder', 'Fabricator', 'Painter', 'Shop Manager', 'Inspector', 'Office'];
// General HR job title, offered on Add Employee and candidate intake (position
// applied for) — distinct from POSITIONS/classification above.
export const JOB_TITLES = ['Ironworker', 'Fabricator', 'Laborer', 'Painter', 'Shop Manager', 'Inspector', 'Office', 'Driver', 'Operator', 'Crew Lead'];
// The status dropdown only ever offers non-terminal transitions — Hired and
// Rejected are decisions, not a dropdown pick, and must go through the Hire/
// Reject confirm modals below so employee provisioning and the documents
// move/delete can never be skipped.
const CANDIDATE_STATUS_OPTIONS = ['Applied', 'Interviewing', 'Offer_Extended'];

const REJECTION_REASONS = [
  { value: 'not_a_fit', label: 'Not a Fit for the Role' },
  { value: 'position_filled', label: 'Position Filled' },
  { value: 'failed_to_respond', label: 'Failed to Respond' },
  { value: 'compensation_mismatch', label: 'Compensation Expectations Mismatch' },
  { value: 'withdrew_application', label: 'Candidate Withdrew Application' },
  { value: 'other', label: 'Other' },
];

// Phase B tab-level enforcement (permissionCatalog.js) for office sessions —
// mirrors the same pattern already wired into EmployeeCenter.jsx for kiosk
// sessions, reading from this User account's own permission_overrides.
const HR_TABS = [
  { value: 'ats', key: 'tab:/human-resources:ats' },
  { value: 'archive', key: 'tab:/human-resources:archive' },
  { value: 'employees', key: 'tab:/human-resources:employees' },
  { value: 'timeoff', key: 'tab:/human-resources:timeoff' },
  { value: 'emergency', key: 'tab:/human-resources:emergency' },
  { value: 'safety', key: 'tab:/human-resources:safety' },
  { value: 'terminal', key: 'tab:/human-resources:terminal' },
  { value: 'addemployee', key: 'tab:/human-resources:addemployee' },
  { value: 'files', key: 'tab:/human-resources:files' },
];

const emptyInterviewForm = () => ({ scheduled_datetime: '', interviewer: '', notes: '' });

export default function HumanResources() {
  useDocumentTitle('SteelOS — Human Resources');
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(null);
  const [roles, setRoles] = useState(['user']);
  const [granularPermissions, setGranularPermissions] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [permissionOverrides, setPermissionOverrides] = useState([]);
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);
  const [candidates, setCandidates] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [certifications, setCertifications] = useState([]);
  const [pendingLeaveBalances, setPendingLeaveBalances] = useState({});
  const [loading, setLoading] = useState(true);

  const [schedulingCandidateId, setSchedulingCandidateId] = useState(null);
  const [interviewForm, setInterviewForm] = useState(emptyInterviewForm());
  const [savingInterview, setSavingInterview] = useState(false);
  const [viewingCandidate, setViewingCandidate] = useState(null);

  const [hireCandidateTarget, setHireCandidateTarget] = useState(null);
  const [hireForm, setHireForm] = useState({ hire_date: '', position_title: '' });
  const [hiring, setHiring] = useState(false);

  const [rejectCandidateTarget, setRejectCandidateTarget] = useState(null);
  const [rejectForm, setRejectForm] = useState({ reason_code: REJECTION_REASONS[0].value, reason_other: '', keep_documents: true });
  const [rejecting, setRejecting] = useState(false);

  const [docsCandidate, setDocsCandidate] = useState(null);
  const [historyCandidate, setHistoryCandidate] = useState(null);

  const [terminalEmployeeNumber, setTerminalEmployeeNumber] = useState('');
  const [terminalPin, setTerminalPin] = useState('');

  const [profileEmployee, setProfileEmployee] = useState(null);
  const [showProfileDialog, setShowProfileDialog] = useState(false);

  const [pendingLeave, setPendingLeave] = useState([]);
  const [decliningRequestId, setDecliningRequestId] = useState(null);
  const [declineNote, setDeclineNote] = useState('');
  // Keyed by request.id — the reason decidePtoRequest() blocked an Approve
  // click, shown inline on that row (see decideLeaveRequest below) instead of
  // only in a toast that's easy to miss and makes Approve look broken.
  const [leaveBlockReasons, setLeaveBlockReasons] = useState({});
  // Dismissible inline notices for requests that WERE approved but into a
  // negative balance (overdraft_action: allow_negative) — the request row
  // itself is gone by the time this fires (already filtered out of
  // pendingLeave), so these render as their own alerts above the list.
  const [leaveOverdraftNotices, setLeaveOverdraftNotices] = useState([]);

  const [emergencyContactEmployeeId, setEmergencyContactEmployeeId] = useState('');
  const [allRoles, setAllRoles] = useState([]);
  const [assigningRoleId, setAssigningRoleId] = useState(null);
  const [viewingCertification, setViewingCertification] = useState(null);

  useEffect(() => { init(); }, []);
  useEffect(() => {
    getEffectiveCompany()
      .then((company) => setModuleAllowed(hasModule(company, '/human-resources')))
      .catch(() => setModuleAllowed(false))
      .finally(() => setCheckingModuleAccess(false));
  }, []);

  // Deep-link target for "employee" drill-downs from other pages/tabs
  // (equipment usage operator, time-off requester, cert radar, etc.) —
  // /human-resources?employee=<id> jumps to the Employees tab and opens
  // that employee's profile dialog, mirroring CRM's ?vendor=/?customer= pattern.
  useEffect(() => {
    const empId = searchParams.get('employee');
    if (!empId || employees.length === 0) return;
    const match = employees.find((e) => e.id === empId);
    if (match) {
      setActiveTab('employees');
      setProfileEmployee(match);
      setShowProfileDialog(true);
    }
  }, [searchParams, employees]);

  // Deep-link target for candidate drill-downs from Global Search — jumps to
  // the ATS tab (or the Archive tab for a rejected candidate) and opens that
  // candidate's read-only application view.
  useEffect(() => {
    const candId = searchParams.get('candidate');
    if (!candId || candidates.length === 0) return;
    const match = candidates.find((c) => c.id === candId);
    if (match) {
      setActiveTab(match.status === 'Rejected' ? 'archive' : 'ats');
      setViewingCandidate(match);
    }
  }, [searchParams, candidates]);

  const init = async () => {
    setLoading(true);
    let currentRoles = ['user'];
    let me = null;
    try {
      me = await db.auth.me();
      currentRoles = me?.roles || me?.user?.roles || ['user'];
      setPermissionOverrides(me?.permission_overrides || []);
      setCurrentUser(me);
    } catch (e) {}
    setRoles(currentRoles);
    getUserGranularPermissions(currentRoles).then(setGranularPermissions).catch(() => setGranularPermissions([]));
    // No backend scheduler exists in this app — anniversary PTO renewals are
    // checked here, on HR page load, instead of a cron job. Idempotent: see
    // src/lib/ptoEngine.js's policy_year_end comparison. Awaited before
    // loadAll so the Time Off Approvals balances/available-hours read below
    // never race a still-in-flight grant and show a stale 0h.
    if (me?.company_id) await runAnniversaryRenewalCheckForCompany(me.company_id).catch(() => {});
    await loadAll(currentRoles);
    // super_admin is a platform-operator role, not an assignable HR role —
    // never offer it in the Platform Role dropdown here or in AddEmployeeWizard.
    getAllRoles().then((r) => setAllRoles(r.filter((role) => role.value !== 'super_admin'))).catch(() => setAllRoles([]));
    setLoading(false);
  };

  const loadAll = async (currentRoles) => {
    try {
      const [candidateData, employeeData, certData, leaveData] = await Promise.all([
        db.entities.candidate_profiles.list('-created_date', 100),
        listEmployeesForRole(currentRoles),
        db.entities.employee_certifications.list('-created_date', 200),
        db.entities.time_off_requests.list('-created_date', 200),
      ]);
      setCandidates(candidateData);
      setEmployees(employeeData);
      setCertifications(certData);
      const pending = leaveData.filter((r) => r.status === 'Submitted' || r.status === 'Pending');
      setPendingLeave(pending);
      loadPendingLeaveBalances(pending);
    } catch (e) {}
  };

  const isFullAccess = hasFullEmployeeAccess(roles);
  // Deliberately separate from isFullAccess: that flag also masks/unmasks
  // SSN, pay rate, and several other tabs across this whole page — reusing
  // it for a "custom role can approve PTO" grant would silently unlock all
  // of that too. This only ever widens the Time Off Approvals tab below.
  const canApprovePto = isFullAccess || hasGranularPermission(granularPermissions, GRANULAR_ACTIONS.APPROVE_PTO);

  // Only reached for the three non-terminal statuses — Hired/Rejected are no
  // longer options in the dropdown, see CANDIDATE_STATUS_OPTIONS.
  const handleStatusChange = async (candidate, status) => {
    const updated = await db.entities.candidate_profiles.update(candidate.id, { status });
    setCandidates((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const openHireModal = (candidate) => {
    setHireCandidateTarget(candidate);
    setHireForm({ hire_date: new Date().toISOString().slice(0, 10), position_title: candidate.position_applied });
  };

  const confirmHire = async () => {
    if (!hireForm.hire_date) {
      toast({ title: 'Hire date is required', variant: 'destructive' });
      return;
    }
    setHiring(true);
    try {
      const employee = await hireCandidate(hireCandidateTarget.id, hireForm, currentUser?.full_name || currentUser?.email);
      await loadAll(roles);
      setHireCandidateTarget(null);
      toast({ title: 'Candidate moved to HR, hire date recorded', description: `Employee #${employee.employee_number} — ${employee.full_name}` });
      setActiveTab('employees');
      setProfileEmployee(employee);
      setShowProfileDialog(true);
    } catch (e) {
      toast({ title: 'Unable to provision employee', variant: 'destructive' });
    } finally {
      setHiring(false);
    }
  };

  const openRejectModal = (candidate) => {
    setRejectCandidateTarget(candidate);
    setRejectForm({ reason_code: REJECTION_REASONS[0].value, reason_other: '', keep_documents: true });
  };

  const confirmReject = async () => {
    const isOther = rejectForm.reason_code === 'other';
    const finalReason = isOther ? rejectForm.reason_other.trim() : REJECTION_REASONS.find((r) => r.value === rejectForm.reason_code)?.label;
    if (isOther && !finalReason) {
      toast({ title: 'Please specify a rejection reason', variant: 'destructive' });
      return;
    }
    setRejecting(true);
    try {
      await rejectCandidate(rejectCandidateTarget.id, { rejection_reason: finalReason, keep_documents: rejectForm.keep_documents }, currentUser?.full_name || currentUser?.email);
      await loadAll(roles);
      setRejectCandidateTarget(null);
      toast({ title: 'Candidate archived' });
    } catch (e) {
      toast({ title: 'Unable to reject candidate', variant: 'destructive' });
    } finally {
      setRejecting(false);
    }
  };

  const openInterviewScheduler = (candidate) => {
    setSchedulingCandidateId(candidate.id);
    setInterviewForm(emptyInterviewForm());
  };

  // Dashboard widgets calendar (widgetContent.jsx's InterviewsCalendarWidget)
  // reads calendar_events directly — this is the only write path into it.
  const saveInterview = async (candidate) => {
    if (!interviewForm.scheduled_datetime) {
      toast({ title: 'Interview date/time is required', variant: 'destructive' });
      return;
    }
    setSavingInterview(true);
    try {
      await db.entities.calendar_events.create({
        event_type: 'Interview',
        candidate_id: candidate.id,
        candidate_name: candidate.candidate_name,
        interviewer: interviewForm.interviewer,
        scheduled_datetime: new Date(interviewForm.scheduled_datetime).toISOString(),
        notes: interviewForm.notes,
      });
      setSchedulingCandidateId(null);
      setInterviewForm(emptyInterviewForm());
      toast({ title: 'Interview scheduled', description: candidate.candidate_name });
    } catch (e) {
      toast({ title: 'Unable to schedule interview', variant: 'destructive' });
    } finally {
      setSavingInterview(false);
    }
  };

  const toggleCompliance = async (employee, field, value) => {
    const updated = await db.entities.employees.update(employee.id, { [field]: value });
    const relocked = await reevaluateTimeclockLock(updated);
    setEmployees((prev) => prev.map((e) => (e.id === relocked.id ? relocked : e)));
    toast({ title: relocked.is_timeclock_locked ? 'Timeclock still locked' : 'Timeclock unlocked — both W-4 and I-9 approved' });
  };

  const openProfile = (employee) => {
    setProfileEmployee(employee);
    setShowProfileDialog(true);
  };

  const handleProfileUpdated = (updated) => {
    setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };

  const toggleAccountActive = async (employee, value) => {
    const updated = await db.entities.employees.update(employee.id, { is_active_login: value });
    setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    toast({ title: value ? `${updated.full_name}'s login re-enabled` : `${updated.full_name}'s login suspended` });
  };

  const handleAssignRoles = async (employee, roles) => {
    setAssigningRoleId(employee.id);
    try {
      const updated = await assignPlatformRoles(employee, roles);
      setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      const label = roles.length > 0 ? roles.map((r) => allRoles.find((x) => x.value === r)?.label || r).join(', ') : 'no roles';
      toast({ title: `${updated.full_name} assigned to ${label}` });
    } finally {
      setAssigningRoleId(null);
    }
  };

  const updateSsnLast4 = async (employee, value) => {
    const ssn_last4 = value.replace(/\D/g, '').slice(0, 4);
    const updated = await db.entities.employees.update(employee.id, { ssn_last4 });
    const relocked = await syncFormulaPin(updated);
    setEmployees((prev) => prev.map((e) => (e.id === relocked.id ? relocked : e)));
    toast({ title: 'SSN updated', description: 'Kiosk PIN recomputed from the formula.' });
  };

  const handleClockIn = async () => {
    // Deliberately bypasses the role-masking wrapper: verifying your OWN PIN
    // is a self-service action (like walking up to a real timeclock kiosk),
    // not a roster-browsing operation — it must work even for viewers whose
    // `employees` state is masked and has no pin_encrypted field at all.
    try {
      const matches = await db.entities.employees.filter({ employee_number: terminalEmployeeNumber.trim() });
      const employee = matches[0];
      if (!employee || !verifyPin(terminalPin, employee.pin_encrypted)) {
        toast({ title: 'Invalid employee number or PIN', variant: 'destructive' });
        return;
      }
      if (employee.is_timeclock_locked) {
        toast({ title: 'Terminal locked', description: 'W-4 and I-9 approval required before this employee can clock in.', variant: 'destructive' });
        return;
      }
      toast({ title: `Clocked in — ${employee.full_name}` });
      setTerminalEmployeeNumber('');
      setTerminalPin('');
    } catch (e) {
      toast({ title: 'Clock-in failed', variant: 'destructive' });
    }
  };

  // Fetches the PtoBalance for each pending request's employee/leave_type so
  // the approval queue can show "available" hours before HR clicks Approve.
  // Unpaid is skipped — it never has a balance.
  const loadPendingLeaveBalances = async (pending) => {
    const relevant = pending.filter((r) => r.leave_type !== 'Unpaid');
    const entries = await Promise.all(relevant.map(async (r) => {
      const rows = await db.entities.PtoBalance.filter({ employee_id: r.employee_id, leave_type: r.leave_type }, '-created_date', 1);
      return [r.id, rows[0]?.balance_hours];
    }));
    setPendingLeaveBalances(Object.fromEntries(entries.filter(([, hours]) => hours !== undefined)));
  };

  // Persists the outcome + supervisor notes to the request record itself,
  // which is what EmployeeCenter.jsx's "My Time Off Requests" list reads to
  // show the employee their decision and comments in their own view. Also
  // decrements/reverses the PTO ledger via decidePtoRequest (src/lib/ptoEngine.js)
  // — the single call site both this page and EmployeeCenter.jsx's HR queue
  // use, so the ledger discipline can't be bypassed from either surface.
  const decideLeaveRequest = async (request, status, notes = '') => {
    let result;
    try {
      result = await decidePtoRequest({
        request, newStatus: status, notes,
        changedBy: currentUser?.full_name || currentUser?.email || 'Unknown',
      });
    } catch (e) {
      // An unexpected throw here (vs. decidePtoRequest's own ok:false path)
      // must still surface something — an unhandled rejection is silent and
      // makes Approve/Decline look like it's doing nothing at all, exactly
      // the failure mode the ok:false inline-reason handling below already
      // guards against.
      toast({ title: `Unable to ${status === 'Approved' ? 'approve' : 'decline'} request`, description: e?.message || 'Unexpected error', variant: 'destructive' });
      return;
    }
    if (!result.ok) {
      // Blocked (insufficient balance / waiting period) — the request stays
      // pending, so surface the reason inline on its row rather than only in
      // a toast, which is easy to miss and makes Approve look like it's
      // silently doing nothing.
      setLeaveBlockReasons((prev) => ({ ...prev, [request.id]: result.message }));
      toast({ title: result.message, variant: 'destructive' });
      return;
    }
    setLeaveBlockReasons((prev) => {
      if (!(request.id in prev)) return prev;
      const next = { ...prev };
      delete next[request.id];
      return next;
    });
    if (result.warning) {
      setLeaveOverdraftNotices((prev) => [...prev, { id: `${request.id}-${prev.length}`, requestId: request.id, message: result.warning }]);
    }
    setPendingLeave((prev) => prev.filter((r) => r.id !== result.request.id));
    setDecliningRequestId(null);
    setDeclineNote('');
    toast({ title: result.warning || `Leave request ${status.toLowerCase()}`, variant: result.warning ? 'default' : undefined });
  };

  const dismissOverdraftNotice = (noticeId) => {
    setLeaveOverdraftNotices((prev) => prev.filter((n) => n.id !== noticeId));
  };

  const confirmDecline = (request) => {
    if (!declineNote.trim()) {
      toast({ title: 'Administrative Comments are required to decline a request', variant: 'destructive' });
      return;
    }
    decideLeaveRequest(request, 'Rejected', declineNote.trim());
  };

  const expiringCerts = getExpiringCertifications(certifications, 60);
  const complianceAlerts = getComplianceAlerts(employees, 30);
  // Rejected candidates live in the read-only Archive tab, not the working
  // pipeline — everything else (including Hired) stays in the ATS list.
  const activeCandidates = candidates.filter((c) => c.status !== 'Rejected');
  const rejectedCandidates = candidates.filter((c) => c.status === 'Rejected');

  const isTabVisible = (value) => {
    const tab = HR_TABS.find((t) => t.value === value);
    return !tab || isCapabilityAllowed(permissionOverrides, tab.key);
  };
  const visibleTabValues = HR_TABS.filter((t) => isTabVisible(t.value)).map((t) => t.value);
  const defaultTabValue = visibleTabValues[0] || 'ats';
  const currentTab = activeTab || defaultTabValue;

  if (loading || checkingModuleAccess) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;

  // Route guard — a direct URL to /human-resources can't bypass the nav's
  // module-pack filtering. Strictly earlier/coarser than the tab-level
  // permission checks above (isTabVisible / isFullAccess).
  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  if (!(moduleAllowed || isPlatformOperatorView)) {
    return <ModuleLocked modulePath="/human-resources" title="Human Resources Not Included" />;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <PageHeader
        title="Human Resources & Personnel"
        subtitle="ATS provisioning, timeclock lockout, and 60-day safety certification radar"
        actions={
          <div className="flex items-center gap-2">
            {isFullAccess && isTabVisible('addemployee') && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => window.open('/human-resources/new-employee', '_blank', 'noopener,noreferrer')}
              >
                <UserPlus className="w-3.5 h-3.5" />Add Employee
              </Button>
            )}
            <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${isFullAccess ? 'bg-green-500/10 text-green-600' : 'bg-yellow-500/10 text-yellow-600'}`}>
              {isFullAccess ? <ShieldCheck className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {isFullAccess ? 'Full HR Access' : 'Masked — Public Fields Only'}
            </span>
          </div>
        }
      />

      <Tabs value={currentTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          {isTabVisible('ats') && <TabsTrigger value="ats">Candidates (ATS)</TabsTrigger>}
          {isTabVisible('archive') && <TabsTrigger value="archive">Candidate Archive</TabsTrigger>}
          {isTabVisible('employees') && <TabsTrigger value="employees">Employees</TabsTrigger>}
          {canApprovePto && isTabVisible('timeoff') && (
            <TabsTrigger value="timeoff" className="gap-1.5">
              Time Off Approvals
              {pendingLeave.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-yellow-500 text-white text-[10px] font-bold">{pendingLeave.length}</span>
              )}
            </TabsTrigger>
          )}
          {isFullAccess && isTabVisible('emergency') && <TabsTrigger value="emergency">Emergency Contacts</TabsTrigger>}
          {isTabVisible('safety') && <TabsTrigger value="safety">Safety Radar</TabsTrigger>}
          {isTabVisible('terminal') && <TabsTrigger value="terminal">Timeclock Terminal</TabsTrigger>}
          {isFullAccess && isTabVisible('files') && <TabsTrigger value="files">Employee Files</TabsTrigger>}
        </TabsList>

        <TabsContent value="ats" className="space-y-3">
          <div className="flex justify-end">
            <Button
              onClick={() => window.open('/human-resources/new-candidate', '_blank', 'noopener,noreferrer')}
              className="gap-2 steel-gradient text-white border-0"
            >
              <UserPlus className="w-4 h-4" />Add Candidate
            </Button>
          </div>
          {activeCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">No candidates in the pipeline yet.</p>
          ) : activeCandidates.map((candidate) => (
            <div key={candidate.id} className="steel-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <button onClick={() => setViewingCandidate(candidate)} className="font-semibold text-primary hover:underline text-left">
                    {candidate.candidate_name}
                  </button>
                  <p className="text-xs text-muted-foreground">{candidate.position_applied} • {candidate.email}</p>
                  {candidate.hired_employee_id && <p className="text-xs text-green-600 mt-0.5">Provisioned as employee record</p>}
                  <button onClick={() => setHistoryCandidate(candidate)} className="text-xs text-muted-foreground hover:text-primary hover:underline inline-flex items-center gap-1 mt-0.5">
                    <History className="w-3 h-3" />Status History
                  </button>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDocsCandidate(candidate)}>
                    <FileText className="w-3.5 h-3.5" />Documents
                  </Button>
                  {candidate.status === 'Interviewing' && (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openInterviewScheduler(candidate)}>
                      <CalendarPlus className="w-3.5 h-3.5" />Schedule Interview
                    </Button>
                  )}
                  {candidate.status === 'Hired' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 px-2">
                      <CheckCircle2 className="w-3.5 h-3.5" />Hired
                    </span>
                  ) : (
                    <>
                      <Select value={candidate.status} onValueChange={(v) => handleStatusChange(candidate, v)}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CANDIDATE_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700 text-white border-0" onClick={() => openHireModal(candidate)}>
                        <CheckCircle2 className="w-3.5 h-3.5" />Hire
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => openRejectModal(candidate)}>
                        <Ban className="w-3.5 h-3.5" />Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {schedulingCandidateId === candidate.id && (
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Date & Time</Label>
                      <Input type="datetime-local" value={interviewForm.scheduled_datetime} onChange={(e) => setInterviewForm((f) => ({ ...f, scheduled_datetime: e.target.value }))} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Interviewer</Label>
                      <Input value={interviewForm.interviewer} onChange={(e) => setInterviewForm((f) => ({ ...f, interviewer: e.target.value }))} className="mt-1" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Textarea value={interviewForm.notes} onChange={(e) => setInterviewForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1" />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setSchedulingCandidateId(null)}>Cancel</Button>
                    <Button size="sm" onClick={() => saveInterview(candidate)} disabled={savingInterview} className="steel-gradient text-white border-0">
                      {savingInterview ? 'Saving…' : 'Save Interview'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </TabsContent>

        <TabsContent value="archive" className="space-y-3">
          {rejectedCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">No rejected candidates archived yet.</p>
          ) : (
            <div className="steel-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left py-3 px-4">Name</th>
                      <th className="text-left py-3 px-4">Position Applied</th>
                      <th className="text-left py-3 px-4">Rejected Date</th>
                      <th className="text-left py-3 px-4">Rejection Reason</th>
                      <th className="text-right py-3 px-4">Documents</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejectedCandidates.map((candidate) => (
                      <tr key={candidate.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="py-2.5 px-4">
                          <button onClick={() => setViewingCandidate(candidate)} className="font-medium text-primary hover:underline text-left">
                            {candidate.candidate_name}
                          </button>
                        </td>
                        <td className="py-2.5 px-4">{candidate.position_applied}</td>
                        <td className="py-2.5 px-4">{candidate.rejection_date || '—'}</td>
                        <td className="py-2.5 px-4">{candidate.rejection_reason || '—'}</td>
                        <td className="py-2.5 px-4 text-right">
                          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDocsCandidate(candidate)}>
                            <FileText className="w-3.5 h-3.5" />View Documents
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="employees" className="space-y-3">
          {isFullAccess && (
            <div className="flex justify-end">
              <Link to="/human-resources/new-employee">
                <Button className="gap-2 steel-gradient text-white border-0">
                  <UserPlus className="w-4 h-4" />New Employee
                </Button>
              </Link>
            </div>
          )}

          {isFullAccess && employees.some((e) => !(e.platform_roles && e.platform_roles.length)) && (
            <div className="steel-card p-4 space-y-2 border-amber-500/30">
              <h4 className="font-semibold text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-500" />Unassigned Platform Roles</h4>
              <p className="text-xs text-muted-foreground">These new hires don't have a platform security role yet — assign one or more to grant them system access.</p>
              <div className="space-y-2">
                {employees.filter((e) => !(e.platform_roles && e.platform_roles.length)).map((emp) => (
                  <div key={emp.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2">
                    <div>
                      <p className="text-sm font-medium">{emp.full_name}</p>
                      <p className="text-xs text-muted-foreground">{emp.employee_number} · {emp.classification}</p>
                    </div>
                    <RoleMultiSelect
                      roles={allRoles}
                      value={emp.platform_roles || []}
                      onChange={(v) => handleAssignRoles(emp, v)}
                      disabled={assigningRoleId === emp.id}
                      placeholder="Assign role(s)…"
                      className="w-56"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {employees.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">No employees provisioned yet — hire a candidate first.</p>
          ) : (
            <div className="steel-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left py-3 px-4">Employee #</th>
                      <th className="text-left py-3 px-4">Name</th>
                      <th className="text-left py-3 px-4">Classification</th>
                      {isFullAccess && <th className="text-left py-3 px-4">Hire Date</th>}
                      <th className="text-left py-3 px-4">Employment Status</th>
                      {isFullAccess && <th className="text-left py-3 px-4">SSN (last 4)</th>}
                      {isFullAccess && <th className="text-right py-3 px-4">Pay Rate</th>}
                      <th className="text-left py-3 px-4">Timeclock</th>
                      <th className="text-left py-3 px-4">Account Active</th>
                      {isFullAccess && <th className="text-left py-3 px-4">Compliance</th>}
                      {isFullAccess && <th className="text-right py-3 px-4">Profile</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr key={emp.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold">
                          <button onClick={() => openProfile(emp)} className="text-primary hover:underline">{emp.employee_number}</button>
                        </td>
                        <td className="py-3 px-4">
                          <button onClick={() => openProfile(emp)} className="text-primary hover:underline">{emp.full_name}</button>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">{emp.classification}</td>
                        {isFullAccess && <td className="py-3 px-4 text-muted-foreground">{emp.hire_date || '—'}</td>}
                        <td className="py-3 px-4">
                          {emp.termination_date ? (
                            <button onClick={() => openProfile(emp)} className="text-left">
                              <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 mb-0.5">Terminated {emp.termination_date}</span>
                              <span className="block text-xs text-primary hover:underline">{terminationReasonLabel(emp) || 'Reason on file'}</span>
                            </button>
                          ) : (
                            <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600">Active</span>
                          )}
                        </td>
                        {isFullAccess && (
                          <td className="py-3 px-4">
                            <Input defaultValue={emp.ssn_last4} onBlur={(e) => updateSsnLast4(emp, e.target.value)} placeholder="0000" className="h-7 w-20 text-xs font-mono" />
                          </td>
                        )}
                        {isFullAccess && (
                          <td className="py-3 px-4 text-right font-mono">
                            {emp.pay_type === 'salary'
                              ? `$${((emp.annual_salary_cents || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr`
                              : `$${((emp.pay_rate_cents || 0) / 100).toFixed(2)}/hr`}
                          </td>
                        )}
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${emp.is_timeclock_locked ? 'bg-red-500/10 text-red-600' : 'bg-green-500/10 text-green-600'}`}>
                            {emp.is_timeclock_locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                            {emp.is_timeclock_locked ? 'Locked' : 'Unlocked'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {isFullAccess ? (
                            <div className="flex items-center gap-2">
                              <Switch checked={emp.is_active_login !== false} onCheckedChange={(v) => toggleAccountActive(emp, v)} />
                              <span className="text-xs text-muted-foreground">{emp.is_active_login !== false ? 'Active' : 'Suspended'}</span>
                            </div>
                          ) : (
                            <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full ${emp.is_active_login !== false ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
                              {emp.is_active_login !== false ? 'Active' : 'Suspended'}
                            </span>
                          )}
                        </td>
                        {isFullAccess && (
                          <td className="py-3 px-4 text-xs space-y-1">
                            <label className="flex items-center gap-1.5">
                              <input type="checkbox" checked={!!emp.has_w4_approved} onChange={(e) => toggleCompliance(emp, 'has_w4_approved', e.target.checked)} />W-4
                            </label>
                            <label className="flex items-center gap-1.5">
                              <input type="checkbox" checked={!!emp.i9_on_file} onChange={(e) => toggleCompliance(emp, 'i9_on_file', e.target.checked)} />I-9
                            </label>
                          </td>
                        )}
                        {isFullAccess && (
                          <td className="py-3 px-4 text-right">
                            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openProfile(emp)}>
                              <IdCard className="w-3.5 h-3.5" />Manage
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {canApprovePto && (
          <TabsContent value="timeoff" className="space-y-3">
            <div className="steel-card p-4">
              <h4 className="font-semibold text-sm mb-1 flex items-center gap-2"><CalendarClock className="w-4 h-4 text-primary" />Pending Time-Off Requests</h4>
              <p className="text-xs text-muted-foreground mb-3">Approve or decline requests submitted from the Employee Center. Declines require a written comment.</p>
              {leaveOverdraftNotices.map((notice) => (
                <div key={notice.id} className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-2.5 text-xs text-yellow-700 mb-2 flex items-start justify-between gap-2">
                  <span className="flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />{notice.message}</span>
                  <button onClick={() => dismissOverdraftNotice(notice.id)} className="text-yellow-700 hover:underline flex-shrink-0">Dismiss</button>
                </div>
              ))}
              {pendingLeave.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No pending requests.</p>
              ) : pendingLeave.map((r) => {
                const requester = employees.find((e) => e.id === r.employee_id);
                return (
                  <div key={r.id} className="rounded-lg border border-border p-3 text-sm mb-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <p className="font-medium">
                          {requester ? (
                            <button onClick={() => openProfile(requester)} className="text-primary hover:underline">{requester.full_name}</button>
                          ) : (r.employee_id)}
                          {' '}— {r.leave_type} ({r.start_date} to {r.end_date})
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.total_hours}h • {r.reason}
                          {r.leave_type !== 'Unpaid' && pendingLeaveBalances[r.id] !== undefined && (
                            <span className={pendingLeaveBalances[r.id] < r.total_hours ? 'text-red-600 font-medium' : ''}>
                              {' '}• Available: {Number(pendingLeaveBalances[r.id]).toFixed(1)}h
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700 text-white border-0" onClick={() => decideLeaveRequest(r, 'Approved')}><CheckCircle2 className="w-3.5 h-3.5" />Approve</Button>
                        <Button size="sm" variant="outline" className="gap-1 text-red-600 border-red-500/30" onClick={() => { setDecliningRequestId(r.id); setDeclineNote(''); }}><Ban className="w-3.5 h-3.5" />Decline</Button>
                      </div>
                    </div>
                    {leaveBlockReasons[r.id] && (
                      <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/5 p-2.5 text-xs text-red-600 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span><span className="font-semibold">Cannot approve:</span> {leaveBlockReasons[r.id]}</span>
                      </div>
                    )}
                    {decliningRequestId === r.id && (
                      <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                        <Label className="text-xs">Administrative Comments (required)</Label>
                        <Textarea value={declineNote} onChange={(e) => setDeclineNote(e.target.value)} rows={2} placeholder="Explain why this request is being declined…" />
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" variant="outline" onClick={() => { setDecliningRequestId(null); setDeclineNote(''); }}>Cancel</Button>
                          <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white border-0" onClick={() => confirmDecline(r)}>Confirm Decline</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>
        )}

        {isFullAccess && (
          <TabsContent value="emergency" className="space-y-3">
            <div className="steel-card p-4 max-w-lg">
              <h4 className="font-semibold text-sm mb-1 flex items-center gap-2"><HeartPulse className="w-4 h-4 text-primary" />Family Contact Matrix</h4>
              <p className="text-xs text-muted-foreground mb-3">Select an employee to view or update their emergency contact on file.</p>
              <Select value={emergencyContactEmployeeId} onValueChange={setEmergencyContactEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Select an employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>#{e.employee_number} — {e.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {emergencyContactEmployeeId && (() => {
              const selected = employees.find((e) => e.id === emergencyContactEmployeeId);
              return selected ? (
                <div className="max-w-lg">
                  <EmergencyContactPanel employee={selected} roles={roles} onUpdated={handleProfileUpdated} />
                </div>
              ) : null;
            })()}
          </TabsContent>
        )}

        <TabsContent value="safety" className="space-y-3">
          <div className="steel-card p-4">
            <h4 className="font-semibold text-sm mb-1 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-yellow-600" />60-Day Certification Radar</h4>
            <p className="text-xs text-muted-foreground mb-3">Certifications expiring within 60 days, or already expired, surface here for HR Manager review.</p>
            {expiringCerts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No certifications are expiring soon.</p>
            ) : expiringCerts.map((cert) => {
              const employee = employees.find((e) => e.id === cert.employee_id);
              return (
                <div
                  key={cert.id}
                  onClick={() => setViewingCertification({ ...cert, employee })}
                  className={`rounded-lg border p-3 text-sm mb-2 cursor-pointer hover:bg-muted/40 transition-colors ${cert.status === 'Expired' ? 'border-red-500/40 bg-red-500/5' : 'border-yellow-500/40 bg-yellow-500/5'}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium">
                      {employee ? (
                        <button onClick={(e) => { e.stopPropagation(); openProfile(employee); }} className="text-primary hover:underline">{employee.full_name}</button>
                      ) : (cert.employee_id)}
                      {' '}— {cert.cert_type.replace(/_/g, ' ')}
                    </p>
                    <span className={`text-xs font-semibold ${cert.status === 'Expired' ? 'text-red-600' : 'text-yellow-700'}`}>{cert.status.replace('_', ' ')}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Expires {cert.expiration_date}</p>
                </div>
              );
            })}
          </div>

          {isFullAccess && (
            <div className="steel-card p-4">
              <h4 className="font-semibold text-sm mb-1 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-yellow-600" />I-9 / E-Verify Compliance</h4>
              <p className="text-xs text-muted-foreground mb-3">Reverification and recheck deadlines overdue or due within 30 days. Informational only — I-9/E-Verify records are kept on file even after termination.</p>
              {complianceAlerts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No I-9 or E-Verify deadlines are due soon.</p>
              ) : complianceAlerts.map(({ employee, i9Flag, everifyFlag }) => {
                const worstFlag = i9Flag === 'overdue' || everifyFlag === 'overdue' ? 'overdue' : 'due_soon';
                return (
                  <div
                    key={employee.id}
                    onClick={() => openProfile(employee)}
                    className={`rounded-lg border p-3 text-sm mb-2 cursor-pointer hover:bg-muted/40 transition-colors ${worstFlag === 'overdue' ? 'border-red-500/40 bg-red-500/5' : 'border-yellow-500/40 bg-yellow-500/5'}`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-primary hover:underline">{employee.full_name}</p>
                      <span className={`text-xs font-semibold ${worstFlag === 'overdue' ? 'text-red-600' : 'text-yellow-700'}`}>{worstFlag === 'overdue' ? 'Overdue' : 'Due Soon'}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {i9Flag && `I-9 reverification due ${employee.i9_reverification_due_date}`}
                      {i9Flag && everifyFlag && ' • '}
                      {everifyFlag && (employee.e_verify_status === 'expired' ? 'E-Verify expired' : `E-Verify recheck due ${employee.e_verify_recheck_due_date}`)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="terminal" className="space-y-3">
          <div className="steel-card p-4 max-w-sm space-y-3">
            <h4 className="font-semibold text-sm">Timeclock PIN Keypad</h4>
            <div>
              <Label className="text-xs">Employee Number</Label>
              <Input value={terminalEmployeeNumber} onChange={(e) => setTerminalEmployeeNumber(e.target.value)} placeholder="001" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">4-Digit PIN (last 4 of SSN)</Label>
              <Input type="password" maxLength={4} value={terminalPin} onChange={(e) => setTerminalPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" className="mt-1" />
            </div>
            <Button onClick={handleClockIn} className="w-full steel-gradient text-white border-0">Clock In</Button>
            <p className="text-xs text-muted-foreground">Terminal rejects the punch if the employee's timeclock is locked, regardless of PIN correctness.</p>
          </div>
        </TabsContent>

        {isFullAccess && (
          <TabsContent value="files">
            <EmployeeFilesPanel employees={employees} />
          </TabsContent>
        )}
      </Tabs>

      {profileEmployee && (
        <EmployeeProfileDialog
          employee={profileEmployee}
          employees={employees}
          roles={roles}
          granularPermissions={granularPermissions}
          open={showProfileDialog}
          onOpenChange={setShowProfileDialog}
          onEmployeeUpdated={handleProfileUpdated}
        />
      )}

      <CandidateApplicationDialog
        candidate={viewingCandidate}
        open={!!viewingCandidate}
        onOpenChange={(o) => { if (!o) setViewingCandidate(null); }}
      />

      <Dialog open={!!hireCandidateTarget} onOpenChange={(o) => { if (!o) setHireCandidateTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Hire {hireCandidateTarget?.candidate_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Hire Date</Label>
              <Input type="date" value={hireForm.hire_date} onChange={(e) => setHireForm((f) => ({ ...f, hire_date: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Position Title</Label>
              <Input value={hireForm.position_title} onChange={(e) => setHireForm((f) => ({ ...f, position_title: e.target.value }))} className="mt-1" />
            </div>
            <p className="text-xs text-muted-foreground">Creates an employee record, moves the candidate's resume/application to their new employee file, and records the hire in status history.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHireCandidateTarget(null)}>Cancel</Button>
            <Button onClick={confirmHire} disabled={hiring} className="gap-1.5 bg-green-600 hover:bg-green-700 text-white border-0">
              <CheckCircle2 className="w-4 h-4" />{hiring ? 'Hiring…' : 'Confirm Hire'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectCandidateTarget} onOpenChange={(o) => { if (!o) setRejectCandidateTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject {rejectCandidateTarget?.candidate_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Rejection Reason</Label>
              <Select value={rejectForm.reason_code} onValueChange={(v) => setRejectForm((f) => ({ ...f, reason_code: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REJECTION_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {rejectForm.reason_code === 'other' && (
              <div>
                <Label>Specify Reason</Label>
                <Textarea value={rejectForm.reason_other} onChange={(e) => setRejectForm((f) => ({ ...f, reason_other: e.target.value }))} rows={2} className="mt-1" />
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="pr-3">
                <Label className="text-sm">Keep Documents</Label>
                <p className="text-xs text-muted-foreground">Retain the resume/application in the Candidate Archive. Off permanently deletes them.</p>
              </div>
              <Switch checked={rejectForm.keep_documents} onCheckedChange={(v) => setRejectForm((f) => ({ ...f, keep_documents: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectCandidateTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmReject} disabled={rejecting} className="gap-1.5">
              <Ban className="w-4 h-4" />{rejecting ? 'Rejecting…' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!docsCandidate} onOpenChange={(o) => { if (!o) setDocsCandidate(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{docsCandidate?.candidate_name} — Documents</DialogTitle></DialogHeader>
          {docsCandidate && (
            <HiringDocumentsPanel
              ownerType="candidate"
              ownerId={docsCandidate.id}
              allowUpload={docsCandidate.status !== 'Rejected'}
              uploadedByName={currentUser?.full_name || currentUser?.email}
            />
          )}
        </DialogContent>
      </Dialog>

      <StatusHistoryModal
        open={!!historyCandidate}
        onOpenChange={(o) => { if (!o) setHistoryCandidate(null); }}
        entityType="candidate_profiles"
        entityId={historyCandidate?.id}
        fieldName="status"
        title={historyCandidate ? `${historyCandidate.candidate_name} — Status History` : 'Status History'}
      />

      <Dialog open={!!viewingCertification} onOpenChange={(o) => !o && setViewingCertification(null)}>
        <DialogContent>
          {viewingCertification && (
            <>
              <DialogHeader><DialogTitle>{viewingCertification.cert_type.replace(/_/g, ' ')}</DialogTitle></DialogHeader>
              <div className="space-y-2 text-sm">
                {[
                  ['Employee', viewingCertification.employee?.full_name || viewingCertification.employee_id, viewingCertification.employee ? () => { setViewingCertification(null); openProfile(viewingCertification.employee); } : null],
                  ['Certification Number', viewingCertification.cert_number || '—'],
                  ['Issued', viewingCertification.issued_date || '—'],
                  ['Expires', viewingCertification.expiration_date || '—'],
                  ['Status', viewingCertification.status.replace('_', ' ')],
                ].map(([label, value, onClick]) => (
                  <div key={label} className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
                    <span className="text-muted-foreground">{label}</span>
                    {onClick ? (
                      <button onClick={onClick} className="col-span-2 font-medium text-left text-primary hover:underline">{value}</button>
                    ) : (
                      <span className="col-span-2 font-medium">{value}</span>
                    )}
                  </div>
                ))}
              </div>
              {viewingCertification.file_uri && (
                <a href={viewingCertification.file_uri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <IdCard className="w-3.5 h-3.5" />View certificate file
                </a>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setViewingCertification(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
