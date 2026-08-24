import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/api/apiClient';
import { hasSalesmanRateAccess } from '@/lib/commissionAccess';
import { useAuth } from '@/lib/AuthContext';
import { ShieldCheck, Loader2, UserPlus, Edit2, History, X, Percent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';

const emptyForm = () => ({ new_rate: '', effective_date: new Date().toISOString().slice(0, 10), reason_for_change: '' });

export default function SalesmanRatesAdmin() {
  const { toast } = useToast();
  const { user } = useAuth();
  const roles = user?.roles || user?.user?.roles || ['user'];
  const canAccess = hasSalesmanRateAccess(roles);

  const [employees, setEmployees] = useState([]);
  const [rates, setRates] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [addSelection, setAddSelection] = useState('');

  const [editingEmployeeId, setEditingEmployeeId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const [historyEmployeeId, setHistoryEmployeeId] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [emp, rateRows, configs] = await Promise.all([
        db.entities.employees.list('full_name', 1000),
        db.entities.SalesmanCommissionRate.list('-effective_date', 2000),
        db.entities.SalesCommissionConfig.list('-created_date', 1),
      ]);
      setEmployees(emp);
      setRates(rateRows);
      setConfig(configs[0] || null);
    } catch (e) {
      toast({ title: 'Unable to load salesman rates', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const salesmen = useMemo(() => employees.filter((e) => e.is_salesman).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')), [employees]);
  const nonSalesmen = useMemo(() => employees.filter((e) => !e.is_salesman && e.is_active).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')), [employees]);

  const ratesByEmployee = useMemo(() => {
    const map = new Map();
    rates.forEach((r) => {
      if (!map.has(r.salesman_id)) map.set(r.salesman_id, []);
      map.get(r.salesman_id).push(r);
    });
    map.forEach((list) => list.sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || '')));
    return map;
  }, [rates]);

  const currentRateFor = (employeeId) => (ratesByEmployee.get(employeeId) || []).find((r) => !r.end_date) || null;

  const isFlatRate = config?.commission_calc_method === 'flat_rate';
  const formatRate = (rate) => (isFlatRate ? `$${Number(rate).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : `${Number(rate)}%`);

  const handleAddSalesman = async () => {
    if (!addSelection) return;
    try {
      await db.entities.employees.update(addSelection, { is_salesman: true });
      toast({ title: 'Added to sales roster' });
      setAddOpen(false);
      setAddSelection('');
      load();
    } catch (e) {
      toast({ title: 'Unable to add salesman', variant: 'destructive' });
    }
  };

  const handleRemoveSalesman = async (employee) => {
    if (!confirm(`Remove ${employee.full_name} from the sales roster? Their rate history is kept.`)) return;
    try {
      await db.entities.employees.update(employee.id, { is_salesman: false });
      toast({ title: 'Removed from sales roster' });
      load();
    } catch (e) {
      toast({ title: 'Unable to remove salesman', variant: 'destructive' });
    }
  };

  const openEdit = (employeeId) => {
    setEditingEmployeeId(employeeId);
    setForm(emptyForm());
  };
  const closeEdit = () => { setEditingEmployeeId(null); setForm(emptyForm()); };

  const handleSaveRate = async () => {
    const rateNum = Number(form.new_rate);
    if (!form.effective_date || Number.isNaN(rateNum) || rateNum < 0) {
      toast({ title: 'Effective date and a valid rate are required', variant: 'destructive' });
      return;
    }
    const current = currentRateFor(editingEmployeeId);
    if (current && form.effective_date <= current.effective_date) {
      toast({ title: "New rate must be effective after the current rate's effective date", variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      if (current) {
        await db.entities.SalesmanCommissionRate.update(current.id, { end_date: form.effective_date });
      }
      await db.entities.SalesmanCommissionRate.create({
        salesman_id: editingEmployeeId,
        rate: rateNum,
        effective_date: form.effective_date,
        reason_for_change: form.reason_for_change,
        created_by: user?.full_name || user?.email || 'Unknown',
      });
      await load();
      closeEdit();
      toast({ title: 'Commission rate updated' });
    } catch (e) {
      toast({ title: 'Unable to save commission rate', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const editingEmployee = employees.find((e) => e.id === editingEmployeeId) || null;
  const historyEmployee = employees.find((e) => e.id === historyEmployeeId) || null;
  const historyRows = historyEmployeeId ? (ratesByEmployee.get(historyEmployeeId) || []) : [];

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Access Restricted</h2>
        <p className="text-sm text-muted-foreground">Salesman rate management requires Admin, Payroll Admin, HR Admin, or Super Admin.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Salesman Commission Rates"
        subtitle={`Per-salesman override of the default commission rate${isFlatRate ? ' (flat $ per job)' : ''}. Rate changes are historical — nothing is ever overwritten.`}
        actions={<Button onClick={() => setAddOpen(true)} className="steel-gradient text-white border-0"><UserPlus className="w-4 h-4" />Add Salesman</Button>}
      />

      {config?.per_salesman_override === false && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 mb-4 text-sm text-amber-700">
          Per-salesman overrides are currently disabled in Commission Setup — every salesman uses the company default rate regardless of what's set here.
        </div>
      )}

      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Salesman</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Current Rate</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Effective Date</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {salesmen.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-10 text-muted-foreground">
                  <Percent className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No salesmen on file yet. Click "Add Salesman" to add one.
                </td>
              </tr>
            ) : salesmen.map((emp) => {
              const current = currentRateFor(emp.id);
              return (
                <tr key={emp.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{emp.full_name}</td>
                  <td className="px-4 py-3 font-mono">
                    <button type="button" onClick={() => setHistoryEmployeeId(emp.id)} className="hover:underline">
                      {current ? formatRate(current.rate) : 'Using default'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{current?.effective_date || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Rate history" onClick={() => setHistoryEmployeeId(emp.id)}><History className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit rate" onClick={() => openEdit(emp.id)}><Edit2 className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Remove from sales roster" onClick={() => handleRemoveSalesman(emp)}><X className="w-3.5 h-3.5 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Salesman */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setAddSelection(''); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Salesman</DialogTitle></DialogHeader>
          <div className="py-2">
            <Label>Employee</Label>
            <select
              value={addSelection}
              onChange={(e) => setAddSelection(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-input/40 px-2 py-1.5 text-sm"
            >
              <option value="">Select an employee…</option>
              {nonSalesmen.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddSalesman} disabled={!addSelection} className="steel-gradient text-white border-0">Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Rate */}
      <Dialog open={!!editingEmployeeId} onOpenChange={(o) => !o && closeEdit()}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Rate — {editingEmployee?.full_name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>{isFlatRate ? 'New Flat Rate ($)' : 'New Rate (%)'}</Label>
              <Input type="number" step="0.01" min="0" value={form.new_rate} onChange={(e) => setForm((f) => ({ ...f, new_rate: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Effective Date</Label>
              <Input type="date" value={form.effective_date} onChange={(e) => setForm((f) => ({ ...f, effective_date: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Reason for Change (optional)</Label>
              <Textarea rows={2} value={form.reason_for_change} onChange={(e) => setForm((f) => ({ ...f, reason_for_change: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEdit}>Cancel</Button>
            <Button onClick={handleSaveRate} disabled={saving} className="steel-gradient text-white border-0">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rate History */}
      <Dialog open={!!historyEmployeeId} onOpenChange={(o) => !o && setHistoryEmployeeId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rate History — {historyEmployee?.full_name}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2 max-h-96 overflow-y-auto">
            {historyRows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No rate history yet — using the company default.</p>
            ) : historyRows.map((r) => (
              <div key={r.id} className="border border-border rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{formatRate(r.rate)}</span>
                  {!r.end_date && <span className="text-[10px] uppercase tracking-wide text-green-600 border border-green-500/30 rounded px-1.5 py-0.5">Current</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Effective {r.effective_date}{r.end_date ? ` → ${r.end_date}` : ''}
                </p>
                {r.reason_for_change && <p className="text-xs mt-1">{r.reason_for_change}</p>}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
