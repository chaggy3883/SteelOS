import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Gauge, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const emptyForm = () => ({ asset_id: '', project_id: '', usage_date: todayStr(), hours_used: '', operator_employee_id: '', notes: '' });

// Which rate applies to this asset when posting usage to job cost — the
// asset's cost_rate_type is independent of its ownership `status` field so a
// rented crane's billing rate can be tracked without touching dispatch state.
export function resolveAssetRate(asset) {
  if (!asset) return 0;
  if (asset.cost_rate_type === 'owned') return asset.cost_per_hour || 0;
  if (asset.cost_rate_type === 'rented') return asset.rental_rate_per_hour || 0;
  return 0;
}

export default function EquipmentUsagePanel({ assets, projects, employees, usageLogs, onReload }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [projectFilter, setProjectFilter] = useState('all');
  const [assetFilter, setAssetFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState(daysAgoStr(30));
  const [dateTo, setDateTo] = useState(todayStr());

  const assetName = (id) => assets.find((a) => a.id === id)?.asset_name || '—';
  const projectName = (id) => projects.find((p) => p.id === id)?.name || '—';
  const employeeName = (id) => employees.find((e) => e.id === id)?.full_name || '—';

  const selectedAsset = assets.find((a) => a.id === form.asset_id) || null;
  const previewRate = resolveAssetRate(selectedAsset);
  const previewCost = (Number(form.hours_used) || 0) * previewRate;

  const handleSubmit = async () => {
    if (!form.asset_id || !form.project_id || !form.usage_date || !(Number(form.hours_used) > 0)) {
      toast({ title: 'Asset, project, date, and hours are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const asset = assets.find((a) => a.id === form.asset_id);
      const hours = Number(form.hours_used) || 0;
      const rate = resolveAssetRate(asset);
      const totalCost = hours * rate;
      const costCode = asset?.default_cost_code || 'EQP-001';
      const description = `${asset?.asset_name || 'Equipment'} — ${hours} hrs @ $${rate}/hr`;

      const log = await db.entities.EquipmentUsageLog.create({
        asset_id: form.asset_id,
        project_id: form.project_id,
        operator_employee_id: form.operator_employee_id || undefined,
        usage_date: form.usage_date,
        hours_used: hours,
        cost_code: costCode,
        rate_used: rate,
        total_cost: totalCost,
        notes: form.notes.trim(),
        description,
      });

      const ledgerEntry = await db.entities.JobCostLedgerEntry.create({
        project_id: form.project_id,
        cost_code: costCode,
        cost_class: 'EQP',
        amount: totalCost,
        transaction_date: form.usage_date,
        source_type: 'equipment',
        source_id: log.id,
        description,
      });

      await db.entities.EquipmentUsageLog.update(log.id, { posted_to_job_cost: true, job_cost_entry_id: ledgerEntry.id });

      await onReload();
      setForm(emptyForm());
      toast({ title: 'Usage logged and posted to job cost', description: `$${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} posted to ${costCode}.` });
    } catch (e) {
      toast({ title: 'Unable to log usage', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const filteredLogs = useMemo(() => {
    return usageLogs
      .filter((log) => {
        if (projectFilter !== 'all' && log.project_id !== projectFilter) return false;
        if (assetFilter !== 'all' && log.asset_id !== assetFilter) return false;
        if (dateFrom && log.usage_date < dateFrom) return false;
        if (dateTo && log.usage_date > dateTo) return false;
        return true;
      })
      .sort((a, b) => new Date(b.usage_date) - new Date(a.usage_date));
  }, [usageLogs, projectFilter, assetFilter, dateFrom, dateTo]);

  return (
    <div className="space-y-4">
      <div className="steel-card p-4 space-y-3">
        <h4 className="font-semibold text-sm flex items-center gap-2"><Gauge className="w-4 h-4 text-primary" />Log Usage</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <Label>Asset</Label>
            <Select value={form.asset_id} onValueChange={(v) => setForm((f) => ({ ...f, asset_id: v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select an asset" /></SelectTrigger>
              <SelectContent>{assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.asset_name} ({a.asset_type?.replace(/_/g, ' ')})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Project</Label>
            <Select value={form.project_id} onValueChange={(v) => setForm((f) => ({ ...f, project_id: v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={form.usage_date} onChange={(e) => setForm((f) => ({ ...f, usage_date: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>Hours Used</Label>
            <Input type="number" min={0.5} step={0.5} value={form.hours_used} onChange={(e) => setForm((f) => ({ ...f, hours_used: e.target.value }))} className="mt-1" placeholder="e.g. 8" />
          </div>
          <div>
            <Label>Operator (optional)</Label>
            <Select value={form.operator_employee_id} onValueChange={(v) => setForm((f) => ({ ...f, operator_employee_id: v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select an operator" /></SelectTrigger>
              <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1" placeholder="Optional" />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <p className="text-sm text-muted-foreground">
            {selectedAsset ? (
              previewRate > 0 ? (
                <>Est. cost: <span className="font-semibold text-foreground">${previewCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span> ({form.hours_used || 0} hrs @ ${previewRate}/hr)</>
              ) : (
                <span className="text-amber-600">This asset has no cost rate set — usage will post at $0. Set a Cost Rate in its detail view first.</span>
              )
            ) : 'Est. cost: —'}
          </p>
          <Button onClick={handleSubmit} disabled={saving} className="steel-gradient text-white border-0">
            {saving ? 'Posting…' : 'Log & Post to Job Cost'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Project</Label>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Asset</Label>
          <Select value={assetFilter} onValueChange={setAssetFilter}>
            <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assets</SelectItem>
              {assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.asset_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1 w-40" />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1 w-40" />
        </div>
      </div>

      <div className="steel-card p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Asset</TableHead>
              <TableHead>Project</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Total Cost</TableHead>
              <TableHead>Posted</TableHead>
              <TableHead>Operator</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLogs.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">No equipment usage logged for this range.</TableCell></TableRow>
            ) : filteredLogs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="text-xs">{log.usage_date}</TableCell>
                <TableCell className="font-medium">
                  <button onClick={() => navigate(`/field-operations?asset=${log.asset_id}`)} className="text-primary hover:underline">{assetName(log.asset_id)}</button>
                </TableCell>
                <TableCell className="text-sm">
                  <button onClick={() => navigate(`/projects/${log.project_id}`)} disabled={!log.project_id} className="text-primary hover:underline disabled:no-underline disabled:text-muted-foreground">{projectName(log.project_id)}</button>
                </TableCell>
                <TableCell className="text-right font-mono">{log.hours_used}</TableCell>
                <TableCell className="text-right font-mono">${(log.rate_used || 0).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono">${(log.total_cost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                <TableCell>
                  {log.posted_to_job_cost ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="w-3.5 h-3.5" />Posted</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><XCircle className="w-3.5 h-3.5" />Not posted</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {log.operator_employee_id ? (
                    <button onClick={() => navigate(`/human-resources?employee=${log.operator_employee_id}`)} className="text-primary hover:underline">{employeeName(log.operator_employee_id)}</button>
                  ) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
