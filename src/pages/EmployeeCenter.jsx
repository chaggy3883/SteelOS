import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { getTerminalId, isTerminalLocked, recordFailedAttempt, recordSuccessfulLogin } from '@/lib/terminalSession';
import { verifyPin } from '@/lib/hrSecurity';
import { computeOvertimeForClockOut, resolveLaborScaleFromCategory, computeMultiScaleGrossPayCents } from '@/lib/attendanceMath';
import { getPayrollRateScalesCents } from '@/lib/burdenedLabor';
import { isMobileDevice, captureLocationCoordinates } from '@/lib/mobilePunch';
import { normalizeTargetMinutes } from '@/lib/shopOpsMetrics';
import { hasFullEmployeeAccess } from '@/lib/employeesApi';
import { isCapabilityAllowed } from '@/lib/permissionCatalog';
import { hasModule } from '@/lib/moduleEntitlement';
import { isAdminUser } from '@/lib/tenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import {
  LogIn, LogOut, Coffee, Play, Lock, ShieldAlert, FileText,
  User, Send, Plus, CheckCircle2, Ban, KeyRound, MapPin, Smartphone, Receipt, DoorOpen,
  Timer, Square, Eye, ShieldCheck,
} from 'lucide-react';
import PdfViewerModal from '@/components/shared/PdfViewerModal';

