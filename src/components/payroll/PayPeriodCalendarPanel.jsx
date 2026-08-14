import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Plus, CalendarRange } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

const FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);

const STATUS_STYLES = {
  open: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  processing: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  locked: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  exported: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  posted: 'bg-green-500/10 text-green-600 border-green-500/20',
};

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (dateStr, days) => { const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() + days); return iso(d); };
const lastDayOfMonth = (dateStr) => { const d = new Date(`${dateStr}T00:00:00`); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
const firstOfNextMonth = (dateStr) => { const d = new Date(`${dateStr}T00:00:00`); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 1)); };

// Advances one period forward given a frequency, starting from `start`.
// Returns { end, nextStart }. Semimonthly splits each month at the 15th.
function computeNextPeriod(start, frequency) {
  if (frequency === 'weekly') return { end: addDays(start, 6), nextStart: addDays(start, 7) };
  if (frequency === 'biweekly') return { end: addDays(start, 13), nextStart: addDays(start, 14) };
  if (frequency === 'monthly') return { end: lastDayOfMonth(start), nextStart: firstOfNextMonth(start) };
  // semimonthly
  const day = Number(start.slice(8, 10));
  if (day <= 15) {
    const end = `${start.slice(0, 8)}15`;
    return { end, nextStart: addDays(end, 1) };
  }
  const end = lastDayOfMonth(start);
  return { end, nextStart: firstOfNextMonth(start) };
}

const emptySingleForm = () => ({ period_start: '', period_end: '', pay_date: '', frequency: 'biweekly', workweek_start_day: 'Monday' });
const emptyBulkForm = () => ({ start_date: '', frequency: 'biweekly', workweek_start_day: 'Monday', count: '4', pay_date_offset_days: '5' });

