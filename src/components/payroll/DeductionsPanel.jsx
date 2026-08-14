import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

const DEDUCTION_TYPES = ['benefits', 'garnishment', 'other'];
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);

const emptyForm = () => ({
  employee_id: '', deduction_type: 'benefits', amount_or_percent: '', is_percent: false,
  priority_order: '1', effective_date: new Date().toISOString().slice(0, 10), end_date: '',
});

export default function DeductionsPanel({ employees }) {
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await db.entities.Deduction.list('priority_order', 2000));
    } catch (e) {
      toast({ title: 'Unable to load deductions', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const employeeName = (id) => employees.find((e) => e.id === id)?.full_name || '—';
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => employeeName(a.employee_id).localeCompare(employeeName(b.employee_id)) || (a.priority_order || 0) - (b.priority_order || 0)),
    [rows, employees]
  );

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setShowForm(true); };
  const openEdit = (row) => {
    setEditId(row.id);
    setForm({
      employee_id: row.employee_id, deduction_type: row.deduction_type, amount_or_percent: String(row.amount_or_percent ?? ''),
      is_percent: !!row.is_percent, priority_order: String(row.priority_order ?? 1),
      effective_date: row.effective_date || new Date().toISOString().slice(0, 10), end_date: row.end_date || '',
    });
    setViewing(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    const amount = Number(form.amount_or_percent);
    if (!form.employee_id || !form.effective_date || !form.amount_or_percent || amount <= 0) {
      toast({ title: 'Employee, amount, and effective date are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        employee_id: form.employee_id,
        deduction_type: form.deduction_type,
        amount_or_percent: amount,
        is_percent: form.is_percent,
        priority_order: Number(form.priority_order) || 1,
        effective_date: form.effective_date,
        end_date: form.end_date || null,
      };
      if (editId) {
        await db.entities.Deduction.update(editId, payload);
        toast({ title: 'Deduction updated' });
      } else {
        await db.entities.Deduction.create(payload);
        toast({ title: 'Deduction added' });
      }
      setShowForm(false);
      setEditId(null);
      setForm(emptyForm());
      await load();
    } catch (e) {
      toast({ title: 'Unable to save deduction', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const isCurrentlyActive = (row) => !row.end_date || row.end_date >= new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="gap-2 steel-gradient text-white border-0" onClick={openAdd}><Plus className="w-4 h-4" />Add Deduction</Button>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-2 px-3">Employee</th>
                <th className="text-left py-2 px-3">Type</th>
                <th className="text-right py-2 px-3">Amount</th>
                <th className="text-right py-2 px-3">Priority</th>
                <th className="text-left py-2 px-3">Effective — End</th>
                <th className="text-left py-2 px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
              ) : sortedRows.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No deductions on file yet</td></tr>
              ) : sortedRows.map((r) => (
                <tr key={r.id} onClick={() => setViewing(r)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                  <td className="py-2 px-3 font-medium">{employeeName(r.employee_id)}</td>
                  <td className="py-2 px-3">{titleCase(r.deduction_type)}</td>
                  <td className="py-2 px-3 text-right font-mono">{r.is_percent ? `${r.amount_or_percent}%` : `$${Number(r.amount_or_percent).toFixed(2)}`}</td>
                  <td className="py-2 px-3 text-right font-mono">{r.priority_order}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.effective_date} — {r.end_date || 'present'}</td>
                  <td className="py-2 px-3">
                    <span className={isCurrentlyActive(r) ? 'text-green-600' : 'text-muted-foreground'}>{isCurrentlyActive(r) ? 'Active' : 'Ended'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{employeeName(viewing?.employee_id)} — {titleCase(viewing?.deduction_type)}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-1.5 text-sm">
              {[
                ['Amount', viewing.is_percent ? `${viewing.amount_or_percent}% of gross` : `$${Number(viewing.amount_or_percent).toFixed(2)} per period`],
                ['Priority Order', viewing.priority_order],
                ['Effective Date', viewing.effective_date],
                ['End Date', viewing.end_date || '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-border/50 py-1 last:border-0">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
            <Button onClick={() => openEdit(viewing)} className="steel-gradient text-white border-0">Edit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Add'} Deduction</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Employee</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm((f) => ({ ...f, employee_id: v }))} disabled={!!editId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select an employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Deduction Type</Label>
                <Select value={form.deduction_type} onValueChange={(v) => setForm((f) => ({ ...f, deduction_type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEDUCTION_TYPES.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Priority Order</Label>
                <Input type="number" value={form.priority_order} onChange={(e) => setForm((f) => ({ ...f, priority_order: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <Label className="text-xs">{form.is_percent ? 'Percent of Gross' : 'Amount ($/period)'}</Label>
                <Input type="number" step="0.01" value={form.amount_or_percent} onChange={(e) => setForm((f) => ({ ...f, amount_or_percent: e.target.value }))} className="mt-1" />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch checked={form.is_percent} onCheckedChange={(v) => setForm((f) => ({ ...f, is_percent: v }))} />
                <Label className="text-xs">Is Percent</Label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Effective Date</Label>
                <Input type="date" value={form.effective_date} onChange={(e) => setForm((f) => ({ ...f, effective_date: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">End Date (optional)</Label>
                <Input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className="mt-1" />
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
