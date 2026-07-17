import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Search, GitMerge, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

export default function CRMSync() {
  const { toast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [duplicates, setDuplicates] = useState([]);
  const [merging, setMerging] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.Customer.list('-created_date', 500);
      setCustomers(list);
      findDuplicates(list);
    } catch (e) { setCustomers([]); }
    finally { setLoading(false); }
  };

  const findDuplicates = (list) => {
    const groups = {};
    list.forEach(c => {
      const key = (c.name || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
      if (!key) return;
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    setDuplicates(Object.values(groups).filter(g => g.length > 1));
  };

  const handleMerge = async (primary, duplicate) => {
    setMerging(duplicate.id);
    try {
      await base44.entities.VendorPricingLink.updateMany(
        { vendor_id: duplicate.id },
        { $set: { vendor_id: primary.id, vendor_name: primary.name } }
      );
      await base44.entities.Bid.updateMany(
        { customer_id: duplicate.id },
        { $set: { customer_id: primary.id, customer_name: primary.name } }
      );
      await base44.entities.Project.updateMany(
        { customer_id: duplicate.id },
        { $set: { customer_id: primary.id, customer_name: primary.name } }
      );
      await base44.entities.Customer.delete(duplicate.id);
      toast({ title: `Merged "${duplicate.name}" into "${primary.name}"` });
      loadData();
    } catch (e) {
      toast({ title: 'Merge failed', variant: 'destructive' });
    } finally { setMerging(null); }
  };

  const filtered = customers.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.city?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">Master Customer List ({customers.length})</TabsTrigger>
          <TabsTrigger value="duplicates">Merge/Purge Tool ({duplicates.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="customers" className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
          </div>
          <div className="steel-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contact</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Location</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-8"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No customers found.</td></tr>
                ) : filtered.slice(0, 50).map(c => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-xs capitalize">{(c.customer_type || 'other').replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{c.primary_contact || c.email || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{[c.city, c.state].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium',
                        c.is_active ? 'bg-green-500/10 text-green-500' : 'bg-gray-500/10 text-gray-500')}>
                        {c.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 50 && <p className="text-xs text-muted-foreground">Showing first 50 of {filtered.length} records</p>}
        </TabsContent>

        <TabsContent value="duplicates">
          <div className="steel-card p-4 mb-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Duplicate Detection</p>
              <p className="text-xs text-muted-foreground">Found {duplicates.length} potential duplicate group(s). Merging reassigns all references (bids, projects, vendor pricing) to the primary record and deletes the duplicate.</p>
            </div>
          </div>
          {duplicates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
              <p className="text-sm text-muted-foreground">No duplicates detected. CRM records are clean.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {duplicates.map((group, i) => (
                <div key={i} className="steel-card p-4">
                  <p className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <GitMerge className="w-4 h-4 text-primary" /> Duplicate Group {i + 1}: "{group[0].name}"
                  </p>
                  <div className="space-y-2">
                    {group.map((c, idx) => (
                      <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                        <div>
                          <p className="text-sm font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.email || 'No email'} • {[c.city, c.state].filter(Boolean).join(', ') || 'No location'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {idx === 0 ? (
                            <span className="text-[10px] px-2 py-1 rounded bg-green-500/10 text-green-500 font-medium">PRIMARY</span>
                          ) : (
                            <Button size="sm" variant="outline" disabled={merging === c.id}
                              onClick={() => handleMerge(group[0], c)}>
                              {merging === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Merge into Primary'}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}