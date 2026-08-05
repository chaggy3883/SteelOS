import React, { useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Plus, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

const REPAIR_CATEGORIES = ['Routine_PM', 'Breakdown_Repair', 'Warranty_Service'];
const emptyRepairForm = () => ({ asset_id: '', repair_category: 'Routine_PM', runtime_hours_at_repair: '', cost: '', repair_date: '', notes: '' });

export default function RepairLedger({ assets, repairLogs, canManageFleet, onReload }) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyRepairForm());
  const [saving, setSaving] = useState(false);

  const assetName = (id) => assets.find((a) => a.id === id)?.asset_name || id || '—';
  const sortedLogs = useMemo(
    () => [...repairLogs].sort((a, b) => new Date(b.repair_date) - new Date(a.repair_date)),
    [repairLogs]
  );

  const handleSave = async () => {
    if (!form.asset_id || !form.repair_date) {
      toast({ title: 'Asset and repair date are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await db.entities.fleet_repair_logs.create({
        asset_id: form.asset_id,
        repair_category: form.repair_category,
        runtime_hours_at_repair: Number(form.runtime_hours_at_repair) || 0,
        cost_cents: Math.round((Number(form.cost) || 0) * 100),
        repair_date: form.repair_date,
        notes: form.notes.trim(),
        created_at: new Date().toISOString(),
      });
      await onReload();
      setShowForm(false);
      setForm(emptyRepairForm());
      toast({ title: 'Repair logged' });
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
          <div key={log.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm mb-2">
            <div>
              <p className="font-medium">{assetName(log.asset_id)} — {log.repair_category.replace(/_/g, ' ')}</p>
              <p className="text-xs text-muted-foreground">{log.repair_date} • {(log.runtime_hours_at_repair || 0).toLocaleString()} hrs at repair{log.notes ? ` • ${log.notes}` : ''}</p>
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
    </div>
  );
}
