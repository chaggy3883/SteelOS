import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Loader2, Building2, Phone, Mail, Search } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

// theme-invert-toggle (src/index.css) forces this component onto a light
// surface in dark mode too (unselected: forced white bg; selected: solid
// blue bg via Tailwind's data-[state=on]:bg-accent), so unselected text must
// stay dark regardless of theme — text-foreground would go near-white in
// dark mode and vanish against that forced-light surface. Selected text
// uses accent-foreground (white), not primary — primary and accent resolve
// to the same blue hue here, so text-primary on bg-accent was invisible.
const TOGGLE_ITEM_CLASS = 'px-4 font-medium text-black data-[state=on]:text-accent-foreground data-[state=on]:font-semibold data-[state=on]:ring-2 data-[state=on]:ring-inset data-[state=on]:ring-primary';

const TYPE_COLORS = {
  general_contractor: 'bg-blue-500/10 text-blue-500',
  owner: 'bg-purple-500/10 text-purple-500',
  engineer: 'bg-green-500/10 text-green-500',
  architect: 'bg-orange-500/10 text-orange-500',
  government: 'bg-red-500/10 text-red-500',
  subcontractor: 'bg-cyan-500/10 text-cyan-500',
  supplier: 'bg-amber-500/10 text-amber-500',
  equipment_rental: 'bg-pink-500/10 text-pink-500',
  carrier: 'bg-indigo-500/10 text-indigo-500',
  other: 'bg-gray-500/10 text-gray-500',
};

export default function CrmDirectories() {
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState(searchParams.get('vendor') ? 'vendors' : 'customers');
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewingRecord, setViewingRecord] = useState(null);

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    const vendorId = searchParams.get('vendor');
    if (!vendorId || vendors.length === 0) return;
    const match = vendors.find(v => v.id === vendorId);
    if (match) setViewingRecord(match);
  }, [searchParams, vendors]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [customerData, vendorData] = await Promise.all([
        db.entities.Customer.filter({ is_active: true }, '-created_date', 200),
        db.entities.Vendor.filter({ is_active: true }, '-created_date', 200),
      ]);
      setCustomers(customerData);
      setVendors(vendorData);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const rows = filter === 'customers' ? customers
    : filter === 'vendors' ? vendors
    : [...customers, ...vendors];

  const filteredRows = rows.filter((r) => r.name?.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="p-6 w-full max-w-none space-y-4 animate-fade-in">
      <PageHeader
        title="Relationship Manager"
        subtitle="A unified directory of customers and vendors."
        icon={Building2}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v)}
          className="justify-start bg-muted/40 p-1 rounded-lg w-fit"
        >
          <ToggleGroupItem value="customers" className={TOGGLE_ITEM_CLASS}>Customers</ToggleGroupItem>
          <ToggleGroupItem value="vendors" className={TOGGLE_ITEM_CLASS}>Vendors</ToggleGroupItem>
          <ToggleGroupItem value="both" className={TOGGLE_ITEM_CLASS}>Both</ToggleGroupItem>
        </ToggleGroup>

        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Type</th>
                <th className="p-3 font-medium">Phone</th>
                <th className="p-3 font-medium">Email</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No records found.</td></tr>
              ) : filteredRows.map((r) => (
                <tr key={r.id} onClick={() => setViewingRecord(r)} className="border-t cursor-pointer hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[r.customer_type || r.vendor_type] || TYPE_COLORS.other}`}>
                      {(r.customer_type || r.vendor_type || 'other').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="p-3">
                    {r.phone ? <span className="inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-muted-foreground" />{r.phone}</span> : '—'}
                  </td>
                  <td className="p-3">
                    {r.email ? <span className="inline-flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-muted-foreground" />{r.email}</span> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!viewingRecord} onOpenChange={(next) => !next && setViewingRecord(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          {viewingRecord && (() => {
            const r = viewingRecord;
            const isCustomer = r.customer_type !== undefined;
            return (
              <>
                <DialogHeader><DialogTitle>{r.name}</DialogTitle></DialogHeader>
                <div className="space-y-3 text-sm">
                  <span className={`inline-block text-xs px-2.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[r.customer_type || r.vendor_type] || TYPE_COLORS.other}`}>
                    {(r.customer_type || r.vendor_type || 'other').replace(/_/g, ' ')}
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    {isCustomer && (
                      <div>
                        <p className="text-xs text-muted-foreground">Address</p>
                        <p className="font-medium">{[r.city, r.state].filter(Boolean).join(', ') || '—'}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground">Phone</p>
                      <p className="font-medium">{r.phone || '—'}</p>
                    </div>
                    <div className={isCustomer ? '' : 'col-span-2'}>
                      <p className="text-xs text-muted-foreground">Email</p>
                      <p className="font-medium">{r.email || '—'}</p>
                    </div>
                    {isCustomer && r.website && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground">Website</p>
                        <p className="font-medium">{r.website}</p>
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <h4 className="text-sm font-semibold">Contacts</h4>
                    {isCustomer ? (
                      !Array.isArray(r.contacts) || r.contacts.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No contacts on file.</p>
                      ) : (
                        r.contacts.map((contact) => (
                          <div key={contact.id} className="rounded border border-border p-2 text-xs">
                            <p className="font-medium">{contact.name}</p>
                            <p className="text-muted-foreground">{contact.title || 'Contact'} • {contact.email || '—'} • {contact.phone || '—'}</p>
                          </div>
                        ))
                      )
                    ) : r.contact_name ? (
                      <p className="text-xs font-medium">{r.contact_name}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">No contacts on file.</p>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setViewingRecord(null)}>Close</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
