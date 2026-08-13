import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { listEmployeesForRole, hasFullEmployeeAccess, hireCandidate, reevaluateTimeclockLock, syncFormulaPin } from '@/lib/employeesApi';
import { getAllRoles } from '@/components/dashboard/rbacConfig';
import { verifyPin } from '@/lib/hrSecurity';
import { getExpiringCertifications } from '@/lib/certAlerts';
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
import AddEmployeeWizard from '@/components/hr/AddEmployeeWizard';
import EmployeeFilesPanel from '@/components/hr/EmployeeFilesPanel';
import CandidateApplicationDialog from '@/components/hr/CandidateApplicationDialog';
import { isCapabilityAllowed } from '@/lib/permissionCatalog';
import { UserPlus, Lock, Unlock, AlertTriangle, ShieldCheck, EyeOff, IdCard, CalendarClock, CheckCircle2, Ban, HeartPulse, CalendarPlus } from 'lucide-react';

const POSITIONS = ['Ironworker', 'Welder', 'Fabricator', 'Painter', 'Shop Manager', 'Inspector', 'Office'];
const CANDIDATE_STATUSES = ['Applied', 'Interviewing', 'Offer_Extended', 'Hired', 'Rejected'];

// Phase B tab-level enforcement (permissionCatalog.js) for office sessions —
// mirrors the same pattern already wired into EmployeeCenter.jsx for kiosk
// sessions, reading from this User account's own permission_overrides.
const HR_TABS = [
  { value: 'ats', key: 'tab:/human-resources:ats' },
  { value: 'employees', key: 'tab:/human-resources:employees' },
  { value: 'timeoff', key: 'tab:/human-resources:timeoff' },
  { value: 'emergency', key: 'tab:/human-resources:emergency' },
  { value: 'safety', key: 'tab:/human-resources:safety' },
  { value: 'terminal', key: 'tab:/human-resources:terminal' },
  { value: 'addemployee', key: 'tab:/human-resources:addemployee' },
  { value: 'files', key: 'tab:/human-resources:files' },
];

const emptyInterviewForm = () => ({ scheduled_datetime: '', interviewer: '', notes: '' });

const emptyCandidateForm = () => ({ candidate_name: '', email: '', phone: '', position_applied: 'Ironworker' });

