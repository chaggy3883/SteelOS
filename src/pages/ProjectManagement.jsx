import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { syncProjectChangeOrderMetrics } from '@/lib/changeOrderMetrics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  ArrowLeft,
  FileText,
  Factory,
  Package,
  Plus,
  Truck,
  Upload,
  Wrench,
  ClipboardCheck,
  TrendingUp,
  CalendarRange
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';

const defaultCoForm = {
  change_order_id: '',
  description: '',
  cost_impact: '',
  schedule_impact: '',
  status: 'Draft',
  attachment_path: ''
};

const defaultLoadForm = {
  load_number: '',
  trailer_type: 'Flatbed',
  carrier_name: '',
  tons_shipped: '',
  ship_date: '',
  attachment_path: ''
};

const milestoneLabels = ['Material Received', 'Fabrication Started', 'QA Structural Inspection Passed'];

export default function ProjectManagement() {
  const { id } = useParams();
  const { toast } = useToast();
  const [project, setProject] = useState(null);
  const [changeOrders, setChangeOrders] = useState([]);
  const [shopSequences, setShopSequences] = useState([]);
  const [shippingLoads, setShippingLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [coForm, setCoForm] = useState(defaultCoForm);
  const [loadForm, setLoadForm] = useState(defaultLoadForm);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    if (id) {
      loadData();
    }
  }, [id]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [projectRecord, coList, sequenceList, loadList] = await Promise.all([
        base44.entities.projects.get(id),
        base44.entities.change_orders.filter({ project_id: id }, '-created_date', 100),
        base44.entities.shop_sequences.filter({ project_id: id }, '-created_date', 100),
        base44.entities.shipping_loads.filter({ project_id: id }, '-created_date', 100),
      ]);

      setProject(projectRecord || null);
      setChangeOrders(coList || []);
      setShopSequences(sequenceList && sequenceList.length > 0 ? sequenceList : defaultSequences(projectRecord?.id));
      setShippingLoads(loadList || []);
    } catch (error) {
      console.error(error);
      toast({ title: 'Unable to load project lifecycle data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const syncProjectMetrics = async (nextProject, nextOrders = changeOrders) => {
    const updatedProject = await syncProjectChangeOrderMetrics(nextProject, nextOrders);
    setProject(updatedProject);
    return updatedProject;
  };

  const saveProjectField = async (field, value) => {
    if (!project) return;
    const updated = await base44.entities.projects.update(project.id, { [field]: value });
    setProject(updated);
  };

  const createChangeOrder = async (event) => {
    event.preventDefault();
    if (!project) return;

    const nextOrder = {
      project_id: project.id,
      change_order_id: coForm.change_order_id || `CO-${String(changeOrders.length + 1).padStart(3, '0')}`,
      description: coForm.description,
      cost_impact: Number(coForm.cost_impact || 0),
      schedule_impact: Number(coForm.schedule_impact || 0),
      status: coForm.status || 'Draft',
      attachment_path: coForm.attachment_path || ''
    };

    const created = await base44.entities.change_orders.create(nextOrder);
    const nextList = [created, ...changeOrders];
    setChangeOrders(nextList);
    setCoForm(defaultCoForm);
    await syncProjectMetrics(project, nextList);
    toast({ title: 'Change order created' });
  };

  const updateChangeOrderStatus = async (entry, status) => {
    const updated = await base44.entities.change_orders.update(entry.id, { status });
    const nextList = changeOrders.map((item) => (item.id === entry.id ? updated : item));
    setChangeOrders(nextList);
    await syncProjectMetrics(project, nextList);
    toast({ title: `Change order ${status}` });
  };

  const toggleSequenceMilestone = async (sequenceId, milestoneKey) => {
    const target = shopSequences.find((item) => item.id === sequenceId);
    if (!target) return;

    const updated = await base44.entities.shop_sequences.update(sequenceId, {
      [milestoneKey]: !target[milestoneKey]
    });
    setShopSequences(shopSequences.map((item) => (item.id === sequenceId ? updated : item)));
  };

  const createShippingLoad = async (event) => {
    event.preventDefault();
    if (!project) return;

    const nextLoad = {
      project_id: project.id,
      load_number: loadForm.load_number || `Load ${shippingLoads.length + 1}`,
      trailer_type: loadForm.trailer_type,
      carrier_name: loadForm.carrier_name,
      tons_shipped: Number(loadForm.tons_shipped || 0),
      ship_date: loadForm.ship_date,
      attachment_path: loadForm.attachment_path || ''
    };

    const created = await base44.entities.shipping_loads.create(nextLoad);
    setShippingLoads([created, ...shippingLoads]);
    setLoadForm(defaultLoadForm);
    toast({ title: 'Shipping load logged' });
  };

  const handleFileSelect = (event, target) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (target === 'co') {
      setCoForm((current) => ({ ...current, attachment_path: file.name }));
    }
    if (target === 'load') {
      setLoadForm((current) => ({ ...current, attachment_path: file.name }));
    }
  };

  const handleDrop = (event, target) => {
    event.preventDefault();
    setDragActive(false);
    const files = event.dataTransfer.files;
    if (!files?.length) return;
    if (target === 'co') {
      setCoForm((current) => ({ ...current, attachment_path: files[0].name }));
    }
    if (target === 'load') {
      setLoadForm((current) => ({ ...current, attachment_path: files[0].name }));
    }
  };

  const donutData = useMemo(() => {
    const summary = {
      Draft: changeOrders.filter((item) => item.status === 'Draft').length,
      Submitted: changeOrders.filter((item) => item.status === 'Submitted to GC').length,
      Approved: changeOrders.filter((item) => item.status === 'Approved').length,
      Rejected: changeOrders.filter((item) => item.status === 'Rejected').length,
      Void: changeOrders.filter((item) => item.status === 'Void').length,
    };
    return Object.entries(summary).filter(([, value]) => value > 0).map(([name, value]) => ({ name, value }));
  }, [changeOrders]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6">
        <Link to="/projects">
          <Button variant="ghost" className="mb-4 gap-2">
            <ArrowLeft className="w-4 h-4" /> Back to Projects
          </Button>
        </Link>
        <div className="steel-card p-8 text-center">Project not found.</div>
      </div>
    );
  }

  const originalValue = Number(project.original_contract_value || project.contract_value || 0);
  const approvedCOs = changeOrders.filter((item) => item.status === 'Approved').reduce((sum, item) => sum + Number(item.cost_impact || 0), 0);
  const revisedValue = Number(project.current_revised_contract_value || originalValue + approvedCOs);
  const remainingBalance = Number(project.remaining_project_balance || revisedValue - Number(project.total_invoiced_to_date || 0));
  const tonnageProgress = project.estimated_tons ? Math.min(100, Math.round((Number(project.fabricated_tons || 0) / Number(project.estimated_tons)) * 100)) : 0;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to={`/projects/${project.id}`}>
            <Button variant="ghost" className="mb-3 gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to Project
            </Button>
          </Link>
          <h1 className="text-2xl font-semibold">Project Management Module</h1>
          <p className="text-sm text-muted-foreground">Lifecycle tracking for {project.name}</p>
        </div>
        <div className="steel-card px-4 py-3 text-right">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Project ID</p>
          <p className="font-semibold text-primary">{project.project_number || project.project_id_number || 'JOB-26-008'}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="steel-card p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Project Health</p>
              <h2 className="text-lg font-semibold">Live execution matrix</h2>
            </div>
            <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{project.execution_status || 'Prefabrication'}</div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border p-3">
              <Label className="text-xs uppercase tracking-wide">Execution Status</Label>
              <select
                className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={project.execution_status || 'Prefabrication'}
                onChange={(event) => saveProjectField('execution_status', event.target.value)}
              >
                {['Prefabrication', 'In Shop', 'In Transit', 'Erection', 'Closeout', 'Completed'].map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
            <div className="rounded-xl border border-border p-3">
              <Label className="text-xs uppercase tracking-wide">Project ID Number</Label>
              <Input
                value={project.project_number || project.project_id_number || ''}
                onChange={(event) => saveProjectField('project_number', event.target.value)}
                className="mt-2"
              />
            </div>
          </div>
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Tonnage Progress</p>
                <p className="text-xs text-muted-foreground">{project.fabricated_tons || 0} of {project.estimated_tons || 0} tons fabricated</p>
              </div>
              <span className="text-sm font-semibold text-primary">{tonnageProgress}%</span>
            </div>
            <div className="mt-3 h-2.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${tonnageProgress}%` }} />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs uppercase tracking-wide">Estimated Tons</Label>
                <Input type="number" value={project.estimated_tons || ''} onChange={(event) => saveProjectField('estimated_tons', Number(event.target.value))} className="mt-2" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide">Fabricated Tons</Label>
                <Input type="number" value={project.fabricated_tons || ''} onChange={(event) => saveProjectField('fabricated_tons', Number(event.target.value))} className="mt-2" />
              </div>
            </div>
          </div>
        </div>

        <div className="steel-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h2 className="text-lg font-semibold">Contract allocation trackers</h2>
          </div>
          <div className="grid gap-3">
            {[
              { label: 'Original Contract Value', value: originalValue, field: 'original_contract_value' },
              { label: 'Approved CO Total', value: approvedCOs, field: 'approved_change_orders_total' },
              { label: 'Revised Contract Value', value: revisedValue, field: 'current_revised_contract_value' },
              { label: 'Total Invoiced', value: Number(project.total_invoiced_to_date || 0), field: 'total_invoiced_to_date' },
              { label: 'Remaining Balance', value: remainingBalance, field: 'remaining_project_balance' }
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
                <Input type="number" value={item.value} onChange={(event) => saveProjectField(item.field, Number(event.target.value))} className="mt-2" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="steel-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <h2 className="text-lg font-semibold">Change Order ledger</h2>
            </div>
            <div className="rounded-full bg-muted px-3 py-1 text-xs">{changeOrders.length} logged</div>
          </div>
          <form onSubmit={createChangeOrder} className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label>Change Order ID</Label>
              <Input value={coForm.change_order_id} onChange={(event) => setCoForm((current) => ({ ...current, change_order_id: event.target.value }))} className="mt-2" placeholder="CO-001" />
            </div>
            <div className="md:col-span-2">
              <Label>Description / Scope</Label>
              <textarea value={coForm.description} onChange={(event) => setCoForm((current) => ({ ...current, description: event.target.value }))} className="mt-2 min-h-[90px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Describe the scope change" />
            </div>
            <div>
              <Label>Cost Impact</Label>
              <Input type="number" value={coForm.cost_impact} onChange={(event) => setCoForm((current) => ({ ...current, cost_impact: event.target.value }))} className="mt-2" />
            </div>
            <div>
              <Label>Schedule Impact (days)</Label>
              <Input type="number" value={coForm.schedule_impact} onChange={(event) => setCoForm((current) => ({ ...current, schedule_impact: event.target.value }))} className="mt-2" />
            </div>
            <div>
              <Label>Status</Label>
              <select value={coForm.status} onChange={(event) => setCoForm((current) => ({ ...current, status: event.target.value }))} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                {['Draft', 'Submitted to GC', 'Approved', 'Rejected', 'Void'].map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <div>
              <Label>Supporting Document</Label>
              <div
                onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => handleDrop(event, 'co')}
                className={`mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm ${dragActive ? 'border-primary bg-primary/5' : 'border-border'}`}
              >
                <Upload className="w-4 h-4" />
                <span>{coForm.attachment_path || 'Drop engineering sketches or RFIs'}</span>
                <input type="file" className="hidden" onChange={(event) => handleFileSelect(event, 'co')} />
              </div>
            </div>
            <div className="md:col-span-2">
              <Button type="submit" className="w-full gap-2">
                <Plus className="w-4 h-4" /> Add Change Order
              </Button>
            </div>
          </form>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3">CO ID</th>
                  <th className="py-2 pr-3">Scope</th>
                  <th className="py-2 pr-3">Cost</th>
                  <th className="py-2 pr-3">Days</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {changeOrders.map((entry) => (
                  <tr key={entry.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-3 font-medium">{entry.change_order_id}</td>
                    <td className="py-3 pr-3">{entry.description}</td>
                    <td className="py-3 pr-3">{entry.cost_impact > 0 ? `+$${entry.cost_impact}` : `-$${Math.abs(entry.cost_impact)}`}</td>
                    <td className="py-3 pr-3">{entry.schedule_impact}</td>
                    <td className="py-3 pr-3">
                      <select value={entry.status} onChange={(event) => updateChangeOrderStatus(entry, event.target.value)} className="rounded-lg border border-border bg-background px-2 py-1 text-xs">
                        {['Draft', 'Submitted to GC', 'Approved', 'Rejected', 'Void'].map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="steel-card p-5">
            <div className="flex items-center gap-2">
              <Factory className="w-4 h-4 text-primary" />
              <h2 className="text-lg font-semibold">Change-order pipeline</h2>
            </div>
            <div className="mt-4 h-44">
              {donutData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutData} dataKey="value" innerRadius={52} outerRadius={72} paddingAngle={2}>
                      {donutData.map((entry, index) => (
                        <Cell key={entry.name} fill={['#0ea5e9', '#f59e0b', '#22c55e', '#ef4444', '#64748b'][index % 5]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No CO data yet</div>
              )}
            </div>
          </div>
          <div className="steel-card p-5">
            <div className="flex items-center gap-2">
              <CalendarRange className="w-4 h-4 text-primary" />
              <h2 className="text-lg font-semibold">Logistics & shipments calendar</h2>
            </div>
            <div className="mt-4 space-y-2">
              {shippingLoads.length > 0 ? shippingLoads.slice(0, 4).map((load) => (
                <div key={load.id} className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">{load.load_number}</p>
                  <p className="text-muted-foreground">{load.carrier_name} • {load.trailer_type} • {load.tons_shipped}T</p>
                  <p className="text-xs text-muted-foreground">{load.ship_date || 'Ship date pending'}</p>
                </div>
              )) : <p className="text-sm text-muted-foreground">No shipments logged yet.</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="steel-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-primary" />
            <h2 className="text-lg font-semibold">Fabrication, shop, and sequence controls</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Drawing Release Date</Label>
              <Input type="date" value={project.drawing_release_date || ''} onChange={(event) => saveProjectField('drawing_release_date', event.target.value)} className="mt-2" />
            </div>
            <div>
              <Label>Detailer CRM Link</Label>
              <Input value={project.detailer_crm_link || ''} onChange={(event) => saveProjectField('detailer_crm_link', event.target.value)} className="mt-2" />
            </div>
            <div className="md:col-span-2">
              <Label>Approved Shop Drawings Upload</Label>
              <Input value={project.approved_shop_drawings_path || ''} onChange={(event) => saveProjectField('approved_shop_drawings_path', event.target.value)} className="mt-2" placeholder="/uploads/shop-drawings.pdf" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3">Sequence</th>
                  {milestoneLabels.map((label) => <th key={label} className="py-2 pr-3">{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {shopSequences.map((sequence) => (
                  <tr key={sequence.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-3 font-medium">{sequence.sequence_name}</td>
                    {milestoneLabels.map((label, index) => {
                      const milestoneKey = ['material_received', 'fabrication_started', 'qa_inspection_passed'][index];
                      const checked = Boolean(sequence[milestoneKey]);
                      return (
                        <td key={`${sequence.id}-${milestoneKey}`} className="py-3 pr-3">
                          <button type="button" onClick={() => toggleSequenceMilestone(sequence.id, milestoneKey)} className={`inline-flex h-5 w-5 items-center justify-center rounded border ${checked ? 'border-primary bg-primary text-white' : 'border-border bg-background'}`}>
                            {checked ? '✓' : ''}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="steel-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-primary" />
              <h2 className="text-lg font-semibold">Shipping logistics & manifests</h2>
            </div>
            <form onSubmit={createShippingLoad} className="grid gap-3">
              <div>
                <Label>Load Number</Label>
                <Input value={loadForm.load_number} onChange={(event) => setLoadForm((current) => ({ ...current, load_number: event.target.value }))} className="mt-2" placeholder="Load 1" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Trailer Type</Label>
                  <select value={loadForm.trailer_type} onChange={(event) => setLoadForm((current) => ({ ...current, trailer_type: event.target.value }))} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    {['Flatbed', 'Drop-deck', 'Stretch'].map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Carrier / Hauler</Label>
                  <Input value={loadForm.carrier_name} onChange={(event) => setLoadForm((current) => ({ ...current, carrier_name: event.target.value }))} className="mt-2" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Tons Shipped</Label>
                  <Input type="number" value={loadForm.tons_shipped} onChange={(event) => setLoadForm((current) => ({ ...current, tons_shipped: event.target.value }))} className="mt-2" />
                </div>
                <div>
                  <Label>Ship Date</Label>
                  <Input type="date" value={loadForm.ship_date} onChange={(event) => setLoadForm((current) => ({ ...current, ship_date: event.target.value }))} className="mt-2" />
                </div>
              </div>
              <div>
                <Label>Manifest / Delivery Receipt</Label>
                <div onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={(event) => handleDrop(event, 'load')} className={`mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm ${dragActive ? 'border-primary bg-primary/5' : 'border-border'}`}>
                  <Upload className="w-4 h-4" />
                  <span>{loadForm.attachment_path || 'Drop manifest PDFs or signed receipts'}</span>
                  <input type="file" className="hidden" onChange={(event) => handleFileSelect(event, 'load')} />
                </div>
              </div>
              <Button type="submit" className="w-full gap-2">
                <Plus className="w-4 h-4" /> Log Shipping Load
              </Button>
            </form>
          </div>

          <div className="steel-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-primary" />
              <h2 className="text-lg font-semibold">Field erection progression</h2>
            </div>
            <div className="grid gap-3">
              <div>
                <Label>Erector CRM Link</Label>
                <Input value={project.erector_crm_link || ''} onChange={(event) => saveProjectField('erector_crm_link', event.target.value)} className="mt-2" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Field Mobilization Date</Label>
                  <Input type="date" value={project.field_mobilization_date || ''} onChange={(event) => saveProjectField('field_mobilization_date', event.target.value)} className="mt-2" />
                </div>
                <div>
                  <Label>Crane Assembly Setup Date</Label>
                  <Input type="date" value={project.crane_setup_date || ''} onChange={(event) => saveProjectField('crane_setup_date', event.target.value)} className="mt-2" />
                </div>
              </div>
              <div>
                <Label>Weekly erection completion</Label>
                <input type="range" min="0" max="100" value={project.erection_progress || 0} onChange={(event) => saveProjectField('erection_progress', Number(event.target.value))} className="mt-2 w-full" />
                <p className="mt-2 text-sm font-medium text-primary">{project.erection_progress || 0}% complete</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function defaultSequences(projectId) {
  return [
    { id: 'seq-anchor-bolts', project_id: projectId, sequence_name: 'Sequence 1 - Anchor Bolts', material_received: false, fabrication_started: false, qa_inspection_passed: false },
    { id: 'seq-columns', project_id: projectId, sequence_name: 'Sequence 2 - Columns', material_received: false, fabrication_started: false, qa_inspection_passed: false },
    { id: 'seq-beams', project_id: projectId, sequence_name: 'Sequence 3 - Beams', material_received: false, fabrication_started: false, qa_inspection_passed: false }
  ];
}
