import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

const COST_TYPES = ['labor', 'tax_liability', 'benefits', 'accrual', 'commission'];
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);
const NO_COST_CODE = '__company_wide__';

const emptyForm = () => ({ cost_type: 'labor', gl_account: '', cost_code_id: NO_COST_CODE });

export default function GLMappingsPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [costCodes, setCostCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [mappings, codes] = await Promise.all([
        db.entities.PayrollGLMapping.list('cost_type', 500),
        db.entities.CostCode.filter({ is_active: true }, 'code_name', 200),
      ]);
      setRows(mappings);
      setCostCodes(codes);
    } catch (e) {
      toast({ title: 'Unable to load GL mappings', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const costCodeName = (id) => costCodes.find((c) => c.id === id)?.code_name || null;
  const sortedRows = useMemo(() => [...rows].sort((a, b) => a.cost_type.localeCompare(b.cost_type) || a.gl_account.localeCompare(b.gl_account)), [rows]);

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setShowForm(true); };
  const openEdit = (row) => {
    setEditId(row.id);
    setForm({ cost_type: row.cost_type, gl_account: row.gl_account, cost_code_id: row.cost_code_id || NO_COST_CODE });
    setViewing(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.gl_account.trim()) {
      toast({ title: 'GL account is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        cost_type: form.cost_type,
        gl_account: form.gl_account.trim(),
        cost_code_id: form.cost_code_id === NO_COST_CODE ? '' : form.cost_code_id,
      };
      if (editId) {
        await db.entities.PayrollGLMapping.update(editId, payload);
        toast({ title: 'GL mapping updated' });
      } else {
        await db.entities.PayrollGLMapping.create(payload);
        toast({ title: 'GL mapping added' });
      }
      setShowForm(false);
      setEditId(null);
      setForm(emptyForm());
      await load();
    } catch (e) {
      toast({ title: 'Unable to save GL mapping', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="gap-2 steel-gradient text-white border-0" onClick={openAdd}><Plus className="w-4 h-4" />Add GL Mapping</Button>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-2 px-3">Cost Type</th>
                <th className="text-left py-2 px-3">GL Account</th>
                <th className="text-left py-2 px-3">Cost Code</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} className="py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
              ) : sortedRows.length === 0 ? (
                <tr><td colSpan={3} className="py-8 text-center text-sm text-muted-foreground">No GL mappings configured yet</td></tr>
              ) : sortedRows.map((r) => (
                <tr key={r.id} onClick={() => setViewing(r)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                  <td className="py-2 px-3 font-medium">{titleCase(r.cost_type)}</td>
                  <td className="py-2 px-3 font-mono">{r.gl_account}</td>
                  <td className="py-2 px-3 text-muted-foreground">{costCodeName(r.cost_code_id) || 'Company-wide default'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{titleCase(viewing?.cost_type)} — GL {viewing?.gl_account}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-1.5 text-sm">
              {[
                ['Cost Type', titleCase(viewing.cost_type)],
                ['GL Account', viewing.gl_account],
                ['Cost Code', costCodeName(viewing.cost_code_id) || 'Company-wide default'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-border/50 py-1 last:border-0">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
            <Button onClick={() => openEdit(viewing)} className="steel-gradient text-white border-0">Edit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Add'} GL Mapping</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Cost Type</Label>
              <Select value={form.cost_type} onValueChange={(v) => setForm((f) => ({ ...f, cost_type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COST_TYPES.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">GL Account</Label>
              <Input value={form.gl_account} onChange={(e) => setForm((f) => ({ ...f, gl_account: e.target.value }))} placeholder="e.g. 5100-Labor" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Cost Code (optional)</Label>
              <Select value={form.cost_code_id} onValueChange={(v) => setForm((f) => ({ ...f, cost_code_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COST_CODE}>Company-wide default (no specific cost code)</SelectItem>
                  {costCodes.map((c) => <SelectItem key={c.id} value={c.id}>{c.code_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