export default function HumanResources() {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(null);
  const [roles, setRoles] = useState(['user']);
  const [permissionOverrides, setPermissionOverrides] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [certifications, setCertifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showCandidateForm, setShowCandidateForm] = useState(false);
  const [candidateForm, setCandidateForm] = useState(emptyCandidateForm());
  const [savingCandidate, setSavingCandidate] = useState(false);

  const [schedulingCandidateId, setSchedulingCandidateId] = useState(null);
  const [interviewForm, setInterviewForm] = useState(emptyInterviewForm());
  const [savingInterview, setSavingInterview] = useState(false);
  const [viewingCandidate, setViewingCandidate] = useState(null);

  const [terminalEmployeeNumber, setTerminalEmployeeNumber] = useState('');
  const [terminalPin, setTerminalPin] = useState('');

  const [profileEmployee, setProfileEmployee] = useState(null);
  const [showProfileDialog, setShowProfileDialog] = useState(false);

  const [pendingLeave, setPendingLeave] = useState([]);
  const [decliningRequestId, setDecliningRequestId] = useState(null);
  const [declineNote, setDeclineNote] = useState('');

  const [emergencyContactEmployeeId, setEmergencyContactEmployeeId] = useState('');
  const [allRoles, setAllRoles] = useState([]);
  const [assigningRoleId, setAssigningRoleId] = useState(null);
  const [viewingCertification, setViewingCertification] = useState(null);

  useEffect(() => { init(); }, []);

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

  const init = async () => {
    setLoading(true);
    let currentRoles = ['user'];
    try {
      const me = await db.auth.me();
      currentRoles = me?.roles || me?.user?.roles || ['user'];
      setPermissionOverrides(me?.permission_overrides || []);
    } catch (e) {}
    setRoles(currentRoles);
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
      setPendingLeave(leaveData.filter((r) => r.status === 'Submitted' || r.status === 'Pending'));
    } catch (e) {}
  };

  const isFullAccess = hasFullEmployeeAccess(roles);

  const handleCreateCandidate = async () => {
    if (!candidateForm.candidate_name.trim()) {
      toast({ title: 'Candidate name is required', variant: 'destructive' });
      return;
    }
    setSavingCandidate(true);
    try {
      const created = await db.entities.candidate_profiles.create({
        ...candidateForm,
        status: 'Applied',
        applied_date: new Date().toISOString().slice(0, 10),
      });
      setCandidates((prev) => [created, ...prev]);
      setShowCandidateForm(false);
      setCandidateForm(emptyCandidateForm());
      toast({ title: 'Candidate added' });
    } catch (e) {
      toast({ title: 'Unable to add candidate', variant: 'destructive' });
    } finally {
      setSavingCandidate(false);
    }
  };

  const handleStatusChange = async (candidate, status) => {
    if (status === 'Hired') {
      try {
        const employee = await hireCandidate(candidate.id);
        await loadAll(roles);
        toast({ title: `Hired — Employee #${employee.employee_number} provisioned`, description: employee.full_name });
      } catch (e) {
        toast({ title: 'Unable to provision employee', variant: 'destructive' });
      }
      return;
    }
    const updated = await db.entities.candidate_profiles.update(candidate.id, { status });
    setCandidates((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
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

  const handleEmployeeCreated = (employee) => {
    setEmployees((prev) => [employee, ...prev]);
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

  const assignPlatformRole = async (employee, role) => {
    setAssigningRoleId(employee.id);
    try {
      const updated = await db.entities.employees.update(employee.id, { platform_role: role });
      setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      toast({ title: `${updated.full_name} assigned to ${allRoles.find((r) => r.value === role)?.label || role}` });
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

  // Persists the outcome + supervisor notes to the request record itself,
  // which is what EmployeeCenter.jsx's "My Time Off Requests" list reads to
  // show the employee their decision and comments in their own view.
  const decideLeaveRequest = async (request, status, notes = '') => {
    const updated = await db.entities.time_off_requests.update(request.id, { status, supervisor_notes: notes });
    setPendingLeave((prev) => prev.filter((r) => r.id !== updated.id));
    setDecliningRequestId(null);
    setDeclineNote('');
    toast({ title: `Leave request ${status.toLowerCase()}` });
  };

  const confirmDecline = (request) => {
    if (!declineNote.trim()) {
      toast({ title: 'Administrative Comments are required to decline a request', variant: 'destructive' });
      return;
    }
    decideLeaveRequest(request, 'Rejected', declineNote.trim());
  };

  const expiringCerts = getExpiringCertifications(certifications, 60);

  const isTabVisible = (value) => {
    const tab = HR_TABS.find((t) => t.value === value);
    return !tab || isCapabilityAllowed(permissionOverrides, tab.key);
  };
  const visibleTabValues = HR_TABS.filter((t) => isTabVisible(t.value)).map((t) => t.value);
  const defaultTabValue = visibleTabValues[0] || 'ats';
  const currentTab = activeTab || defaultTabValue;

  if (loading) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <PageHeader
        title="Human Resources & Personnel"
        subtitle="ATS provisioning, timeclock lockout, and 60-day safety certification radar"
        actions={
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${isFullAccess ? 'bg-green-500/10 text-green-600' : 'bg-yellow-500/10 text-yellow-600'}`}>
            {isFullAccess ? <ShieldCheck className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {isFullAccess ? 'Full HR Access' : 'Masked — Public Fields Only'}
          </span>
        }
      />

      <Tabs value={currentTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          {isTabVisible('ats') && <TabsTrigger value="ats">Candidates (ATS)</TabsTrigger>}
          {isTabVisible('employees') && <TabsTrigger value="employees">Employees</TabsTrigger>}
          {isFullAccess && isTabVisible('timeoff') && (
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
          {isFullAccess && isTabVisible('addemployee') && <TabsTrigger value="addemployee">Add Employee</TabsTrigger>}
          {isFullAccess && isTabVisible('files') && <TabsTrigger value="files">Employee Files</TabsTrigger>}
        </TabsList>

        <TabsContent value="ats" className="space-y-3">
          <div className="flex justify-end">
            <Button onClick={() => setShowCandidateForm(true)} className="gap-2 steel-gradient text-white border-0">
              <UserPlus className="w-4 h-4" />Add Candidate
            </Button>
          </div>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">No candidates in the pipeline yet.</p>
          ) : candidates.map((candidate) => (
            <div key={candidate.id} className="steel-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <button onClick={() => setViewingCandidate(candidate)} className="font-semibold text-primary hover:underline text-left">
                    {candidate.candidate_name}
                  </button>
                  <p className="text-xs text-muted-foreground">{candidate.position_applied} • {candidate.email}</p>
                  {candidate.hired_employee_id && <p className="text-xs text-green-600 mt-0.5">Provisioned as employee record</p>}
                </div>
                <div className="flex items-center gap-2">
                  {candidate.status === 'Interviewing' && (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openInterviewScheduler(candidate)}>
                      <CalendarPlus className="w-3.5 h-3.5" />Schedule Interview
                    </Button>
                  )}
                  <Select value={candidate.status} onValueChange={(v) => handleStatusChange(candidate, v)}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CANDIDATE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>)}
                    </SelectContent>
                  </Select>
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

        <TabsContent value="employees" className="space-y-3">
          {isFullAccess && employees.some((e) => !e.platform_role) && (
            <div className="steel-card p-4 space-y-2 border-amber-500/30">
              <h4 className="font-semibold text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-500" />Unassigned Platform Roles</h4>
              <p className="text-xs text-muted-foreground">These new hires don't have a platform security role yet — assign one to grant them system access.</p>
              <div className="space-y-2">
                {employees.filter((e) => !e.platform_role).map((emp) => (
                  <div key={emp.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2">
                    <div>
                      <p className="text-sm font-medium">{emp.full_name}</p>
                      <p className="text-xs text-muted-foreground">{emp.employee_number} · {emp.classification}</p>
                    </div>
                    <Select value={emp.platform_role || ''} onValueChange={(v) => assignPlatformRole(emp, v)} disabled={assigningRoleId === emp.id}>
                      <SelectTrigger className="w-56 h-8 text-xs"><SelectValue placeholder="Assign a role…" /></SelectTrigger>
                      <SelectContent>
                        {allRoles.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
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
                              <input type="checkbox" checked={!!emp.has_i9_approved} onChange={(e) => toggleCompliance(emp, 'has_i9_approved', e.target.checked)} />I-9
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

        {isFullAccess && (
          <TabsContent value="timeoff" className="space-y-3">
            <div className="steel-card p-4">
              <h4 className="font-semibold text-sm mb-1 flex items-center gap-2"><CalendarClock className="w-4 h-4 text-primary" />Pending Time-Off Requests</h4>
              <p className="text-xs text-muted-foreground mb-3">Approve or decline requests submitted from the Employee Center. Declines require a written comment.</p>
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
                        <p className="text-xs text-muted-foreground">{r.total_hours}h • {r.reason}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700 text-white border-0" onClick={() => decideLeaveRequest(r, 'Approved')}><CheckCircle2 className="w-3.5 h-3.5" />Approve</Button>
                        <Button size="sm" variant="outline" className="gap-1 text-red-600 border-red-500/30" onClick={() => { setDecliningRequestId(r.id); setDeclineNote(''); }}><Ban className="w-3.5 h-3.5" />Decline</Button>
                      </div>
                    </div>
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
                  <EmergencyContactPanel employee={selected} onUpdated={handleProfileUpdated} />
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
        </TabsContent>

        <TabsContent value="terminal" className="space-y-3">
          <div className="steel-card p-4 max-w-sm space-y-3">
            <h4 className="font-semibold text-sm">Timeclock PIN Keypad</h4>
            <div>
              <Label className="text-xs">Employee Number</Label>
              <Input value={terminalEmployeeNumber} onChange={(e) => setTerminalEmployeeNumber(e.target.value)} placeholder="001" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">5-Digit PIN</Label>
              <Input type="password" maxLength={5} value={terminalPin} onChange={(e) => setTerminalPin(e.target.value.replace(/\D/g, ''))} placeholder="•••••" className="mt-1" />
            </div>
            <Button onClick={handleClockIn} className="w-full steel-gradient text-white border-0">Clock In</Button>
            <p className="text-xs text-muted-foreground">Terminal rejects the punch if the employee's timeclock is locked, regardless of PIN correctness.</p>
          </div>
        </TabsContent>

        {isFullAccess && (
          <TabsContent value="addemployee">
            <AddEmployeeWizard positions={POSITIONS} allRoles={allRoles} onEmployeeCreated={handleEmployeeCreated} />
          </TabsContent>
        )}

        {isFullAccess && (
          <TabsContent value="files">
            <EmployeeFilesPanel employees={employees} />
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={showCandidateForm} onOpenChange={setShowCandidateForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Candidate</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Candidate Name</Label>
              <Input value={candidateForm.candidate_name} onChange={(e) => setCandidateForm((f) => ({ ...f, candidate_name: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={candidateForm.email} onChange={(e) => setCandidateForm((f) => ({ ...f, email: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={candidateForm.phone} onChange={(e) => setCandidateForm((f) => ({ ...f, phone: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Position Applied</Label>
              <Select value={candidateForm.position_applied} onValueChange={(v) => setCandidateForm((f) => ({ ...f, position_applied: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCandidateForm(false)}>Cancel</Button>
            <Button onClick={handleCreateCandidate} disabled={savingCandidate} className="steel-gradient text-white border-0">
              {savingCandidate ? 'Saving…' : 'Add Candidate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {profileEmployee && (
        <EmployeeProfileDialog
          employee={profileEmployee}
          roles={roles}
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
