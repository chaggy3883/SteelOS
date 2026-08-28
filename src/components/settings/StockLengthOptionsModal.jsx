import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Plus, Edit2, Trash2, Ruler } from 'lucide-react';

const emptyForm = () => ({ stock_length_in: '', vendor_id: '', cost_per_length: '', is_active: true });

// STAGE 4: admin-editable stock length options for one steel_catalog item.
// Seeded empty everywhere — real stock lengths/costs come from the user, not
// a hardcoded industry-standard table.
export default function StockLengthOptionsModal({ item, onClose }) {
  const { toast } = useToast();
  const [options, setOptions] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, [item.id]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [optionRows, vendorRows] = await Promise.all([
        db.entities.StockLengthOption.filter({ steel_catalog_item_id: item.id }, 'stock_length_in', 500),
        db.entities.Vendor.filter({ is_active: true }, 'name', 200),
      ]);
      setOptions(optionRows);
      setVendors(vendorRows);
    } catch (e) {
      toast({ title: 'Failed to load stock lengths', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const vendorsById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);

  const openEdit = (option) => {
    setEditId(option.id);
    setForm({
      stock_length_in: String(option.stock_length_in ?? ''),
      vendor_id: option.vendor_id || '',
      cost_per_length: option.cost_per_length != null ? String(option.cost_per_length) : '',
      is_active: option.is_active !== false,
    });
  };
  const cancelForm = () => { setEditId(null); setForm(emptyForm()); };

  const handleSave = async () => {
    const length = parseFloat(form.stock_length_in);
    if (!Number.isFinite(length) || length <= 0) {
      toast({ title: 'Enter a stock length in inches greater than 0', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const data = {
        steel_catalog_item_id: item.id,
        stock_length_in: length,
        vendor_id: form.vendor_id || null,
        cost_per_length: form.cost_per_length.trim() !== '' ? parseFloat(form.cost_per_length) : null,
        is_active: form.is_active,
      };

      if (editId) {
        await db.entities.StockLengthOption.update(editId, data);
        toast({ title: 'Stock length updated' });
      } else {
        await db.entities.StockLengthOption.create(data);
        toast({ title: 'Stock length added' });
      }
      cancelForm();
      loadData();
    } catch (e) {
      toast({ title: 'Failed to save stock length', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (option) => {
    try {
      const updated = await db.entities.StockLengthOption.update(option.id, { is_active: !option.is_active });
      setOptions((prev) => prev.map((o) => (o.id === option.id ? updated : o)));
    } catch (e) {
      toast({ title: 'Failed to update stock length', variant: 'destructive' });
    }
  };

  const handleDelete = async (option) => {
    if (!confirm(`Remove the ${option.stock_length_in}" stock length option?`)) return;
    try {
      await db.entities.StockLengthOption.delete(option.id);
      setOptions((prev) => prev.filter((o) => o.id !== option.id));
      if (editId === option.id) cancelForm();
      toast({ title: 'Stock length removed' });
    } catch (e) {
      toast({ title: 'Failed to remove stock length', variant: 'destructive' });
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stock Lengths — {item.size_designation}</DialogTitle>
        </DialogHeader>

        <div className="steel-card p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {editId ? 'Edit Stock Length' : 'Add Stock Length'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <Label className="text-xs">Length (in)</Label>
              <Input
                type="number"
                value={form.stock_length_in}
                onChange={(e) => setForm((f) => ({ ...f, stock_length_in: e.target.value }))}
                placeholder="e.g. 240"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Preferred Vendor</Label>
              <Select value={form.vendor_id || '__none__'} onValueChange={(v) => setForm((f) => ({ ...f, vendor_id: v === '__none__' ? '' : v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cost per Length</Label>
              <Input
                type="number"
                step="0.01"
                value={form.cost_per_length}
                onChange={(e) => setForm((f) => ({ ...f, cost_per_length: e.target.value }))}
                placeholder="Optional"
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex items-center justify-between mt-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={form.is_active} onCheckedChange={(checked) => setForm((f) => ({ ...f, is_active: checked }))} />
              Active
            </label>
            <div className="flex items-center gap-2">
              {editId && <Button variant="outline" size="sm" onClick={cancelForm}>Cancel</Button>}
              <Button size="sm" onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {editId ? 'Update' : 'Add'}
              </Button>
            </div>
          </div>
        </div>

        <div className="steel-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Length (in)</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Vendor</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Cost</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Active</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-8"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></td></tr>
              ) : options.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-muted-foreground">
                    <Ruler className="w-6 h-6 mx-auto mb-2 opacity-40" />
                    No stock lengths yet for this shape.
                  </td>
                </tr>
              ) : options.map((option) => (
                <tr key={option.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{option.stock_length_in}"</td>
                  <td className="px-3 py-2">{vendorsById.get(option.vendor_id)?.name || '—'}</td>
                  <td className="px-3 py-2">{option.cost_per_length != null ? `$${Number(option.cost_per_length).toLocaleString()}` : '—'}</td>
                  <td className="px-3 py-2"><Switch checked={!!option.is_active} onCheckedChange={() => toggleActive(option)} /></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(option)}><Edit2 className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(option)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
