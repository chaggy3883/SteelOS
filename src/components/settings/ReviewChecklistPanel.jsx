import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Plus, ListChecks } from 'lucide-react';

const CATEGORIES = ['General/Commercial', 'Division 05', 'Quality/Safety'];
const emptyNewItem = () => ({ item_code: '', item_label: '', category: CATEGORIES[0], keywords: '', note_for_estimator: '' });

// Admin-editable version of what aiIntelligenceEngine.js's Front-End Spec
// Review keyword scan checks every uploaded document against — see
// simulateAiReview()/seedChecklistLines() there. Deactivating an item here
// (rather than deleting) keeps its history on any exception lines it
// already seeded.
export default function ReviewChecklistPanel() {
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState(emptyNewItem());
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadItems(); }, []);

  const loadItems = async () => {
    setLoading(true);
    try {
      const rows = await db.entities.ReviewChecklistItem.list('sort_order', 500);
      setItems(rows);
    } catch (e) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const updateLocal = (id, patch) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const persistField = async (item, patch) => {
    try {
      await db.entities.ReviewChecklistItem.update(item.id, patch);
    } catch (e) {
      toast({ title: 'Unable to save checklist item', variant: 'destructive' });
    }
  };

  const handleToggleActive = (item) => {
    const is_active = !item.is_active;
    updateLocal(item.id, { is_active });
    persistField(item, { is_active });
  };

  const handleAddItem = async () => {
    if (!newItem.item_label.trim() || !newItem.keywords.trim()) {
      toast({ title: 'Item label and keywords are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const maxOrder = items.reduce((max, i) => Math.max(max, i.sort_order || 0), 0);
      const created = await db.entities.ReviewChecklistItem.create({
        ...newItem,
        item_code: newItem.item_code.trim() || `CUSTOM-${maxOrder + 1}`,
        sort_order: maxOrder + 1,
        is_active: true,
      });
      setItems((prev) => [...prev, created]);
      setNewItem(emptyNewItem());
      toast({ title: 'Checklist item added' });
    } catch (e) {
      toast({ title: 'Unable to add checklist item', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-4xl space-y-4">
      <div className="steel-card p-6">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><ListChecks className="w-4 h-4 text-primary" />Add Checklist Item</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Drives the Front-End Spec Review's automatic keyword scan — every active item is checked against each uploaded spec document.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Item Code</Label>
            <Input value={newItem.item_code} onChange={(e) => setNewItem((f) => ({ ...f, item_code: e.target.value }))} className="mt-1" placeholder="e.g. INS-2" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Item Label</Label>
            <Input value={newItem.item_label} onChange={(e) => setNewItem((f) => ({ ...f, item_label: e.target.value }))} className="mt-1" placeholder="e.g. Wire Transfer Fees" />
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={newItem.category} onValueChange={(v) => setNewItem((f) => ({ ...f, category: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3">
          <Label className="text-xs">Keywords (comma-separated)</Label>
          <Textarea value={newItem.keywords} onChange={(e) => setNewItem((f) => ({ ...f, keywords: e.target.value }))} className="mt-1" rows={2} placeholder="e.g. wire transfer, ACH fee, bank fee" />
        </div>
        <div className="mt-3">
          <Label className="text-xs">Note for Estimator (optional)</Label>
          <Input value={newItem.note_for_estimator} onChange={(e) => setNewItem((f) => ({ ...f, note_for_estimator: e.target.value }))} className="mt-1" />
        </div>
        <div className="flex justify-end mt-3">
          <Button onClick={handleAddItem} disabled={saving} className="steel-gradient text-white border-0">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
            Add Item
          </Button>
        </div>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">Checklist — {items.filter((i) => i.is_active).length} active / {items.length} total</h3>
        </div>
        {items.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No checklist items yet — add one above, or load demo data from the Demo Data tab.</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <div key={item.id} className={`p-4 grid grid-cols-1 md:grid-cols-[100px_1fr_1fr_auto] gap-3 items-start ${!item.is_active ? 'opacity-50' : ''}`}>
                <div>
                  <p className="text-xs font-mono font-bold text-primary">{item.item_code}</p>
                  <p className="text-xs text-muted-foreground">{item.category}</p>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">{item.item_label}</p>
                  <Textarea
                    value={item.keywords || ''}
                    onChange={(e) => updateLocal(item.id, { keywords: e.target.value })}
                    onBlur={(e) => persistField(item, { keywords: e.target.value })}
                    className="text-xs min-h-9"
                    rows={2}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Note for Estimator</Label>
                  <Input
                    value={item.note_for_estimator || ''}
                    onChange={(e) => updateLocal(item.id, { note_for_estimator: e.target.value })}
                    onBlur={(e) => persistField(item, { note_for_estimator: e.target.value })}
                    className="mt-1 h-9 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2 justify-end md:justify-start">
                  <Switch checked={!!item.is_active} onCheckedChange={() => handleToggleActive(item)} />
                  <span className="text-xs text-muted-foreground">{item.is_active ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
