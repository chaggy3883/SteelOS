import React, { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { cleanGrade } from '@/lib/materialEntryMath';

// Cascading Material -> Size -> Grade pickers for the Full Takeoff manual
// grid, fed from the master Material Catalog (MaterialShapeType /
// MaterialSizeOption / MaterialGradeOption — the same records the Material
// Catalog admin page maintains). Same Popover + Command composition as
// RoleMultiSelect.jsx, so typing "W", "HSS", "PL" or "Flat Bar" filters.

const CATEGORY_ORDER = ['Structural Steel', 'Stainless', 'Aluminum', 'Bolts/Fasteners', 'Other/Misc'];

export function ShapePicker({ shapeTypes = [], value, onChange, className }) {
  const [open, setOpen] = useState(false);
  const selected = shapeTypes.find((s) => s.shape_code === value);
  const grouped = useMemo(() => {
    const map = new Map();
    shapeTypes.forEach((s) => {
      const cat = s.category || 'Other/Misc';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(s);
    });
    return [...map.entries()].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a[0]);
      const bi = CATEGORY_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [shapeTypes]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" className={cn('h-8 w-full justify-between font-normal text-sm px-2', className)}>
          <span className="truncate">{selected ? `${selected.shape_code} — ${selected.description}` : value || 'Pick material'}</span>
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-50 flex-shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search code or description…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No material found.</CommandEmpty>
            {grouped.map(([category, items]) => (
              <CommandGroup key={category} heading={category}>
                {items.map((s) => (
                  <CommandItem key={s.shape_code} value={`${s.shape_code} ${s.description}`} onSelect={() => { onChange(s); setOpen(false); }}>
                    <Check className={cn('mr-2 h-4 w-4 flex-shrink-0', s.shape_code === value ? 'opacity-100' : 'opacity-0')} />
                    <span className="font-mono text-xs w-14 flex-shrink-0">{s.shape_code}</span>
                    <span className="truncate">{s.description}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// onAddSize(searchText), when given, adds a "+ Add size" footer (and an
// "Add …" button when nothing matches) that hands over whatever was typed
// in the search box — see AddCatalogSizeDialog.
export function SizePicker({ sizes = [], value, onChange, disabled, className, onAddSize }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const unique = useMemo(() => [...new Set(sizes)], [sizes]);
  const startAdd = () => { setOpen(false); onAddSize?.(search.trim()); };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" disabled={disabled} className={cn('h-8 w-full justify-between font-normal text-sm px-2', className)}>
          <span className="truncate">{value || (unique.length ? 'Pick size' : 'No sizes in catalog')}</span>
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-50 flex-shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search size…" value={search} onValueChange={setSearch} />
          <CommandList className="max-h-80">
            <CommandEmpty>
              No size found.
              {onAddSize && search.trim() && (
                <Button type="button" size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={startAdd}>
                  <Plus className="w-3 h-3 mr-1" />Add &quot;{search.trim()}&quot;
                </Button>
              )}
            </CommandEmpty>
            <CommandGroup>
              {unique.map((s) => (
                <CommandItem key={s} value={s} onSelect={() => { onChange(s); setOpen(false); }}>
                  <Check className={cn('mr-2 h-4 w-4 flex-shrink-0', s === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{s}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {onAddSize && (
            <div className="border-t p-1">
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start h-7 text-xs" onClick={startAdd}>
                <Plus className="w-3 h-3 mr-1" />Add size{search.trim() ? ` "${search.trim()}"` : ''}
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Grade: the shape's catalog grades (leading "*" default markers dropped),
// plus "Other" for free entry. A saved grade outside the list shows as
// Other with its text kept, never dropped.
export function GradePicker({ grades = [], value, onChange, className }) {
  const options = useMemo(() => [...new Set(grades.map(cleanGrade).filter(Boolean))], [grades]);
  const [forceOther, setForceOther] = useState(false);
  const isOther = forceOther || (!!value && !options.includes(value)) || options.length === 0;
  return (
    <div className={className}>
      {options.length > 0 && (
        <Select
          value={isOther ? '__other' : (value || '')}
          onValueChange={(v) => {
            if (v === '__other') { setForceOther(true); return; }
            setForceOther(false);
            onChange(v);
          }}
        >
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Pick grade" /></SelectTrigger>
          <SelectContent>
            {options.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            <SelectItem value="__other">Other (type it)</SelectItem>
          </SelectContent>
        </Select>
      )}
      {isOther && (
        <Input value={value || ''} onChange={(e) => onChange(e.target.value)} className={cn('h-8 text-sm', options.length > 0 && 'mt-1')} placeholder="Enter grade" />
      )}
    </div>
  );
}
