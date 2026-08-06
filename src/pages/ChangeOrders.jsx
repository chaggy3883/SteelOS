import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { syncProjectChangeOrderMetrics } from '@/lib/changeOrderMetrics';
import { FileEdit, Loader2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';

const STATUS_OPTIONS = ['Draft', 'Submitted to GC', 'Approved', 'Rejected', 'Void'];
const emptyForm = () => ({ title: '', status: 'Draft', tonnage: '', hours: '', dollars: '' });

// Cross-project Change Order Hub — pick any active project, log a CO against
// it without leaving this page. Writes to the SAME `change_orders` entity
// ProjectManagement.jsx's per-project tab already uses (not a separate
// entity) so both views stay in sync on one authoritative record set, and
// runs the exact same contract-value rollup via changeOrderMetrics.js.
export default function ChangeOrders() {
  const { toast } = useToast();
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [changeOrders, setChangeOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [selectedCo, setSelectedCo] = useState(null);
  const [editingCo, setEditingCo] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { if (selectedProjectId) loadProjectOrders(selectedProjectId); }, [selectedProjectId]);

  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const rows = await db.entities.projects.filter({ is_archived: false }, 'name', 100);
      setProjects(rows);
    } catch (e) { setProjects([]); }
    finally { setLoadingProjects(false); }
  };

  const loadProjectOrders = async (projectId) => {
    setLoadingOrders(true);
    try {
      const [projectRecord, orders] = await Promise.all([
        db.entities.projects.get(projectId),
        db.entities.change_orders.filter({ project_id: projectId }, '-created_date', 100),
      ]);
      setSelectedProject(projectRecord || null);
      setChangeOrders(orders || []);
    } catch (e) {
      setSelectedProject(null);
      setChangeOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  };

  const handleExecute = async () => {
    if (!selectedProject || !form.title.trim()) return;
    setSaving(true);
    try {
      const dollars = Number(form.dollars || 0);
      const nextOrder = {
        project_id: selectedProject.id,
        change_order_id: `CO-${String(changeOrders.length + 1).padStart(3, '0')}`,
        co_sequence_number: changeOrders.length + 1,
        description: form.title.trim(),
        status: form.status,
        cost_impact: dollars,
        total_change_order_value_cents: Math.round(dollars * 100),
        added_tonnage_weight_lbs: Number(form.tonnage || 0),
        added_labor_hours: Number(form.hours || 0),
        date_submitted: new Date().toISOString().slice(0, 10),
      };
      const created = await db.entities.change_orders.create(nextOrder);
      const nextList = [created, ...changeOrders];
      setChangeOrders(nextList);
      const updatedProject = await syncProjectChangeOrderMetrics(selectedProject, nextList);
      setSelectedProject(updatedProject);
      setForm(emptyForm());
      toast({ title: `${created.change_order_id} executed`, description: `Logged against ${updatedProject.project_number || updatedProject.name}.` });
    } catch (e) {
      toast({ title: 'Unable to execute change order', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const startEditingCo = () => {
    setEditForm({
      description: selectedCo.description || '',
      status: selectedCo.status || 'Draft',
      date_submitted: selectedCo.date_submitted || '',
      cost_impact: selectedCo.cost_impact ?? 0,
      schedule_impact: selectedCo.schedule_impact ?? 0,
      added_tonnage_weight_lbs: selectedCo.added_tonnage_weight_lbs ?? 0,
      added_labor_hours: selectedCo.added_labor_hours ?? 0,
      total_change_order_value_cents: selectedCo.total_change_order_value_cents ?? 0,
    });
    setEditingCo(true);
  };

  const cancelEditingCo = () => {
    setEditingCo(false);
    setEditForm({
      description: selectedCo.description || '',
      status: selectedCo.status || 'Draft',
      date_submitted: selectedCo.date_submitted || '',
      cost_impact: selectedCo.cost_impact ?? 0,
      schedule_impact: selectedCo.schedule_impact ?? 0,
      added_tonnage_weight_lbs: selectedCo.added_tonnage_weight_lbs ?? 0,
      added_labor_hours: selectedCo.added_labor_hours ?? 0,
      total_change_order_value_cents: selectedCo.total_change_order_value_cents ?? 0,
    });
  };

  const handleCostImpactChange = (value) => {
    setEditForm((f) => ({ ...f, cost_impact: value, total_change_order_value_cents: Math.round((Number(value) || 0) * 100) }));
  };

  const handleSaveCoEdit = async () => {
    if (!selectedCo) return;
    setSavingEdit(true);
    try {
      const payload = {
        ...editForm,
        cost_impact: Number(editForm.cost_impact) || 0,
        schedule_impact: Number(editForm.schedule_impact) || 0,
        added_tonnage_weight_lbs: Number(editForm.added_tonnage_weight_lbs) || 0,
        added_labor_hours: Number(editForm.added_labor_hours) || 0,
      };
      const updated = await db.entities.change_orders.update(selectedCo.id, payload);
      setChangeOrders((prev) => prev.map((c) => (c.id === selectedCo.id ? updated : c)));
      setSelectedCo(updated);
      setEditingCo(false);
      toast({ title: 'Change order updated' });
    } catch (e) {
      toast({ title: 'Unable to save changes', variant: 'destructive' });
    } finally {
      setSavingEdit(false);
    }
  };

  const fmtCurrency = (n) => `$${Number(n || 0).toLocaleString()}`;

  return (
    <div className="p-6 w-full max-w-none space-y-4 animate-fade-in">
      <PageHeader title="Change Order Hub" subtitle="Log and review change orders across every active project in one place" icon={FileEdit} />

      <div className="steel-card p-5 space-y-2">
        <Label className="text-sm font-semibold">Active Project</Label>
        {loadingProjects ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading projects…</div>
        ) : (
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="max-w-md"><SelectValue placeholder="Select an active project…" /></SelectTrigger>
            <SelectContent>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {selectedProjectId && (
        loadingOrders ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
        ) : selectedProject ? (
          <>
            <div className="steel-card p-5 space-y-3">
              <h3 className="font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-primary" />New Change Order — {selectedProject.name}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <Label>CO Title *</Label>
                  <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="mt-1" placeholder="e.g. Added stair tower revisions" />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Extra Steel Tonnage</Label>
                  <Input type="number" min={0} value={form.tonnage} onChange={(e) => setForm((f) => ({ ...f, tonnage: e.target.value }))} className="mt-1" placeholder="tons" />
                </div>
                <div>
                  <Label>Added Shop/Field Hours</Label>
                  <Input type="number" min={0} value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} className="mt-1" placeholder="hours" />
                </div>
                <div>
                  <Label>Extra Contract Dollars</Label>
                  <Input type="number" min={0} value={form.dollars} onChange={(e) => setForm((f) => ({ ...f, dollars: e.target.value }))} className="mt-1" placeholder="$" />
                </div>
              </div>
              <Button onClick={handleExecute} disabled={saving || !form.title.trim()} className="w-full steel-gradient text-white border-0">
                {saving ? 'Executing…' : 'Execute Change Order'}
              </Button>
            </div>

            <div className="steel-card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Change Orders — {selectedProject.name}</h3>
                <span className="text-xs text-muted-foreground">{changeOrders.length} logged · Revised Value ${Number(selectedProject.current_revised_contract_value || 0).toLocaleString()}</span>
              </div>
              {changeOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No change orders logged for this project yet.</p>
              ) : (
                <div className="space-y-2">
                  {changeOrders.map((co) => (
                    <div
                      key={co.id}
                      onClick={() => { setSelectedCo(co); setEditingCo(false); }}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <div>
                        <p className="font-medium">{co.change_order_id} — {co.description}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {co.added_tonnage_weight_lbs ? `${co.added_tonnage_weight_lbs} lb tonnage · ` : ''}
                          {co.added_labor_hours ? `${co.added_labor_hours} hrs · ` : ''}
                          ${Number(co.cost_impact || 0).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted font-medium flex-shrink-0">{co.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Unable to load that project.</p>
        )
      )}

      <Dialog open={!!selectedCo} onOpenChange={(o) => { if (!o) { setSelectedCo(null); setEditingCo(false); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {selectedCo && !editingCo && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span>{selectedCo.change_order_id}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted font-medium">{selectedCo.status}</span>
                </DialogTitle>
              </DialogHeader>
              <p className="text-xs text-muted-foreground -mt-2">{selectedCo.date_submitted || 'No submission date'}</p>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Project</p>
                  <p className="font-medium">{selectedProject?.name || '—'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="font-medium whitespace-pre-wrap">{selectedCo.description || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cost Impact</p>
                  <p className="font-medium">{fmtCurrency(selectedCo.cost_impact)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Contract value impact</p>
                  <p className="font-medium">{fmtCurrency((selectedCo.total_change_order_value_cents || 0) / 100)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Schedule Impact</p>
                  <p className="font-medium">{selectedCo.schedule_impact || 0} days</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Added Tonnage</p>
                  <p className="font-medium">{selectedCo.added_tonnage_weight_lbs || 0} lbs</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Added Labor Hours</p>
                  <p className="font-medium">{selectedCo.added_labor_hours || 0} hours</p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setSelectedCo(null)}>Close</Button>
                <Button onClick={startEditingCo} className="steel-gradient text-white border-0">Edit</Button>
              </div>
            </>
          )}

          {selectedCo && editingCo && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span>{selectedCo.change_order_id}</span>
                  <span className="text-sm text-muted-foreground font-normal">Edit Change Order</span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <div>
                  <Label>Description</Label>
                  <Textarea value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} className="mt-1" rows={3} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Status</Label>
                    <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Date Submitted</Label>
                    <Input type="date" value={editForm.date_submitted} onChange={(e) => setEditForm((f) => ({ ...f, date_submitted: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label>Cost Impact ($)</Label>
                    <Input type="number" value={editForm.cost_impact} onChange={(e) => handleCostImpactChange(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label>Schedule Impact (days)</Label>
                    <Input type="number" value={editForm.schedule_impact} onChange={(e) => setEditForm((f) => ({ ...f, schedule_impact: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label>Added Tonnage (lbs)</Label>
                    <Input type="number" value={editForm.added_tonnage_weight_lbs} onChange={(e) => setEditForm((f) => ({ ...f, added_tonnage_weight_lbs: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label>Added Labor Hours</Label>
                    <Input type="number" value={editForm.added_labor_hours} onChange={(e) => setEditForm((f) => ({ ...f, added_labor_hours: e.target.value }))} className="mt-1" />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={cancelEditingCo}>Cancel</Button>
                  <Button onClick={handleSaveCoEdit} disabled={savingEdit} className="steel-gradient text-white border-0">
                    {savingEdit ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
