import React, { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';

// Searchable multi-select for picking employee sign-in attendees — no
// existing multi-select primitive in ui/, so this composes Popover+Command
// (the same shadcn building blocks already vendored) into one. Selected
// employees render as removable chips below the trigger so the presenter can
// see (and undo) picks without reopening the dropdown.
export default function EmployeeMultiSelect({ employees = [], selectedIds = [], onChange, disabled = false, placeholder = 'Search employees…' }) {
  const [open, setOpen] = useState(false);

  const selected = employees.filter((e) => selectedIds.includes(e.id));

  const toggle = (id) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  };

  const remove = (id) => onChange(selectedIds.filter((x) => x !== id));

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" disabled={disabled} className="w-full justify-between font-normal">
            {selected.length > 0 ? `${selected.length} employee${selected.length === 1 ? '' : 's'} selected` : 'Select employees…'}
            <ChevronsUpDown className="w-4 h-4 opacity-50 flex-shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command>
            <CommandInput placeholder={placeholder} />
            <CommandList>
              <CommandEmpty>No employees found.</CommandEmpty>
              <CommandGroup>
                {employees.map((e) => {
                  const isSelected = selectedIds.includes(e.id);
                  return (
                    <CommandItem key={e.id} value={`${e.full_name} ${e.employee_number}`} onSelect={() => toggle(e.id)}>
                      <Check className={cn('mr-2 h-4 w-4 flex-shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                      <span className="flex-1 truncate">{e.full_name}</span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{e.employee_number}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((e) => (
            <Badge key={e.id} variant="secondary" className="gap-1 pr-1">
              {e.full_name}
              {!disabled && (
                <button type="button" onClick={() => remove(e.id)} className="ml-0.5 rounded-full hover:bg-muted-foreground/20">
                  <X className="w-3 h-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
