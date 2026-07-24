import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, ExternalLink, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';

export default function BidNew() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customer_id: '',
    customer_name: '',
    general_contractor_id: '',
    general_contractor_name: '',
    job_name: '',
    job_location: '',
    bid_due_date: '',
  });
  const [errors, setErrors] = useState({});

  useEffect(() => { loadCRM(); }, []);

  const loadCRM = async () => {
    try {
      const data = await base44.entities.Customer.filter({ is_active: true }, 'name', 200);
      setCustomers(data.filter(c => ['general_contractor', 'owner', 'other'].includes(c.customer_type)));
      setVendors(data.filter(c => c.customer_type === 'general_contractor'));
    } catch (e) {}
  };

  const validate = () => {
    const errs = {};
    if (!form.customer_name) errs.customer_name = 'Customer name is required';
    if (!form.general_contractor_name) errs.general_contractor_name = 'General contractor is required';
    if (!form.job_name) errs.job_name = 'Job name is required';
    if (!form.job_location) errs.job_location = 'Job location is required';
    if (!form.bid_due_date) errs.bid_due_date = 'Bid due date is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      toast({ title: 'Please fill all required fields', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const yearSuffix = String(new Date().getFullYear()).slice(-2);
      const allBids = await base44.entities.Bid.list('-created_date', 500);
      const currentYearBids = allBids.filter(b => String(b.bid_number || '').startsWith(`${yearSuffix}-`));
      const maxNum = currentYearBids.reduce((max, b) => {
        const n = parseInt(String(b.bid_number || '').split('-')[1] || '0', 10);
        return n > max ? n : max;
      }, 0);
      const bidNumber = `${yearSuffix}-${String(maxNum + 1).padStart(3, '0')}`;

      // Parse city/state from job_location
      const locParts = form.job_location.split(',').map(s => s.trim());
      const job_city = locParts[0] || '';
      const job_state = locParts[1] || '';

      const bid = await base44.entities.Bid.create({
        bid_number: bidNumber,
        customer_id: form.customer_id || null,
        customer_name: form.customer_name,
        general_contractor_id: form.general_contractor_id || null,
        general_contractor_name: form.general_contractor_name,
        job_name: form.job_name,
        job_location: form.job_location,
        job_city,
        job_state,
        bid_due_date: form.bid_due_date,
        status: 'draft',
        front_end_review_status: 'not_started',
      });
      toast({ title: `Bid ${bidNumber} created!` });
      navigate(`/estimating/${bid.id}`);
    } catch (e) {
      toast({ title: 'Failed to create bid', description: e.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const fieldProps = (name) => ({
    value: form[name],
    onChange: e => setForm(f => ({ ...f, [name]: e.target.value })),
    className: `mt-1 ${errors[name] ? 'border-red-500' : ''}`,
  });

  return (
    <div className="p-6 animate-fade-in max-w-3xl">
      <Button variant="ghost" size="sm" onClick={() => navigate('/estimating')} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-1" />Back to Estimating
      </Button>
      <PageHeader title="Add Bid" subtitle="Create a new bid opportunity — a unique bid number is generated automatically." />

      <div className="steel-card p-6 space-y-5">
        {/* Customer */}
        <div>
          <Label>Customer Name <span className="text-red-500">*</span></Label>
          <div className="flex gap-2 mt-1">
            <Input list="customer-list" placeholder="Select or type customer name" {...fieldProps('customer_name')}
              onChange={e => {
                setForm(f => ({ ...f, customer_name: e.target.value }));
                const match = customers.find(c => c.name === e.target.value);
                setForm(f => ({ ...f, customer_name: e.target.value, customer_id: match?.id || '' }));
              }} />
            <datalist id="customer-list">
              {customers.map(c => <option key={c.id} value={c.name} />)}
            </datalist>
            <a href="/crm" target="_blank" className="flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap px-2">
              <ExternalLink className="w-3.5 h-3.5" />CRM
            </a>
          </div>
          {errors.customer_name && <p className="text-xs text-red-500 mt-1">{errors.customer_name}</p>}
        </div>

        {/* General Contractor */}
        <div>
          <Label>General Contractor <span className="text-red-500">*</span></Label>
          <div className="flex gap-2 mt-1">
            <Input list="gc-list" placeholder="Select or type GC name" {...fieldProps('general_contractor_name')}
              onChange={e => {
                setForm(f => ({ ...f, general_contractor_name: e.target.value }));
                const match = vendors.find(c => c.name === e.target.value);
                setForm(f => ({ ...f, general_contractor_name: e.target.value, general_contractor_id: match?.id || '' }));
              }} />
            <datalist id="gc-list">
              {vendors.map(c => <option key={c.id} value={c.name} />)}
            </datalist>
            <a href="/crm" target="_blank" className="flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap px-2">
              <ExternalLink className="w-3.5 h-3.5" />CRM
            </a>
          </div>
          {errors.general_contractor_name && <p className="text-xs text-red-500 mt-1">{errors.general_contractor_name}</p>}
        </div>

        {/* Job Name */}
        <div>
          <Label>Job Name <span className="text-red-500">*</span></Label>
          <Input placeholder="e.g. Downtown Office Tower — Structural Steel" {...fieldProps('job_name')} />
          {errors.job_name && <p className="text-xs text-red-500 mt-1">{errors.job_name}</p>}
        </div>

        {/* Job Location */}
        <div>
          <Label>Job Location <span className="text-red-500">*</span></Label>
          <Input placeholder="City, State (used for tax rate lookup)" {...fieldProps('job_location')} />
          {errors.job_location && <p className="text-xs text-red-500 mt-1">{errors.job_location}</p>}
        </div>

        {/* Bid Due Date */}
        <div>
          <Label>Bid Due Date <span className="text-red-500">*</span></Label>
          <Input type="date" {...fieldProps('bid_due_date')} />
          {errors.bid_due_date && <p className="text-xs text-red-500 mt-1">{errors.bid_due_date}</p>}
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSubmit} disabled={saving} className="steel-gradient text-white border-0 min-w-48">
            <Save className="w-4 h-4 mr-2" />{saving ? 'Creating…' : 'Create Bid Opportunity'}
          </Button>
        </div>
      </div>
    </div>
  );
}