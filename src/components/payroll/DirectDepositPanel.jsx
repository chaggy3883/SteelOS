import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { Plus, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { obscureSecret } from '@/lib/hrSecurity';

const ACCOUNT_TYPES = ['checking', 'savings'];
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);

const emptyForm = () => ({
  employee_id: '', account_holder_name: '', routing_number: '', account_number: '', account_type: 'checking',
});

// HR-owned setup: creating/replacing an employee's direct deposit account
// here is what employees.direct_deposit_enabled + this record actually gate
// — see the standing rule that the bank account is strictly HR-verified and
// never a self-service edit (EmployeeCenter.jsx only shows the masked
// last-4 and offers a "Request Change" notification, same pattern as its
// existing requestInfoUpdate flow).
export default function DirectDepositPanel({ employees }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const identity = user?.full_name || user?.email || 'Unknown';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [showAccountNumber, setShowAccountNumber] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await db.entities.EmployeeBankAccount.list('-created_date', 2000));
    } catch (e) {
      toast({ title: 'Unable to load direct deposit accounts', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const employeeName = (id) => employees.find((e) => e.id === id)?.full_name || '—';
  const employee = (id) => employees.find((e) => e.id === id);
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => employeeName(a.employee_id).localeCompare(employeeName(b.employee_id))),
    [rows, employees]
  );

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setShowAccountNumber(false); setShowForm(true); };
  const openEdit = (row) => {
    setEditId(row.id);
    setForm({
      employee_id: row.employee_id, account_holder_name: row.account_holder_name || '',
      routing_number: row.routing_number || '', account_number: '', account_type: row.account_type || 'checking',
    });
    setShowAccountNumber(false);
    setViewing(null);
    setShowForm(true);
  };

  const editingRow = editId ? rows.find((r) => r.id === editId) : null;

  const handleSave = async () => {
    if (!form.employee_id || !form.account_holder_name.trim() || !form.routing_number.trim() || (!editId && !form.account_number.trim())) {
      toast({ title: 'Employee, account holder name, routing number, and account number are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        employee_id: form.employee_id,
        account_holder_name: form.account_holder_name.trim(),
        routing_number: form.routing_number.trim(),
        account_type: form.account_type,
        is_primary: true,
        status: 'active',
        verified_by: identity,
        verified_date: new Date().toISOString(),
      };
      if (form.account_number.trim()) {
        payload.account_number_last4 = form.account_number.trim().slice(-4);
        payload.account_number_encrypted = obscureSecret(form.account_number.trim());
      }

      // Only one active primary account per employee — replacing an account
      // deactivates the old one rather than deleting it, so AchOutgoing
      // history (destination_bank_account_id) always still resolves.
      const otherActiveForEmployee = rows.filter((r) => r.employee_id === form.employee_id && r.id !== editId && r.status === 'active');
      await Promise.all(otherActiveForEmployee.map((r) => db.entities.EmployeeBankAccount.update(r.id, { status: 'inactive', is_primary: false })));

      if (editId) {
        await db.entities.EmployeeBankAccount.update(editId, payload);
        toast({ title: 'Direct deposit account updated' });
      } else {
        await db.entities.EmployeeBankAccount.create(payload);
        toast({ title: 'Direct deposit account added' });
      }
      await db.entities.employees.update(form.employee_id, { direct_deposit_enabled: true });

      setShowForm(false);
      setEditId(null);
      setForm(emptyForm());
      await load();
    } catch (e) {
      toast({ title: 'Unable to save direct deposit account', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDirectDeposit = async (row, enabled) => {
    try {
      await db.entities.employees.update(row.employee_id, { direct_deposit_enabled: enabled });
      toast({ title: enabled ? 'Direct deposit enabled' : 'Direct deposit disabled — this employee will receive a paper check' });
    } catch (e) {
      toast({ title: 'Unable to update direct deposit status', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="gap-2 steel-gradient text-white border-0" onClick={openAdd}><Plus className="w-4 h-4" />Add Direct Deposit Account</Button>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-2 px-3">Employee</th>
                <th className="text-left py-2 px-3">Account Holder</th>
                <th className="text-left py-2 px-3">Type</th>
                <th className="text-left py-2 px-3">Account</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-center py-2 px-3">Direct Deposit</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
              ) : sortedRows.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No direct deposit accounts on file yet</td></tr>
              ) : sortedRows.map((r) => {
                const emp = employee(r.employee_id);
                return (
                  <tr key={r.id} onClick={() => setViewing(r)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                    <td className="py-2 px-3 font-medium">{employeeName(r.employee_id)}</td>
                    <td className="py-2 px-3">{r.account_holder_name}</td>
                    <td className="py-2 px-3">{titleCase(r.account_type)}</td>
                    <td className="py-2 px-3 font-mono text-xs">****{r.account_number_last4 || '----'}</td>
                    <td className="py-2 px-3">
                      <span className={r.status === 'active' ? 'text-green-600' : 'text-muted-foreground'}>{titleCase(r.status)}</span>
                    </td>
                    <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <Switch checked={!!emp?.direct_deposit_enabled} onCheckedChange={(v) => handleToggleDirectDeposit(r, v)} disabled={r.status !== 'active'} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{employeeName(viewing?.employee_id)} — Direct Deposit</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-1.5 text-sm">
              {[
                ['Account Holder', viewing.account_holder_name],
                ['Account Type', titleCase(viewing.account_type)],
                ['Account Number', `****${viewing.account_number_last4 || '----'}`],
                ['Routing Number', viewing.routing_number],
                ['Status', titleCase(viewing.status)],
                ['Verified By', viewing.verified_by || '—'],
                ['Verified Date', viewing.verified_date ? new Date(viewing.verified_date).toLocaleString() : '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-border/50 py-1 last:border-0">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-2 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" />HR-verified accounts only — replacing an account requires re-verification.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
            <Button onClick={() => openEdit(viewing)} className="steel-gradient text-white border-0">Replace Account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? 'Replace' : 'Add'} Direct Deposit Account</DialogTitle></DialogHeader>
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
            <div>
              <Label className="text-xs">Account Holder Name</Label>
              <Input value={form.account_holder_name} onChange={(e) => setForm((f) => ({ ...f, account_holder_name: e.target.value }))} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Routing Number</Label>
                <Input value={form.routing_number} onChange={(e) => setForm((f) => ({ ...f, routing_number: e.target.value.replace(/\D/g, '') }))} className="mt-1" maxLength={9} />
              </div>
              <div>
                <Label className="text-xs">Account Type</Label>
                <Select value={form.account_type} onValueChange={(v) => setForm((f) => ({ ...f, account_type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">{editId ? 'New Account Number (leave blank to keep current)' : 'Account Number'}</Label>
              <div className="relative mt-1">
                <Input
                  type={showAccountNumber ? 'text' : 'password'}
                  placeholder={editId && editingRow ? `Currently ending ${editingRow.account_number_last4 || '----'}` : ''}
                  value={form.account_number}
                  onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value.replace(/\D/g, '') }))}
                  className="pr-9"
                />
                <button type="button" onClick={() => setShowAccountNumber((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showAccountNumber ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Saving marks this account HR-verified under your name and enables direct deposit for this employee.</p>
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
