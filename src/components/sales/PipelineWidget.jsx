import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, TrendingUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { db } from '@/api/apiClient';
import { getPipelineBids, bucketPipeline } from '@/lib/salesDashboardData';

const CUSTOMER_TYPE_LABELS = {
  general_contractor: 'General Contractor',
  owner: 'Owner',
  engineer: 'Engineer',
  architect: 'Architect',
  government: 'Government',
  fabricator_subcontractor: 'Fabricator/Subcontractor',
  other: 'Other',
};

const STAGES = [
  { key: 'prospects', label: 'Prospects' },
  { key: 'quotes', label: 'Quotes Submitted' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function PipelineWidget({ salesmanId }) {
  const navigate = useNavigate();
  const [bids, setBids] = useState([]);
  const [customerTypeById, setCustomerTypeById] = useState({});
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minRevenue, setMinRevenue] = useState('');
  const [customerType, setCustomerType] = useState('');

  useEffect(() => {
    setLoading(true);
    getPipelineBids(salesmanId)
      .then(async (rows) => {
        setBids(rows);
        const customerIds = [...new Set(rows.map((b) => b.customer_id).filter(Boolean))];
        const customers = await Promise.all(customerIds.map((id) => db.entities.Customer.get(id).catch(() => null)));
        const map = {};
        customers.filter(Boolean).forEach((c) => { map[c.id] = c.customer_type; });
        setCustomerTypeById(map);
      })
      .catch(() => setBids([]))
      .finally(() => setLoading(false));
  }, [salesmanId]);

  const filtered = useMemo(() => bids.filter((b) => {
    if (dateFrom && (b.bid_due_date || '') < dateFrom) return false;
    if (dateTo && (b.bid_due_date || '') > dateTo) return false;
    if (minRevenue && (Number(b.bid_quoted_price) || 0) < Number(minRevenue)) return false;
    if (customerType && customerTypeById[b.customer_id] !== customerType) return false;
    return true;
  }), [bids, dateFrom, dateTo, minRevenue, customerType, customerTypeById]);

  const buckets = useMemo(() => bucketPipeline(filtered), [filtered]);

  const openBid = (bid) => {
    if (bid.won_project_id) navigate(`/projects/${bid.won_project_id}`);
    else navigate(`/estimating/${bid.id}`);
  };

  return (
    <div className="steel-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">Sales Pipeline</h3>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs mt-1" />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">To</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs mt-1" />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Min Revenue</Label>
          <Input type="number" placeholder="$" value={minRevenue} onChange={(e) => setMinRevenue(e.target.value)} className="h-8 text-xs mt-1 w-28" />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Customer Type</Label>
          <select value={customerType} onChange={(e) => setCustomerType(e.target.value)} className="h-8 text-xs mt-1 rounded-md border border-input bg-input/40 px-2">
            <option value="">All</option>
            {Object.entries(CUSTOMER_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {STAGES.map((stage) => (
            <div key={stage.key} className="border border-border rounded-lg p-3">
              <p className="text-xs text-muted-foreground">{stage.label}</p>
              <p className="text-2xl font-bold mt-1">{buckets[stage.key].length}</p>
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {buckets[stage.key].slice(0, 8).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => openBid(b)}
                    className="block w-full text-left text-xs truncate hover:underline text-primary"
                    title={`${b.job_name} — ${money(b.bid_quoted_price)}`}
                  >
                    {b.job_name || b.bid_number}
                  </button>
                ))}
                {buckets[stage.key].length === 0 && <p className="text-xs text-muted-foreground">None</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
