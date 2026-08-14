import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Plus, History, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { cn } from '@/lib/utils';

const emptyForm = () => ({ pay_type: 'hourly', rate: '', effective_date: new Date().toISOString().slice(0, 10), overtime_eligible: true });
const money = (rate, payType) => (payType === 'salary' ? `$${Number(rate).toLocaleString()}/yr` : `$${Number(rate).toFixed(2)}/hr`);

// Pay rates are append-only history, never an overwrite: a rate change
// end-dates the current open row (end_date blank == active) and creates a
// new one. Nothing here ever mutates a past EmployeePayRate row's rate,
// pay_type, or effective_date.
export default function PayRatesPanel({ employees }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingEmployeeId, setViewingEmployeeId] = useState(null);
  const [showNewRateForm, setShowNewRateForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadRates(); }, []);

  const loadRates = async () => {
    setLoading(true);
    try {
      const list = await db.entities.EmployeePayRate.list('-effective_date', 2000);
      setRates(list);
    } catch (e) {
      toast({ title: 'Unable to load pay rates', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const ratesByEmployee = useMemo(() => {
    const map = new Map();
    rates.forEach((r) => {
      if (!map.has(r.employee_id)) map.set(r.employee_id, []);
      map.get(r.employee_id).push(r);
    });
    map.forEach((list) => list.sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || '')));
    return map;
  }, [rates]);

  const currentRateFor = (employeeId) => (ratesByEmployee.get(employeeId) || []).find((r) => !r.end_date) || null;

  const activeEmployees = useMemo(() => [...employees].filter((e) => e.is_active).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')), [employees]);
  const missingPayRate = activeEmployees.filter((e) => !currentRateFor(e.id));

  const viewingEmployee = employees.find((e) => e.id === viewingEmployeeId) || null;
  const viewingHistory = viewingEmployeeId ? (ratesByEmployee.get(viewingEmployeeId) || []) : [];

  const openHistory = (employeeId) => { setViewingEmployeeId(employeeId); setShowNewRateForm(false); setForm(emptyForm()); };

  const handleAddRate = async () => {
    if (!viewingEmployeeId) return;
    const rateNum = Number(form.rate);
    if (!form.effective_date || !rateNum || rateNum <= 0) {
      toast({ title: 'Effective date and a positive rate are required', variant: 'destructive' });
      return;
    }
    const current = currentRateFor(viewingEmployeeId);
    if (current && form.effective_date <= current.effective_date) {
      toast({ title: 'New rate must be effective after the current rate’s effective date', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (current) {
        await db.entities.EmployeePayRate.update(current.id, { end_date: form.effective_date });
      }
      await db.entities.EmployeePayRate.create({
        employee_id: viewingEmployeeId,
        pay_type: form.pay_type,
        rate: rateNum,
        effective_date: form.effective_date,
        overtime_eligible: form.overtime_eligible,
        created_by: user?.full_name || user?.email || 'Unknown',
      });
      await loadRates();
      setShowNewRateForm(false);
      setForm(emptyForm());
      toast({ title: `New rate on file for ${viewingEmployee?.full_name}` });
    } catch (e) {
      toast({ title: 'Unable to save pay rate', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {missingPayRate.length > 0 && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-600 mb-2">
            <AlertTriangle className="w-4 h-4" />{missingPayRate.length} active employee{missingPayRate.length === 1 ? '' : 's'} missing a pay rate
          </div>
          <div className="flex flex-wrap gap-2">
            {missingPayRate.map((e) => (
              <button key={e.id} type="button" onClick={() => openHistory(e.id)} className="text-xs px-2 py-1 rounded-full bg-red-500/10 text-red-600 hover:bg-red-500/20">
                {e.full_name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-2 px-3">Employee</th>
                <th className="text-left py-2 px-3">Pay Type</th>
                <th className="text-right py-2 px-3">Current Rate</th>
                <th className="text-left py-2 px-3">Effective</th>
                <th className="text-left py-2 px-3">OT Eligible</th>
                <th className="text-right py-2 px-3">History</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
              ) : activeEmployees.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No active employees</td></tr>
              ) : activeEmployees.map((e) => {
                const rate = currentRateFor(e.id);
                const history = ratesByEmployee.get(e.id) || [];
                return (
                  <tr key={e.id} onClick={() => openHistory(e.id)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                    <td className="py-2 px-3 font-medium">{e.full_name}</td>
                    <td className="py-2 px-3">{rate ? (rate.pay_type === 'salary' ? 'Salary' : 'Hourly') : '—'}</td>
                    <td className="py-2 px-3 text-right font-mono">
                      {rate ? money(rate.rate, rate.pay_type) : <span className="text-red-600 font-medium">Missing</span>}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">{rate?.effective_date || '—'}</td>
                    <td className="py-2 px-3 text-muted-foreground">{rate ? (rate.overtime_eligible ? 'Yes' : 'No') : '—'}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><History className="w-3.5 h-3.5" />{history.length}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!viewingEmployeeId} onOpenChange={(o) => !o && setViewingEmployeeId(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{viewingEmployee?.full_name} — Pay Rate History</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            {viewingHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No pay rate on file yet.</p>
            ) : viewingHistory.map((r) => (
              <div key={r.id} className={cn('rounded-lg border p-2 text-sm', !r.end_date ? 'border-primary/40 bg-primary/5' : 'border-border')}>
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold">{money(r.rate, r.pay_type)}</span>
                  {!r.end_date && <span className="text-xs text-primary font-medium">Current</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.effective_date} — {r.end_date || 'present'} · {r.overtime_eligible ? 'OT eligible' : 'Not OT eligible'}{r.created_by ? ` · set by ${r.created_by}` : ''}
                </p>
              </div>
            ))}
          </div>

          {showNewRateForm ? (
            <div className="rounded-lg border border-border p-3 space-y-3 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Pay Type</Label>
                  <Select value={form.pay_type} onValueChange={(v) => setForm((f) => ({ ...f, pay_type: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="salary">Salary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">{form.pay_type === 'salary' ? 'Annual Salary ($)' : 'Hourly Rate ($)'}</Label>
                  <Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Effective Date</Label>
                  <Input type="date" value={form.effective_date} onChange={(e) => setForm((f) => ({ ...f, effective_date: e.target.value }))} className="mt-1" />
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <Switch checked={form.overtime_eligible} onCheckedChange={(v) => setForm((f) => ({ ...f, overtime_eligible: v }))} />
                  <Label className="text-xs">Overtime Eligible</Label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowNewRateForm(false)}>Cancel</Button>
                <Button onClick={handleAddRate} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Save New Rate'}</Button>
              </div>
            </div>
          ) : (
            <Button className="w-full gap-2 mt-2 steel-gradient text-white border-0" onClick={() => setShowNewRateForm(true)}>
              <Plus className="w-4 h-4" />Record Rate Change
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