const isPdfFileUri = (uri) => /\.pdf($|[?#])/i.test(uri || '') || /^data:application\/pdf/i.test(uri || '');

// SANDBOX LOCK — intentional, read before adding anything here.
// This page never renders DashboardWidget/WIDGET_LIBRARY and never reads or
// writes page_layouts_json['employee_center'] on User or employees (see
// src/pages/Dashboard.jsx for the one page that does have that system). This
// workspace must stay identical across every worker session — do not wire in
// per-user widget customization, deletion, or resizing here.

// Phase B tab-level enforcement (permissionCatalog.js) — these are the only
// tab keys actually checked anywhere in the app right now. Employee Center's
// own module can never be disabled (see LOCKED_MODULE_KEY), but individual
// tabs inside it can be, e.g. hiding Payroll for a specific worker.
const EMPLOYEE_CENTER_TABS = [
  { value: 'kiosk', key: 'tab:/employee-center:kiosk' },
  { value: 'profile', key: 'tab:/employee-center:profile' },
  { value: 'timeoff', key: 'tab:/employee-center:timeoff' },
  { value: 'payroll', key: 'tab:/employee-center:payroll' },
];

const LABOR_CATEGORIES = ['Shop_Fab', 'Drill_Line', 'Welding', 'Paint', 'Field_Erection'];
const MATERIAL_PROFILE_TYPES = ['Wide_Flange_Beam', 'Moment_Column', 'Angle', 'Channel', 'Plate', 'HSS', 'Other'];
const LEAVE_TYPES = ['PTO', 'Sick', 'Unpaid', 'Bereavement'];
const EXPENSE_CATEGORIES = ['Lodging', 'Meals', 'Fuel', 'Tolls_Parking', 'Other'];
const emptyLeaveForm = () => ({ leave_type: 'PTO', start_date: '', end_date: '', total_hours: '', reason: '' });
const emptyExpenseForm = () => ({
  expense_category: 'Lodging', merchant_name: '', amount: '', expense_date: '', per_diem_allowance: '', is_out_of_town_travel: true,
});

export default function EmployeeCenter() {
  const { toast } = useToast();
  const [terminalId] = useState(() => getTerminalId());
  const [appUserRoles, setAppUserRoles] = useState(['user']);
  const [currentUser, setCurrentUser] = useState(null);

  // Admin support-view: an admin/super_admin account has no employees row of
  // its own (see the mount effect below), so it can never satisfy the normal
  // PIN gate — this lets it pick a target employee instead. isAdminViewing
  // marks the session as that read-only support view, never a real kiosk
  // login, so every mutating action below must check it.
  const [adminEmployees, setAdminEmployees] = useState([]);
  const [adminCompanies, setAdminCompanies] = useState({});
  const [adminSelectedEmployeeId, setAdminSelectedEmployeeId] = useState('');
  const [loadingAdminEmployees, setLoadingAdminEmployees] = useState(false);
  const [isAdminViewing, setIsAdminViewing] = useState(false);

  const [employee, setEmployee] = useState(null);
  const [company, setCompany] = useState(null);
  const [pieceMarkInput, setPieceMarkInput] = useState('');
  const [pieceProfileType, setPieceProfileType] = useState('Wide_Flange_Beam');
  const [pieceTargetMinutes, setPieceTargetMinutes] = useState('');
  const [activePieceLog, setActivePieceLog] = useState(null);
  const [isKioskSession, setIsKioskSession] = useState(false);
  const [kioskNumber, setKioskNumber] = useState('');
  const [kioskPin, setKioskPin] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [lockInfo, setLockInfo] = useState({ locked: false });

  const [projects, setProjects] = useState([]);
  const [punches, setPunches] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [laborCategory, setLaborCategory] = useState('');

  const [timeOffRequests, setTimeOffRequests] = useState([]);
  const [allPendingLeave, setAllPendingLeave] = useState([]);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveForm, setLeaveForm] = useState(emptyLeaveForm());

  const [payrollDocs, setPayrollDocs] = useState([]);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [pdfViewer, setPdfViewer] = useState(null);
  const [showVaultGate, setShowVaultGate] = useState(false);
  const [vaultPin, setVaultPin] = useState('');

  const [decliningRequestId, setDecliningRequestId] = useState(null);
  const [declineNote, setDeclineNote] = useState('');

  const [rateScale, setRateScale] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState(emptyExpenseForm());
  const [savingExpense, setSavingExpense] = useState(false);

  useEffect(() => {
    checkLock();
    db.entities.Project.filter({ is_archived: false }, 'name', 50).then(setProjects).catch(() => setProjects([]));
    db.auth.me()
      .then((me) => {
        setAppUserRoles(me?.roles || ['user']);
        setCurrentUser(me);
        // A kiosk-PIN session (Login.jsx / KioskKeypadLogin.jsx) already
        // proved identity via employee_id — resolving it here means the
        // worker never re-enters their Employee Number + PIN a second time
        // through the Kiosk Login card below.
        if (me?.employee_id) {
          setIsKioskSession(true);
          return db.entities.employees.get(me.employee_id).then((emp) => {
            if (!emp) return;
            setEmployee(emp);
            setVaultUnlocked(false);
            return Promise.all([loadEmployeeData(emp.id), loadCompany(emp.company_id)]);
          });
        }
        // Office accounts (admin/super_admin) have no employees row backing
        // them — this was the actual bug: the PIN gate below has no way to
        // ever succeed for them. isAdminUser() checks against the real
        // BUILTIN_ROLES role names ('admin', 'super_admin', etc.) via
        // tenantContext.js — this must never be loosened to any broader
        // check, since it's what stands in for the PIN a normal employee
        // would otherwise have to prove.
        if (isAdminUser(me)) {
          return loadAdminEmployeePicker();
        }
      })
      .catch(() => setAppUserRoles(['user']));
    loadPendingLeaveQueue();
    getPayrollRateScalesCents().then(setRateScale).catch(() => setRateScale(null));
  }, []);

  const checkLock = async () => {
    const info = await isTerminalLocked(terminalId);
    setLockInfo(info);
  };

  const loadCompany = async (companyId) => {
    if (!companyId) {
      setCompany(null);
      return;
    }
    try {
      setCompany(await db.entities.Company.get(companyId));
    } catch (e) {
      setCompany(null);
    }
  };

  const loadPendingLeaveQueue = async () => {
    try {
      const rows = await db.entities.time_off_requests.list('-created_date', 200);
      setAllPendingLeave(rows);
    } catch (e) {}
  };

  const isHrReviewer = hasFullEmployeeAccess(appUserRoles);

  const loadEmployeeData = async (employeeId) => {
    const [punchData, leaveData, payrollData, expenseData] = await Promise.all([
      db.entities.attendance_punches.filter({ employee_id: employeeId }, '-created_date', 200),
      db.entities.time_off_requests.filter({ employee_id: employeeId }, '-created_date', 100),
      db.entities.payroll_document_mappings.filter({ employee_id: employeeId }, '-created_date', 100),
      db.entities.credit_card_expenses.filter({ employee_id: employeeId }, '-created_date', 100),
    ]);
    setPunches(punchData);
    setTimeOffRequests(leaveData);
    setPayrollDocs(payrollData);
    setExpenses(expenseData);
  };

  const loadAdminEmployeePicker = async () => {
    setLoadingAdminEmployees(true);
    try {
      const [employeeList, companyList] = await Promise.all([
        db.entities.employees.list('full_name', 500),
        db.entities.Company.list('name', 200).catch(() => []),
      ]);
      setAdminEmployees(employeeList);
      setAdminCompanies(Object.fromEntries(companyList.map((c) => [c.id, c.name])));
    } catch (e) {
      setAdminEmployees([]);
    } finally {
      setLoadingAdminEmployees(false);
    }
  };

  // Admin support view — deliberately NOT a kiosk login: no PIN is checked
  // (role already gated this via isAdminUser above), the vault is
  // auto-unlocked since the admin can't know the employee's PIN either, and
  // every mutating handler below checks isAdminViewing and no-ops. Logged to
  // AuditLog so "who looked at whose Employee Center, and when" is on record.
  const handleAdminViewEmployee = async () => {
    if (!adminSelectedEmployeeId) return;
    setLoggingIn(true);
    try {
      const emp = await db.entities.employees.get(adminSelectedEmployeeId);
      if (!emp) {
        toast({ title: 'Employee not found', variant: 'destructive' });
        return;
      }
      setEmployee(emp);
      setIsAdminViewing(true);
      setVaultUnlocked(true);
      await Promise.all([loadEmployeeData(emp.id), loadCompany(emp.company_id)]);
      try {
        await db.entities.AuditLog.create({
          user_id: currentUser?.id,
          user_name: currentUser?.full_name || currentUser?.email || 'Unknown Admin',
          user_email: currentUser?.email,
          action_type: 'VIEW_EMPLOYEE_CENTER',
          entity_type: 'employees',
          entity_id: emp.id,
          entity_name: emp.full_name,
          notes: `Admin viewed Employee Center for ${emp.full_name} (#${emp.employee_number}) — read-only support access, no PIN entered.`,
        });
      } catch (e) {}
      toast({ title: `Viewing ${emp.full_name}'s Employee Center`, description: 'Admin View — read-only. This visit was logged.' });
    } finally {
      setLoggingIn(false);
    }
  };

  const handleKioskLogin = async () => {
    const info = await isTerminalLocked(terminalId);
    if (info.locked) {
      setLockInfo(info);
      toast({ title: 'Terminal locked', description: `Try again after ${info.lockedUntil.toLocaleTimeString()}.`, variant: 'destructive' });
      return;
    }
    setLoggingIn(true);
    try {
      const matches = await db.entities.employees.filter({ employee_number: kioskNumber.trim() });
      const candidate = matches[0];
      if (!candidate || !verifyPin(kioskPin, candidate.pin_encrypted)) {
        const { justLocked, session } = await recordFailedAttempt(terminalId);
        if (justLocked) {
          setLockInfo({ locked: true, lockedUntil: new Date(session.locked_until_timestamp) });
          toast({ title: 'Terminal locked for 5 minutes', description: 'Too many failed PIN attempts.', variant: 'destructive' });
        } else {
          toast({ title: 'Invalid employee number or PIN', variant: 'destructive' });
        }
        return;
      }
      await recordSuccessfulLogin(terminalId, candidate.id);
      setEmployee(candidate);
      setKioskNumber('');
      setKioskPin('');
      setVaultUnlocked(false);
      await Promise.all([loadEmployeeData(candidate.id), loadCompany(candidate.company_id)]);
      toast({ title: `Welcome, ${candidate.full_name}` });
    } finally {
      setLoggingIn(false);
    }
  };

  const handleKioskLogout = () => {
    setEmployee(null);
    setCompany(null);
    setPunches([]);
    setTimeOffRequests([]);
    setPayrollDocs([]);
    setExpenses([]);
    setVaultUnlocked(false);
    setSelectedProjectId('');
    setLaborCategory('');
    setIsAdminViewing(false);
    setAdminSelectedEmployeeId('');
  };

  // Kiosk Reset Action — a real kiosk-PIN session (isKioskSession) has no
  // office account underneath it to preserve, unlike the manual PIN-entry
  // path above (an office user testing/covering the terminal, who should
  // stay signed into their own account). A full db.auth.logout clears
  // the session entirely and hard-redirects to /login, which — since the
  // device's kiosk-mode localStorage flag is untouched — lands back on the
  // clean KioskKeypadLogin numeric dialer for the next worker.
  const handleFinishAndExitTerminal = () => {
    db.auth.logout('/login');
  };

  const sortedPunches = useMemo(() => [...punches].sort((a, b) => new Date(b.punch_time) - new Date(a.punch_time)), [punches]);
  const lastPunch = sortedPunches[0];
  const currentState = !lastPunch || lastPunch.punch_type === 'Clock_Out' ? 'OUT' : lastPunch.punch_type === 'Start_Break' ? 'ON_BREAK' : 'WORKING';

  const handlePunch = async (punchType) => {
    if (!employee || isAdminViewing) return;
    if (punchType === 'Clock_In' && (!selectedProjectId || !laborCategory)) {
      toast({ title: 'Select a project and labor category first', variant: 'destructive' });
      return;
    }
    const punch_time = new Date().toISOString();
    const isMobile = isMobileDevice();
    const coordinates = isMobile ? await captureLocationCoordinates() : null;
    const payload = {
      employee_id: employee.id,
      terminal_id: terminalId,
      punch_type: punchType,
      punch_time,
      project_id: punchType === 'Clock_In' ? selectedProjectId : (lastPunch?.project_id || ''),
      labor_activity_category: punchType === 'Clock_In' ? laborCategory : (lastPunch?.labor_activity_category || ''),
      total_regular_minutes: 0,
      total_overtime_minutes: 0,
      is_mobile_remote_punch: isMobile,
      punch_in_location_coordinates: punchType === 'Clock_In' ? coordinates : null,
      punch_out_location_coordinates: punchType === 'Clock_Out' ? coordinates : null,
    };
    if (punchType === 'Clock_Out') {
      const allEmployeePunches = await db.entities.attendance_punches.filter({ employee_id: employee.id }, '-created_date', 500);
      Object.assign(payload, computeOvertimeForClockOut(employee.id, punch_time, allEmployeePunches));
    }
    const created = await db.entities.attendance_punches.create(payload);
    setPunches((prev) => [created, ...prev]);
    toast({
      title: `${punchType.replace('_', ' ')} recorded`,
      description: isMobile ? (coordinates ? `Remote mobile punch — location captured` : 'Remote mobile punch — location unavailable') : undefined,
    });
  };

  const handleStartFabrication = async () => {
    if (isAdminViewing) return;
    if (!employee || !pieceMarkInput.trim() || !selectedProjectId) {
      toast({ title: 'Enter a piece mark and select a job first', variant: 'destructive' });
      return;
    }
    const created = await db.entities.piece_production_logs.create({
      company_id: employee.company_id,
      project_id: selectedProjectId,
      employee_id: employee.id,
      piece_mark: pieceMarkInput.trim(),
      material_profile_type: pieceProfileType,
      target_minutes: normalizeTargetMinutes(pieceTargetMinutes),
      start_time: new Date().toISOString(),
      status: 'In_Progress',
    });
    setActivePieceLog(created);
    toast({ title: `Fabrication started — ${pieceMarkInput.trim()}` });
  };

  const handleCompletePiece = async () => {
    if (!activePieceLog || isAdminViewing) return;
    const endTime = new Date();
    const elapsedMinutes = Math.max(0, Math.round((endTime - new Date(activePieceLog.start_time)) / 60000));
    await db.entities.piece_production_logs.update(activePieceLog.id, {
      end_time: endTime.toISOString(),
      elapsed_minutes: elapsedMinutes,
      status: 'Complete',
    });
    toast({ title: `Piece complete — ${activePieceLog.piece_mark}`, description: `${elapsedMinutes} min` });
    setActivePieceLog(null);
    setPieceMarkInput('');
    setPieceTargetMinutes('');
  };

  const estimatedPayFor = (punch) => {
    if (!rateScale || punch.punch_type !== 'Clock_Out') return null;
    const laborScale = resolveLaborScaleFromCategory(punch.labor_activity_category);
    const { totalGrossPayCents } = computeMultiScaleGrossPayCents({
      laborScale,
      regularMinutes: punch.total_regular_minutes,
      overtimeMinutes: punch.total_overtime_minutes,
      ...rateScale,
    });
    return (totalGrossPayCents / 100).toFixed(2);
  };

  const submitExpense = async () => {
    if (isAdminViewing) return;
    if (!expenseForm.expense_date || !expenseForm.amount) {
      toast({ title: 'Expense date and amount are required', variant: 'destructive' });
      return;
    }
    setSavingExpense(true);
    try {
      const created = await db.entities.credit_card_expenses.create({
        employee_id: employee.id,
        project_id: selectedProjectId || lastPunch?.project_id || '',
        merchant_name: expenseForm.merchant_name.trim(),
        expense_category: expenseForm.expense_category,
        amount_cents: Math.round((Number(expenseForm.amount) || 0) * 100),
        expense_date: expenseForm.expense_date,
        per_diem_allowance_cents: Math.round((Number(expenseForm.per_diem_allowance) || 0) * 100),
        is_out_of_town_travel: expenseForm.is_out_of_town_travel,
        status: 'Pending',
      });
      setExpenses((prev) => [created, ...prev]);
      setShowExpenseForm(false);
      setExpenseForm(emptyExpenseForm());
      toast({ title: 'Expense logged' });
    } finally {
      setSavingExpense(false);
    }
  };

  const submitLeaveRequest = async () => {
    if (isAdminViewing) return;
    if (!leaveForm.start_date || !leaveForm.end_date) {
      toast({ title: 'Start and end dates are required', variant: 'destructive' });
      return;
    }
    const created = await db.entities.time_off_requests.create({
      employee_id: employee.id,
      ...leaveForm,
      total_hours: Number(leaveForm.total_hours) || 0,
      status: 'Submitted',
    });
    setTimeOffRequests((prev) => [created, ...prev]);
    setAllPendingLeave((prev) => [created, ...prev]);
    setShowLeaveForm(false);
    setLeaveForm(emptyLeaveForm());
    toast({ title: 'Time off request submitted' });
  };

  // Approving here is deliberately non-invasive to the Master Shop Scheduler:
  // it doesn't inject fake shop_schedules rows (which would corrupt the
  // capacity heatmap's tonnage math) — ShopOperations.jsx instead queries
  // Approved time_off_requests live and annotates the week columns with them.
  const decideLeaveRequest = async (request, status, notes = '') => {
    if (isAdminViewing) return;
    const updated = await db.entities.time_off_requests.update(request.id, { status, supervisor_notes: notes });
    setAllPendingLeave((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    if (employee && request.employee_id === employee.id) {
      setTimeOffRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    }
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

  const requestInfoUpdate = async () => {
    if (isAdminViewing) return;
    try {
      await db.entities.Notification.create({
        title: 'Employee Info Update Request',
        message: `${employee.full_name} (#${employee.employee_number}) requested a profile info update.`,
        is_read: false,
      });
      toast({ title: 'Request sent to HR Admin' });
    } catch (e) {
      toast({ title: 'Unable to send request', variant: 'destructive' });
    }
  };

  const openVaultGate = () => {
    setVaultPin('');
    setShowVaultGate(true);
  };

  const submitVaultPin = () => {
    if (!verifyPin(vaultPin, employee.pin_encrypted)) {
      toast({ title: 'Incorrect PIN', variant: 'destructive' });
      return;
    }
    setVaultUnlocked(true);
    setShowVaultGate(false);
    setVaultPin('');
  };

  // 404 PDF Interceptor — this app has no backend to actually generate/host a
  // PDF at doc.file_secure_uri (seed data points it at a path that doesn't
  // exist), so "Download PDF" was a dead link. This computes the same
  // year-to-date hours a real paystub/W-2 would summarize, straight from
  // the punch ledger already loaded, and renders it inline instead.
  const ytdHoursForYear = (year) => {
    const minutes = punches
      .filter((p) => p.punch_type === 'Clock_Out' && new Date(p.punch_time).getFullYear() === year)
      .reduce((sum, p) => sum + (p.total_regular_minutes || 0) + (p.total_overtime_minutes || 0), 0);
    return (minutes / 60).toFixed(1);
  };

  const approvedLeaveHours = timeOffRequests.filter((r) => r.status === 'Approved').reduce((sum, r) => sum + (r.total_hours || 0), 0);
  // Out-of-town travel/per-diem tracking is a field-crew concept — gated to
  // companies whose pack includes Field Operations (Erector or Enterprise
  // Connect; see modulePacks.js), not to a literal plan-string comparison.
  const travelExpensePlanEnabled = hasModule(company, '/field-operations');

  const visibleTabValues = EMPLOYEE_CENTER_TABS
    .filter((t) => isCapabilityAllowed(employee?.permission_overrides, t.key))
    .map((t) => t.value);
  const isTabVisible = (value) => visibleTabValues.includes(value);
  const defaultTabValue = visibleTabValues[0] || 'kiosk';

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <PageHeader title="Employee Center" subtitle="Kiosk time clock, self-service profile, time off, and payroll document vault" />

      {!employee ? (
        <div className={`grid grid-cols-1 ${isAdminUser(currentUser) ? 'md:grid-cols-2' : ''} gap-4 max-w-3xl mx-auto`}>
          <div className="steel-card p-6 space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary" />Kiosk Login</h3>
            {lockInfo.locked ? (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 flex items-center gap-2">
                <Lock className="w-4 h-4" />Terminal locked until {lockInfo.lockedUntil?.toLocaleTimeString()}.
              </div>
            ) : (
              <>
                <div>
                  <Label className="text-xs">Employee Number</Label>
                  <Input value={kioskNumber} onChange={(e) => setKioskNumber(e.target.value)} placeholder="001" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">5-Digit PIN</Label>
                  <Input type="password" maxLength={5} value={kioskPin} onChange={(e) => setKioskPin(e.target.value.replace(/\D/g, ''))} placeholder="•••••" className="mt-1" onKeyDown={(e) => e.key === 'Enter' && handleKioskLogin()} />
                </div>
                <Button onClick={handleKioskLogin} disabled={loggingIn} className="w-full steel-gradient text-white border-0">Log In</Button>
              </>
            )}
          </div>

          {isAdminUser(currentUser) && (
            <div className="steel-card p-6 space-y-3 border-amber-500/30">
              <h3 className="font-semibold text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-600" />Admin: View Employee Center</h3>
              <p className="text-xs text-muted-foreground">
                For support and troubleshooting only. Opens a read-only view of the selected employee's
                Employee Center — no PIN required, and this access is logged.
              </p>
              <div>
                <Label className="text-xs">Employee</Label>
                <Select value={adminSelectedEmployeeId} onValueChange={setAdminSelectedEmployeeId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder={loadingAdminEmployees ? 'Loading…' : 'Select an employee'} /></SelectTrigger>
                  <SelectContent>
                    {adminEmployees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.full_name} — #{e.employee_number}{adminCompanies[e.company_id] ? ` • ${adminCompanies[e.company_id]}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleAdminViewEmployee}
                disabled={!adminSelectedEmployeeId || loggingIn}
                variant="outline"
                className="w-full border-amber-500/40 text-amber-700 hover:bg-amber-500/10"
              >
                <Eye className="w-4 h-4 mr-2" />View (Read-Only)
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          {isAdminViewing ? (
            <div className="steel-card p-3 flex items-center justify-between border-amber-500/40 bg-amber-500/10">
              <p className="text-sm font-medium flex items-center gap-2 text-amber-800 dark:text-amber-400">
                <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                ADMIN VIEW — READ ONLY: {employee.full_name} <span className="text-muted-foreground font-mono text-xs">#{employee.employee_number}</span>
              </p>
              <Button variant="outline" size="sm" onClick={handleKioskLogout} className="border-amber-500/40">
                <DoorOpen className="w-3.5 h-3.5 mr-1.5" />Exit Admin View
              </Button>
            </div>
          ) : (
            <div className="steel-card p-3 flex items-center justify-between">
              <p className="text-sm font-medium">{employee.full_name} <span className="text-muted-foreground font-mono text-xs">#{employee.employee_number}</span></p>
              <Button variant="outline" size="sm" onClick={handleKioskLogout}>Log Out</Button>
            </div>
          )}

          <Tabs defaultValue={defaultTabValue} onValueChange={(v) => { if (!isAdminViewing && v !== 'payroll') setVaultUnlocked(false); }}>
            <TabsList className="mb-4 max-w-full overflow-x-auto justify-start">
              {isTabVisible('kiosk') && <TabsTrigger value="kiosk">Time Clock Kiosk</TabsTrigger>}
              {isTabVisible('profile') && <TabsTrigger value="profile">My Profile</TabsTrigger>}
              {isTabVisible('timeoff') && <TabsTrigger value="timeoff">Time Off</TabsTrigger>}
              {isTabVisible('payroll') && <TabsTrigger value="payroll">Payroll</TabsTrigger>}
            </TabsList>

            <TabsContent value="kiosk" className="space-y-4">
              <div className="steel-card p-4 space-y-3 max-w-md">
                <h4 className="font-semibold text-sm">Cost-Coding Allocation (required to Clock In)</h4>
                <div>
                  <Label className="text-xs">Project</Label>
                  <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select a project" /></SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Labor Activity Category</Label>
                  <Select value={laborCategory} onValueChange={setLaborCategory}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select a category" /></SelectTrigger>
                    <SelectContent>
                      {LABOR_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="steel-card p-4 space-y-3 max-w-2xl">
                <h4 className="font-semibold text-sm flex items-center gap-2"><Timer className="w-4 h-4" />Log Piece Mark / Production Time</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">Piece Mark</Label>
                    <Input placeholder="e.g. B-12" value={pieceMarkInput} onChange={(e) => setPieceMarkInput(e.target.value)} disabled={!!activePieceLog} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Material Profile</Label>
                    <Select value={pieceProfileType} onValueChange={setPieceProfileType} disabled={!!activePieceLog}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MATERIAL_PROFILE_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Target Minutes</Label>
                    <Input type="number" min={0} placeholder="e.g. 45" value={pieceTargetMinutes} onChange={(e) => setPieceTargetMinutes(e.target.value)} disabled={!!activePieceLog} className="mt-1" />
                  </div>
                </div>
                {activePieceLog ? (
                  <Button size="lg" className="w-full h-14 bg-red-600 hover:bg-red-700 text-white border-0" disabled={isAdminViewing} onClick={handleCompletePiece}>
                    <Square className="w-5 h-5 mr-2" />Complete Piece — {activePieceLog.piece_mark}
                  </Button>
                ) : (
                  <Button size="lg" className="w-full h-14 bg-green-600 hover:bg-green-700 text-white border-0" disabled={isAdminViewing} onClick={handleStartFabrication}>
                    <Timer className="w-5 h-5 mr-2" />Start Fabrication
                  </Button>
                )}
              </div>

              {isMobileDevice() && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
                  <Smartphone className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  <span className="text-blue-700 dark:text-blue-400">Mobile device detected — punches here are tagged as remote and capture your location.</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl">
                <Button size="lg" className="h-24 sm:h-20 flex-col gap-1 bg-green-600 hover:bg-green-700 text-white border-0" disabled={isAdminViewing || currentState !== 'OUT'} onClick={() => handlePunch('Clock_In')}>
                  <LogIn className="w-6 h-6 sm:w-5 sm:h-5" />Clock In
                </Button>
                <Button size="lg" className="h-24 sm:h-20 flex-col gap-1 bg-red-600 hover:bg-red-700 text-white border-0" disabled={isAdminViewing || currentState !== 'WORKING'} onClick={() => handlePunch('Clock_Out')}>
                  <LogOut className="w-6 h-6 sm:w-5 sm:h-5" />Clock Out
                </Button>
                <Button size="lg" variant="outline" className="h-24 sm:h-20 flex-col gap-1" disabled={isAdminViewing || currentState !== 'WORKING'} onClick={() => handlePunch('Start_Break')}>
                  <Coffee className="w-6 h-6 sm:w-5 sm:h-5" />Start Break
                </Button>
                <Button size="lg" variant="outline" className="h-24 sm:h-20 flex-col gap-1" disabled={isAdminViewing || currentState !== 'ON_BREAK'} onClick={() => handlePunch('End_Break')}>
                  <Play className="w-6 h-6 sm:w-5 sm:h-5" />End Break
                </Button>
              </div>

              {isKioskSession && (
                <Button
                  size="lg"
                  onClick={handleFinishAndExitTerminal}
                  className="w-full max-w-2xl h-16 text-lg font-bold gap-3 bg-red-600 hover:bg-red-700 text-white border-0"
                >
                  <DoorOpen className="w-6 h-6" />COMPLETE PUNCH &amp; EXIT TERMINAL
                </Button>
              )}

              <div className="steel-card p-4">
                <h4 className="font-semibold text-sm mb-2">Recent Punches</h4>
                {sortedPunches.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No punches yet today.</p>
                ) : sortedPunches.slice(0, 10).map((p) => {
                  const estPay = estimatedPayFor(p);
                  return (
                    <div key={p.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 border-b border-border/50 py-2 text-sm">
                      <span className="flex items-center gap-1.5 flex-wrap">
                        {p.punch_type.replace('_', ' ')} {p.labor_activity_category ? `• ${p.labor_activity_category.replace('_', ' ')}` : ''}
                        {p.is_mobile_remote_punch && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 font-medium">
                            <Smartphone className="w-3 h-3" />Remote
                          </span>
                        )}
                        {(p.punch_in_location_coordinates || p.punch_out_location_coordinates) && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                            <MapPin className="w-3 h-3" />{p.punch_in_location_coordinates || p.punch_out_location_coordinates}
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {new Date(p.punch_time).toLocaleString()}{p.total_overtime_minutes > 0 ? ` • OT ${p.total_overtime_minutes}m` : ''}{estPay ? ` • ~$${estPay}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>

              {travelExpensePlanEnabled && (
                <div className="steel-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-sm flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" />Travel &amp; Per Diem (Out-of-Town Crews)</h4>
                    {!isAdminViewing && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowExpenseForm(true)}>
                        <Plus className="w-3.5 h-3.5" />Log Expense
                      </Button>
                    )}
                  </div>
                  {expenses.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No travel expenses on file.</p>
                  ) : expenses.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2 border-b border-border/50 py-2 text-sm">
                      <div>
                        <p className="font-medium">{e.expense_category.replace('_', ' ')}{e.merchant_name ? ` — ${e.merchant_name}` : ''}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.expense_date} • {e.status}
                          {e.is_out_of_town_travel && ' • Out-of-town'}
                          {e.per_diem_allowance_cents > 0 && ` • Per diem $${(e.per_diem_allowance_cents / 100).toFixed(2)}`}
                        </p>
                      </div>
                      <span className="font-mono text-sm flex-shrink-0">${((e.amount_cents || 0) / 100).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="profile" className="space-y-3">
              <div className="steel-card p-4 max-w-lg">
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><User className="w-4 h-4 text-primary" />Profile Overview</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Name</span><p className="font-medium">{employee.full_name}</p></div>
                  <div><span className="text-muted-foreground">Title</span><p className="font-medium">{employee.classification || '—'}</p></div>
                  <div><span className="text-muted-foreground">Department</span><p className="font-medium">{employee.department || 'Not on file'}</p></div>
                  <div><span className="text-muted-foreground">Hire Date</span><p className="font-medium">{employee.hire_date || '—'}</p></div>
                  <div><span className="text-muted-foreground">Emergency Contact</span><p className="font-medium">{employee.emergency_contact_name || 'Not on file'}</p></div>
                  <div><span className="text-muted-foreground">Emergency Phone</span><p className="font-medium">{employee.emergency_contact_phone || 'Not on file'}</p></div>
                </div>
                {!isAdminViewing && (
                  <Button variant="outline" className="gap-2 mt-4" onClick={requestInfoUpdate}>
                    <Send className="w-4 h-4" />Request Info Update
                  </Button>
                )}
              </div>
            </TabsContent>

            <TabsContent value="timeoff" className="space-y-4">
              <div className="steel-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-sm">My Time Off Requests</h4>
                  {!isAdminViewing && (
                    <Button size="sm" className="gap-2 steel-gradient text-white border-0" onClick={() => setShowLeaveForm(true)}>
                      <Plus className="w-4 h-4" />New Request
                    </Button>
                  )}
                </div>
                {timeOffRequests.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No time off requests yet.</p>
                ) : timeOffRequests.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border p-3 text-sm mb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{r.leave_type} — {r.start_date} to {r.end_date}</p>
                        <p className="text-xs text-muted-foreground">{r.total_hours}h • {r.reason}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${r.status === 'Approved' ? 'bg-green-500/10 text-green-600' : r.status === 'Rejected' ? 'bg-red-500/10 text-red-600' : 'bg-yellow-500/10 text-yellow-700'}`}>{r.status}</span>
                    </div>
                    {r.supervisor_notes && (
                      <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
                        <span className="font-medium">Supervisor comments:</span> {r.supervisor_notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {isHrReviewer && !isAdminViewing && (
                <div className="steel-card p-4">
                  <h4 className="font-semibold text-sm mb-3">HR Approval Queue (all employees)</h4>
                  {allPendingLeave.filter((r) => r.status === 'Submitted' || r.status === 'Pending').length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No pending requests.</p>
                  ) : allPendingLeave.filter((r) => r.status === 'Submitted' || r.status === 'Pending').map((r) => (
                    <div key={r.id} className="rounded-lg border border-border p-3 text-sm mb-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{r.employee_id} — {r.leave_type} ({r.start_date} to {r.end_date})</p>
                          <p className="text-xs text-muted-foreground">{r.total_hours}h • {r.reason}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700 text-white border-0" onClick={() => decideLeaveRequest(r, 'Approved')}><CheckCircle2 className="w-3.5 h-3.5" />Approve</Button>
                          <Button size="sm" variant="outline" className="gap-1 text-red-600 border-red-500/30" onClick={() => { setDecliningRequestId(r.id); setDeclineNote(''); }}><Ban className="w-3.5 h-3.5" />Reject</Button>
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
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="payroll" className="space-y-3">
              {!vaultUnlocked ? (
                <div className="steel-card p-8 max-w-sm mx-auto text-center space-y-3">
                  <ShieldAlert className="w-8 h-8 text-yellow-600 mx-auto" />
                  <p className="text-sm text-muted-foreground">Payroll documents are PIN-vaulted. Re-enter your PIN to view this tab.</p>
                  <Button onClick={() => openVaultGate()} className="steel-gradient text-white border-0">Unlock Vault</Button>
                </div>
              ) : (
                <div className="steel-card p-4">
                  <h4 className="font-semibold text-sm mb-1">Pay Stubs &amp; W-2s</h4>
                  <p className="text-xs text-muted-foreground mb-3">{approvedLeaveHours > 0 ? `${approvedLeaveHours}h of approved leave pending payout in the upcoming pay period.` : 'No approved leave hours pending payout.'}</p>
                  {payrollDocs.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No payroll documents on file.</p>
                  ) : payrollDocs.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm mb-2">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-primary" />
                        <div>
                          <p className="font-medium">{doc.document_type} — {doc.tax_year}</p>
                          <p className="text-xs text-muted-foreground">{doc.payout_date} • Gross ${((doc.gross_wages_cents || 0) / 100).toFixed(2)} • Net ${((doc.net_pay_cents || 0) / 100).toFixed(2)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {isPdfFileUri(doc.file_secure_uri) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPdfViewer({ source: doc.file_secure_uri, fileName: `${doc.document_type}-${doc.tax_year}.pdf` })}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1.5" />Open
                          </Button>
                        )}
                        <div className="text-right">
                          <p className="font-mono text-sm font-semibold">{ytdHoursForYear(doc.tax_year)}h</p>
                          <p className="text-[10px] text-muted-foreground">YTD {doc.tax_year} hours</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      <Dialog open={showLeaveForm} onOpenChange={setShowLeaveForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Time Off Request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Leave Type</Label>
              <Select value={leaveForm.leave_type} onValueChange={(v) => setLeaveForm((f) => ({ ...f, leave_type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={leaveForm.start_date} onChange={(e) => setLeaveForm((f) => ({ ...f, start_date: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>End Date</Label>
                <Input type="date" value={leaveForm.end_date} onChange={(e) => setLeaveForm((f) => ({ ...f, end_date: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Total Hours</Label>
              <Input type="number" value={leaveForm.total_hours} onChange={(e) => setLeaveForm((f) => ({ ...f, total_hours: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea value={leaveForm.reason} onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))} rows={2} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLeaveForm(false)}>Cancel</Button>
            <Button onClick={submitLeaveRequest} className="steel-gradient text-white border-0">Submit Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showVaultGate} onOpenChange={setShowVaultGate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Re-Enter Your PIN</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground flex items-center gap-2"><Lock className="w-4 h-4" />Payroll access requires re-authentication.</p>
            <Input type="password" maxLength={5} value={vaultPin} onChange={(e) => setVaultPin(e.target.value.replace(/\D/g, ''))} placeholder="•••••" onKeyDown={(e) => e.key === 'Enter' && submitVaultPin()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVaultGate(false)}>Cancel</Button>
            <Button onClick={submitVaultPin} className="steel-gradient text-white border-0">Unlock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showExpenseForm} onOpenChange={setShowExpenseForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Travel Expense</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Category</Label>
              <Select value={expenseForm.expense_category} onValueChange={(v) => setExpenseForm((f) => ({ ...f, expense_category: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace('_', ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Merchant</Label>
              <Input value={expenseForm.merchant_name} onChange={(e) => setExpenseForm((f) => ({ ...f, merchant_name: e.target.value }))} className="mt-1" placeholder="Hampton Inn" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount ($)</Label>
                <Input type="number" value={expenseForm.amount} onChange={(e) => setExpenseForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Expense Date</Label>
                <Input type="date" value={expenseForm.expense_date} onChange={(e) => setExpenseForm((f) => ({ ...f, expense_date: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Per Diem Allowance ($)</Label>
              <Input type="number" value={expenseForm.per_diem_allowance} onChange={(e) => setExpenseForm((f) => ({ ...f, per_diem_allowance: e.target.value }))} className="mt-1" placeholder="0.00" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={expenseForm.is_out_of_town_travel} onCheckedChange={(v) => setExpenseForm((f) => ({ ...f, is_out_of_town_travel: v }))} />
              <Label className="text-sm">Out-of-town travel</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExpenseForm(false)}>Cancel</Button>
            <Button onClick={submitExpense} disabled={savingExpense} className="steel-gradient text-white border-0">
              {savingExpense ? 'Saving…' : 'Log Expense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PdfViewerModal
        open={!!pdfViewer}
        onOpenChange={(o) => { if (!o) setPdfViewer(null); }}
        source={pdfViewer?.source}
        fileName={pdfViewer?.fileName}
      />
    </div>
  );
}
