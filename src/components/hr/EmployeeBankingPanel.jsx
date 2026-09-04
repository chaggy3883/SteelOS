import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { hasFullEmployeeAccess } from '@/lib/employeesApi';
import { obscureSecret } from '@/lib/hrSecurity';
import { Landmark, Plus, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

const ACCOUNT_TYPES = ['checking', 'savings'];
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);

const emptyForm = (holderName) => ({ account_holder_name: holderName || '', routing_number: '', account_number: '', account_type: 'checking' });

// Per-employee entry point into the same EmployeeBankAccount records
// DirectDepositPanel.jsx (Payroll Setup > Direct Deposit) manages — this is
// not a parallel banking field set, just a second, employee-scoped place for
// HR to reach the same data while already on that employee's profile. Same
// HR-verified-only contract: no self-service edit exists here either.
export default function EmployeeBankingPanel({ employee, roles = [], onUpdated }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const identity = user?.full_name || user?.email || 'Unknown';
  const canEdit = hasFullEmployeeAccess(roles);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm(employee.full_name));
  const [saving, setSaving] = useState(false);
  const [showAccountNumber, setShowAccountNumber] = useState(false);
  const [viewingDetail, setViewingDetail] = useState(false);

  useEffect(() => { load(); }, [employee?.id]);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await db.entities.EmployeeBankAccount.filter({ employee_id: employee.id }, '-created_date', 50));
    } catch (e) {
      toast({ title: 'Unable to load banking information', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const activeAccount = rows.find((r) => r.status === 'active' && r.is_primary) || rows.find((r) => r.status === 'active') || null;

  const openReplace = () => {
    setForm(emptyForm(activeAccount?.account_holder_name || employee.full_name));
    setShowAccountNumber(false);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.account_holder_name.trim() || !form.routing_number.trim() || !form.account_number.trim()) {
      toast({ title: 'Account holder name, routing number, and account number are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const otherActive = rows.filter((r) => r.status === 'active');
      await Promise.all(otherActive.map((r) => db.entities.EmployeeBankAccount.update(r.id, { status: 'inactive', is_primary: false })));

      await db.entities.EmployeeBankAccount.create({
        employee_id: employee.id,
        account_holder_name: form.account_holder_name.trim(),
        routing_number: form.routing_number.trim(),
        account_number_last4: form.account_number.trim().slice(-4),
        account_number_encrypted: obscureSecret(form.account_number.trim()),
        account_type: form.account_type,
        is_primary: true,
        status: 'active',
        verified_by: identity,
        verified_date: new Date().toISOString(),
      });
      const updatedEmployee = await db.entities.employees.update(employee.id, { direct_deposit_enabled: true });
      onUpdated(updatedEmployee);

      toast({ title: 'Direct deposit account saved' });
      setShowForm(false);
      setViewingDetail(false);
      await load();
    } catch (e) {
      toast({ title: 'Unable to save direct deposit account', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDirectDeposit = async (enabled) => {
    try {
      const updatedEmployee = await db.entities.employees.update(employee.id, { direct_deposit_enabled: enabled });
      onUpdated(updatedEmployee);
      toast({ title: enabled ? 'Direct deposit enabled' : 'Direct deposit disabled — this employee will receive a paper check' });
    } catch (e) {
      toast({ title: 'Unable to update direct deposit status', variant: 'destructive' });
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><Landmark className="w-4 h-4 text-primary" />Direct Deposit</h4>

        {activeAccount ? (
          <div onClick={() => setViewingDetail(true)} className="cursor-pointer space-y-1.5 text-sm rounded-md border border-border/50 p-3 hover:bg-muted/50">
            <div className="flex justify-between"><span className="text-muted-foreground">Account Holder</span><span className="font-medium">{activeAccount.account_holder_name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="font-medium">{titleCase(activeAccount.account_type)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Account</span><span className="font-mono font-medium">****{activeAccount.account_number_last4 || '----'}</span></div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No direct deposit account on file.</p>
        )}

        {canEdit ? (
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={!!employee.direct_deposit_enabled} onCheckedChange={handleToggleDirectDeposit} disabled={!activeAccount} />
              <span className="text-xs text-muted-foreground">Direct deposit enabled</span>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={openReplace}>
              <Plus className="w-3.5 h-3.5" />{activeAccount ? 'Replace Account' : 'Add Account'}
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">Direct deposit: {employee.direct_deposit_enabled ? 'Enabled' : 'Disabled'}</p>
        )}
      </div>

      <Dialog open={viewingDetail} onOpenChange={setViewingDetail}>
        <DialogContent>
          <DialogHeader><DialogTitle>{employee.full_name} — Direct Deposit</DialogTitle></DialogHeader>
          {activeAccount && (
            <div className="space-y-1.5 text-sm">
              {[
                ['Account Holder', activeAccount.account_holder_name],
                ['Account Type', titleCase(activeAccount.account_type)],
                ['Account Number', `****${activeAccount.account_number_last4 || '----'}`],
                ['Routing Number', activeAccount.routing_number],
                ['Status', titleCase(activeAccount.status)],
                ['Verified By', activeAccount.verified_by || '—'],
                ['Verified Date', activeAccount.verified_date ? new Date(activeAccount.verified_date).toLocaleString() : '—'],
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
            <Button variant="outline" onClick={() => setViewingDetail(false)}>Close</Button>
            {canEdit && <Button onClick={openReplace} className="steel-gradient text-white border-0">Replace Account</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>{activeAccount ? 'Replace' : 'Add'} Direct Deposit Account</DialogTitle></DialogHeader>
          <div className="space-y-3">
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
              <Label className="text-xs">Account Number</Label>
              <div className="relative mt-1">
                <Input
                  type={showAccountNumber ? 'text' : 'password'}
                  placeholder={activeAccount ? `Currently ending ${activeAccount.account_number_last4 || '----'}` : ''}
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
