import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Building2, Plus, Search, Phone, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/ui/PageHeader';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

const TYPE_COLORS = {
  general_contractor: 'bg-blue-500/10 text-blue-500',
  owner: 'bg-purple-500/10 text-purple-500',
  engineer: 'bg-green-500/10 text-green-500',
  architect: 'bg-orange-500/10 text-orange-500',
  government: 'bg-red-500/10 text-red-500',
  other: 'bg-gray-500/10 text-gray-500',
};

export default function CRM() {
  const { toast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', customer_type: 'general_contractor', phone: '', email: '', city: '', state: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.Customer.filter({ is_active: true }, '-created_date', 100);
      setCustomers(data);
    } catch (e) {} finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      await base44.entities.Customer.create({ ...form, is_active: true });
      toast({ title: 'Customer added!' });
      setOpen(false);
      setForm({ name: '', customer_type: 'general_contractor', phone: '', email: '', city: '', state: '' });
      loadData();
    } catch (e) {
      toast({ title: 'Error saving customer', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const filtered = customers.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="CRM — Customers"
        subtitle={`${customers.length} active customers`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="steel-gradient text-white border-0"><Plus className="w-4 h-4 mr-2" />Add Customer</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Customer</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div><Label>Company Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1" /></div>
                <div>
                  <Label>Type</Label>
                  <Select value={form.customer_type} onValueChange={v => setForm(f => ({ ...f, customer_type: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['general_contractor','owner','engineer','architect','government','other'].map(t => (
                        <SelectItem key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>City</Label><Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} className="mt-1" /></div>
                  <div><Label>State</Label><Input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} className="mt-1" /></div>
                </div>
                <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="mt-1" /></div>
                <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="mt-1" /></div>
                <Button onClick={handleSave} disabled={saving || !form.name} className="w-full steel-gradient text-white border-0">
                  {saving ? 'Saving...' : 'Add Customer'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="relative max-w-sm mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 steel-card">
          <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No customers yet. Add your first customer to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(c => (
            <div key={c.id} className="steel-card p-5 hover:shadow-lg transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-blue-500" />
                </div>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[c.customer_type] || TYPE_COLORS.other}`}>
                  {c.customer_type?.replace(/_/g,' ').replace(/\b\w/g,ch=>ch.toUpperCase())}
                </span>
              </div>
              <h3 className="font-semibold mb-1">{c.name}</h3>
              {(c.city || c.state) && <p className="text-sm text-muted-foreground mb-3">{[c.city, c.state].filter(Boolean).join(', ')}</p>}
              <div className="space-y-1.5 text-xs text-muted-foreground">
                {c.email && <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5" />{c.email}</div>}
                {c.phone && <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5" />{c.phone}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}