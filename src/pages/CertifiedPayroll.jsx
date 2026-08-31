import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import {
  FileCheck2, Plus, AlertTriangle, CheckCircle2, XCircle, ClipboardList, ShieldAlert, FileDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { normalizeRoleName, BUILTIN_ROLES } from '@/components/dashboard/rbacConfig';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { buildCertifiedPayrollReportRows } from '@/lib/certifiedPayrollReport';
import { generateWH347Pdf } from '@/lib/certifiedPayrollReportPdf';
import { resolveEmployerTaxRules } from '@/lib/payrollEngine';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

// Same payroll-adjacent audience already granted the /certified-payroll
// module in rbacConfig.jsx — this page previously relied entirely on the nav
// link being hidden (not real enforcement for a direct URL hit), which
// mattered less while it only tracked subcontractor submissions but is worth
// closing now that the Hancock Reports tab surfaces Hancock's own generated
// wage data. Self-validated against BUILTIN_ROLES, same pattern as
// PayrollProcessing.jsx.
const CERTIFIED_PAYROLL_ALLOWED_ROLES = ['admin', 'super_admin', 'payroll_admin', 'controller'];
const VALID_ROLE_NAMES = new Set(BUILTIN_ROLES.map((r) => r.name));
if (!CERTIFIED_PAYROLL_ALLOWED_ROLES.every((name) => VALID_ROLE_NAMES.has(name))) {
  throw new Error('CertifiedPayroll.jsx: CERTIFIED_PAYROLL_ALLOWED_ROLES references a role name not present in BUILTIN_ROLES.');
}

const SUBMISSION_STATUSES = ['pending', 'received', 'deficient', 'accepted', 'filed'];
const SUBMISSION_STATUS_STYLES = {
  pending: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  received: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  deficient: 'bg-red-500/10 text-red-500 border-red-500/20',
  accepted: 'bg-green-500/10 text-green-600 border-green-500/20',
  filed: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};
const ACTIVE_SC_STATUSES = ['executed', 'active'];
const ACTIVE_PROJECT_STATUSES = ['awarded', 'engineering', 'fabrication', 'erection'];

const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);
const todayStr = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

