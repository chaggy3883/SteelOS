import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, FolderKanban, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

export default function ProjectNew() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    project_number: '',
    name: '',
    description: '',
    project_type: 'commercial',
    status: 'estimating',
    customer_name: '',
    contract_value: '',
    estimated_tons: '',
    bid_date: '',
    completion_date: '',
    address: '',
    city: '',
    state: '',
    risk_level: 'low',
    health_score: 100,
  });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.project_number || !form.name) {
      toast({ title: 'Required fields missing', description: 'Project number and name are required.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const project = await base44.entities.Project.create({
        ...form,
        contract_value: form.contract_value ? parseFloat(form.contract_value) : null,
        estimated_tons: form.estimated_tons ? parseFloat(form.estimated_tons) : null,
        is_archived: false,
        is_pinned: false,
      });
      toast({ title: 'Project created!', description: `${form.name} has been created successfully.` });
      navigate(`/projects/${project.id}`);
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to create project.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/projects">
          <Button variant="ghost" size="icon" className="rounded-lg">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">New Project</h1>
          <p className="text-sm text-muted-foreground">Create a new structural steel project</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="steel-card p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <FolderKanban className="w-4 h-4 text-primary" /> Project Information
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Project Number *</Label>
              <Input placeholder="e.g. 2025-001" value={form.project_number} onChange={e => set('project_number', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Project Status</Label>
              <Select value={form.status} onValueChange={v => set('status', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['lead','estimating','awarded','engineering','fabrication','erection','complete','cancelled'].map(s => (
                    <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Project Name *</Label>
              <Input placeholder="e.g. Downtown Office Tower — Structural Steel" value={form.name} onChange={e => set('name', e.target.value)} className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <Label>Description</Label>
              <Textarea placeholder="Brief project description..." value={form.description} onChange={e => set('description', e.target.value)} className="mt-1" rows={3} />
            </div>
            <div>
              <Label>Project Type</Label>
              <Select value={form.project_type} onValueChange={v => set('project_type', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['commercial','industrial','bridge','miscellaneous','residential','government'].map(s => (
                    <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Risk Level</Label>
              <Select value={form.risk_level} onValueChange={v => set('risk_level', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['low','medium','high','critical'].map(s => (
                    <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Customer & Financials */}
        <div className="steel-card p-6">
          <h2 className="font-semibold mb-4">Customer & Financial</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label>Customer / General Contractor</Label>
              <Input placeholder="Customer name" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Contract Value ($)</Label>
              <Input type="number" placeholder="0.00" value={form.contract_value} onChange={e => set('contract_value', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Estimated Tons</Label>
              <Input type="number" placeholder="0" value={form.estimated_tons} onChange={e => set('estimated_tons', e.target.value)} className="mt-1" />
            </div>
          </div>
        </div>

        {/* Schedule */}
        <div className="steel-card p-6">
          <h2 className="font-semibold mb-4">Schedule</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Bid Date</Label>
              <Input type="date" value={form.bid_date} onChange={e => set('bid_date', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Completion Date</Label>
              <Input type="date" value={form.completion_date} onChange={e => set('completion_date', e.target.value)} className="mt-1" />
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="steel-card p-6">
          <h2 className="font-semibold mb-4">Project Location</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-3">
              <Label>Address</Label>
              <Input placeholder="Street address" value={form.address} onChange={e => set('address', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>City</Label>
              <Input placeholder="City" value={form.city} onChange={e => set('city', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>State</Label>
              <Input placeholder="State" value={form.state} onChange={e => set('state', e.target.value)} className="mt-1" />
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Link to="/projects"><Button variant="outline" type="button">Cancel</Button></Link>
          <Button type="submit" disabled={saving} className="steel-gradient text-white border-0 min-w-32">
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <><Save className="w-4 h-4 mr-2" /> Create Project</>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}