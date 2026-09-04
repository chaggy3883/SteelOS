import React, { useState, useEffect, useRef } from 'react';
import { db } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { HardHat, Package, Handshake, AlertTriangle, Plus, Loader2, Link2, TrendingUp, TrendingDown } from 'lucide-react';
import {
  computeLaborEstimateTotal, computeActualLaborCost, laborVariance,
  computeMaterialVariance, computeSubVariance,
} from '@/lib/tmEngine';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => `$${round2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);

export default function TmTrackingPanel({ project }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [bid, setBid] = useState(null);
  const [laborEstimateItems, setLaborEstimateItems] = useState([]);
  const [materialLineItems, setMaterialLineItems] = useState([]);
  const [subLineItems, setSubLineItems] = useState([]);
  const [materialUsage, setMaterialUsage] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [laborRates, setLaborRates] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const scrollToRef = (ref) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const laborSectionRef = useRef(null);
  const materialsSectionRef = useRef(null);
  const subsSectionRef = useRef(null);

  const [usageDialog, setUsageDialog] = useState(null);
  const [poDialogFor, setPoDialogFor] = useState(null);

  useEffect(() => { load(); }, [project.id]);

  const load = async () => {
    setLoading(true);
    try {
      const bids = await db.entities.Bid.filter({ project_id: project.id }, '-created_date', 1);
      const sourceBid = bids[0] || null;
      setBid(sourceBid);

      const [labor, materials, subs, usage, entries, emp, rates, pos] = await Promise.all([
        sourceBid ? db.entities.TmLaborEstimateLineItem.filter({ bid_id: sourceBid.id }, 'position', 200) : [],
        sourceBid ? db.entities.TmMaterialLineItem.filter({ bid_id: sourceBid.id }, 'line_number', 500) : [],
        sourceBid ? db.entities.TmSubcontractorLineItem.filter({ bid_id: sourceBid.id }, 'line_number', 200) : [],
        db.entities.TmMaterialUsage.filter({ project_id: project.id }, '-received_date', 1000),
        db.entities.TimeEntry.filter({ project_id: project.id }, '-work_date', 5000),
        db.entities.employees.list('full_name', 1000),
        db.entities.TmLaborRate.list('-effective_date', 2000),
        db.entities.purchase_orders.filter({ project_id: project.id }, '-created_date', 500),
      ]);
      setLaborEstimateItems(labor);
      setMaterialLineItems(materials);
      setSubLineItems(subs);
      setMaterialUsage(usage);
      setTimeEntries(entries);
      setEmployees(emp);
      setLaborRates(rates);
      setPurchaseOrders(pos);
    } catch (e) {
      toast({ title: 'Unable to load T&M tracking data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const laborActual = computeActualLaborCost(timeEntries, employees, laborRates);
  const estimatedHours = laborEstimateItems.reduce((s, l) => s + (Number(l.estimated_hours) || 0), 0);
  const laborVar = laborVariance(estimatedHours, laborActual.totalHours);
  const laborEstimateTotal = computeLaborEstimateTotal(laborEstimateItems);

  const materialVar = computeMaterialVariance(materialLineItems, materialUsage);
  const subVar = computeSubVariance(subLineItems, purchaseOrders);

  const overallEstimated = round2(laborEstimateTotal + materialVar.estimatedTotal + subVar.estimatedTotal);
  const overallActual = round2(laborActual.totalCost + materialVar.actualTotal + subVar.actualTotal);
  const overallVarPct = overallEstimated > 0 ? round2(((overallActual - overallEstimated) / overallEstimated) * 100) : null;

  const postMaterialUsage = async (form) => {
    const lineItem = materialLineItems.find((li) => li.id === form.tm_material_line_item_id) || null;
    const quantity_used = Number(form.quantity_used) || 0;
    const unit_cost = Number(form.unit_cost) || 0;
    const total_cost = round2(quantity_used * unit_cost);
    try {
      const usage = await db.entities.TmMaterialUsage.create({
        project_id: project.id,
        tm_material_line_item_id: lineItem?.id || null,
        material_description: form.material_description || lineItem?.description || '',
        quantity_used,
        unit_cost,
        total_cost,
        received_date: form.received_date || new Date().toISOString().slice(0, 10),
        vendor: form.vendor || '',
      });
      if (total_cost > 0) {
        const ledgerEntry = await db.entities.JobCostLedgerEntry.create({
          project_id: project.id,
          cost_code: 'TM-MATERIAL',
          cost_class: 'MAT',
          amount: total_cost,
          transaction_date: usage.received_date,
          source_type: 'material',
          source_id: usage.id,
          description: `${usage.material_description} — T&M material usage${lineItem ? '' : ' (not on original estimate)'}`,
        });
        await db.entities.TmMaterialUsage.update(usage.id, { job_cost_posted: true, job_cost_ledger_entry_id: ledgerEntry.id });
      }
      toast({ title: 'Material usage logged', description: lineItem ? undefined : 'Not on the original estimate — flagged as additional material.' });
      setUsageDialog(null);
      load();
    } catch (e) {
      toast({ title: 'Unable to log material usage', variant: 'destructive' });
    }
  };

  const linkPurchaseOrder = async (lineItemId, purchaseOrderId) => {
    try {
      await db.entities.TmSubcontractorLineItem.update(lineItemId, { purchase_order_id: purchaseOrderId || null });
      toast({ title: 'Purchase order linked' });
      setPoDialogFor(null);
      load();
    } catch (e) {
      toast({ title: 'Unable to link purchase order', variant: 'destructive' });
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;

  if (!bid) {
    return <p className="text-sm text-muted-foreground p-8 text-center">No T&M estimate found for this project — the originating bid may have been created before T&M pricing was added, or its estimate tab was never filled in.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Overall variance */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button type="button" onClick={() => scrollToRef(laborSectionRef)} className="steel-card p-4 text-left hover:ring-2 hover:ring-primary/40 transition-shadow">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><HardHat className="w-3.5 h-3.5" />Labor Variance</p>
          <p className="text-lg font-bold mt-1">{estimatedHours.toLocaleString()} est · {laborActual.totalHours.toLocaleString()} actual hrs</p>
          <p className={`text-sm font-medium ${laborVar.variancePct > 0 ? 'text-red-600' : 'text-green-600'}`}>{pct(laborVar.variancePct)}</p>
          {laborActual.unmatchedHours > 0 && (
            <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{laborActual.unmatchedHours} hrs unpriced — no T&M rate for: {laborActual.unmatchedPositions.join(', ') || 'unknown position'}</p>
          )}
        </button>
        <button type="button" onClick={() => scrollToRef(laborSectionRef)} className="steel-card p-4 text-left hover:ring-2 hover:ring-primary/40 transition-shadow">
          <p className="text-xs text-muted-foreground">Estimated vs. Actual $</p>
          <p className="text-lg font-bold mt-1">{money(overallEstimated)} est · {money(overallActual)} actual</p>
          <p className={`text-sm font-medium flex items-center gap-1 ${overallVarPct > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {overallVarPct > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}{pct(overallVarPct)}
          </p>
        </button>
        <div className="steel-card p-4">
          <p className="text-xs text-muted-foreground">By Category</p>
          <div className="text-xs mt-1 space-y-0.5">
            <button type="button" onClick={() => scrollToRef(laborSectionRef)} className="block w-full text-left hover:underline">Labor: {money(laborEstimateTotal)} → {money(laborActual.totalCost)}</button>
            <button type="button" onClick={() => scrollToRef(materialsSectionRef)} className="block w-full text-left hover:underline">Materials: {money(materialVar.estimatedTotal)} → {money(materialVar.actualTotal)}</button>
            <button type="button" onClick={() => scrollToRef(subsSectionRef)} className="block w-full text-left hover:underline">Subs: {money(subVar.estimatedTotal)} → {money(subVar.actualTotal)}</button>
          </div>
        </div>
      </div>

      {/* Labor by position */}
      <div ref={laborSectionRef} className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border"><h3 className="font-semibold flex items-center gap-2"><HardHat className="w-4 h-4" />Labor — Estimated vs. Actual</h3></div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Position</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Est. Hours</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Actual Hours</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Actual Cost</th>
            </tr>
          </thead>
          <tbody>
            {laborEstimateItems.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-6 text-muted-foreground">No labor estimated on the original bid.</td></tr>
            ) : laborEstimateItems.map((li) => {
              const actual = laborActual.byPosition.find((p) => p.position === li.position);
              return (
                <tr key={li.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">{li.position}</td>
                  <td className="px-4 py-2 text-right font-mono">{Number(li.estimated_hours).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right font-mono">{(actual?.hours || 0).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right font-mono">{money(actual?.cost || 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Materials */}
      <div ref={materialsSectionRef} className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><Package className="w-4 h-4" />Materials — Usage Log</h3>
          <Button size="sm" variant="outline" onClick={() => setUsageDialog({ tm_material_line_item_id: '', material_description: '', quantity_used: '', unit_cost: '', received_date: new Date().toISOString().slice(0, 10), vendor: '' })}>
            <Plus className="w-3.5 h-3.5 mr-1" />Log Material Usage
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Line Item</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Est. Qty</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Used Qty</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Cost Used</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Flag</th>
            </tr>
          </thead>
          <tbody>
            {materialVar.lines.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No materials quoted on the original bid.</td></tr>
            ) : materialVar.lines.map((l) => (
              <tr key={l.lineItem.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">{l.lineItem.description}</td>
                <td className="px-4 py-2 text-right font-mono">{l.lineItem.quantity} {l.lineItem.unit}</td>
                <td className="px-4 py-2 text-right font-mono">{l.quantityUsed} {l.lineItem.unit}</td>
                <td className="px-4 py-2 text-right font-mono">{money(l.costUsed)}</td>
                <td className="px-4 py-2">{l.overQuantity && <span className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Over estimate</span>}</td>
              </tr>
            ))}
            {materialVar.unquotedTotal > 0 && (
              <tr className="bg-amber-500/5">
                <td className="px-4 py-2 text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Additional material (not on original estimate)</td>
                <td className="px-4 py-2 text-right">—</td>
                <td className="px-4 py-2 text-right">—</td>
                <td className="px-4 py-2 text-right font-mono">{money(materialVar.unquotedTotal)}</td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Subcontractors */}
      <div ref={subsSectionRef} className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border"><h3 className="font-semibold flex items-center gap-2"><Handshake className="w-4 h-4" />Subcontractors — Quoted vs. Actual</h3></div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Scope</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Subcontractor</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Quoted</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Actual (PO)</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Variance</th>
              <th className="w-32" />
            </tr>
          </thead>
          <tbody>
            {subVar.lines.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">No subcontractor scopes on the original bid.</td></tr>
            ) : subVar.lines.map((l) => (
              <tr key={l.lineItem.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">{l.lineItem.description}</td>
                <td className="px-4 py-2">{l.lineItem.subcontractor_name}</td>
                <td className="px-4 py-2 text-right font-mono">{money(l.lineItem.quoted_price)}</td>
                <td className="px-4 py-2 text-right font-mono">{l.purchaseOrder ? money(l.actualCost) : '—'}</td>
                <td className="px-4 py-2 text-right font-mono">{l.variance == null ? '—' : (l.variance > 0 ? <span className="text-red-600">{money(l.variance)}</span> : <span className="text-green-600">{money(l.variance)}</span>)}</td>
                <td className="px-4 py-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => setPoDialogFor(l.lineItem)}>
                    <Link2 className="w-3.5 h-3.5 mr-1" />{l.purchaseOrder ? l.purchaseOrder.po_number : 'Link PO'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {usageDialog && (
        <MaterialUsageDialog
          form={usageDialog}
          lineItems={materialLineItems}
          onCancel={() => setUsageDialog(null)}
          onSave={postMaterialUsage}
        />
      )}

      {poDialogFor && (
        <LinkPoDialog
          lineItem={poDialogFor}
          purchaseOrders={purchaseOrders}
          onCancel={() => setPoDialogFor(null)}
          onSave={(poId) => linkPurchaseOrder(poDialogFor.id, poId)}
        />
      )}
    </div>
  );
}

function MaterialUsageDialog({ form: initialForm, lineItems, onCancel, onSave }) {
  const [form, setForm] = useState(initialForm);
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleLineItemChange = (id) => {
    const li = lineItems.find((l) => l.id === id);
    setForm((f) => ({ ...f, tm_material_line_item_id: id, material_description: li ? li.description : f.material_description, unit_cost: li ? li.unit_cost : f.unit_cost }));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Log Material Usage</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Matches Estimate Line Item</Label>
            <select value={form.tm_material_line_item_id} onChange={(e) => handleLineItemChange(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-input/40 px-2 py-1.5 text-sm">
              <option value="">— Unquoted / Additional Material —</option>
              {lineItems.map((li) => <option key={li.id} value={li.id}>{li.description}</option>)}
            </select>
          </div>
          {!form.tm_material_line_item_id && (
            <div>
              <Label>Material Description</Label>
              <Input value={form.material_description} onChange={(e) => setField('material_description', e.target.value)} className="mt-1" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Quantity Used</Label>
              <Input type="number" step="0.01" min="0" value={form.quantity_used} onChange={(e) => setField('quantity_used', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Unit Cost ($)</Label>
              <Input type="number" step="0.01" min="0" value={form.unit_cost} onChange={(e) => setField('unit_cost', e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Received Date</Label>
              <Input type="date" value={form.received_date} onChange={(e) => setField('received_date', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Vendor</Label>
              <Input value={form.vendor} onChange={(e) => setField('vendor', e.target.value)} className="mt-1" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={!form.quantity_used || (!form.tm_material_line_item_id && !form.material_description)} className="steel-gradient text-white border-0">Log Usage</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkPoDialog({ lineItem, purchaseOrders, onCancel, onSave }) {
  const [selected, setSelected] = useState(lineItem.purchase_order_id || '');
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Link Purchase Order — {lineItem.subcontractor_name}</DialogTitle></DialogHeader>
        <div className="py-2">
          <Label>Purchase Order</Label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-input/40 px-2 py-1.5 text-sm">
            <option value="">None</option>
            {purchaseOrders.map((po) => <option key={po.id} value={po.id}>{po.po_number} — {po.vendor_name || 'Vendor TBD'} ({po.status || 'draft'})</option>)}
          </select>
          {purchaseOrders.length === 0 && <p className="text-xs text-muted-foreground mt-2">No purchase orders exist for this project yet — issue one from Purchasing first.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onSave(selected || null)} className="steel-gradient text-white border-0">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
