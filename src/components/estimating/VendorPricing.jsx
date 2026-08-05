import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { Plus, Link as LinkIcon, Trash2, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

const PROCUREMENT_CATEGORIES = [
  { key: 'detailing_engineering', label: 'Detailing and Engineering' },
  { key: 'erection', label: 'Erection' },
  { key: 'joist_deck', label: 'Joist and Deck' },
  { key: 'misc_metals', label: 'Misc. Metals' },
  { key: 'rolling', label: 'Rolling' },
  { key: 'steel_materials', label: 'Steel Materials' },
];

export default function VendorPricing({ bidId }) {
  const { toast } = useToast();
  const [links, setLinks] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openCat, setOpenCat] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ vendor_id: '', vendor_name: '', quoted_amount: '', unit_cost: '', unit_of_measure: '', cost_sheet_url: '', notes: '' });

  useEffect(() => { loadData(); }, [bidId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [linkData, custData] = await Promise.all([
        db.entities.VendorPricingLink.filter({ bid_id: bidId }, '-created_date', 100),
        db.entities.Customer.filter({ is_active: true }, 'name', 100),
      ]);
      setLinks(linkData);
      setCustomers(custData);
    } catch (e) {} finally { setLoading(false); }
  };

  const handleAdd = async (catKey) => {
    if (!form.vendor_name && !form.vendor_id) return;
    setSaving(true);
    try {
      const vendor = customers.find(c => c.id === form.vendor_id);
      await db.entities.VendorPricingLink.create({
        bid_id: bidId,
        vendor_id: form.vendor_id || null,
        vendor_name: form.vendor_name || vendor?.name || '',
        procurement_category: catKey,
        cost_sheet_url: form.cost_sheet_url || null,
        quoted_amount: parseFloat(form.quoted_amount) || 0,
        unit_cost: parseFloat(form.unit_cost) || 0,
        unit_of_measure: form.unit_of_measure || '',
        notes: form.notes || '',
        is_approved: false,
      });
      toast({ title: 'Vendor pricing link added!' });
      setOpenCat(null);
      setForm({ vendor_id: '', vendor_name: '', quoted_amount: '', unit_cost: '', unit_of_measure: '', cost_sheet_url: '', notes: '' });
      loadData();
    } catch (e) {
      toast({ title: 'Error', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const toggleApprove = async (link) => {
    await db.entities.VendorPricingLink.update(link.id, { is_approved: !link.is_approved });
    loadData();
  };

  const handleDelete = async (link) => {
    await db.entities.VendorPricingLink.delete(link.id);
    loadData();
  };

  return (
    <div className="space-y-4">
      {PROCUREMENT_CATEGORIES.map(cat => {
        const catLinks = links.filter(l => l.procurement_category === cat.key);
        return (
          <div key={cat.key} className="steel-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="font-semibold text-sm">{cat.label}</h4>
                <p className="text-xs text-muted-foreground">{catLinks.length} vendor quote(s)</p>
              </div>
              <Dialog open={openCat === cat.key} onOpenChange={(o) => { setOpenCat(o ? cat.key : null); if (!o) setForm({ vendor_id: '', vendor_name: '', quoted_amount: '', unit_cost: '', unit_of_measure: '', cost_sheet_url: '', notes: '' }); }}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline"><Plus className="w-3.5 h-3.5 mr-1" />Add</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Vendor Pricing — {cat.label}</DialogTitle></DialogHeader>
                  <div className="space-y-3 py-2">
                    <div>
                      <Label>Vendor (from CRM)</Label>
                      <Select value={form.vendor_id} onValueChange={v => setForm(f => ({ ...f, vendor_id: v, vendor_name: customers.find(c => c.id === v)?.name || '' }))}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Select vendor / GC" /></SelectTrigger>
                        <SelectContent>
                          {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <a href="/crm" target="_blank" className="text-xs text-primary hover:underline mt-1 inline-flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" />Open CRM to add new vendor
                      </a>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Quoted Amount ($)</Label><Input type="number" value={form.quoted_amount} onChange={e => setForm(f => ({ ...f, quoted_amount: e.target.value }))} className="mt-1" /></div>
                      <div><Label>Unit Cost ($)</Label><Input type="number" value={form.unit_cost} onChange={e => setForm(f => ({ ...f, unit_cost: e.target.value }))} className="mt-1" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Unit of Measure</Label><Input placeholder="tons, ea, lot" value={form.unit_of_measure} onChange={e => setForm(f => ({ ...f, unit_of_measure: e.target.value }))} className="mt-1" /></div>
                      <div><Label>Cost Sheet URL</Label><Input placeholder="https://…" value={form.cost_sheet_url} onChange={e => setForm(f => ({ ...f, cost_sheet_url: e.target.value }))} className="mt-1" /></div>
                    </div>
                    <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="mt-1" /></div>
                    <Button onClick={() => handleAdd(cat.key)} disabled={saving || (!form.vendor_name && !form.vendor_id)} className="w-full steel-gradient text-white border-0">
                      {saving ? 'Adding…' : 'Add Vendor Pricing'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            {loading ? (
              <div className="h-16 bg-muted rounded animate-pulse" />
            ) : catLinks.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4">No vendor quotes linked yet.</p>
            ) : (
              <div className="space-y-2">
                {catLinks.map(link => (
                  <div key={link.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{link.vendor_name || 'Unknown Vendor'}</p>
                        {link.is_approved
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 font-medium">APPROVED</span>
                          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-500 font-medium">PENDING</span>
                        }
                      </div>
                      <p className="text-xs text-muted-foreground">
                        ${link.quoted_amount?.toLocaleString() || 0}{link.unit_cost ? ` · $${link.unit_cost}/${link.unit_of_measure || 'unit'}` : ''}
                      </p>
                    </div>
                    {link.cost_sheet_url && (
                      <a href={link.cost_sheet_url} target="_blank" rel="noreferrer">
                        <Button variant="ghost" size="icon" className="h-8 w-8"><LinkIcon className="w-3.5 h-3.5" /></Button>
                      </a>
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleApprove(link)}>
                      <Check className={`w-3.5 h-3.5 ${link.is_approved ? 'text-green-500' : 'text-muted-foreground'}`} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(link)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}