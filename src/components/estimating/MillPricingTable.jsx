import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { Factory, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

const MILLS = [
  { value: 'nucor', label: 'Nucor' },
  { value: 'gerdau', label: 'Gerdau' },
  { value: 'steel_dynamics', label: 'Steel Dynamics' },
  { value: 'cmc', label: 'CMC' },
  { value: 'berger', label: 'Berger' },
  { value: 'other', label: 'Other' },
];

const PRODUCTS = ['wide_flange', 'hss', 'angle', 'channel', 'plate', 'bar', 'rebar'];

export default function MillPricingTable({ bid }) {
  const { toast } = useToast();
  const [pricing, setPricing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ mill_name: 'nucor', product_type: 'wide_flange', grade: '', price_per_ton: '', surcharge_per_ton: '', freight_per_ton: '', effective_date: new Date().toISOString().split('T')[0] });
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await db.entities.MillPricing.filter({ is_active: true }, '-effective_date', 100);
      setPricing(data);
    } catch (e) {} finally { setLoading(false); }
  };

  const handleAdd = async () => {
    if (!form.price_per_ton) return;
    setSaving(true);
    try {
      await db.entities.MillPricing.create({
        mill_name: form.mill_name,
        mill_display_name: MILLS.find(m => m.value === form.mill_name)?.label || form.mill_name,
        product_type: form.product_type,
        grade: form.grade || null,
        price_per_ton: parseFloat(form.price_per_ton),
        price_per_cwt: parseFloat(form.price_per_ton) / 20,
        effective_date: form.effective_date,
        surcharge_per_ton: parseFloat(form.surcharge_per_ton) || 0,
        freight_per_ton: parseFloat(form.freight_per_ton) || 0,
        is_active: true,
      });
      toast({ title: 'Mill price added!' });
      setOpen(false);
      setForm({ mill_name: 'nucor', product_type: 'wide_flange', grade: '', price_per_ton: '', surcharge_per_ton: '', freight_per_ton: '', effective_date: new Date().toISOString().split('T')[0] });
      loadData();
    } catch (e) { toast({ title: 'Error', variant: 'destructive' }); } finally { setSaving(false); }
  };

  const filtered = pricing.filter(p =>
    !search || p.mill_display_name?.toLowerCase().includes(search.toLowerCase()) || p.product_type?.toLowerCase().includes(search.toLowerCase())
  );

  // If bid has estimated tons, show a material cost calc based on lowest WF price
  const lowestWF = pricing.filter(p => p.product_type === 'wide_flange').sort((a, b) => (a.price_per_ton + (a.freight_per_ton || 0)) - (b.price_per_ton + (b.freight_per_ton || 0)))[0];
  const estMaterialCost = bid?.estimated_tons && lowestWF ? bid.estimated_tons * (lowestWF.price_per_ton + (lowestWF.surcharge_per_ton || 0) + (lowestWF.freight_per_ton || 0)) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-semibold flex items-center gap-2"><Factory className="w-4 h-4 text-primary" />Live Mill Price-Book Sync</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Master table of live base-metal pricing per ton from domestic mills.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="steel-gradient text-white border-0"><Plus className="w-3.5 h-3.5 mr-1" />Add Price</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Mill Price</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label>Mill</Label><Select value={form.mill_name} onValueChange={v => setForm(f => ({ ...f, mill_name: v }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{MILLS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Product Type</Label><Select value={form.product_type} onValueChange={v => setForm(f => ({ ...f, product_type: v }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{PRODUCTS.map(p => <SelectItem key={p} value={p}>{p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Grade</Label><Input value={form.grade} onChange={e => setForm(f => ({ ...f, grade: e.target.value }))} className="mt-1" placeholder="e.g. A992, A500" /></div>
              <div><Label>Price per Ton ($)</Label><Input type="number" value={form.price_per_ton} onChange={e => setForm(f => ({ ...f, price_per_ton: e.target.value }))} className="mt-1" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Surcharge/Ton ($)</Label><Input type="number" value={form.surcharge_per_ton} onChange={e => setForm(f => ({ ...f, surcharge_per_ton: e.target.value }))} className="mt-1" /></div>
                <div><Label>Freight/Ton ($)</Label><Input type="number" value={form.freight_per_ton} onChange={e => setForm(f => ({ ...f, freight_per_ton: e.target.value }))} className="mt-1" /></div>
              </div>
              <div><Label>Effective Date</Label><Input type="date" value={form.effective_date} onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))} className="mt-1" /></div>
              <Button onClick={handleAdd} disabled={saving || !form.price_per_ton} className="w-full steel-gradient text-white border-0">{saving ? 'Saving…' : 'Add Price'}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {estMaterialCost && (
        <div className="steel-card p-4 bg-primary/5 flex items-center gap-3">
          <Factory className="w-5 h-5 text-primary" />
          <p className="text-sm">
            <span className="text-muted-foreground">Est. Structural Material Cost (based on lowest WF rate from {lowestWF?.mill_display_name}): </span>
            <strong className="text-primary">${estMaterialCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
            <span className="text-muted-foreground"> ({bid.estimated_tons} tons × ${(lowestWF.price_per_ton + (lowestWF.surcharge_per_ton || 0) + (lowestWF.freight_per_ton || 0)).toLocaleString()}/ton)</span>
          </p>
        </div>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search mill pricing…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-3 px-4">Mill</th>
                <th className="text-left py-3 px-4">Product</th>
                <th className="text-left py-3 px-4">Grade</th>
                <th className="text-right py-3 px-4">$/Ton</th>
                <th className="text-right py-3 px-4">Surcharge</th>
                <th className="text-right py-3 px-4">Freight</th>
                <th className="text-right py-3 px-4">Delivered $/Ton</th>
                <th className="text-left py-3 px-4">Effective</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={8} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">No mill pricing data. Add prices to enable material cost calculation.</td></tr>
              ) : (
                filtered.map(p => {
                  const delivered = (p.price_per_ton || 0) + (p.surcharge_per_ton || 0) + (p.freight_per_ton || 0);
                  return (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-muted/50">
                      <td className="py-3 px-4 font-medium">{p.mill_display_name}</td>
                      <td className="py-3 px-4"><span className="text-xs bg-muted px-2 py-0.5 rounded">{p.product_type?.replace(/_/g, ' ')}</span></td>
                      <td className="py-3 px-4 text-muted-foreground">{p.grade || '—'}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold">${p.price_per_ton?.toLocaleString() || '—'}</td>
                      <td className="py-3 px-4 text-right font-mono text-muted-foreground">${p.surcharge_per_ton?.toLocaleString() || '0'}</td>
                      <td className="py-3 px-4 text-right font-mono text-muted-foreground">${p.freight_per_ton?.toLocaleString() || '0'}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-primary">${delivered.toLocaleString()}</td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">{p.effective_date}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}