// Setup-side calendar: defines the pay period schedule in advance.
// Processing a period (generating a register, locking, exporting, posting to
// job cost) stays exclusively in Payroll.jsx — this panel never duplicates
// those actions, only the master-data shape (dates + workweek_start_day).
export default function PayPeriodCalendarPanel() {
  const { toast } = useToast();
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSingleForm, setShowSingleForm] = useState(false);
  const [singleForm, setSingleForm] = useState(emptySingleForm());
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [bulkForm, setBulkForm] = useState(emptyBulkForm());
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      setPeriods(await db.entities.PayPeriod.list('-period_start', 500));
    } catch (e) {
      toast({ title: 'Unable to load pay periods', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const sortedPeriods = useMemo(() => [...periods].sort((a, b) => (b.period_start || '').localeCompare(a.period_start || '')), [periods]);

  const handleCreateSingle = async () => {
    if (!singleForm.period_start || !singleForm.period_end) {
      toast({ title: 'Start and end dates are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const created = await db.entities.PayPeriod.create({ ...singleForm, status: 'open' });
      setPeriods((prev) => [created, ...prev]);
      setShowSingleForm(false);
      setSingleForm(emptySingleForm());
      toast({ title: 'Pay period added to the calendar' });
    } catch (e) {
      toast({ title: 'Unable to add pay period', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleBulkGenerate = async () => {
    const count = Number(bulkForm.count);
    if (!bulkForm.start_date || !count || count <= 0) {
      toast({ title: 'A start date and a positive number of periods are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const offset = Number(bulkForm.pay_date_offset_days) || 0;
      let cursor = bulkForm.start_date;
      const payloads = [];
      for (let i = 0; i < count; i++) {
        const { end, nextStart } = computeNextPeriod(cursor, bulkForm.frequency);
        payloads.push({
          period_start: cursor,
          period_end: end,
          pay_date: addDays(end, offset),
          frequency: bulkForm.frequency,
          workweek_start_day: bulkForm.workweek_start_day,
          status: 'open',
        });
        cursor = nextStart;
      }
      const created = await db.entities.PayPeriod.bulkCreate(payloads);
      setPeriods((prev) => [...created, ...prev]);
      setShowBulkForm(false);
      setBulkForm(emptyBulkForm());
      toast({ title: `${created.length} pay periods generated` });
    } catch (e) {
      toast({ title: 'Unable to generate pay periods', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" className="gap-2" onClick={() => setShowBulkForm(true)}><CalendarRange className="w-4 h-4" />Generate Periods</Button>
        <Button className="gap-2 steel-gradient text-white border-0" onClick={() => setShowSingleForm(true)}><Plus className="w-4 h-4" />Add Pay Period</Button>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-2 px-3">Period</th>
                <th className="text-left py-2 px-3">Pay Date</th>
                <th className="text-left py-2 px-3">Frequency</th>
                <th className="text-left py-2 px-3">Workweek Starts</th>
                <th className="text-left py-2 px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
              ) : sortedPeriods.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No pay periods on the calendar yet</td></tr>
              ) : sortedPeriods.map((p) => (
                <tr key={p.id} onClick={() => setViewing(p)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                  <td className="py-2 px-3 font-medium">{p.period_start} — {p.period_end}</td>
                  <td className="py-2 px-3 text-muted-foreground">{p.pay_date || '—'}</td>
                  <td className="py-2 px-3">{titleCase(p.frequency)}</td>
                  <td className="py-2 px-3 text-muted-foreground">{p.workweek_start_day || 'Monday'}</td>
                  <td className="py-2 px-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[p.status] || STATUS_STYLES.open}`}>{titleCase(p.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{viewing?.period_start} — {viewing?.period_end}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-1.5 text-sm">
              {[
                ['Pay Date', viewing.pay_date || '—'],
                ['Frequency', titleCase(viewing.frequency)],
                ['Workweek Starts', viewing.workweek_start_day || 'Monday'],
                ['Status', titleCase(viewing.status)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-border/50 py-1 last:border-0">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-2">Generating the register, locking, exporting, and job cost posting for this period happen in the Payroll module, not here.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSingleForm} onOpenChange={setShowSingleForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Pay Period</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Period Start</Label><Input type="date" value={singleForm.period_start} onChange={(e) => setSingleForm((f) => ({ ...f, period_start: e.target.value }))} className="mt-1" /></div>
              <div><Label className="text-xs">Period End</Label><Input type="date" value={singleForm.period_end} onChange={(e) => setSingleForm((f) => ({ ...f, period_end: e.target.value }))} className="mt-1" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Pay Date</Label><Input type="date" value={singleForm.pay_date} onChange={(e) => setSingleForm((f) => ({ ...f, pay_date: e.target.value }))} className="mt-1" /></div>
              <div>
                <Label className="text-xs">Frequency</Label>
                <Select value={singleForm.frequency} onValueChange={(v) => setSingleForm((f) => ({ ...f, frequency: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{titleCase(f)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Workweek Start Day</Label>
              <Select value={singleForm.workweek_start_day} onValueChange={(v) => setSingleForm((f) => ({ ...f, workweek_start_day: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{WEEKDAYS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSingleForm(false)}>Cancel</Button>
            <Button onClick={handleCreateSingle} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBulkForm} onOpenChange={setShowBulkForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Generate Pay Periods</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">First Period Start</Label><Input type="date" value={bulkForm.start_date} onChange={(e) => setBulkForm((f) => ({ ...f, start_date: e.target.value }))} className="mt-1" /></div>
              <div>
                <Label className="text-xs">Frequency</Label>
                <Select value={bulkForm.frequency} onValueChange={(v) => setBulkForm((f) => ({ ...f, frequency: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{titleCase(f)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Number of Periods</Label><Input type="number" value={bulkForm.count} onChange={(e) => setBulkForm((f) => ({ ...f, count: e.target.value }))} className="mt-1" /></div>
              <div><Label className="text-xs">Pay Date (days after period end)</Label><Input type="number" value={bulkForm.pay_date_offset_days} onChange={(e) => setBulkForm((f) => ({ ...f, pay_date_offset_days: e.target.value }))} className="mt-1" /></div>
            </div>
            <div>
              <Label className="text-xs">Workweek Start Day</Label>
              <Select value={bulkForm.workweek_start_day} onValueChange={(v) => setBulkForm((f) => ({ ...f, workweek_start_day: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{WEEKDAYS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">Semimonthly periods split each month at the 15th; weekly/biweekly/monthly roll forward from the first period start.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkForm(false)}>Cancel</Button>
            <Button onClick={handleBulkGenerate} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Generating…' : 'Generate'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
