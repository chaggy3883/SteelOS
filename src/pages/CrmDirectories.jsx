import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, Building2, Phone, Mail } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// theme-invert-toggle (src/components/ui/toggle.jsx) always forces this
// component onto a light/white surface in dark mode, so text must stay dark
// regardless of theme — bg-primary/text-primary-foreground would be invisible.
const TOGGLE_ITEM_CLASS = 'px-4 font-medium text-black data-[state=on]:text-primary data-[state=on]:font-semibold data-[state=on]:ring-2 data-[state=on]:ring-inset data-[state=on]:ring-primary';

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
  const [filter, setFilter] = useState('customers');
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [customerData, vendorData] = await Promise.all([
        base44.entities.Customer.filter({ is_active: true }, '-created_date', 200),
        base44.entities.Vendor.filter({ is_active: true }, '-created_date', 200),
      ]);
      setCustomers(customerData);
      setVendors(vendorData);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const rows = filter === 'customers' ? customers
    : filter === 'vendors' ? vendors
    : [...customers, ...vendors];

  return (
    <div className="p-6 w-full max-w-none space-y-4 animate-fade-in">
      <PageHeader
        title="Relationship Manager"
        subtitle="A unified directory of customers and vendors."
        icon={Building2}
      />

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
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No records found.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t">
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
    </div>
  );
}
