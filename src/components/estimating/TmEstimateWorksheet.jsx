import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Trash2, Loader2, HardHat, Package, Handshake, FileCheck2, Upload } from 'lucide-react';
import { computeTmEstimateSummary } from '@/lib/tmEngine';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => `$${round2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

export default function TmEstimateWorksheet({ bid, onSaved }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [laborRates, setLaborRates] = useState([]);
  const [laborItems, setLaborItems] = useState([]);
  const [materialItems, setMaterialItems] = useState([]);
  const [subItems, setSubItems] = useState([]);
  const [markupText, setMarkupText] = useState(String(bid.tm_markup_percentage ?? 0));
  const [savingMarkup, setSavingMarkup] = useState(false);

  const [laborDialog, setLaborDialog] = useState(null);
  const [materialDialog, setMaterialDialog] = useState(null);
  const [subDialog, setSubDialog] = useState(null);

  useEffect(() => { load(); }, [bid.id]);
  useEffect(() => { setMarkupText(String(bid.tm_markup_percentage ?? 0)); }, [bid.tm_markup_percentage]);

  const load = async () => {
    setLoading(true);
    try {
      const [rates, labor, materials, subs] = await Promise.all([
        db.entities.TmLaborRate.list('position', 500),
        db.entities.TmLaborEstimateLineItem.filter({ bid_id: bid.id }, 'line_number', 500),
        db.entities.TmMaterialLineItem.filter({ bid_id: bid.id }, 'line_number', 500),
        db.entities.TmSubcontractorLineItem.filter({ bid_id: bid.id }, 'line_number', 500),
      ]);
      setLaborRates(rates);
      setLaborItems(labor);
      setMaterialItems(materials);
      setSubItems(subs);
    } catch (e) {
      toast({ title: 'Unable to load T&M estimate', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const currentPositions = Array.from(
    new Map(laborRates.filter((r) => !r.end_date).map((r) => [r.position, r])).values()
  );

  const summary = computeTmEstimateSummary({
    laborLineItems: laborItems,
    materialLineItems: materialItems,
    subLineItems: subItems,
    markupPct: Number(markupText) || 0,
  });

  const handleSaveMarkup = async () => {
    setSavingMarkup(true);
    try {
      await db.entities.Bid.update(bid.id, { tm_markup_percentage: Number(markupText) || 0 });
      toast({ title: 'Markup % saved' });
      onSaved?.();
    } catch (e) {
      toast({ title: 'Unable to save markup %', variant: 'destructive' });
    } finally {
      setSavingMarkup(false);
    }
  };

  // --- Labor ---
  const nextLine = (list) => (list.reduce((max, l) => Math.max(max, Number(l.line_number) || 0), 0) + 1);

  const saveLaborRow = async (form) => {
    const payload = {
      bid_id: bid.id,
      line_number: form.id ? form.line_number : nextLine(laborItems),
      position: form.position,
      estimated_hours: Number(form.estimated_hours) || 0,
      hourly_rate: Number(form.hourly_rate) || 0,
      notes: form.notes || '',
    };
    if (form.id) await db.entities.TmLaborEstimateLineItem.update(form.id, payload);
    else await db.entities.TmLaborEstimateLineItem.create(payload);
    setLaborDialog(null);
    load();
  };

  const deleteLaborRow = async (id) => {
    if (!confirm('Remove this labor estimate row?')) return;
    await db.entities.TmLaborEstimateLineItem.delete(id);
    load();
  };

  // --- Materials ---
  const saveMaterialRow = async (form) => {
    const quantity = Number(form.quantity) || 0;
    const unit_cost = Number(form.unit_cost) || 0;
    const payload = {
      bid_id: bid.id,
      line_number: form.id ? form.line_number : nextLine(materialItems),
      description: form.description,
      quantity,
      unit: form.unit || 'ea',
      unit_cost,
      total_cost: form.source === 'on_hand' ? 0 : round2(quantity * unit_cost),
      source: form.source || 'quote',
      quote_vendor: form.quote_vendor || '',
      quote_reference: form.quote_reference || '',
      notes: form.notes || '',
    };
    if (form.id) await db.entities.TmMaterialLineItem.update(form.id, payload);
    else await db.entities.TmMaterialLineItem.create(payload);
    setMaterialDialog(null);
    load();
  };

  const deleteMaterialRow = async (id) => {
    if (!confirm('Remove this material line item?')) return;
    await db.entities.TmMaterialLineItem.delete(id);
    load();
  };

  // --- Subcontractors ---
  const saveSubRow = async (form) => {
    setSubDialog((prev) => ({ ...prev, saving: true }));
    try {
      let quote_document_id = form.quote_document_id || null;
      if (form.newQuoteFile) {
        const dataUrl = await readFileAsDataUrl(form.newQuoteFile);
        const doc = await db.entities.Document.create({
          bid_id: bid.id,
          name: `${form.subcontractor_name || 'Subcontractor'} Quote`,
          document_type: 'vendor_quote',
          file_url: dataUrl,
          file_name: form.newQuoteFile.name,
          file_size: form.newQuoteFile.size,
          file_type: form.newQuoteFile.type,
        });
        quote_document_id = doc.id;
      }
      const payload = {
        bid_id: bid.id,
        line_number: form.id ? form.line_number : nextLine(subItems),
        description: form.description,
        subcontractor_name: form.subcontractor_name,
        quoted_price: Number(form.quoted_price) || 0,
        quote_document_id,
        notes: form.notes || '',
      };
      if (form.id) await db.entities.TmSubcontractorLineItem.update(form.id, payload);
      else await db.entities.TmSubcontractorLineItem.create(payload);
      setSubDialog(null);
      load();
    } catch (e) {
      toast({ title: 'Unable to save subcontractor line item', variant: 'destructive' });
      setSubDialog((prev) => ({ ...prev, saving: false }));
    }
  };

  const deleteSubRow = async (id) => {
    if (!confirm('Remove this subcontractor line item?')) return;
    await db.entities.TmSubcontractorLineItem.delete(id);
    load();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold">T&M Estimate Summary</h3>
            <p className="text-xs text-muted-foreground">Labor + Materials + Subcontractors, plus markup</p>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Markup %</Label>
            <Input type="number" step="0.1" min="0" value={markupText} onChange={(e) => setMarkupText(e.target.value)} className="w-24 h-8" />
            <Button size="sm" variant="outline" onClick={handleSaveMarkup} disabled={savingMarkup}>{savingMarkup ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-border">
              <td className="px-4 py-2 text-muted-foreground">Estimated Labor ({laborItems.reduce((s, l) => s + (Number(l.estimated_hours) || 0), 0).toLocaleString()} hrs)</td>
              <td className="px-4 py-2 text-right font-mono">{money(summary.laborTotal)}</td>
            </tr>
            <tr className="border-b border-border">
              <td className="px-4 py-2 text-muted-foreground">Materials ({materialItems.length} line item{materialItems.length === 1 ? '' : 's'})</td>
              <td className="px-4 py-2 text-right font-mono">{money(summary.materialTotal)}</td>
            </tr>
            <tr className="border-b border-border">
              <td className="px-4 py-2 text-muted-foreground">Subcontractors ({subItems.length} line item{subItems.length === 1 ? '' : 's'})</td>
              <td className="px-4 py-2 text-right font-mono">{money(summary.subTotal)}</td>
            </tr>
            <tr className="border-b border-border">
              <td className="px-4 py-2 text-muted-foreground">Markup ({Number(markupText) || 0}%)</td>
              <td className="px-4 py-2 text-right font-mono">{money(summary.markupAmount)}</td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-semibold">Grand Total</td>
              <td className="px-4 py-3 text-right font-mono font-bold text-lg">{money(summary.grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Labor */}
      <div className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><HardHat className="w-4 h-4" />Labor</h3>
          <Button size="sm" variant="outline" onClick={() => setLaborDialog({ position: currentPositions[0]?.position || '', estimated_hours: '', hourly_rate: currentPositions[0]?.hourly_rate || '', notes: '' })}>
            <Plus className="w-3.5 h-3.5 mr-1" />Add Labor Row
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Position</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Est. Hours</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Rate</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Subtotal</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {laborItems.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No labor estimated yet.</td></tr>
            ) : laborItems.map((li) => (
              <tr key={li.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => setLaborDialog(li)}>
                <td className="px-4 py-2">{li.position}</td>
                <td className="px-4 py-2 text-right font-mono">{Number(li.estimated_hours).toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-mono">{money(li.hourly_rate)}/hr</td>
                <td className="px-4 py-2 text-right font-mono">{money((Number(li.estimated_hours) || 0) * (Number(li.hourly_rate) || 0))}</td>
                <td className="px-2 py-2 text-right"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); deleteLaborRow(li.id); }}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Materials */}
      <div className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><Package className="w-4 h-4" />Materials</h3>
          <Button size="sm" variant="outline" onClick={() => setMaterialDialog({ description: '', quantity: '', unit: 'ea', unit_cost: '', source: 'quote', quote_vendor: '', quote_reference: '', notes: '' })}>
            <Plus className="w-3.5 h-3.5 mr-1" />Add Material
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Description</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Qty</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Unit Cost</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Source</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Total</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {materialItems.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No materials quoted yet.</td></tr>
            ) : materialItems.map((mi) => (
              <tr key={mi.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => setMaterialDialog(mi)}>
                <td className="px-4 py-2">{mi.description}</td>
                <td className="px-4 py-2 text-right font-mono">{mi.quantity} {mi.unit}</td>
                <td className="px-4 py-2 text-right font-mono">{money(mi.unit_cost)}</td>
                <td className="px-4 py-2 capitalize">{mi.source === 'on_hand' ? 'On Hand' : (mi.quote_vendor || 'Quote')}</td>
                <td className="px-4 py-2 text-right font-mono">{money(mi.total_cost)}</td>
                <td className="px-2 py-2 text-right"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); deleteMaterialRow(mi.id); }}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Subcontractors */}
      <div className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><Handshake className="w-4 h-4" />Subcontractors</h3>
          <Button size="sm" variant="outline" onClick={() => setSubDialog({ description: '', subcontractor_name: '', quoted_price: '', notes: '' })}>
            <Plus className="w-3.5 h-3.5 mr-1" />Add Subcontractor
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Scope</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Subcontractor</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Quote</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Quoted Price</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {subItems.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No subcontractor scopes yet.</td></tr>
            ) : subItems.map((si) => (
              <tr key={si.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => setSubDialog(si)}>
                <td className="px-4 py-2">{si.description}</td>
                <td className="px-4 py-2">{si.subcontractor_name}</td>
                <td className="px-4 py-2">{si.quote_document_id ? <span className="inline-flex items-center gap-1 text-xs text-green-600"><FileCheck2 className="w-3.5 h-3.5" />Attached</span> : <span className="text-xs text-muted-foreground">None</span>}</td>
                <td className="px-4 py-2 text-right font-mono">{money(si.quoted_price)}</td>
                <td className="px-2 py-2 text-right"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); deleteSubRow(si.id); }}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {laborDialog && (
        <LaborRowDialog row={laborDialog} positions={currentPositions} onCancel={() => setLaborDialog(null)} onSave={saveLaborRow} />
      )}
      {materialDialog && (
        <MaterialRowDialog row={materialDialog} onCancel={() => setMaterialDialog(null)} onSave={saveMaterialRow} />
      )}
      {subDialog && (
        <SubRowDialog row={subDialog} onCancel={() => setSubDialog(null)} onSave={saveSubRow} />
      )}
    </div>
  );
}

function LaborRowDialog({ row, positions, onCancel, onSave }) {
  const [form, setForm] = useState(row);
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handlePositionChange = (position) => {
    const rate = positions.find((p) => p.position === position)?.hourly_rate;
    setForm((f) => ({ ...f, position, hourly_rate: rate != null ? rate : f.hourly_rate }));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{row.id ? 'Edit Labor Estimate' : 'Add Labor Estimate'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Position</Label>
            {positions.length === 0 ? (
              <p className="text-xs text-amber-600 mt-1">No labor rates configured yet — set them up in Admin &gt; T&M Labor Rates.</p>
            ) : (
              <select value={form.position} onChange={(e) => handlePositionChange(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-input/40 px-2 py-1.5 text-sm">
                <option value="">Select a position…</option>
                {positions.map((p) => <option key={p.position} value={p.position}>{p.position}</option>)}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Estimated Hours</Label>
              <Input type="number" step="0.25" min="0" value={form.estimated_hours} onChange={(e) => setField('estimated_hours', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Hourly Rate ($)</Label>
              <Input type="number" step="0.01" min="0" value={form.hourly_rate} onChange={(e) => setField('hourly_rate', e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes || ''} onChange={(e) => setField('notes', e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={!form.position || !form.estimated_hours} className="steel-gradient text-white border-0">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MaterialRowDialog({ row, onCancel, onSave }) {
  const [form, setForm] = useState(row);
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{row.id ? 'Edit Material Line Item' : 'Add Material Line Item'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => setField('description', e.target.value)} className="mt-1" placeholder={'2" x 1" steel plate'} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Quantity</Label>
              <Input type="number" step="0.01" min="0" value={form.quantity} onChange={(e) => setField('quantity', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Unit</Label>
              <select value={form.unit} onChange={(e) => setField('unit', e.target.value)} className="mt-1 w-full rounded-md border border-input bg-input/40 px-2 py-1.5 text-sm">
                {['ea', 'lb', 'ft', 'ton', 'sqft', 'other'].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <Label>Unit Cost ($)</Label>
              <Input type="number" step="0.01" min="0" value={form.unit_cost} onChange={(e) => setField('unit_cost', e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Source</Label>
            <select value={form.source} onChange={(e) => setField('source', e.target.value)} className="mt-1 w-full rounded-md border border-input bg-input/40 px-2 py-1.5 text-sm">
              <option value="quote">From Vendor Quote</option>
              <option value="on_hand">Already On Hand (zero cost to customer)</option>
            </select>
          </div>
          {form.source !== 'on_hand' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quote Vendor</Label>
                <Input value={form.quote_vendor || ''} onChange={(e) => setField('quote_vendor', e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Quote / PO# Reference</Label>
                <Input value={form.quote_reference || ''} onChange={(e) => setField('quote_reference', e.target.value)} className="mt-1" placeholder="TBD" />
              </div>
            </div>
          )}
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes || ''} onChange={(e) => setField('notes', e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={!form.description || !form.quantity} className="steel-gradient text-white border-0">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubRowDialog({ row, onCancel, onSave }) {
  const [form, setForm] = useState(row);
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const fileInputRef = React.useRef(null);

  return (
    <Dialog open onOpenChange={(o) => !o && !form.saving && onCancel()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{row.id ? 'Edit Subcontractor Line Item' : 'Add Subcontractor Line Item'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Scope Description</Label>
            <Input value={form.description} onChange={(e) => setField('description', e.target.value)} className="mt-1" placeholder="Handrails installation, welding, etc." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Subcontractor</Label>
              <Input value={form.subcontractor_name} onChange={(e) => setField('subcontractor_name', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Quoted Price ($)</Label>
              <Input type="number" step="0.01" min="0" value={form.quoted_price} onChange={(e) => setField('quoted_price', e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Quote Attachment (PDF)</Label>
            {form.quote_document_id && !form.newQuoteFile ? (
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-600 border border-green-500/20"><FileCheck2 className="w-3.5 h-3.5" />Quote on file</span>
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>Replace</Button>
              </div>
            ) : (
              <div onClick={() => fileInputRef.current?.click()} className="mt-1 rounded-lg border-2 border-dashed border-border p-3 flex items-center gap-2 text-center cursor-pointer hover:bg-muted/30 transition-colors">
                <Upload className="w-4 h-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{form.newQuoteFile ? form.newQuoteFile.name : 'Click to attach the subcontractor quote'}</p>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => setField('newQuoteFile', e.target.files?.[0] || null)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes || ''} onChange={(e) => setField('notes', e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={form.saving}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={form.saving || !form.description || !form.subcontractor_name} className="steel-gradient text-white border-0">
            {form.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
