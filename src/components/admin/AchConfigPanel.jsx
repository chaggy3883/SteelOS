import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Landmark, Wifi, Loader2, Save, CheckCircle2, XCircle, HelpCircle, Eye, EyeOff, Download, Send, BadgeCheck, AlertTriangle, Clock } from 'lucide-react';
import { obscureSecret } from '@/lib/hrSecurity';
import { exportRowsToCsv } from '@/lib/csvExport';
import { cn } from '@/lib/utils';

const STATUS_CONFIG = {
  connected: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Connected' },
  error: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Error' },
  disconnected: { icon: XCircle, color: 'text-gray-500', bg: 'bg-gray-500/10', label: 'Disconnected' },
  untested: { icon: HelpCircle, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Not Tested' },
};

const emptyForm = () => ({
  bank_name: '', api_key_encrypted: '', api_endpoint: '', routing_number: '',
  account_number: '', test_mode: true, is_active: false,
});

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);

// Configuration + transaction logging only — this is NOT a real bank/ACH
// processor integration (no backend exists to make the actual API calls).
// See NOTE ON BANK API IMPLEMENTATION: when the VPS phase lands, the real
// webhook handlers/batch file generation/authentication wire in here without
// changing this storage/UI layer.
export default function AchConfigPanel() {
  const { toast } = useToast();
  const { user } = useAuth();
  const identity = user?.full_name || user?.email || 'Unknown';

  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [achOutgoing, setAchOutgoing] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [viewingBatch, setViewingBatch] = useState(null);
  const [failReason, setFailReason] = useState('');
  const [failingId, setFailingId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [configs, outgoing, emps, accts] = await Promise.all([
        db.entities.BankIntegrationConfig.list('-created_date', 5),
        db.entities.AchOutgoing.list('-effective_date', 1000),
        db.entities.employees.list('full_name', 1000),
        db.entities.EmployeeBankAccount.list('-created_date', 1000),
      ]);
      setConfig(configs[0] || null);
      setAchOutgoing(outgoing);
      setEmployees(emps);
      setBankAccounts(accts);
    } catch (e) {
      toast({ title: 'Unable to load ACH configuration', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const employeeName = (id) => employees.find((e) => e.id === id)?.full_name || id;
  const accountLast4 = (id) => bankAccounts.find((a) => a.id === id)?.account_number_last4 || '----';

  const status = config?.connection_status || 'untested';
  const StatusIcon = STATUS_CONFIG[status]?.icon || HelpCircle;

  const startEdit = () => {
    setForm({
      bank_name: config?.bank_name || '',
      api_key_encrypted: '',
      api_endpoint: config?.api_endpoint || '',
      routing_number: config?.routing_number || '',
      account_number: '',
      test_mode: config?.test_mode ?? true,
      is_active: config?.is_active ?? false,
    });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!form.bank_name.trim()) {
      toast({ title: 'Bank name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        bank_name: form.bank_name.trim(),
        api_endpoint: form.api_endpoint.trim(),
        routing_number: form.routing_number.trim(),
        test_mode: form.test_mode,
        is_active: form.is_active,
        created_by: identity,
      };
      if (form.api_key_encrypted.trim()) payload.api_key_encrypted = obscureSecret(form.api_key_encrypted.trim());
      if (form.account_number.trim()) {
        payload.account_number_last4 = form.account_number.trim().slice(-4);
        payload.account_number_encrypted = obscureSecret(form.account_number.trim());
      }
      if (config?.id) {
        await db.entities.BankIntegrationConfig.update(config.id, payload);
      } else {
        await db.entities.BankIntegrationConfig.create(payload);
      }
      toast({ title: 'ACH bank configuration saved' });
      setEditing(false);
      load();
    } catch (e) {
      toast({ title: 'Unable to save configuration', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!config?.id) {
      toast({ title: 'Save the configuration before testing the connection', variant: 'destructive' });
      return;
    }
    setTesting(true);
    try {
      // No real bank API exists to call (see file header) — this simulates a
      // round trip the same way IntegrationCard.jsx's handleTest does, so the
      // UI/status flow is real even though nothing is actually dialed out to.
      await new Promise((r) => setTimeout(r, 1200));
      const hasCreds = !!config.api_key_encrypted;
      const testStatus = hasCreds ? 'connected' : 'error';
      const testMsg = hasCreds ? 'Connection successful' : 'No API key on file — add credentials before testing';
      const updated = await db.entities.BankIntegrationConfig.update(config.id, {
        connection_status: testStatus,
        last_tested: new Date().toISOString(),
        last_test_message: testMsg,
      });
      setConfig(updated);
      toast({ title: testStatus === 'connected' ? 'Connection test passed' : 'Connection test failed', variant: testStatus === 'connected' ? 'default' : 'destructive' });
    } catch (e) {
      toast({ title: 'Test failed', variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  const thisMonthPrefix = new Date().toISOString().slice(0, 7);
  const thisMonthBatches = useMemo(() => achOutgoing.filter((a) => (a.effective_date || '').startsWith(thisMonthPrefix)), [achOutgoing, thisMonthPrefix]);
  const countByStatus = (status) => thisMonthBatches.filter((a) => a.status === status).length;
  const failedTransfers = useMemo(() => achOutgoing.filter((a) => a.status === 'failed'), [achOutgoing]);

  const sortedOutgoing = useMemo(() => [...achOutgoing].sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || '')), [achOutgoing]);

  const handleTransmit = async (row) => {
    setBusyId(row.id);
    try {
      const batchRef = `ACH-${(row.effective_date || '').replace(/-/g, '')}-${row.id.slice(-6)}`;
      await db.entities.AchOutgoing.update(row.id, {
        status: 'transmitted', transmitted_at: new Date().toISOString(), batch_reference: batchRef,
      });
      toast({ title: `Batch transmitted — ${batchRef}` });
      load();
    } catch (e) {
      toast({ title: 'Unable to mark transmitted', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handleSettle = async (row) => {
    setBusyId(row.id);
    try {
      await db.entities.AchOutgoing.update(row.id, { status: 'settled', settled_at: new Date().toISOString() });
      toast({ title: 'Transfer marked settled' });
      load();
    } catch (e) {
      toast({ title: 'Unable to mark settled', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handleFail = async () => {
    if (!failReason.trim()) {
      toast({ title: 'A failure reason is required', variant: 'destructive' });
      return;
    }
    setBusyId(failingId);
    try {
      await db.entities.AchOutgoing.update(failingId, { status: 'failed', failed_reason: failReason.trim() });
      toast({ title: 'Transfer marked failed', variant: 'destructive' });
      setFailingId(null);
      setFailReason('');
      load();
    } catch (e) {
      toast({ title: 'Unable to mark failed', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handleExportCsv = () => {
    exportRowsToCsv({
      filename: 'ach_outgoing_reconciliation.csv',
      columns: ['Effective Date', 'Employee', 'Amount', 'Status', 'Batch Reference', 'Transmitted At', 'Settled At', 'Failed Reason'],
      rows: sortedOutgoing.map((a) => [
        a.effective_date || '', employeeName(a.employee_id), Number(a.amount) || 0, titleCase(a.status),
        a.batch_reference || '', a.transmitted_at || '', a.settled_at || '', a.failed_reason || '',
      ]),
    });
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="steel-card p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-3">
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', STATUS_CONFIG[status].bg)}>
              <StatusIcon className={cn('w-5 h-5', STATUS_CONFIG[status].color)} />
            </div>
            <div>
              <h4 className="font-semibold text-sm flex items-center gap-2"><Landmark className="w-4 h-4 text-primary" />ACH Payment Processing</h4>
              <p className="text-xs text-muted-foreground max-w-md">
                Bank API credentials and transaction logging for direct deposit payroll and incoming AR payments. This is NOT a real payment processor
                integration — configuration storage + transaction logging only, until the VPS backend phase wires in real bank API calls.
              </p>
              {config?.last_tested && <p className="text-[10px] text-muted-foreground mt-0.5">Last tested: {new Date(config.last_tested).toLocaleString()}</p>}
            </div>
          </div>
          <span className={cn('text-[10px] px-2 py-1 rounded font-medium flex-shrink-0', STATUS_CONFIG[status].bg, STATUS_CONFIG[status].color)}>
            {STATUS_CONFIG[status].label}
          </span>
        </div>

        {config?.last_test_message && status === 'error' && (
          <div className="mb-3 p-2 rounded bg-red-500/10 text-xs text-red-500">{config.last_test_message}</div>
        )}

        {!editing ? (
          <div className="space-y-2">
            {config && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div><span className="text-muted-foreground">Bank</span><p className="font-medium">{config.bank_name}</p></div>
                <div><span className="text-muted-foreground">Endpoint</span><p className="font-medium truncate">{config.api_endpoint || '—'}</p></div>
                <div><span className="text-muted-foreground">Company Account</span><p className="font-medium">****{config.account_number_last4 || '----'}</p></div>
                <div><span className="text-muted-foreground">Mode</span><p className="font-medium">{config.test_mode ? 'Test' : 'Live'} · {config.is_active ? 'Active' : 'Inactive'}</p></div>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={startEdit}>{config ? 'Edit Configuration' : 'Configure ACH Processing'}</Button>
              {config && (
                <Button size="sm" variant="outline" onClick={handleTest} disabled={testing} className="gap-1.5">
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}Verify API Connection
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Bank Name</Label>
                <Input value={form.bank_name} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">API Endpoint</Label>
                <Input value={form.api_endpoint} onChange={(e) => setForm((f) => ({ ...f, api_endpoint: e.target.value }))} className="mt-1" placeholder="https://api.yourbank.com/ach" />
              </div>
              <div>
                <Label className="text-xs">API Key</Label>
                <div className="relative mt-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder={config?.api_key_encrypted ? '•••••••• (enter new to update)' : ''}
                    value={form.api_key_encrypted}
                    onChange={(e) => setForm((f) => ({ ...f, api_key_encrypted: e.target.value }))}
                    className="pr-9"
                  />
                  <button type="button" onClick={() => setShowKey((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Company Routing Number</Label>
                <Input value={form.routing_number} onChange={(e) => setForm((f) => ({ ...f, routing_number: e.target.value.replace(/\D/g, '') }))} className="mt-1" maxLength={9} />
              </div>
              <div>
                <Label className="text-xs">Company Account Number</Label>
                <Input
                  type="password"
                  placeholder={config?.account_number_last4 ? `•••••••• (ends ${config.account_number_last4} — enter new to update)` : ''}
                  value={form.account_number}
                  onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value.replace(/\D/g, '') }))}
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex items-center gap-6 pt-1">
              <div className="flex items-center gap-2">
                <Switch checked={form.test_mode} onCheckedChange={(v) => setForm((f) => ({ ...f, test_mode: v }))} />
                <Label className="text-xs">Test Mode</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
                <Label className="text-xs">Active</Label>
              </div>
            </div>
            <div className="flex gap-2 pt-2 border-t border-border">
              <Button size="sm" onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0 flex-1 gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Transmitted This Month', value: countByStatus('transmitted'), icon: Send, color: 'text-blue-500' },
          { label: 'Settled This Month', value: countByStatus('settled'), icon: BadgeCheck, color: 'text-green-500' },
          { label: 'Pending This Month', value: countByStatus('pending'), icon: Clock, color: 'text-amber-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Icon className={cn('w-4 h-4', color)} /><p className="text-xs text-muted-foreground">{label}</p></div>
            <p className={cn('text-xl font-bold', color)}>{value}</p>
          </div>
        ))}
      </div>

      {failedTransfers.length > 0 && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 flex items-center gap-2 text-sm text-red-600">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />{failedTransfers.length} failed ACH transfer{failedTransfers.length === 1 ? '' : 's'} need attention — see the report below.
        </div>
      )}

      <div className="steel-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-sm">ACH Outgoing (Payroll Direct Deposit)</h3>
          <Button size="sm" variant="outline" onClick={handleExportCsv} disabled={sortedOutgoing.length === 0} className="gap-1.5">
            <Download className="w-3.5 h-3.5" />Export CSV
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-2 px-3">Pay Date</th>
                <th className="text-left py-2 px-3">Employee</th>
                <th className="text-left py-2 px-3">Destination</th>
                <th className="text-right py-2 px-3">Amount</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-right py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedOutgoing.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">No ACH direct deposit transfers yet — they're created automatically when a payroll run is locked.</td></tr>
              ) : sortedOutgoing.map((row) => (
                <tr key={row.id} onClick={() => setViewingBatch(row)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                  <td className="py-2 px-3">{row.effective_date}</td>
                  <td className="py-2 px-3 font-medium">{employeeName(row.employee_id)}</td>
                  <td className="py-2 px-3 font-mono text-xs text-muted-foreground">****{accountLast4(row.destination_bank_account_id)}</td>
                  <td className="py-2 px-3 text-right font-mono">{money(row.amount)}</td>
                  <td className="py-2 px-3">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                      row.status === 'settled' ? 'bg-green-500/10 text-green-600' :
                      row.status === 'transmitted' ? 'bg-blue-500/10 text-blue-600' :
                      row.status === 'failed' ? 'bg-red-500/10 text-red-600' : 'bg-amber-500/10 text-amber-600')}>
                      {titleCase(row.status)}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {busyId === row.id ? <Loader2 className="w-4 h-4 animate-spin ml-auto text-muted-foreground" /> : (
                      <>
                        {row.status === 'pending' && (
                          <Button size="sm" variant="outline" className="h-7 text-xs mr-1" onClick={() => handleTransmit(row)}>Transmit Batch</Button>
                        )}
                        {row.status === 'transmitted' && (
                          <Button size="sm" variant="outline" className="h-7 text-xs mr-1" onClick={() => handleSettle(row)}>Mark Settled</Button>
                        )}
                        {(row.status === 'pending' || row.status === 'transmitted') && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" onClick={() => { setFailingId(row.id); setFailReason(''); }}>Mark Failed</Button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!viewingBatch} onOpenChange={(o) => !o && setViewingBatch(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>ACH Transfer — {viewingBatch ? employeeName(viewingBatch.employee_id) : ''}</DialogTitle></DialogHeader>
          {viewingBatch && (
            <div className="space-y-1.5 text-sm">
              {[
                ['Amount', money(viewingBatch.amount)],
                ['Effective Date', viewingBatch.effective_date],
                ['Destination Account', `****${accountLast4(viewingBatch.destination_bank_account_id)}`],
                ['Status', titleCase(viewingBatch.status)],
                ['Batch Reference', viewingBatch.batch_reference || '—'],
                ['Transmitted At', viewingBatch.transmitted_at ? new Date(viewingBatch.transmitted_at).toLocaleString() : '—'],
                ['Settled At', viewingBatch.settled_at ? new Date(viewingBatch.settled_at).toLocaleString() : '—'],
                ['Failed Reason', viewingBatch.failed_reason || '—'],
                ['Payroll Run Id', viewingBatch.payroll_run_id],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-border/50 py-1 last:border-0 gap-3">
                  <span className="text-muted-foreground flex-shrink-0">{label}</span>
                  <span className="font-medium text-right break-all">{value}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter><Button onClick={() => setViewingBatch(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!failingId} onOpenChange={(o) => { if (!o) { setFailingId(null); setFailReason(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark ACH Transfer Failed</DialogTitle></DialogHeader>
          <Textarea value={failReason} onChange={(e) => setFailReason(e.target.value)} placeholder="Why did this transfer fail? (required)" rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFailingId(null); setFailReason(''); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleFail} disabled={!failReason.trim()}>Mark Failed</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
