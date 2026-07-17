import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Search, Plus, Trash2, Edit2, Loader2, RefreshCw, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

export default function TaxZoneLookup() {
  const { toast } = useToast();
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [apiEnabled, setApiEnabled] = useState(false);
  const [apiProvider, setApiProvider] = useState('avatax');
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ zip_code: '', city: '', state: '', county: '', tax_percentage: '' });

  useEffect(() => { loadRates(); }, []);

  const loadRates = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.TaxRate.filter({ is_active: true }, '-created_date', 200);
      setRates(list);
    } catch (e) { setRates([]); }
    finally { setLoading(false); }
  };

  const filtered = rates.filter(r =>
    r.zip_code?.includes(search) || r.city?.toLowerCase().includes(search.toLowerCase()) ||
    r.state?.toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = async () => {
    try {
      const data = { ...form, tax_percentage: parseFloat(form.tax_percentage) || 0 };
      if (editId) {
        await base44.entities.TaxRate.update(editId, data);
        toast({ title: 'Tax rate updated' });
      } else {
        await base44.entities.TaxRate.create(data);
        toast({ title: 'Tax rate added' });
      }
      setShowAdd(false); setEditId(null);
      setForm({ zip_code: '', city: '', state: '', county: '', tax_percentage: '' });
      loadRates();
    } catch (e) { toast({ title: 'Failed to save', variant: 'destructive' }); }
  };

  const handleEdit = (rate) => {
    setEditId(rate.id);
    setForm({ zip_code: rate.zip_code, city: rate.city, state: rate.state, county: rate.county || '', tax_percentage: String(rate.tax_percentage) });
    setShowAdd(true);
  };

  const handleDelete = async (rate) => {
    if (!confirm(`Delete tax rate for ${rate.zip_code}?`)) return;
    try {
      await base44.entities.TaxRate.update(rate.id, { is_active: false });
      setRates(prev => prev.filter(r => r.id !== rate.id));
      toast({ title: 'Tax rate deleted' });
    } catch (e) { toast({ title: 'Failed to delete', variant: 'destructive' }); }
  };

  const handleApiSync = () => {
    toast({ title: 'API sync requires Builder+ backend function', description: `Configure ${apiProvider === 'avatax' ? 'AvaTax' : 'Vertex'} credentials in the Integrations tab` });
  };

  return (
    <div className="space-y-4">
      <div className="steel-card p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="w-5 h-5 text-primary" />
          <div>
            <p className="text-sm font-medium">Automated Tax Lookup API</p>
            <p className="text-xs text-muted-foreground">Connect to AvaTax or Vertex for real-time rate sync</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={apiProvider} onValueChange={setApiProvider} disabled={!apiEnabled}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="avatax">AvaTax</SelectItem>
              <SelectItem value="vertex">Vertex</SelectItem>
            </SelectContent>
          </Select>
          <Switch checked={apiEnabled} onCheckedChange={setApiEnabled} />
          {apiEnabled && <Button size="sm" variant="outline" onClick={handleApiSync}><RefreshCw className="w-3.5 h-3.5" />Sync</Button>}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by ZIP, city, state..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Button onClick={() => { setEditId(null); setForm({ zip_code: '', city: '', state: '', county: '', tax_percentage: '' }); setShowAdd(true); }} className="steel-gradient text-white border-0">
          <Plus className="w-4 h-4" />Add Tax Rate
        </Button>
      </div>

      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">ZIP Code</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">City</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">State</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">County</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Tax %</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Source</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No tax rates found. Click "Add Tax Rate" to create one.</td></tr>
            ) : filtered.map(rate => (
              <tr key={rate.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-mono text-xs">{rate.zip_code}</td>
                <td className="px-4 py-3">{rate.city || '—'}</td>
                <td className="px-4 py-3">{rate.state || '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">{rate.county || '—'}</td>
                <td className="px-4 py-3 text-right font-medium">{rate.tax_percentage?.toFixed(2)}%</td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${rate.source === 'manual' ? 'bg-gray-500/10 text-gray-500' : 'bg-blue-500/10 text-blue-500'}`}>
                    {rate.source === 'manual' ? 'MANUAL' : rate.source?.toUpperCase()}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(rate)}><Edit2 className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(rate)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <Dialog open onOpenChange={() => { setShowAdd(false); setEditId(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? 'Edit Tax Rate' : 'Add Tax Rate'}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-2">
              <div><Label>ZIP Code</Label><Input value={form.zip_code} onChange={e => setForm(f => ({ ...f, zip_code: e.target.value }))} className="mt-1" /></div>
              <div><Label>Tax Percentage (%)</Label><Input type="number" step="0.01" value={form.tax_percentage} onChange={e => setForm(f => ({ ...f, tax_percentage: e.target.value }))} className="mt-1" /></div>
              <div><Label>City</Label><Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} className="mt-1" /></div>
              <div><Label>State</Label><Input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} className="mt-1" /></div>
              <div className="col-span-2"><Label>County (optional)</Label><Input value={form.county} onChange={e => setForm(f => ({ ...f, county: e.target.value }))} className="mt-1" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowAdd(false); setEditId(null); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={!form.zip_code || !form.tax_percentage} className="steel-gradient text-white border-0">{editId ? 'Update' : 'Add'} Tax Rate</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}