// One "week ending" every 7 days starting 6 days after the project kicks off
// — a generic WH-347 weekly cadence, not tied to any specific day-of-week
// convention. Stops at `throughDateStr` (normally today) so it only ever
// counts weeks that have actually elapsed.
function weekEndings(startDateStr, throughDateStr) {
  if (!startDateStr) return [];
  const start = new Date(`${startDateStr}T00:00:00`);
  const through = new Date(`${throughDateStr}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(through.getTime()) || start > through) return [];
  const dates = [];
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 6);
  while (cursor <= through) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 7);
  }
  return dates;
}

// A submission "covers" an expected week if its week_ending_date lands
// within 3 days of it — lenient on purpose so real-world submission dates
// (never exactly 7*n days from project start) still register as compliant.
function buildSubCompliance(project, subcontract, submissions) {
  const expectedWeeks = weekEndings(project.start_date, todayStr());
  const subSubmissions = submissions.filter((s) => s.project_id === project.id && (s.subcontract_id === subcontract.id || s.subcontractor_name === subcontract.subcontractor_name));
  const missingWeeks = expectedWeeks.filter((w) => !subSubmissions.some((s) => daysBetween(s.week_ending_date, w) <= 3));
  const receivedCount = expectedWeeks.length - missingWeeks.length;
  const complianceRate = expectedWeeks.length > 0 ? (receivedCount / expectedWeeks.length) * 100 : 100;
  return { expectedWeeks: expectedWeeks.length, receivedCount, complianceRate, missingWeeks };
}

const emptyForm = () => ({
  project_id: '', subcontract_id: '', subcontractor_name: '', week_ending_date: '', date_received: todayStr(), notes: '',
});

export default function CertifiedPayroll() {
  useDocumentTitle('SteelOS — Certified Payroll');
  const { toast } = useToast();
  const { user } = useAuth();
  const [accessChecked, setAccessChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [subcontracts, setSubcontracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const me = await db.auth.me();
        const roles = me?.roles || me?.user?.roles || ['user'];
        setAllowed(roles.some((r) => CERTIFIED_PAYROLL_ALLOWED_ROLES.includes(normalizeRoleName(r))));
      } catch (e) {
        setAllowed(false);
      } finally {
        setAccessChecked(true);
      }
    })();
  }, []);

  useEffect(() => {
    getEffectiveCompany()
      .then((company) => setModuleAllowed(hasModule(company, '/certified-payroll')))
      .catch(() => setModuleAllowed(false))
      .finally(() => setCheckingModuleAccess(false));
  }, []);

  useEffect(() => { if (accessChecked && allowed) loadData(); }, [accessChecked, allowed]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [subList, projList, scList] = await Promise.all([
        db.entities.CertifiedPayrollSubmission.list('-week_ending_date', 1000),
        db.entities.Project.filter({ is_archived: false }, 'name', 200),
        db.entities.Subcontract.list('-created_date', 500),
      ]);
      setSubmissions(subList);
      setProjects(projList);
      setSubcontracts(scList);
    } catch (e) {
      console.error('Failed to load certified payroll data', e);
    } finally {
      setLoading(false);
    }
  };

  const prevailingWageProjects = projects.filter((p) => p.is_prevailing_wage);
  const projectById = (id) => projects.find((p) => p.id === id);

  // ============ TAB 1 — Submissions ============
  const [projectFilter, setProjectFilter] = useState('all');
  const [subFilter, setSubFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [weekFrom, setWeekFrom] = useState('');
  const [weekTo, setWeekTo] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  const subcontractorNames = Array.from(new Set(subcontracts.map((s) => s.subcontractor_name))).sort();
  const formSubcontracts = subcontracts.filter((s) => !form.project_id || s.project_id === form.project_id);

  const filteredSubmissions = submissions.filter((s) => {
    if (projectFilter !== 'all' && s.project_id !== projectFilter) return false;
    if (subFilter !== 'all' && s.subcontractor_name !== subFilter) return false;
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (weekFrom && s.week_ending_date < weekFrom) return false;
    if (weekTo && s.week_ending_date > weekTo) return false;
    return true;
  });

  // Coverage stats span every active subcontract on every prevailing-wage
  // project — not just the projects/subs currently in view via the filter
  // bar above, so these cards read as a standing compliance posture.
  const coverageStats = (() => {
    let totalExpected = 0;
    let totalReceived = 0;
    let overdue = 0;
    prevailingWageProjects.forEach((project) => {
      const activeSubs = subcontracts.filter((s) => s.project_id === project.id && ACTIVE_SC_STATUSES.includes(s.status));
      activeSubs.forEach((sc) => {
        const { expectedWeeks, receivedCount, missingWeeks } = buildSubCompliance(project, sc, submissions);
        totalExpected += expectedWeeks;
        totalReceived += receivedCount;
        overdue += missingWeeks.filter((w) => daysBetween(w, todayStr()) > 7).length;
      });
    });
    const deficient = submissions.filter((s) => s.status === 'deficient').length;
    return { totalExpected, totalReceived, deficient, overdue };
  })();

  const handleCreate = async () => {
    if (!form.project_id || !form.subcontractor_name.trim() || !form.week_ending_date) {
      toast({ title: 'Project, subcontractor, and week ending date are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const seq = submissions.filter((s) => s.project_id === form.project_id && s.subcontractor_name === form.subcontractor_name.trim()).length + 1;
      const created = await db.entities.CertifiedPayrollSubmission.create({
        ...form,
        subcontractor_name: form.subcontractor_name.trim(),
        submission_number: seq,
        status: 'received',
      });
      setSubmissions((prev) => [created, ...prev]);
      toast({ title: 'Certified payroll submission recorded' });
      setNewOpen(false);
      setForm(emptyForm());
    } catch (e) {
      toast({ title: 'Unable to record submission', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const startEditing = () => {
    setEditForm({
      week_ending_date: selectedSubmission.week_ending_date || '',
      submission_number: selectedSubmission.submission_number || 1,
      date_received: selectedSubmission.date_received || '',
      status: selectedSubmission.status || 'pending',
      deficiency_notes: selectedSubmission.deficiency_notes || '',
      fringe_benefits_verified: selectedSubmission.fringe_benefits_verified || false,
      classifications_verified: selectedSubmission.classifications_verified || false,
      hours_verified: selectedSubmission.hours_verified || false,
      document_uri: selectedSubmission.document_uri || '',
      notes: selectedSubmission.notes || '',
    });
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedSubmission) return;
    setSavingEdit(true);
    try {
      const updated = await db.entities.CertifiedPayrollSubmission.update(selectedSubmission.id, editForm);
      setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setSelectedSubmission(updated);
      setEditing(false);
      toast({ title: 'Submission updated' });
    } catch (e) {
      toast({ title: 'Unable to save changes', variant: 'destructive' });
    } finally {
      setSavingEdit(false);
    }
  };

  // ============ TAB 2 — Compliance Dashboard ============
  const complianceProjects = prevailingWageProjects
    .filter((p) => ACTIVE_PROJECT_STATUSES.includes(p.status))
    .map((project) => {
      const activeSubs = subcontracts.filter((s) => s.project_id === project.id && ACTIVE_SC_STATUSES.includes(s.status));
      const subRows = activeSubs.map((sc) => ({ subcontract: sc, ...buildSubCompliance(project, sc, submissions) }));
      return { project, subRows };
    });

  const complianceTier = (rate) => (rate >= 90 ? 'green' : rate >= 75 ? 'yellow' : 'red');
  const COMPLIANCE_STYLES = {
    green: 'text-green-600',
    yellow: 'text-yellow-600',
    red: 'text-red-600',
  };

  // ============ TAB 3 — Hancock Reports ============
  const [lockedRuns, setLockedRuns] = useState([]);
  const [certifiedReports, setCertifiedReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportProjectId, setReportProjectId] = useState('');
  const [reportRunId, setReportRunId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState(null);

  useEffect(() => {
    if (!accessChecked || !allowed) return;
    (async () => {
      setReportsLoading(true);
      try {
        const [runs, reports] = await Promise.all([
          db.entities.PayrollRun.filter({ status: 'locked' }, '-run_date', 200),
          db.entities.CertifiedPayrollReport.list('-generated_at', 500),
        ]);
        setLockedRuns(runs);
        setCertifiedReports(reports);
      } catch (e) {
        console.error('Failed to load Hancock certified payroll reports', e);
      } finally {
        setReportsLoading(false);
      }
    })();
  }, [accessChecked, allowed]);

  const runsForReportProject = lockedRuns; // every locked run is a candidate; generation itself no-ops if the project had no labor on that run
  const reportProject = prevailingWageProjects.find((p) => p.id === reportProjectId) || null;

  const buildAndDownloadReport = async (project, run) => {
    const period = await db.entities.PayPeriod.get(run.pay_period_id);
    const [payrollLines, jobLaborAllocations, timeEntries, allEmployees, payRates, taxWithholdings, deductions, payrollRules] = await Promise.all([
      db.entities.PayrollLine.filter({ payroll_run_id: run.id }, '-created_date', 500),
      db.entities.JobLaborAllocation.filter({ payroll_run_id: run.id, project_id: project.id }, '-created_date', 2000),
      db.entities.TimeEntry.list('-work_date', 5000),
      db.entities.employees.list('full_name', 1000),
      db.entities.EmployeePayRate.list('-effective_date', 2000),
      db.entities.TaxWithholding.list('-effective_date', 2000),
      db.entities.Deduction.list('priority_order', 2000),
      db.entities.PayrollRule.list('-effective_date', 500),
    ]);
    const employerTaxRules = resolveEmployerTaxRules(payrollRules, { asOfDate: period.period_end });
    const rows = buildCertifiedPayrollReportRows({ project, period, payrollLines, jobLaborAllocations, timeEntries, employees: allEmployees, payRates, taxWithholdings, deductions, employerTaxRules });
    if (rows.length === 0) {
      toast({ title: 'No labor found', description: 'This project has no allocated hours on the selected payroll run.', variant: 'destructive' });
      return null;
    }
    const company = await getEffectiveCompany().catch(() => null);
    generateWH347Pdf({ project, period, run, company, rows });
    return period;
  };

  const handleGenerateReport = async () => {
    const run = lockedRuns.find((r) => r.id === reportRunId);
    if (!reportProject || !run) return;
    setGenerating(true);
    try {
      const period = await buildAndDownloadReport(reportProject, run);
      if (!period) return;
      const identity = user?.full_name || user?.email || 'Unknown';
      const created = await db.entities.CertifiedPayrollReport.create({
        project_id: reportProject.id, payroll_run_id: run.id, week_ending: period.period_end,
        generated_at: new Date().toISOString(), generated_by: identity,
      });
      setCertifiedReports((prev) => [created, ...prev]);
      toast({ title: 'Certified payroll report generated' });
    } catch (e) {
      toast({ title: 'Unable to generate report', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerateReport = async (report) => {
    setRegeneratingId(report.id);
    try {
      const [project, run] = await Promise.all([
        db.entities.Project.get(report.project_id),
        db.entities.PayrollRun.get(report.payroll_run_id),
      ]);
      if (run.status !== 'locked') {
        toast({ title: 'Payroll run is no longer locked', description: 'It was reopened — the source data may have changed since this report was generated.', variant: 'destructive' });
      }
      await buildAndDownloadReport(project, run);
    } catch (e) {
      toast({ title: 'Unable to regenerate report', variant: 'destructive' });
    } finally {
      setRegeneratingId(null);
    }
  };

  if (!accessChecked || checkingModuleAccess) {
    return <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>;
  }

  // Route guard — a direct URL to /certified-payroll can't bypass the nav's
  // module-pack filtering. Strictly earlier/coarser than the role-based
  // check below.
  const isPlatformOperatorView = isSuperAdmin(user) && !isImpersonating();
  if (!(moduleAllowed || isPlatformOperatorView)) {
    return <ModuleLocked modulePath="/certified-payroll" title="Certified Payroll Not Included" />;
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="steel-card p-8 text-center max-w-md mx-auto mt-12">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">Access Restricted</h2>
          <p className="text-sm text-muted-foreground">Certified payroll is only available to Admin, Payroll Admin, Controller, and Super Admin roles.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Certified Payroll"
        subtitle="Prevailing wage compliance — WH-347 submissions from erection subcontractors, plus Hancock's own certified payroll reports"
        icon={FileCheck2}
      />

      <Tabs defaultValue="submissions">
        <TabsList className="mb-4">
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          <TabsTrigger value="compliance">Compliance Dashboard</TabsTrigger>
          <TabsTrigger value="reports">Hancock Reports</TabsTrigger>
        </TabsList>

        {/* ============ TAB 1 ============ */}
        <TabsContent value="submissions">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Expected', value: coverageStats.totalExpected, icon: ClipboardList, color: 'text-blue-500' },
              { label: 'Received', value: coverageStats.totalReceived, icon: CheckCircle2, color: 'text-green-500' },
              { label: 'Deficient', value: coverageStats.deficient, icon: AlertTriangle, color: 'text-red-500' },
              { label: 'Overdue', value: coverageStats.overdue, icon: XCircle, color: 'text-orange-500' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="steel-card p-4">
                <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div className="flex gap-3 flex-wrap items-end">
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="w-56"><SelectValue placeholder="All Prevailing Wage Projects" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Prevailing Wage Projects</SelectItem>
                  {prevailingWageProjects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={subFilter} onValueChange={setSubFilter}>
                <SelectTrigger className="w-48"><SelectValue placeholder="All Subcontractors" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Subcontractors</SelectItem>
                  {subcontractorNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {SUBMISSION_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}
                </SelectContent>
              </Select>
              <div>
                <Label className="text-xs">Week From</Label>
                <Input type="date" value={weekFrom} onChange={(e) => setWeekFrom(e.target.value)} className="mt-1 w-40" />
              </div>
              <div>
                <Label className="text-xs">Week To</Label>
                <Input type="date" value={weekTo} onChange={(e) => setWeekTo(e.target.value)} className="mt-1 w-40" />
              </div>
            </div>

            <Dialog open={newOpen} onOpenChange={setNewOpen}>
              <DialogTrigger asChild>
                <Button className="steel-gradient text-white border-0"><Plus className="w-4 h-4 mr-2" />Record Submission</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Certified Payroll Submission</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <Label>Project *</Label>
                    <Select value={form.project_id} onValueChange={(v) => setForm((f) => ({ ...f, project_id: v, subcontract_id: '', subcontractor_name: '' }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select a prevailing wage project" /></SelectTrigger>
                      <SelectContent>{prevailingWageProjects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Subcontract</Label>
                    <Select value={form.subcontract_id} onValueChange={(v) => { const sc = subcontracts.find((s) => s.id === v); setForm((f) => ({ ...f, subcontract_id: v, subcontractor_name: sc?.subcontractor_name || f.subcontractor_name })); }} disabled={!form.project_id}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select a subcontract" /></SelectTrigger>
                      <SelectContent>{formSubcontracts.map((s) => <SelectItem key={s.id} value={s.id}>{s.subcontract_number} — {s.subcontractor_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Subcontractor Name *</Label><Input value={form.subcontractor_name} onChange={(e) => setForm((f) => ({ ...f, subcontractor_name: e.target.value }))} className="mt-1" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Week Ending Date *</Label><Input type="date" value={form.week_ending_date} onChange={(e) => setForm((f) => ({ ...f, week_ending_date: e.target.value }))} className="mt-1" /></div>
                    <div><Label>Date Received</Label><Input type="date" value={form.date_received} onChange={(e) => setForm((f) => ({ ...f, date_received: e.target.value }))} className="mt-1" /></div>
                  </div>
                  <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1" rows={2} /></div>
                  <Button onClick={handleCreate} disabled={saving || !form.project_id || !form.subcontractor_name.trim() || !form.week_ending_date} className="w-full steel-gradient text-white border-0">
                    {saving ? 'Recording...' : 'Record Submission'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="steel-card overflow-x-auto">
            <table className="w-full text-sm min-w-[1000px]">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-2 px-3">Project</th>
                  <th className="text-left py-2 px-3">Sub Name</th>
                  <th className="text-left py-2 px-3">Week Ending</th>
                  <th className="text-left py-2 px-3">Submission #</th>
                  <th className="text-left py-2 px-3">Received Date</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-center py-2 px-3">Fringe</th>
                  <th className="text-center py-2 px-3">Class.</th>
                  <th className="text-center py-2 px-3">Hours</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubmissions.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-sm text-muted-foreground">No certified payroll submissions found</td></tr>
                ) : filteredSubmissions.map((s) => {
                  const proj = projectById(s.project_id);
                  return (
                    <tr key={s.id} onClick={() => { setSelectedSubmission(s); setEditing(false); }} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                      <td className="py-2 px-3 text-muted-foreground">{proj ? `${proj.project_number} — ${proj.name}` : '—'}</td>
                      <td className="py-2 px-3 font-medium">{s.subcontractor_name}</td>
                      <td className="py-2 px-3 text-xs">{s.week_ending_date}</td>
                      <td className="py-2 px-3">#{s.submission_number}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{s.date_received || '—'}</td>
                      <td className="py-2 px-3"><span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${SUBMISSION_STATUS_STYLES[s.status] || SUBMISSION_STATUS_STYLES.pending}`}>{titleCase(s.status)}</span></td>
                      <td className="py-2 px-3 text-center">{s.fringe_benefits_verified ? <CheckCircle2 className="w-4 h-4 text-green-500 inline" /> : <XCircle className="w-4 h-4 text-muted-foreground inline" />}</td>
                      <td className="py-2 px-3 text-center">{s.classifications_verified ? <CheckCircle2 className="w-4 h-4 text-green-500 inline" /> : <XCircle className="w-4 h-4 text-muted-foreground inline" />}</td>
                      <td className="py-2 px-3 text-center">{s.hours_verified ? <CheckCircle2 className="w-4 h-4 text-green-500 inline" /> : <XCircle className="w-4 h-4 text-muted-foreground inline" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ============ TAB 2 ============ */}
        <TabsContent value="compliance">
          {complianceProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">No active prevailing wage projects.</p>
          ) : (
            <div className="space-y-4">
              {complianceProjects.map(({ project, subRows }) => (
                <div key={project.id} className="steel-card p-4">
                  <h3 className="font-semibold text-sm mb-3">{project.project_number} — {project.name}</h3>
                  {subRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">No active subcontracts on this project.</p>
                  ) : (
                    <div className="space-y-3">
                      {subRows.map(({ subcontract, expectedWeeks, receivedCount, complianceRate, missingWeeks }) => {
                        const tier = complianceTier(complianceRate);
                        return (
                          <div key={subcontract.id} className="border border-border rounded-lg p-3">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div>
                                <p className="font-medium text-sm">{subcontract.subcontractor_name}</p>
                                <p className="text-xs text-muted-foreground">{receivedCount} / {expectedWeeks} weeks received since project start</p>
                              </div>
                              <span className={`text-lg font-bold ${COMPLIANCE_STYLES[tier]}`}>{complianceRate.toFixed(0)}%</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-2">
                              <div
                                className={`h-full rounded-full ${tier === 'green' ? 'bg-green-500' : tier === 'yellow' ? 'bg-yellow-500' : 'bg-red-500'}`}
                                style={{ width: `${Math.min(100, complianceRate)}%` }}
                              />
                            </div>
                            {missingWeeks.filter((w) => daysBetween(w, todayStr()) > 7).length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {missingWeeks.filter((w) => daysBetween(w, todayStr()) > 7).map((w) => (
                                  <span key={w} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/10 text-red-600 border border-red-500/20">
                                    <AlertTriangle className="w-3 h-3" />MISSING — Week of {w}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ============ TAB 3 — Hancock Reports ============ */}
        <TabsContent value="reports">
          <div className="steel-card p-4 mb-4 space-y-3">
            <p className="text-sm text-muted-foreground">Generate a WH-347-style certified payroll report for Hancock's own employees from a <strong>locked</strong> payroll run — only available once the source run is locked, so the report always matches what was actually paid.</p>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <Label className="text-xs">Prevailing Wage Project</Label>
                <Select value={reportProjectId} onValueChange={setReportProjectId}>
                  <SelectTrigger className="mt-1 w-64"><SelectValue placeholder="Select a project" /></SelectTrigger>
                  <SelectContent>{prevailingWageProjects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Locked Payroll Run</Label>
                <Select value={reportRunId} onValueChange={setReportRunId}>
                  <SelectTrigger className="mt-1 w-56"><SelectValue placeholder="Select a locked run" /></SelectTrigger>
                  <SelectContent>
                    {runsForReportProject.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">No locked payroll runs yet</div>
                    ) : runsForReportProject.map((r) => <SelectItem key={r.id} value={r.id}>{r.run_date} (locked)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button className="gap-2 steel-gradient text-white border-0" disabled={!reportProjectId || !reportRunId || generating} onClick={handleGenerateReport}>
                <FileDown className="w-4 h-4" />{generating ? 'Generating…' : 'Generate Report'}
              </Button>
            </div>
          </div>

          <div className="steel-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-2 px-3">Project</th>
                  <th className="text-left py-2 px-3">Week Ending</th>
                  <th className="text-left py-2 px-3">Generated At</th>
                  <th className="text-left py-2 px-3">Generated By</th>
                  <th className="text-right py-2 px-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reportsLoading ? (
                  <tr><td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
                ) : certifiedReports.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No Hancock certified payroll reports generated yet</td></tr>
                ) : certifiedReports.map((r) => {
                  const proj = projectById(r.project_id);
                  return (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-2 px-3 text-muted-foreground">{proj ? `${proj.project_number} — ${proj.name}` : r.project_id}</td>
                      <td className="py-2 px-3">{r.week_ending}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{r.generated_at?.slice(0, 10)}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{r.generated_by}</td>
                      <td className="py-2 px-3 text-right">
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={regeneratingId === r.id} onClick={() => handleRegenerateReport(r)}>
                          <FileDown className="w-3 h-3" />{regeneratingId === r.id ? 'Regenerating…' : 'Regenerate PDF'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* ============ Detail dialog ============ */}
      <Dialog open={!!selectedSubmission} onOpenChange={(o) => { if (!o) { setSelectedSubmission(null); setEditing(false); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {selectedSubmission && !editing && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span>{selectedSubmission.subcontractor_name}</span>
                  <span className="text-sm text-muted-foreground font-normal">Submission #{selectedSubmission.submission_number}</span>
                </DialogTitle>
              </DialogHeader>
              <StatusBadge status={selectedSubmission.status} label={titleCase(selectedSubmission.status)} />
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Project', value: projectById(selectedSubmission.project_id) ? `${projectById(selectedSubmission.project_id).project_number} — ${projectById(selectedSubmission.project_id).name}` : '—' },
                  { label: 'Week Ending', value: selectedSubmission.week_ending_date || '—' },
                  { label: 'Date Received', value: selectedSubmission.date_received || '—' },
                  { label: 'Fringe Benefits Verified', value: selectedSubmission.fringe_benefits_verified ? 'Yes' : 'No' },
                  { label: 'Classifications Verified', value: selectedSubmission.classifications_verified ? 'Yes' : 'No' },
                  { label: 'Hours Verified', value: selectedSubmission.hours_verified ? 'Yes' : 'No' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium">{value}</p>
                  </div>
                ))}
              </div>
              {selectedSubmission.status === 'deficient' && (
                <div>
                  <p className="text-xs text-muted-foreground">Deficiency Notes</p>
                  <p className="text-sm mt-1 whitespace-pre-wrap text-red-600">{selectedSubmission.deficiency_notes || 'No details recorded'}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">{selectedSubmission.notes || 'No notes'}</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setSelectedSubmission(null)}>Close</Button>
                <Button onClick={startEditing} className="steel-gradient text-white border-0">Edit</Button>
              </div>
            </>
          )}

          {selectedSubmission && editing && (
            <>
              <DialogHeader><DialogTitle className="text-sm font-normal text-muted-foreground">Edit Submission — {selectedSubmission.subcontractor_name}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Status</Label>
                    <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{SUBMISSION_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Submission #</Label><Input type="number" min={1} value={editForm.submission_number} onChange={(e) => setEditForm((f) => ({ ...f, submission_number: Number(e.target.value) || 1 }))} className="mt-1" /></div>
                  <div><Label>Week Ending Date</Label><Input type="date" value={editForm.week_ending_date} onChange={(e) => setEditForm((f) => ({ ...f, week_ending_date: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Date Received</Label><Input type="date" value={editForm.date_received} onChange={(e) => setEditForm((f) => ({ ...f, date_received: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Document URI</Label><Input value={editForm.document_uri} onChange={(e) => setEditForm((f) => ({ ...f, document_uri: e.target.value }))} className="mt-1" placeholder="Link to scanned WH-347" /></div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <Label className="text-xs">Fringe ✓</Label>
                    <Switch checked={editForm.fringe_benefits_verified} onCheckedChange={(c) => setEditForm((f) => ({ ...f, fringe_benefits_verified: c }))} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <Label className="text-xs">Class. ✓</Label>
                    <Switch checked={editForm.classifications_verified} onCheckedChange={(c) => setEditForm((f) => ({ ...f, classifications_verified: c }))} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <Label className="text-xs">Hours ✓</Label>
                    <Switch checked={editForm.hours_verified} onCheckedChange={(c) => setEditForm((f) => ({ ...f, hours_verified: c }))} />
                  </div>
                </div>

                {editForm.status === 'deficient' && (
                  <div><Label>Deficiency Notes</Label><Textarea value={editForm.deficiency_notes} onChange={(e) => setEditForm((f) => ({ ...f, deficiency_notes: e.target.value }))} className="mt-1" rows={2} placeholder="What's missing or wrong?" /></div>
                )}
                <div><Label>Notes</Label><Textarea value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1" rows={2} /></div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button onClick={handleSaveEdit} disabled={savingEdit} className="steel-gradient text-white border-0">
                    {savingEdit ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
