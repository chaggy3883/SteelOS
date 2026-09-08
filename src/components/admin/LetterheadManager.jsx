import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { FileImage, Loader2, Save, Trash2, Pencil, X, CheckCircle2, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import FileDropzone from '@/components/ui/FileDropzone';
import { LETTERHEAD_DOCUMENT_TYPES, LETTERHEAD_DOCUMENT_CATEGORIES } from '@/lib/letterheadDocumentTypes';

const emptyForm = () => ({ id: null, name: '', letterhead_image_url: '', applies_to: [], is_active: true });

// Company letterhead management — assign an uploaded banner image to any
// subset of the app's PDF export types (see letterheadDocumentTypes.js for
// the full, grepped list). Applied at generation time by every PDF
// generator via src/lib/letterheadPdf.js, which re-queries this entity on
// every export (no cache), so a save here takes effect on the very next
// export of any assigned document type.
export default function LetterheadManager() {
  const { toast } = useToast();
  const [letterheads, setLetterheads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());

  useEffect(() => { loadLetterheads(); }, []);

  const loadLetterheads = async () => {
    setLoading(true);
    try {
      const rows = await db.entities.CompanyLetterhead.list('-created_date', 100);
      setLetterheads(rows);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelected = (file) => {
    const reader = new FileReader();
    // A data: URI, not a blob: URL — persists across reloads (blob: URLs are
    // revoked when the tab that created them unloads, which would silently
    // break every future export the moment the browser was closed).
    reader.onload = () => setForm((f) => ({ ...f, letterhead_image_url: reader.result }));
    reader.readAsDataURL(file);
  };

  const toggleAppliesTo = (key) => {
    setForm((f) => ({
      ...f,
      applies_to: f.applies_to.includes(key) ? f.applies_to.filter((k) => k !== key) : [...f.applies_to, key],
    }));
  };

  const toggleCategoryAll = (category, checked) => {
    const categoryKeys = LETTERHEAD_DOCUMENT_TYPES.filter((t) => t.category === category).map((t) => t.key);
    setForm((f) => ({
      ...f,
      applies_to: checked
        ? [...new Set([...f.applies_to, ...categoryKeys])]
        : f.applies_to.filter((k) => !categoryKeys.includes(k)),
    }));
  };

  const startEdit = (letterhead) => {
    setForm({
      id: letterhead.id,
      name: letterhead.name || '',
      letterhead_image_url: letterhead.letterhead_image_url || '',
      applies_to: letterhead.applies_to || [],
      is_active: letterhead.is_active !== false,
    });
  };

  const cancelEdit = () => setForm(emptyForm());

  const handleSave = async () => {
    if (!form.letterhead_image_url) {
      toast({ title: 'Upload an image first', variant: 'destructive' });
      return;
    }
    if (form.applies_to.length === 0) {
      toast({ title: 'Select at least one document type', description: 'A letterhead with no assigned document types would never be used.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim() || 'Untitled Letterhead',
        letterhead_image_url: form.letterhead_image_url,
        applies_to: form.applies_to,
        is_active: form.is_active,
      };
      if (form.id) {
        const updated = await db.entities.CompanyLetterhead.update(form.id, payload);
        setLetterheads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        toast({ title: 'Letterhead updated', description: 'Takes effect on the next export of every assigned document type.' });
      } else {
        const created = await db.entities.CompanyLetterhead.create(payload);
        setLetterheads((prev) => [created, ...prev]);
        toast({ title: 'Letterhead saved', description: 'Takes effect on the next export of every assigned document type.' });
      }
      setForm(emptyForm());
    } catch (e) {
      toast({ title: 'Unable to save letterhead', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (letterhead) => {
    try {
      const updated = await db.entities.CompanyLetterhead.update(letterhead.id, { is_active: !letterhead.is_active });
      setLetterheads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } catch (e) {
      toast({ title: 'Unable to update letterhead', variant: 'destructive' });
    }
  };

  const handleDelete = async (letterhead) => {
    try {
      await db.entities.CompanyLetterhead.delete(letterhead.id);
      setLetterheads((prev) => prev.filter((l) => l.id !== letterhead.id));
      if (form.id === letterhead.id) cancelEdit();
      toast({ title: 'Letterhead deleted' });
    } catch (e) {
      toast({ title: 'Unable to delete letterhead', variant: 'destructive' });
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="steel-card p-6">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><FileImage className="w-4 h-4 text-primary" />{form.id ? 'Edit Letterhead' : 'New Letterhead'}</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Drawn full-width at the top of the page, replacing that document's normal logo/company-name header — see the assigned document types below.
          Applies on the very next export; nothing needs a page refresh or cache clear.
        </p>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Letterhead Name</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Standard Letterhead" className="mt-1" />
          </div>

          <div>
            <Label className="text-xs">Letterhead Image</Label>
            {form.letterhead_image_url ? (
              <div className="mt-1 space-y-2">
                <div className="rounded-lg border border-border bg-muted/30 p-2">
                  <img src={form.letterhead_image_url} alt="Letterhead preview" className="max-h-28 w-full object-contain" />
                </div>
                <Button size="sm" variant="outline" onClick={() => setForm((f) => ({ ...f, letterhead_image_url: '' }))}>Replace Image</Button>
              </div>
            ) : (
              <FileDropzone accept="image/*" label="Drag & drop a letterhead banner, or click to browse" onFileSelected={handleFileSelected} className="mt-1" />
            )}
          </div>

          <div>
            <Label className="text-xs">Applies To</Label>
            <p className="text-[11px] text-muted-foreground mb-2">Every PDF export type in the app — grep-verified against every jsPDF/html2canvas generator, not hand-guessed.</p>
            <div className="space-y-3">
              {LETTERHEAD_DOCUMENT_CATEGORIES.map((category) => {
                const categoryTypes = LETTERHEAD_DOCUMENT_TYPES.filter((t) => t.category === category);
                const allChecked = categoryTypes.every((t) => form.applies_to.includes(t.key));
                return (
                  <div key={category} className="rounded-lg border border-border p-3">
                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer mb-2">
                      <Checkbox checked={allChecked} onCheckedChange={(c) => toggleCategoryAll(category, !!c)} />
                      {category}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-6">
                      {categoryTypes.map((t) => (
                        <label key={t.key} className="flex items-center gap-2 text-xs cursor-pointer">
                          <Checkbox checked={form.applies_to.includes(t.key)} onCheckedChange={() => toggleAppliesTo(t.key)} />
                          {t.label}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={form.is_active} onCheckedChange={(c) => setForm((f) => ({ ...f, is_active: !!c }))} />
            Active
          </label>
        </div>

        <div className="flex gap-2 mt-4">
          {form.id && <Button variant="outline" onClick={cancelEdit}><X className="w-4 h-4 mr-2" />Cancel</Button>}
          <Button onClick={handleSave} disabled={saving} className="gap-2 steel-gradient text-white border-0">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{form.id ? 'Save Changes' : 'Save Letterhead'}
          </Button>
        </div>
      </div>

      <div className="steel-card p-6">
        <h3 className="font-semibold mb-4">Existing Letterheads</h3>
        {letterheads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No letterheads yet — every document uses its default header.</p>
        ) : (
          <div className="space-y-3">
            {letterheads.map((letterhead) => (
              <div key={letterhead.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <img src={letterhead.letterhead_image_url} alt="" className="w-20 h-12 object-contain rounded border border-border bg-muted/30 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{letterhead.name || 'Untitled Letterhead'}</p>
                  <p className="text-xs text-muted-foreground">{(letterhead.applies_to || []).length} document type{(letterhead.applies_to || []).length === 1 ? '' : 's'}</p>
                </div>
                <button type="button" onClick={() => toggleActive(letterhead)} className="flex items-center gap-1.5 text-xs flex-shrink-0" title="Toggle active">
                  {letterhead.is_active !== false
                    ? <><CheckCircle2 className="w-4 h-4 text-green-500" /><span className="text-green-600">Active</span></>
                    : <><Circle className="w-4 h-4 text-muted-foreground" /><span className="text-muted-foreground">Inactive</span></>}
                </button>
                <Button size="sm" variant="ghost" onClick={() => startEdit(letterhead)}><Pencil className="w-3.5 h-3.5" /></Button>
                <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => handleDelete(letterhead)}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
