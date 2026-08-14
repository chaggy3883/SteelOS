import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

const JURISDICTIONS = ['federal', 'state', 'local'];
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);

const emptyForm = () => ({ employee_id: '', jurisdiction: 'federal', filing_status: '', allowances_or_credits: '0', additional_withholding: '0', effective_date: new Date().toISOString().slice(0, 10) });

// An employee normally carries one active row per jurisdiction level at once
// (federal + state, sometimes + local) — these are layers, not a single
// choice, so this is a plain list rather than a "current value" picker.
export default function TaxWithholdingPanel({ employees }) {
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
      setRows(await db.entities.TaxWithholding.list('-effective_date', 2000));
    } catch (e) {
      toast({ title: 'Unable to load tax withholding records', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const employeeName = (id) => employees.find((e) => e.id === id)?.full_name || '—';
  const sortedRows = useMemo(() => [...rows].sort((a, b) => employeeName(a.employee_id).localeCompare(employeeName(b.employee_id)) || a.jurisdiction.localeCompare(b.jurisdiction)), [rows, employees]);

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setShowForm(true); };
  const openEdit = (row) => {
    setEditId(row.id);
    setForm({
      employee_id: row.employee_id, jurisdiction: row.jurisdiction, filing_status: row.filing_status || '',
      allowances_or_credits: String(row.allowances_or_credits ?? 0), additional_withholding: String(row.additional_withholding ?? 0),
      effective_date: row.effective_date || new Date().toISOString().slice(0, 10),
    });
    setViewing(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.employee_id || !form.effective_date) {
      toast({ title: 'Employee and effective date are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        employee_id: form.employee_id,
        jurisdiction: form.jurisdiction,
        filing_status: form.filing_status.trim(),
        allowances_or_credits: Number(form.allowances_or_credits) || 0,
        additional_withholding: Number(form.additional_withholding) || 0,
        effective_date: form.effective_date,
      };
      if (editId) {
        await db.entities.TaxWithholding.update(editId, payload);
        toast({ title: 'Tax withholding updated' });
      } else {
        await db.entities.TaxWithholding.create(payload);
        toast({ title: 'Tax withholding added' });
      }
      setShowForm(false);
      setEditId(null);
      setForm(emptyForm());
      await load();
    } catch (e) {
      toast({ title: 'Unable to save tax withholding', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="gap-2 steel-gradient text-white border-0" onClick={openAdd}><Plus className="w-4 h-4" />Add Withholding</Button>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-2 px-3">Employee</th>
                <th className="text-left py-2 px-3">Jurisdiction</th>
                <th className="text-left py-2 px-3">Filing Status</th>
                <th className="text-right py-2 px-3">Allowances/Credits</th>
                <th className="text-right py-2 px-3">Additional W/H</th>
                <th className="text-left py-2 px-3">Effective</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
              ) : sortedRows.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No tax withholding records yet</td></tr>
              ) : sortedRows.map((r) => (
                <tr key={r.id} onClick={() => setViewing(r)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                  <td className="py-2 px-3 font-medium">{employeeName(r.employee_id)}</td>
                  <td className="py-2 px-3">{titleCase(r.jurisdiction)}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.filing_status || '—'}</td>
                  <td className="py-2 px-3 text-right font-mono">{r.allowances_or_credits ?? 0}</td>
                  <td className="py-2 px-3 text-right font-mono">${Number(r.additional_withholding || 0).toFixed(2)}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.effective_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{employeeName(viewing?.employee_id)} — {titleCase(viewing?.jurisdiction)} Withholding</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-1.5 text-sm">
              {[
                ['Filing Status', viewing.filing_status || '—'],
                ['Allowances / Credits', viewing.allowances_or_credits ?? 0],
                ['Additional Withholding', `$${Number(viewing.additional_withholding || 0).toFixed(2)}`],
                ['Effective Date', viewing.effective_date],
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
          <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Add'} Tax Withholding</DialogTitle></DialogHeader>
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
                <Label className="text-xs">Jurisdiction</Label>
                <Select value={form.jurisdiction} onValueChange={(v) => setForm((f) => ({ ...f, jurisdiction: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JURISDICTIONS.map((j) => <SelectItem key={j} value={j}>{titleCase(j)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Effective Date</Label>
                <Input type="date" value={form.effective_date} onChange={(e) => setForm((f) => ({ ...f, effective_date: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Filing Status</Label>
              <Input value={form.filing_status} onChange={(e) => setForm((f) => ({ ...f, filing_status: e.target.value }))} placeholder="e.g. single, married_filing_jointly" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Allowances / Credits</Label>
                <Input type="number" value={form.allowances_or_credits} onChange={(e) => setForm((f) => ({ ...f, allowances_or_credits: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Additional Withholding ($/period)</Label>
                <Input type="number" step="0.01" value={form.additional_withholding} onChange={(e) => setForm((f) => ({ ...f, additional_withholding: e.target.value }))} className="mt-1" />
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
