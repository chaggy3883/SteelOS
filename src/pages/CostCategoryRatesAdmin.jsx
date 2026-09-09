import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { hasBidWorksheetRateAccess } from '@/lib/bidWorksheetRateAccess';
import { COST_CATEGORIES, RATE_DEFAULT_CATEGORY_KEYS } from '@/components/estimating/TakeoffEngine';
import { ShieldCheck, Loader2, Edit2, History, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';

const emptyForm = () => ({ hourly_rate: '', effective_date: new Date().toISOString().slice(0, 10), notes: '' });

// Fixed set — unlike TmLaborRatesAdmin's open-ended positions, these
// categories are the exact COST_CATEGORIES keys TakeoffEngine.jsx pre-fills
// unit_cost from (see RATE_DEFAULT_CATEGORY_KEYS), so there's no add/remove
// affordance here, just a rate/history per category.
const RATE_CATEGORIES = RATE_DEFAULT_CATEGORY_KEYS
  .map((key) => COST_CATEGORIES.find((c) => c.key === key))
  .filter(Boolean);

export default function CostCategoryRatesAdmin() {
  const { toast } = useToast();
  const { user } = useAuth();
  const roles = user?.roles || user?.user?.roles || ['user'];
  const canAccess = hasBidWorksheetRateAccess(roles);

  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);

  const [editingCategoryKey, setEditingCategoryKey] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const [historyCategoryKey, setHistoryCategoryKey] = useState(null);

  useEffect(() => { if (canAccess) load(); else setLoading(false); }, [canAccess]);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await db.entities.CostCategoryDefaultRate.list('-effective_date', 2000);
      setRates(rows);
    } catch (e) {
      toast({ title: 'Unable to load Bid Worksheet default rates', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const ratesByCategory = useMemo(() => {
    const map = new Map();
    rates.forEach((r) => {
      if (!map.has(r.category_key)) map.set(r.category_key, []);
      map.get(r.category_key).push(r);
    });
    map.forEach((list) => list.sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || '')));
    return map;
  }, [rates]);

  const currentRateFor = (categoryKey) => (ratesByCategory.get(categoryKey) || []).find((r) => !r.end_date) || null;

  const openEdit = (categoryKey) => {
    setEditingCategoryKey(categoryKey);
    setForm(emptyForm());
  };
  const closeEdit = () => { setEditingCategoryKey(null); setForm(emptyForm()); };

  const handleSaveRate = async () => {
    const rateNum = Number(form.hourly_rate);
    if (!form.effective_date || Number.isNaN(rateNum) || rateNum < 0) {
      toast({ title: 'Effective date and a valid rate are required', variant: 'destructive' });
      return;
    }
    const current = currentRateFor(editingCategoryKey);
    if (current && form.effective_date <= current.effective_date) {
      toast({ title: "New rate must be effective after the current rate's effective date", variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (current) {
        await db.entities.CostCategoryDefaultRate.update(current.id, { end_date: form.effective_date });
      }
      await db.entities.CostCategoryDefaultRate.create({
        category_key: editingCategoryKey,
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

  const historyRows = historyCategoryKey ? (ratesByCategory.get(historyCategoryKey) || []) : [];
  const historyCategory = RATE_CATEGORIES.find((c) => c.key === historyCategoryKey);
  const editingCategory = RATE_CATEGORIES.find((c) => c.key === editingCategoryKey);

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Access Restricted</h2>
        <p className="text-sm text-muted-foreground">Bid Worksheet default rate management requires Admin, Super Admin, or Estimator.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Bid Worksheet Default Rates"
        subtitle="Company-wide default rate that pre-fills a brand-new Bid Worksheet line for these categories. Fully editable per line afterward — this only sets the starting value."
      />

      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Current Rate</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Effective Date</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {RATE_CATEGORIES.map((cat) => {
              const current = currentRateFor(cat.key);
              return (
                <tr key={cat.key} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">
                    {cat.label}
                    <span className="block text-xs text-muted-foreground font-normal">{cat.rateLabel || 'Rate/Hr'}</span>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    <button type="button" onClick={() => setHistoryCategoryKey(cat.key)} className="hover:underline">
                      {current ? `$${Number(current.hourly_rate).toFixed(2)}/hr` : 'Not set'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{current?.effective_date || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Rate history" onClick={() => setHistoryCategoryKey(cat.key)}><History className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title={current ? 'Edit rate' : 'Set rate'} onClick={() => openEdit(cat.key)}>
                        {current ? <Edit2 className="w-3.5 h-3.5" /> : <DollarSign className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit / Set Rate */}
      <Dialog open={!!editingCategoryKey} onOpenChange={(o) => !o && closeEdit()}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Rate — {editingCategory?.label}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>{editingCategory?.rateLabel || 'Hourly Rate ($)'}</Label>
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
      <Dialog open={!!historyCategoryKey} onOpenChange={(o) => !o && setHistoryCategoryKey(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rate History — {historyCategory?.label}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2 max-h-96 overflow-y-auto">
            {historyRows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No rate history yet.</p>
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
