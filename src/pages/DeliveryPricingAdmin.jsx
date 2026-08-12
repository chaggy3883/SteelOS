import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { isAdminUser } from '@/lib/tenantContext';
import { ShieldCheck, Plus, Edit2, Trash2, Loader2, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';

const emptyForm = () => ({ min_miles: '', max_miles: '', cost_per_trip: '' });

const formatCurrency = (n) => `$${Number(n || 0).toLocaleString()}`;
const formatMinMiles = (tier) => (Number(tier.min_miles) === 0 ? `< ${tier.max_miles}` : String(tier.min_miles));

export default function DeliveryPricingAdmin() {
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    db.auth.me().then(u => { setCurrentUser(u); setCheckingAccess(false); }).catch(() => setCheckingAccess(false));
  }, []);

  useEffect(() => { loadTiers(); }, []);

  const loadTiers = async () => {
    setLoading(true);
    try {
      const list = await db.entities.DeliveryPricingTier.list('min_miles', 200);
      setTiers(list);
    } catch (e) {
      setTiers([]);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (tier) => {
    setEditId(tier.id);
    setForm({ min_miles: String(tier.min_miles), max_miles: String(tier.max_miles), cost_per_trip: String(tier.cost_per_trip) });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditId(null); setForm(emptyForm()); };

  const handleSave = async () => {
    const minMiles = parseFloat(form.min_miles);
    const maxMiles = parseFloat(form.max_miles);
    const cost = parseFloat(form.cost_per_trip);
    if (Number.isNaN(minMiles) || Number.isNaN(maxMiles) || Number.isNaN(cost)) {
      toast({ title: 'Min Miles, Max Miles, and Cost are all required', variant: 'destructive' });
      return;
    }
    if (maxMiles <= minMiles) {
      toast({ title: 'Max Miles must be greater than Min Miles', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const data = { min_miles: minMiles, max_miles: maxMiles, cost_per_trip: cost };
      if (editId) {
        await db.entities.DeliveryPricingTier.update(editId, data);
        toast({ title: 'Delivery pricing tier updated' });
      } else {
        await db.entities.DeliveryPricingTier.create(data);
        toast({ title: 'Delivery pricing tier added' });
      }
      closeModal();
      loadTiers();
    } catch (e) {
      toast({ title: 'Failed to save tier', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tier) => {
    if (!confirm(`Delete the ${formatMinMiles(tier)}–${tier.max_miles} mile tier?`)) return;
    try {
      await db.entities.DeliveryPricingTier.delete(tier.id);
      setTiers(prev => prev.filter(t => t.id !== tier.id));
      toast({ title: 'Delivery pricing tier deleted' });
      if (editId === tier.id) closeModal();
    } catch (e) {
      toast({ title: 'Failed to delete tier', variant: 'destructive' });
    }
  };

  if (checkingAccess) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!isAdminUser(currentUser)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Admin Access Required</h2>
        <p className="text-sm text-muted-foreground">You need administrator privileges to manage delivery pricing.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Delivery Pricing Tiers"
        subtitle="Flat delivery cost per trip, banded by round-trip mileage from the company address."
        actions={<Button onClick={openAdd} className="steel-gradient text-white border-0"><Plus className="w-4 h-4" />Add Tier</Button>}
      />

      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Min Miles</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Max Miles</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Cost</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center py-8"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></td></tr>
            ) : tiers.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-10 text-muted-foreground">
                  <Truck className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No delivery pricing tiers yet. Click "Add Tier" to create one.
                </td>
              </tr>
            ) : tiers.map(tier => (
              <tr key={tier.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-mono text-xs">{formatMinMiles(tier)}</td>
                <td className="px-4 py-3 font-mono text-xs">{tier.max_miles}</td>
                <td className="px-4 py-3 font-medium">{formatCurrency(tier.cost_per_trip)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(tier)}><Edit2 className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(tier)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Dialog open onOpenChange={closeModal}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? 'Edit Delivery Pricing Tier' : 'Add Delivery Pricing Tier'}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-2">
              <div>
                <Label>Min Miles</Label>
                <Input type="number" value={form.min_miles} onChange={e => setForm(f => ({ ...f, min_miles: e.target.value }))} placeholder="0" className="mt-1" />
              </div>
              <div>
                <Label>Max Miles</Label>
                <Input type="number" value={form.max_miles} onChange={e => setForm(f => ({ ...f, max_miles: e.target.value }))} placeholder="25" className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label>Cost per Trip</Label>
                <Input type="number" step="0.01" value={form.cost_per_trip} onChange={e => setForm(f => ({ ...f, cost_per_trip: e.target.value }))} placeholder="750" className="mt-1" />
              </div>
            </div>
            <DialogFooter className="flex items-center justify-between sm:justify-between">
              {editId ? (
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleDelete({ id: editId, min_miles: form.min_miles, max_miles: form.max_miles })}
                >
                  <Trash2 className="w-4 h-4" />Delete
                </Button>
              ) : <span />}
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={closeModal}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{editId ? 'Update' : 'Save'}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
