import React, { useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Plus, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import RepairDetailDialog from '@/components/field-operations/RepairDetailDialog';

const REPAIR_CATEGORIES = ['Routine_PM', 'Breakdown_Repair', 'Warranty_Service'];
const emptyRepairForm = () => ({ asset_id: '', repair_category: 'Routine_PM', runtime_hours_at_repair: '', cost: '', repair_date: '', notes: '', project_id: '', vendor_id: '' });

export default function RepairLedger({ assets, repairLogs, projects = [], vendors = [], canManageFleet, onReload }) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyRepairForm());
  const [saving, setSaving] = useState(false);
  const [viewingRepair, setViewingRepair] = useState(null);
  const [showDetail, setShowDetail] = useState(false);

  const assetName = (id) => assets.find((a) => a.id === id)?.asset_name || id || '—';
  const sortedLogs = useMemo(
    () => [...repairLogs].sort((a, b) => new Date(b.repair_date) - new Date(a.repair_date)),
    [repairLogs]
  );

  // Section H — mirrors EquipmentUsagePanel.jsx's handleSubmit job-cost
  // posting pattern; a vendor pick additionally opens an AP bill for the
  // repair amount. Neither is required — a repair with no project or vendor
  // just saves as unposted shop overhead.
  const handleSave = async () => {
    if (!form.asset_id || !form.repair_date) {
      toast({ title: 'Asset and repair date are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const asset = assets.find((a) => a.id === form.asset_id);
      const costCode = asset?.default_cost_code || 'EQP-001';
      const costCents = Math.round((Number(form.cost) || 0) * 100);

      const created = await db.entities.fleet_repair_logs.create({
        asset_id: form.asset_id,
        repair_category: form.repair_category,
        runtime_hours_at_repair: Number(form.runtime_hours_at_repair) || 0,
        cost_cents: costCents,
        repair_date: form.repair_date,
        notes: form.notes.trim(),
        project_id: form.project_id || '',
        vendor_id: form.vendor_id || '',
        cost_code: costCode,
        posted_to_job_cost: false,
        job_cost_entry_id: '',
        vendor_bill_id: '',
        created_at: new Date().toISOString(),
      });

      let posted_to_job_cost = false;
      let job_cost_entry_id = '';
      let vendor_bill_id = '';

      if (form.project_id) {
        const description = `${asset?.asset_name || 'Equipment'} — ${form.repair_category.replace(/_/g, ' ')} repair`;
        const ledgerEntry = await db.entities.JobCostLedgerEntry.create({
          project_id: form.project_id,
          cost_code: costCode,
          cost_class: 'EQP',
          amount: costCents / 100,
          transaction_date: form.repair_date,
          source_type: 'equipment_repair',
          source_id: created.id,
          description,
        });
        posted_to_job_cost = true;
        job_cost_entry_id = ledgerEntry.id;
      }

      if (form.vendor_id) {
        const bill = await db.entities.VendorBill.create({
          vendor_id: form.vendor_id,
          po_id: '',
          project_id: form.project_id || '',
          invoice_date: form.repair_date,
          gross_amount: costCents / 100,
          status: 'Pending_Match',
        });
        vendor_bill_id = bill.id;
      }

      if (posted_to_job_cost || vendor_bill_id) {
        await db.entities.fleet_repair_logs.update(created.id, { posted_to_job_cost, job_cost_entry_id, vendor_bill_id });
      }

      // PM-clearing rule: only a Routine_PM repair resets the maintenance
      // clock — Breakdown_Repair/Warranty_Service leave last_pm_runtime_hours
      // untouched so the PM Due badge still fires on schedule.
      if (form.repair_category === 'Routine_PM') {
        await db.entities.erection_fleet_assets.update(form.asset_id, { last_pm_runtime_hours: Number(form.runtime_hours_at_repair) || 0 });
      }

      await onReload();
      setShowForm(false);
      setForm(emptyRepairForm());
      toast({
        title: 'Repair logged',
        description: posted_to_job_cost || vendor_bill_id ? 'Posted to accounting.' : 'Saved as unposted overhead — no project or vendor selected.',
      });
    } catch (e) {
      toast({ title: 'Unable to log repair', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {canManageFleet && (
        <div className="flex justify-end">
          <Button size="sm" className="gap-2 steel-gradient text-white border-0" onClick={() => setShowForm(true)}>
            <Plus className="w-3.5 h-3.5" />Log Repair
          </Button>
        </div>
      )}

      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><Wrench className="w-4 h-4 text-primary" />Repair History ({sortedLogs.length})</h4>
        {sortedLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No repairs logged yet.</p>
        ) : sortedLogs.map((log) => (
          <div
            key={log.id}
            onClick={() => { setViewingRepair(log); setShowDetail(true); }}
            className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm mb-2 cursor-pointer hover:bg-muted/50 transition-colors"
          >
            <div>
              <p className="font-medium">{assetName(log.asset_id)} — {log.repair_category.replace(/_/g, ' ')}</p>
              <p className="text-xs text-muted-foreground">{log.repair_date} • {(log.runtime_hours_at_repair || 0).toLocaleString()} hrs at repair{log.notes ? ` • ${log.notes}` : ''}</p>
              <div className="flex items-center gap-1.5 mt-1">
                {log.posted_to_job_cost && <Badge variant="secondary" className="text-[10px]">Posted to Job Cost</Badge>}
                {log.vendor_bill_id && <Badge variant="secondary" className="text-[10px]">AP Bill Created</Badge>}
                {!log.posted_to_job_cost && !log.vendor_bill_id && (
                  <span className="text-xs text-muted-foreground">
                    {!log.project_id && !log.vendor_id ? 'Not posted — no project or vendor' : 'Unposted'}
                  </span>
                )}
              </div>
            </div>
            <span className="font-mono text-sm flex-shrink-0">${((log.cost_cents || 0) / 100).toFixed(2)}</span>
          </div>
        ))}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Fleet Repair</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Asset</Label>
              <Select value={form.asset_id} onValueChange={(v) => setForm((f) => ({ ...f, asset_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select an asset" /></SelectTrigger>
                <SelectContent>{assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.asset_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Repair Category</Label>
              <Select value={form.repair_category} onValueChange={(v) => setForm((f) => ({ ...f, repair_category: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{REPAIR_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Runtime Hours at Repair</Label>
                <Input type="number" value={form.runtime_hours_at_repair} onChange={(e) => setForm((f) => ({ ...f, runtime_hours_at_repair: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Cost ($)</Label>
                <Input type="number" value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Repair Date</Label>
              <Input type="date" value={form.repair_date} onChange={(e) => setForm((f) => ({ ...f, repair_date: e.target.value }))} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Project (optional)</Label>
                <Select value={form.project_id} onValueChange={(v) => setForm((f) => ({ ...f, project_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="No project — unposted" /></SelectTrigger>
                  <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vendor (optional)</Label>
                <Select value={form.vendor_id} onValueChange={(v) => setForm((f) => ({ ...f, vendor_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="No vendor — no AP bill" /></SelectTrigger>
                  <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Log Repair'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RepairDetailDialog
        repair={viewingRepair}
        open={showDetail}
        onOpenChange={(o) => { setShowDetail(o); if (!o) setViewingRepair(null); }}
        assets={assets}
        projects={projects}
        vendors={vendors}
      />
    </div>
  );
}
