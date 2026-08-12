import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { isAdminUser } from '@/lib/tenantContext';
import { ShieldCheck, Plus, Edit2, Trash2, Loader2, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';

const emptyForm = () => ({ code_name: '', description: '' });

export default function CostCodesAdmin() {
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    db.auth.me().then(u => { setCurrentUser(u); setCheckingAccess(false); }).catch(() => setCheckingAccess(false));
  }, []);

  useEffect(() => { loadCodes(); }, []);

  const loadCodes = async () => {
    setLoading(true);
    try {
      const list = await db.entities.CostCode.list('code_name', 200);
      setCodes(list);
    } catch (e) {
      setCodes([]);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (code) => { setEditId(code.id); setForm({ code_name: code.code_name, description: code.description || '' }); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditId(null); setForm(emptyForm()); };

  const isDuplicate = () => {
    const name = form.code_name.trim().toLowerCase();
    return codes.some(c => c.id !== editId && (c.code_name || '').trim().toLowerCase() === name);
  };

  const handleSave = async () => {
    const name = form.code_name.trim();
    if (!name) return;
    if (isDuplicate()) {
      toast({ title: 'Cost code already exists', description: `"${name}" is already in use for this company.`, variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const data = { code_name: name, description: form.description.trim() };
      if (editId) {
        await db.entities.CostCode.update(editId, data);
        toast({ title: 'Cost code updated' });
      } else {
        await db.entities.CostCode.create({ ...data, is_active: true });
        toast({ title: 'Cost code added' });
      }
      closeModal();
      loadCodes();
    } catch (e) {
      toast({ title: 'Failed to save cost code', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (code) => {
    if (!confirm(`Delete cost code "${code.code_name}"? This cannot be undone.`)) return;
    try {
      await db.entities.CostCode.delete(code.id);
      setCodes(prev => prev.filter(c => c.id !== code.id));
      toast({ title: 'Cost code deleted' });
      if (editId === code.id) closeModal();
    } catch (e) {
      toast({ title: 'Failed to delete cost code', variant: 'destructive' });
    }
  };

  const toggleActive = async (code) => {
    try {
      const updated = await db.entities.CostCode.update(code.id, { is_active: !code.is_active });
      setCodes(prev => prev.map(c => c.id === code.id ? updated : c));
    } catch (e) {
      toast({ title: 'Failed to update cost code', variant: 'destructive' });
    }
  };

  if (checkingAccess) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!isAdminUser(currentUser)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Admin Access Required</h2>
        <p className="text-sm text-muted-foreground">You need administrator privileges to manage cost codes.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Cost Codes"
        subtitle="Company-wide cost code list used across purchasing, job costing, and delivery coding."
        actions={<Button onClick={openAdd} className="steel-gradient text-white border-0"><Plus className="w-4 h-4" />Add Cost Code</Button>}
      />

      <div className="steel-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Code Name</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Active?</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center py-8"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></td></tr>
            ) : codes.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-10 text-muted-foreground">
                  <Tags className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No cost codes yet. Click "Add Cost Code" to create one.
                </td>
              </tr>
            ) : codes.map(code => (
              <tr key={code.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-mono text-xs font-medium">{code.code_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{code.description || '—'}</td>
                <td className="px-4 py-3">
                  <Switch checked={!!code.is_active} onCheckedChange={() => toggleActive(code)} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(code)}><Edit2 className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(code)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Dialog open onOpenChange={closeModal}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? 'Edit Cost Code' : 'Add Cost Code'}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label>Code Name</Label>
                <Input value={form.code_name} onChange={e => setForm(f => ({ ...f, code_name: e.target.value }))} placeholder="e.g. DELIVERY" className="mt-1" />
              </div>
              <div>
                <Label>Description (optional)</Label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Freight and mileage to jobsite" className="mt-1" />
              </div>
            </div>
            <DialogFooter className="flex items-center justify-between sm:justify-between">
              {editId ? (
                <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => handleDelete({ id: editId, code_name: form.code_name })}>
                  <Trash2 className="w-4 h-4" />Delete
                </Button>
              ) : <span />}
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={closeModal}>Cancel</Button>
                <Button onClick={handleSave} disabled={!form.code_name.trim() || saving} className="steel-gradient text-white border-0">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{editId ? 'Update' : 'Save'}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
