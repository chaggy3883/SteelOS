import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Trash2, Search, FileDown } from 'lucide-react';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

// Builds a flat two-column workbook (Shape Type, Size Designation) from the
// { shapeType: [sizes] } map — a simple, re-importable save format. This is
// intentionally not a byte-for-byte round-trip of the original multi-block
// Steel sizes .xlsx layout (see steelCatalogXlsx.js); it only needs to carry
// whatever the editor currently holds back out to a file.
function buildCatalogWorkbook(catalog) {
  const aoa = [['Shape Type', 'Size Designation']];
  Object.entries(catalog).forEach(([shapeType, sizes]) => {
    sizes.forEach((size) => aoa.push([shapeType, size]));
  });
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
}

export default function SteelCatalogEditor({ open, onOpenChange, catalog, onSave }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(catalog);
  const [search, setSearch] = useState('');
  const [newShapeName, setNewShapeName] = useState('');
  const [newSizeShape, setNewSizeShape] = useState('');
  const [newSizeValue, setNewSizeValue] = useState('');

  const shapeTypes = Object.keys(draft);

  // Re-seeds the draft from the latest catalog prop every time the dialog is
  // (re)opened, so repeated opens don't keep editing a stale in-progress copy.
  const handleOpenChange = (nextOpen) => {
    if (nextOpen) {
      setDraft(catalog);
      setSearch('');
    }
    onOpenChange(nextOpen);
  };

  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    return Object.entries(draft).map(([shapeType, sizes]) => ({
      shapeType,
      sizes: term
        ? sizes.filter((s) => s.toLowerCase().includes(term) || shapeType.toLowerCase().includes(term))
        : sizes,
    })).filter((group) => !term || group.sizes.length > 0 || group.shapeType.toLowerCase().includes(term));
  }, [draft, search]);

  const handleAddShape = () => {
    const name = newShapeName.trim();
    if (!name) return;
    if (draft[name]) {
      toast({ title: 'Shape already exists', variant: 'destructive' });
      return;
    }
    setDraft((prev) => ({ ...prev, [name]: [] }));
    setNewShapeName('');
  };

  const handleRemoveShape = (shapeType) => {
    setDraft((prev) => {
      const next = { ...prev };
      delete next[shapeType];
      return next;
    });
  };

  const handleAddSize = () => {
    const shapeType = newSizeShape || shapeTypes[0];
    const size = newSizeValue.trim();
    if (!shapeType || !size) return;
    setDraft((prev) => ({
      ...prev,
      [shapeType]: prev[shapeType]?.includes(size) ? prev[shapeType] : [...(prev[shapeType] || []), size],
    }));
    setNewSizeValue('');
  };

  const handleRemoveSize = (shapeType, size) => {
    setDraft((prev) => ({ ...prev, [shapeType]: prev[shapeType].filter((s) => s !== size) }));
  };

  const handleSave = () => {
    onSave(draft);
    toast({ title: 'Steel catalog updated' });
    handleOpenChange(false);
  };

  const handleDownload = () => {
    const bytes = buildCatalogWorkbook(draft);
    downloadWorkbook(bytes, 'steel-sizes-catalog.xlsx');
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Steel Size Catalog</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search shapes or sizes…"
            className="pl-8 h-8 text-sm"
          />
        </div>

        <div className="border rounded-lg divide-y max-h-[40vh] overflow-y-auto">
          {filteredEntries.map(({ shapeType, sizes }) => (
            <div key={shapeType} className="p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{shapeType}</p>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => handleRemoveShape(shapeType)} title="Remove shape">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              {sizes.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {sizes.map((size) => (
                    <span key={size} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs">
                      {size}
                      <button onClick={() => handleRemoveSize(shapeType, size)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No sizes yet.</p>
              )}
            </div>
          ))}
          {filteredEntries.length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">No matches.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-end gap-2">
            <Input
              value={newShapeName}
              onChange={(e) => setNewShapeName(e.target.value)}
              placeholder="New shape type (e.g. Plate)"
              className="h-8 text-sm"
            />
            <Button size="sm" variant="outline" onClick={handleAddShape}><Plus className="w-3.5 h-3.5" /></Button>
          </div>
          <div className="flex items-end gap-2">
            <Select value={newSizeShape || shapeTypes[0] || ''} onValueChange={setNewSizeShape}>
              <SelectTrigger className="h-8 text-xs w-32"><SelectValue placeholder="Shape" /></SelectTrigger>
              <SelectContent>
                {shapeTypes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              value={newSizeValue}
              onChange={(e) => setNewSizeValue(e.target.value)}
              placeholder="New size (e.g. W12X40)"
              className="h-8 text-sm"
            />
            <Button size="sm" variant="outline" onClick={handleAddSize}><Plus className="w-3.5 h-3.5" /></Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleDownload}>
            <FileDown className="w-4 h-4 mr-1.5" />Download .xlsx
          </Button>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
