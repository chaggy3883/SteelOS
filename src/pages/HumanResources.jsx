import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { listEmployeesForRole, hasFullEmployeeAccess, hireCandidate, reevaluateTimeclockLock, syncFormulaPin } from '@/lib/employeesApi';
import { verifyPin } from '@/lib/hrSecurity';
import { getExpiringCertifications } from '@/lib/certAlerts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import { UserPlus, Lock, Unlock, AlertTriangle, ShieldCheck, EyeOff } from 'lucide-react';

const POSITIONS = ['Ironworker', 'Welder', 'Fabricator', 'Painter', 'Shop Manager', 'Inspector', 'Office'];
const CANDIDATE_STATUSES = ['Applied', 'Interviewing', 'Offer_Extended', 'Hired', 'Rejected'];

const emptyCandidateForm = () => ({ candidate_name: '', email: '', phone: '', position_applied: 'Ironworker' });

export default function HumanResources() {
  const { toast } = useToast();
  const [roles, setRoles] = useState(['user']);
  const [candidates, setCandidates] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [certifications, setCertifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showCandidateForm, setShowCandidateForm] = useState(false);
  const [candidateForm, setCandidateForm] = useState(emptyCandidateForm());
  const [savingCandidate, setSavingCandidate] = useState(false);

  const [terminalEmployeeNumber, setTerminalEmployeeNumber] = useState('');
  const [terminalPin, setTerminalPin] = useState('');

  useEffect(() => { init(); }, []);

  const init = async () => {
    setLoading(true);
    let currentRoles = ['user'];
    try {
      const me = await base44.auth.me();
      currentRoles = me?.roles || me?.user?.roles || ['user'];
    } catch (e) {}
    setRoles(currentRoles);
    await loadAll(currentRoles);
    setLoading(false);
  };

  const loadAll = async (currentRoles) => {
    try {
      const [candidateData, employeeData, certData] = await Promise.all([
        base44.entities.candidate_profiles.list('-created_date', 100),
        listEmployeesForRole(currentRoles),
        base44.entities.employee_certifications.list('-created_date', 200),
      ]);
      setCandidates(candidateData);
      setEmployees(employeeData);
      setCertifications(certData);
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
      const created = await base44.entities.candidate_profiles.create({
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
    const updated = await base44.entities.candidate_profiles.update(candidate.id, { status });
    setCandidates((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const toggleCompliance = async (employee, field, value) => {
    const updated = await base44.entities.employees.update(employee.id, { [field]: value });
    const relocked = await reevaluateTimeclockLock(updated);
    setEmployees((prev) => prev.map((e) => (e.id === relocked.id ? relocked : e)));
    toast({ title: relocked.is_timeclock_locked ? 'Timeclock still locked' : 'Timeclock unlocked — both W-4 and I-9 approved' });
  };

  const updateSsnLast4 = async (employee, value) => {
    const ssn_last4 = value.replace(/\D/g, '').slice(0, 4);
    const updated = await base44.entities.employees.update(employee.id, { ssn_last4 });
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
      const matches = await base44.entities.employees.filter({ employee_number: terminalEmployeeNumber.trim() });
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

  const expiringCerts = getExpiringCertifications(certifications, 60);

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

      <Tabs defaultValue="ats">
        <TabsList className="mb-4">
          <TabsTrigger value="ats">Candidates (ATS)</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="safety">Safety Radar</TabsTrigger>
          <TabsTrigger value="terminal">Timeclock Terminal</TabsTrigger>
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
            <div key={candidate.id} className="steel-card p-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-semibold">{candidate.candidate_name}</p>
                <p className="text-xs text-muted-foreground">{candidate.position_applied} • {candidate.email}</p>
                {candidate.hired_employee_id && <p className="text-xs text-green-600 mt-0.5">Provisioned as employee record</p>}
              </div>
              <Select value={candidate.status} onValueChange={(v) => handleStatusChange(candidate, v)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CANDIDATE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="employees" className="space-y-3">
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
                      {isFullAccess && <th className="text-left py-3 px-4">Compliance</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr key={emp.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-primary">{emp.employee_number}</td>
                        <td className="py-3 px-4">{emp.full_name}</td>
                        <td className="py-3 px-4 text-muted-foreground">{emp.classification}</td>
                        {isFullAccess && (
                          <td className="py-3 px-4">
                            <Input defaultValue={emp.ssn_last4} onBlur={(e) => updateSsnLast4(emp, e.target.value)} placeholder="0000" className="h-7 w-20 text-xs font-mono" />
                          </td>
                        )}
                        {isFullAccess && <td className="py-3 px-4 text-right font-mono">${((emp.pay_rate_cents || 0) / 100).toFixed(2)}/hr</td>}
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${emp.is_timeclock_locked ? 'bg-red-500/10 text-red-600' : 'bg-green-500/10 text-green-600'}`}>
                            {emp.is_timeclock_locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                            {emp.is_timeclock_locked ? 'Locked' : 'Unlocked'}
                          </span>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="safety" className="space-y-3">
          <div className="steel-card p-4">
            <h4 className="font-semibold text-sm mb-1 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-yellow-600" />60-Day Certification Radar</h4>
            <p className="text-xs text-muted-foreground mb-3">Certifications expiring within 60 days, or already expired, surface here for HR Manager review.</p>
            {expiringCerts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No certifications are expiring soon.</p>
            ) : expiringCerts.map((cert) => {
              const employee = employees.find((e) => e.id === cert.employee_id);
              return (
                <div key={cert.id} className={`rounded-lg border p-3 text-sm mb-2 ${cert.status === 'Expired' ? 'border-red-500/40 bg-red-500/5' : 'border-yellow-500/40 bg-yellow-500/5'}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{employee?.full_name || cert.employee_id} — {cert.cert_type.replace(/_/g, ' ')}</p>
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
    </div>
  );
}
