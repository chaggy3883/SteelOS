import React, { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Upload, FileSpreadsheet, Save, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

const CATEGORIES = ['Proposal', 'Invoice', 'Packing_Slip', 'Spreadsheet', 'Custom'];

export default function TemplateVaultPanel() {
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pendingName, setPendingName] = useState('');
  const [pendingCategory, setPendingCategory] = useState('Custom');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [savingId, setSavingId] = useState(null);

  useEffect(() => { loadTemplates(); }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.company_templates.filter({ is_active: true }, '-created_date', 100);
      setTemplates(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const created = await base44.entities.company_templates.create({
        template_name: pendingName.trim() || file.name,
        category: pendingCategory,
        file_url,
        file_name: file.name,
        layout_config_text: '',
      });
      setTemplates((prev) => [created, ...prev]);
      setPendingName('');
      toast({ title: 'Template uploaded', description: file.name });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openEditor = (template) => {
    setEditingId(template.id);
    setEditingText(template.layout_config_text || '');
  };

  const saveLayout = async (id) => {
    setSavingId(id);
    try {
      await base44.entities.company_templates.update(id, { layout_config_text: editingText });
      setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, layout_config_text: editingText } : t));
      setEditingId(null);
      toast({ title: 'Layout saved' });
    } finally {
      setSavingId(null);
    }
  };

  const removeTemplate = async (id) => {
    await base44.entities.company_templates.update(id, { is_active: false });
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="steel-card p-6 space-y-3">
        <h3 className="font-semibold">Upload a Custom Template</h3>
        <p className="text-sm text-muted-foreground">Upload a spreadsheet or report layout your team wants SteelOS to recognize as a reusable template.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Label className="text-xs">Template Name</Label>
            <Input placeholder="e.g. West Region Proposal Cover Sheet" value={pendingName} onChange={(e) => setPendingName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={pendingCategory} onValueChange={setPendingCategory}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.docx,.pdf" className="hidden" onChange={handleFileChange} />
        <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
          Upload Spreadsheet / Layout
        </Button>
      </div>

      <div className="steel-card p-6 space-y-3">
        <h3 className="font-semibold">Template Vault</h3>
        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No templates uploaded yet.</p>
        ) : (
          <div className="space-y-3">
            {templates.map((t) => (
              <div key={t.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileSpreadsheet className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{t.template_name}</p>
                      <p className="text-xs text-muted-foreground">{t.category?.replace(/_/g, ' ')} · {t.file_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button size="sm" variant="outline" onClick={() => openEditor(t)}>Edit Layout</Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeTemplate(t.id)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
                {editingId === t.id && (
                  <div className="space-y-2 pt-1">
                    <Label className="text-xs">Layout Parameters</Label>
                    <Textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="min-h-[160px] font-mono text-xs"
                      placeholder="e.g. header_title=Proposal; column_order=item,qty,unit_cost,total; footer_note=..."
                    />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                      <Button size="sm" onClick={() => saveLayout(t.id)} disabled={savingId === t.id} className="steel-gradient text-white border-0">
                        {savingId === t.id ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                        Save Layout
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
