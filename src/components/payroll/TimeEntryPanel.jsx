import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Plus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { computeTimeEntryHours } from '@/lib/payrollEngine';

const ENTRY_TYPES = ['regular', 'pto', 'holiday'];
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);

const emptyForm = () => ({
  employee_id: '', work_date: new Date().toISOString().slice(0, 10), clock_in: '', clock_out: '',
  project_id: '', phase_id: '', area_id: '', cost_code_id: '', entry_type: 'regular',
});

// Raw time capture feeding the weekly processing pipeline — distinct from
// attendance_punches (the shop-floor kiosk clock-in/out stream): TimeEntry
// carries the job-allocation dimensions (project/phase/area/cost_code) the
// payroll engine needs and attendance_punches doesn't model, at a
// per-day/per-shift grain rather than raw punch events.
export default function TimeEntryPanel({ employees, projects, costCodes, payPeriods = [] }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const identity = user?.full_name || user?.email || 'Unknown';
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [lockedPeriodIds, setLockedPeriodIds] = useState(new Set());
  const [punchNotes, setPunchNotes] = useState([]);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [te, lockedRuns, punches] = await Promise.all([
        db.entities.TimeEntry.list('-work_date', 3000),
        db.entities.PayrollRun.filter({ status: 'locked' }, '-run_date', 200),
        db.entities.attendance_punches.list('-punch_time', 1000),
      ]);
      setEntries(te);
      setLockedPeriodIds(new Set(lockedRuns.map((r) => r.pay_period_id)));
      setPunchNotes(punches.filter((p) => p.note));
    } catch (e) {
      toast({ title: 'Unable to load time entries', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Kiosk punch notes are informational for payroll_admin/admin unless the
  // employee added/edited one after the punch's own date fell into an
  // already-locked pay period (attendance_punches.note_added_after_cutoff) —
  // those need an explicit acknowledgment before they're considered reviewed.
  const handleApprovePunchNote = async (punch) => {
    try {
      const updated = await db.entities.attendance_punches.update(punch.id, {
        note_reviewed_by: identity,
        note_reviewed_at: new Date().toISOString(),
      });
      setPunchNotes((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast({ title: 'Punch note reviewed' });
    } catch (e) {
      toast({ title: 'Unable to save review', variant: 'destructive' });
    }
  };

  // A work_date inside a pay period whose PayrollRun is 'locked' can't take
  // new TimeEntry rows — the whole point of locking is that everything
  // feeding an already-paid run stays exactly what it was when it was paid.
  // Reopening the run (PayrollRunPanel) is the only way back to editable.
  const lockedPeriodForDate = (workDate) => payPeriods.find((p) => lockedPeriodIds.has(p.id) && workDate >= p.period_start && workDate <= p.period_end) || null;

  const employeeName = (id) => employees.find((e) => e.id === id)?.full_name || '—';
  const projectLabel = (id) => { const p = projects.find((pr) => pr.id === id); return p ? `${p.project_number} — ${p.name}` : '—'; };
  const costCodeName = (id) => costCodes.find((c) => c.id === id)?.code_name || '—';

  const filtered = useMemo(
    () => entries.filter((e) => employeeFilter === 'all' || e.employee_id === employeeFilter).sort((a, b) => (b.work_date || '').localeCompare(a.work_date || '')),
    [entries, employeeFilter]
  );

  const openAdd = () => { setForm(emptyForm()); setShowForm(true); };

  const handleSave = async () => {
    if (!form.employee_id || !form.work_date || !form.project_id || !form.cost_code_id) {
      toast({ title: 'Employee, date, project, and cost code are required', variant: 'destructive' });
      return;
    }
    const hours = computeTimeEntryHours(form.clock_in, form.clock_out);
    if (hours <= 0) {
      toast({ title: 'Clock out must be after clock in', variant: 'destructive' });
      return;
    }
    if (lockedPeriodForDate(form.work_date)) {
      toast({ title: 'Pay period is locked', description: 'This work date falls in a locked pay period — reopen the payroll run before adding time entries.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const created = await db.entities.TimeEntry.create({
        employee_id: form.employee_id,
        work_date: form.work_date,
        clock_in: form.clock_in,
        clock_out: form.clock_out,
        project_id: form.project_id,
        phase_id: form.phase_id.trim() || null,
        area_id: form.area_id.trim() || null,
        cost_code_id: form.cost_code_id,
        hours,
        entry_type: form.entry_type,
      });
      setEntries((prev) => [created, ...prev]);
      setShowForm(false);
      setForm(emptyForm());
      toast({ title: `${hours.toFixed(2)} hours logged for ${employeeName(form.employee_id)}` });
    } catch (e) {
      toast({ title: 'Unable to save time entry', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All Employees" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Employees</SelectItem>
            {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button className="gap-2 steel-gradient text-white border-0" onClick={openAdd}><Plus className="w-4 h-4" />Add Time Entry</Button>
      </div>

      {punchNotes.length > 0 && (
        <div className="steel-card p-4">
          <h4 className="font-semibold text-sm mb-2">Kiosk Punch Notes</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {[...punchNotes]
              .sort((a, b) => (a.note_added_after_cutoff && !a.note_reviewed_by ? -1 : 1) - (b.note_added_after_cutoff && !b.note_reviewed_by ? -1 : 1) || (b.punch_time || '').localeCompare(a.punch_time || ''))
              .slice(0, 30)
              .map((p) => {
                const needsReview = p.note_added_after_cutoff && !p.note_reviewed_by;
                return (
                  <div key={p.id} className="flex items-start justify-between gap-3 border-b border-border/50 pb-2 text-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium">{employeeName(p.employee_id)}</span>
                        <span className="text-xs text-muted-foreground">{new Date(p.punch_time).toLocaleString()} · {p.punch_type?.replace('_', ' ')}</span>
                        {needsReview && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 font-medium">
                            <AlertCircle className="w-3 h-3" />After cutoff — needs review
                          </span>
                        )}
                        {!needsReview && p.note_reviewed_by && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-700 font-medium">
                            <CheckCircle2 className="w-3 h-3" />Reviewed by {p.note_reviewed_by}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground italic mt-0.5 truncate">"{p.note}"</p>
                    </div>
                    {needsReview && (
                      <Button size="sm" variant="outline" className="h-7 text-xs flex-shrink-0" onClick={() => handleApprovePunchNote(p)}>Approve</Button>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-2 px-3">Employee</th>
                <th className="text-left py-2 px-3">Date</th>
                <th className="text-left py-2 px-3">Project</th>
                <th className="text-left py-2 px-3">Phase / Area</th>
                <th className="text-left py-2 px-3">Cost Code</th>
                <th className="text-right py-2 px-3">Hours</th>
                <th className="text-left py-2 px-3">Type</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No time entries yet</td></tr>
              ) : filtered.map((e) => (
                <tr key={e.id} className="border-b border-border/50">
                  <td className="py-2 px-3 font-medium">{employeeName(e.employee_id)}</td>
                  <td className="py-2 px-3 text-muted-foreground">{e.work_date}</td>
                  <td className="py-2 px-3 text-muted-foreground">{projectLabel(e.project_id)}</td>
                  <td className="py-2 px-3 text-muted-foreground text-xs">{[e.phase_id, e.area_id].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="py-2 px-3">{costCodeName(e.cost_code_id)}</td>
                  <td className="py-2 px-3 text-right font-mono">{Number(e.hours || 0).toFixed(2)}</td>
                  <td className="py-2 px-3">{titleCase(e.entry_type)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Time Entry</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Employee</Label>
                <Select value={form.employee_id} onValueChange={(v) => setForm((f) => ({ ...f, employee_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select an employee" /></SelectTrigger>
                  <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Work Date</Label>
                <Input type="date" value={form.work_date} onChange={(e) => setForm((f) => ({ ...f, work_date: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Clock In</Label><Input type="datetime-local" value={form.clock_in} onChange={(e) => setForm((f) => ({ ...f, clock_in: e.target.value }))} className="mt-1" /></div>
              <div><Label className="text-xs">Clock Out</Label><Input type="datetime-local" value={form.clock_out} onChange={(e) => setForm((f) => ({ ...f, clock_out: e.target.value }))} className="mt-1" /></div>
            </div>
            {form.clock_in && form.clock_out && (
              <p className="text-xs text-muted-foreground">{computeTimeEntryHours(form.clock_in, form.clock_out).toFixed(2)} hours</p>
            )}
            <div>
              <Label className="text-xs">Project</Label>
              <Select value={form.project_id} onValueChange={(v) => setForm((f) => ({ ...f, project_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a project" /></SelectTrigger>
                <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Phase (optional)</Label><Input value={form.phase_id} onChange={(e) => setForm((f) => ({ ...f, phase_id: e.target.value }))} placeholder="e.g. Fabrication" className="mt-1" /></div>
              <div><Label className="text-xs">Area (optional)</Label><Input value={form.area_id} onChange={(e) => setForm((f) => ({ ...f, area_id: e.target.value }))} placeholder="e.g. Area A" className="mt-1" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Cost Code</Label>
                <Select value={form.cost_code_id} onValueChange={(v) => setForm((f) => ({ ...f, cost_code_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select a cost code" /></SelectTrigger>
                  <SelectContent>{costCodes.map((c) => <SelectItem key={c.id} value={c.id}>{c.code_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Entry Type</Label>
                <Select value={form.entry_type} onValueChange={(v) => setForm((f) => ({ ...f, entry_type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{ENTRY_TYPES.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
