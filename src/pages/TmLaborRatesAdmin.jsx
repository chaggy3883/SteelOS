import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/tenantContext';
import { ShieldCheck, Loader2, Plus, Edit2, History, X, HardHat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';

const ADMIN_ROLES = ['admin', 'super_admin', 'payroll_admin', 'hr_admin'];

const emptyForm = () => ({ hourly_rate: '', effective_date: new Date().toISOString().slice(0, 10), notes: '' });

export default function TmLaborRatesAdmin() {
  const { toast } = useToast();
  const { user } = useAuth();
  const roles = (user?.roles || user?.user?.roles || []).map((r) => String(r).toLowerCase());
  const canAccess = isAdminUser(user) || ADMIN_ROLES.some((r) => roles.includes(r));

  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [newPosition, setNewPosition] = useState('');
  const [newPositionForm, setNewPositionForm] = useState(emptyForm());

  const [editingPosition, setEditingPosition] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const [historyPosition, setHistoryPosition] = useState(null);
  const [removingPosition, setRemovingPosition] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await db.entities.TmLaborRate.list('-effective_date', 2000);
      setRates(rows);
    } catch (e) {
      toast({ title: 'Unable to load T&M labor rates', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const ratesByPosition = useMemo(() => {
    const map = new Map();
    rates.forEach((r) => {
      if (!map.has(r.position)) map.set(r.position, []);
      map.get(r.position).push(r);
    });
    map.forEach((list) => list.sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || '')));
    return map;
  }, [rates]);

  const positions = useMemo(() => Array.from(ratesByPosition.keys()).sort((a, b) => a.localeCompare(b)), [ratesByPosition]);

  const currentRateFor = (position) => (ratesByPosition.get(position) || []).find((r) => !r.end_date) || null;

  const handleAddPosition = async () => {
    const position = newPosition.trim();
    const rateNum = Number(newPositionForm.hourly_rate);
    if (!position) { toast({ title: 'Enter a position/trade name', variant: 'destructive' }); return; }
    if (positions.includes(position)) { toast({ title: 'That position already exists', variant: 'destructive' }); return; }
    if (!newPositionForm.effective_date || Number.isNaN(rateNum) || rateNum < 0) {
      toast({ title: 'Effective date and a valid rate are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await db.entities.TmLaborRate.create({
        position,
        hourly_rate: rateNum,
        effective_date: newPositionForm.effective_date,
        created_by: user?.full_name || user?.email || 'Unknown',
      });
      toast({ title: 'Labor rate added' });
      setAddOpen(false);
      setNewPosition('');
      setNewPositionForm(emptyForm());
      load();
    } catch (e) {
      toast({ title: 'Unable to add labor rate', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePosition = async (position) => {
    if (!confirm(`Remove "${position}" from the T&M labor rate table? Its rate history is kept but the position will no longer be selectable on new estimates.`)) return;
    const current = currentRateFor(position);
    if (!current) return;
    try {
      await db.entities.TmLaborRate.update(current.id, { end_date: new Date().toISOString().slice(0, 10) });
      toast({ title: `${position} removed` });
      load();
    } catch (e) {
      toast({ title: 'Unable to remove position', variant: 'destructive' });
    }
  };

  const openEdit = (position) => {
    setEditingPosition(position);
    setForm(emptyForm());
  };
  const closeEdit = () => { setEditingPosition(null); setForm(emptyForm()); };

  const handleSaveRate = async () => {
    const rateNum = Number(form.hourly_rate);
    if (!form.effective_date || Number.isNaN(rateNum) || rateNum < 0) {
      toast({ title: 'Effective date and a valid rate are required', variant: 'destructive' });
      return;
    }
    const current = currentRateFor(editingPosition);
    if (current && form.effective_date <= current.effective_date) {
      toast({ title: "New rate must be effective after the current rate's effective date", variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (current) {
        await db.entities.TmLaborRate.update(current.id, { end_date: form.effective_date });
      }
      await db.entities.TmLaborRate.create({
        position: editingPosition,
        hourly_rate: rateNum,
        effective_date: form.effective_date,
        created_by: user?.full_name || user?.email || 'Unknown',
        notes: form.notes,
      });
      await load();
      closeEdit();
      toast({ title: 'Rate updated' });
    } catch (e) {
      toast({ title: 'Unable to save rate', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const historyRows = historyPosition ? (ratesByPosition.get(historyPosition) || []) : [];

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Access Restricted</h2>
        <p className="text-sm text-muted-foreground">T&M labor rate management requires Admin, Payroll Admin, HR Admin, or Super Admin.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="T&M Labor Rates"
        subtitle="Company-wide standard shop rates billed to Time & Material customers. Rate changes are historical — nothing is ever overwritten."
        actions={<Button onClick={() => setAddOpen(true)} className="steel-gradient text-white border-0"><Plus className="w-4 h-4" />Add Position</Button>}
      />

      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Position / Trade</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Current Rate</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Effective Date</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-10 text-muted-foreground">
                  <HardHat className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No labor rates configured yet. Click "Add Position" to add one (e.g. Welder, Fabricator, Crane Operator).
                </td>
              </tr>
            ) : positions.map((position) => {
              const current = currentRateFor(position);
              return (
                <tr key={position} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{position}</td>
                  <td className="px-4 py-3 font-mono">
                    <button type="button" onClick={() => setHistoryPosition(position)} className="hover:underline">
                      {current ? `$${Number(current.hourly_rate).toFixed(2)}/hr` : 'Removed'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{current?.effective_date || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Rate history" onClick={() => setHistoryPosition(position)}><History className="w-3.5 h-3.5" /></Button>
                      {current && <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit rate" onClick={() => openEdit(position)}><Edit2 className="w-3.5 h-3.5" /></Button>}
                      {current && <Button variant="ghost" size="icon" className="h-8 w-8" title="Remove position" onClick={() => handleRemovePosition(position)}><X className="w-3.5 h-3.5 text-destructive" /></Button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Position */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) { setNewPosition(''); setNewPositionForm(emptyForm()); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Labor Position</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Position / Trade</Label>
              <Input value={newPosition} onChange={(e) => setNewPosition(e.target.value)} className="mt-1" placeholder="e.g. Welder" />
            </div>
            <div>
              <Label>Hourly Rate ($)</Label>
              <Input type="number" step="0.01" min="0" value={newPositionForm.hourly_rate} onChange={(e) => setNewPositionForm((f) => ({ ...f, hourly_rate: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Effective Date</Label>
              <Input type="date" value={newPositionForm.effective_date} onChange={(e) => setNewPositionForm((f) => ({ ...f, effective_date: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddPosition} disabled={saving} className="steel-gradient text-white border-0">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Rate */}
      <Dialog open={!!editingPosition} onOpenChange={(o) => !o && closeEdit()}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Rate — {editingPosition}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>New Hourly Rate ($)</Label>
              <Input type="number" step="0.01" min="0" value={form.hourly_rate} onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Effective Date</Label>
              <Input type="date" value={form.effective_date} onChange={(e) => setForm((f) => ({ ...f, effective_date: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEdit}>Cancel</Button>
            <Button onClick={handleSaveRate} disabled={saving} className="steel-gradient text-white border-0">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rate History */}
      <Dialog open={!!historyPosition} onOpenChange={(o) => !o && setHistoryPosition(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rate History — {historyPosition}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2 max-h-96 overflow-y-auto">
            {historyRows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No rate history.</p>
            ) : historyRows.map((r) => (
              <div key={r.id} className="border border-border rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">${Number(r.hourly_rate).toFixed(2)}/hr</span>
                  {!r.end_date && <span className="text-[10px] uppercase tracking-wide text-green-600 border border-green-500/30 rounded px-1.5 py-0.5">Current</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Effective {r.effective_date}{r.end_date ? ` → ${r.end_date}` : ''}
                </p>
                {r.notes && <p className="text-xs mt-1">{r.notes}</p>}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
